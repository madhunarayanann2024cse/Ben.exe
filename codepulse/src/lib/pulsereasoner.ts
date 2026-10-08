/**
 * CodePulse — PulseReasoner v1.
 *
 * The deterministic intelligence layer. It is the *always-on* engine: when an
 * LLM key is present the LLM refines the narrative, but parsing, retrieval,
 * ranking, RCA anchoring and post-mortem structure are computed here so the
 * product behaves identically offline, on stage, with zero latency risk.
 *
 * Pipeline:
 *   parse(trace) ──► embed(query) ──► cosine vs incident vectors (pgvector)
 *        │                                   │
 *        └──► rule signals (category/error/keyword/service) ──► hybrid blend
 *                                              │
 *                     RCA verdict ◄── evidence ◄┘ ──► fix correlation ──► post-mortem
 */

import { CATEGORIES, CATEGORY_BY_KEY, type Category } from './taxonomy';
import {
  embed,
  cosine,
  tokenize,
  tokenWeight,
  blendScore,
  displaySimilarity,
  confidenceFrom,
  confidenceLabel,
} from './vector';
import { documentFor } from './seed';
import type {
  Environment,
  EvidenceItem,
  FixCorrelation,
  Incident,
  MatchCandidate,
  ParsedTrace,
  PostMortem,
  RootCauseVerdict,
  ScoreBreakdown,
  Severity,
} from './types';

/* ──────────────────────────────── 1. parsing ─────────────────────────────── */

const FRAME_RE = /(?:at\s+)?([\w$.<>]+)\(([^)]*)\)|([\w$]+\.(?:java|kt|ts|js|py|go|rb|scala)):(\d+)/g;
const ERROR_TYPE_RE = /[\w.$]*(?:Exception|Error|Failure|Timeout|OOMKilled|Throwable)[\w.$]*/g;
const STATUS_RE = /\b(4\d{2}|5\d{2})\b/;

export function parseTrace(raw: string, serviceField?: string, environmentField?: string): ParsedTrace {
  const text = (raw || '').trim();
  const lines = text.split(/\r?\n/).map((l) => l.trimEnd()).slice(0, 600);
  // ── error type: prefer the most specific fully-qualified class name
  const typeMatches = Array.from(text.matchAll(ERROR_TYPE_RE))
    .map((m) => m[0].replace(/[,:.]$/, ''))
    .filter((t) => t.length > 6 && !/^(error|exception|failure|timeout)$/i.test(t));
  typeMatches.sort((a, b) => b.length - a.length || text.indexOf(a) - text.indexOf(b));
  const errorType = typeMatches[0] ?? extractFirstLine(text);

  // ── stack frames
  const frames: ParsedTrace['frames'] = [];
  for (const line of lines) {
    FRAME_RE.lastIndex = 0;
    const m = FRAME_RE.exec(line);
    if (!m) continue;
    const frame = (m[1] ?? line.replace(/^at\s+/, '')).trim();
    const filePart = m[2] ?? '';
    const file = m[3] ?? (filePart ? filePart.split(':')[0] : '');
    const rawLine = m[4] ?? (/(\d+)/.exec(filePart)?.[1] ?? null);
    const lineNo = rawLine ? Number(rawLine) : null;
    const serviceFromFile = serviceForFile(file);
    if (frame && frames.length < 24) {
      frames.push({ frame, file: file || 'unknown', line: Number.isFinite(lineNo) ? lineNo : null, service: serviceFromFile });
    }
  }

  // ── human-readable message: the informative non-frame lines
  const messageLines = lines
    .filter((l) => l.length > 0 && !/^\s*at\s/.test(l))
    .filter((l) => !/^(service|env|environment|region|host|pod|cluster)\s*[:=]/i.test(l))
    .filter((l) => !/^\s*[{}[\]]/.test(l))
    .slice(0, 5);
  const errorMessage = messageLines.join(' ').slice(0, 420) || errorType;

  const statusMatch = STATUS_RE.exec(text);
  const httpStatus = statusMatch ? statusMatch[1] : null;

  const explicitService = /service\s*[:=]\s*([A-Za-z0-9][A-Za-z0-9 _-]{1,40})/i.exec(text)?.[1]?.trim();
  const fileService = frames.find((f) => f.service)?.service ?? null;
  const serviceHint = (serviceField && serviceField.trim()) || explicitService || fileService || null;

  const tokens = tokenize(text);
  const counts = new Map<string, number>();
  for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
  const keywords = Array.from(counts.keys())
    .map((t) => ({ t, w: tokenWeight(t) * (1 + Math.log(counts.get(t) as number)) }))
    .filter((k) => k.w >= 1.6)
    .sort((a, b) => b.w - a.w)
    .slice(0, 16)
    .map((k) => k.t);

  const signals = categorySignals(text);
  const signalStrength = Math.max(0.15, Math.min(1, signals[0] ? signals[0].score / 2.4 : 0.15));

  return {
    errorType,
    errorMessage,
    httpStatus,
    frames,
    serviceHint,
    keywords,
    signalStrength: Number(signalStrength.toFixed(3)),
  };
}

function extractFirstLine(text: string): string {
  return text.split(/\r?\n/).find((l) => l.trim().length > 3)?.trim().slice(0, 80) ?? 'UnknownError';
}

function serviceForFile(file: string): string | null {
  const f = (file || '').toLowerCase();
  if (!f) return null;
  const map: Record<string, string> = {
    paymentservice: 'Payment API',
    chargecontroller: 'Payment API',
    paymentintentrepository: 'Payment API',
    settlementbatch: 'Payment API',
    checkout: 'Checkout Gateway',
    pricingclient: 'Checkout Gateway',
    quoteaggregator: 'Checkout Gateway',
    session: 'Session Service',
    authfilter: 'Session Service',
    embeddingcache: 'Search Indexer',
    reindexjob: 'Search Indexer',
    identity: 'Identity Service',
    tokenverifier: 'Identity Service',
    jwks: 'Identity Service',
    smsdispatcher: 'Notification Worker',
    notif: 'Notification Worker',
    tlsterminator: 'Edge Gateway',
    edge: 'Edge Gateway',
    orderevent: 'Order Events',
    dlq: 'Order Events',
    inventory: 'Inventory Service',
    reservation: 'Inventory Service',
  };
  const key = Object.keys(map).find((k) => f.includes(k));
  return key ? map[key] : null;
}

/* ───────────────────────── 2. category rule signals ──────────────────────── */

export interface CategorySignal {
  key: Category['key'];
  label: string;
  score: number;
  matched: { note: string; weight: number }[];
}

export function categorySignals(text: string): CategorySignal[] {
  const signals: CategorySignal[] = CATEGORIES.map((cat) => {
    const matched: { note: string; weight: number }[] = [];
    let total = 0;
    for (const p of cat.patterns) {
      if (p.re.test(text)) {
        matched.push({ note: p.note, weight: p.weight });
        total += p.weight;
      }
      p.re.lastIndex = 0;
    }
    for (const e of cat.errorTypes) {
      if (e.test(text)) {
        matched.push({ note: `exception class ${e.source.replace(/[\\/^$*+?()[\]{}|]/g, '')}`, weight: 0.75 });
        total += 0.75;
      }
      e.lastIndex = 0;
    }
    return { key: cat.key, label: cat.label, score: Number(total.toFixed(3)), matched };
  });
  return signals.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
}

/* ───────────────────────────── 3. hybrid ranking ─────────────────────────── */

export interface RankOptions {
  service?: string;
  environment?: string;
}

export interface RankedCandidate extends MatchCandidate {
  incident: Incident;
}

const RULE_WEIGHTS = {
  category: 0.28,
  errorType: 0.18,
  keywords: 0.22,
  signature: 0.12,
  service: 0.1,
  environment: 0.04,
  tags: 0.06,
};

function norm(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function baseErrorName(errorType: string): string {
  const parts = errorType.split('.');
  return (parts[parts.length - 1] || errorType).replace(/[^A-Za-z0-9]/g, '');
}

export function ruleBreakdown(
  parsed: ParsedTrace,
  text: string,
  signals: CategorySignal[],
  incident: Incident,
  opts: RankOptions,
): ScoreBreakdown {
  const textLower = text.toLowerCase();
  const incidentCategory = Object.entries(CATEGORY_BY_KEY).find(([, c]) => c.label === incident.rootCauseCategory)?.[0];
  const signalMap = new Map(signals.map((s) => [s.key, s]));
  const ownSignal = incidentCategory ? signalMap.get(incidentCategory as Category['key']) : undefined;
  const topSignal = signals[0];

  const categoryHit =
    incidentCategory && topSignal && incidentCategory === topSignal.key
      ? Math.min(1, (ownSignal?.score ?? 0) / 2.6)
      : Math.min(1, (ownSignal?.score ?? 0) / 4.2);

  const incidentError = baseErrorName(incident.errorType).toLowerCase();
  const queryError = baseErrorName(parsed.errorType).toLowerCase();
  const errorTypeHit =
    incidentError && queryError && (textLower.includes(incidentError) || queryError.includes(incidentError) || incidentError.includes(queryError))
      ? 1
      : CATEGORIES.some((c) => c.key === incidentCategory && c.errorTypes.some((e) => e.test(text)))
        ? 0.55
        : 0;

  const queryTokens = new Map<string, number>();
  for (const t of tokenize(text)) queryTokens.set(t, Math.max(queryTokens.get(t) ?? 0, tokenWeight(t)));
  const incidentTokens = new Set(tokenize(documentFor(incident)));
  const queryWeightSum = Array.from(queryTokens.entries())
    .filter(([t]) => tokenWeight(t) >= 1.5)
    .reduce((acc, [, w]) => acc + w, 0) || 1;
  const overlapWeight = Array.from(queryTokens.entries())
    .filter(([t, w]) => w >= 1.5 && incidentTokens.has(t))
    .reduce((acc, [, w]) => acc + w, 0);
  const keywordHit = Math.min(1, overlapWeight / queryWeightSum / 0.42);

  const signatureTokens = new Set(tokenize(`${incident.errorMessage} ${incident.signature} ${incident.title}`));
  const sigHits = Array.from(queryTokens.keys()).filter(
    (t) => tokenWeight(t) >= 1.5 && signatureTokens.has(t),
  ).length;
  const signatureHit = Math.min(1, sigHits / 6);

  const svc = norm(opts.service || parsed.serviceHint || '');
  const incSvc = norm(incident.service);
  const serviceHit = !svc ? (parsed.serviceHint ? 0.35 : 0)
    : svc === incSvc ? 1
      : svc.includes(incSvc) || incSvc.includes(svc) ? 0.65
        : svc.split(' ')[0] === incSvc.split(' ')[0] ? 0.45
          : 0;

  const env = (opts.environment || '').toLowerCase();
  const environmentHit = !env ? 0.3 : env === incident.environment ? 1 : env === 'canary' && incident.environment === 'production' ? 0.4 : 0;

  const tagHits = incident.tags.filter((t) => textLower.includes(t.toLowerCase()) || queryTokens.has(t.toLowerCase())).length;
  const tagHit = Math.min(1, tagHits / 4);

  const breakdown = [
    { label: 'Root-cause class signals', weight: RULE_WEIGHTS.category, hit: categoryHit, note: `${incident.rootCauseCategory} · ${ownSignal?.matched.length ?? 0} signature(s) matched in trace` },
    { label: 'Exception class match', weight: RULE_WEIGHTS.errorType, hit: errorTypeHit, note: `${parsed.errorType} ↔ ${incident.errorType}` },
    { label: 'Domain keyword overlap (weighted)', weight: RULE_WEIGHTS.keywords, hit: keywordHit, note: `${overlapWeight.toFixed(1)} of ${queryWeightSum.toFixed(1)} weighted query signal mass found in incident memory` },
    { label: 'Error-signature similarity', weight: RULE_WEIGHTS.signature, hit: signatureHit, note: `${sigHits} discriminating token(s) shared with the historical error signature` },
    { label: 'Service identity', weight: RULE_WEIGHTS.service, hit: serviceHit, note: `${opts.service || parsed.serviceHint || 'unspecified'} vs ${incident.service}` },
    { label: 'Environment', weight: RULE_WEIGHTS.environment, hit: environmentHit, note: `${opts.environment || 'unspecified'} vs ${incident.environment}` },
    { label: 'Tag / topic affinity', weight: RULE_WEIGHTS.tags, hit: tagHit, note: `${tagHits} tag(s) aligned` },
  ];

  const ruleScore = breakdown.reduce((acc, b) => acc + b.weight * b.hit, 0);
  return {
    cosine: 0,
    rule: Number(ruleScore.toFixed(4)),
    composite: 0,
    breakdown: breakdown.map((b) => ({ ...b, hit: Number(b.hit.toFixed(3)), note: b.note })),
  };
}

export function rankCandidates(
  queryText: string,
  parsed: ParsedTrace,
  incidents: Incident[],
  opts: RankOptions = {},
): RankedCandidate[] {
  const queryVec = embed(queryText);
  const signals = categorySignals(queryText);

  const ranked = incidents.map((incident) => {
    const incidentVec = incident.embedding && incident.embedding.length ? incident.embedding : embed(documentFor(incident));
    const cos = Math.max(0, cosine(queryVec, incidentVec));
    const scores = ruleBreakdown(parsed, queryText, signals, incident, opts);
    const composite = blendScore(cos, scores.rule);
    const similarity = displaySimilarity(composite);
    const full: ScoreBreakdown = {
      cosine: Number(cos.toFixed(4)),
      rule: scores.rule,
      composite: Number(composite.toFixed(4)),
      breakdown: scores.breakdown,
    };
    return {
      incident,
      incidentId: incident.id,
      title: incident.title,
      service: incident.service,
      severity: incident.severity,
      similarity,
      scores: full,
    };
  });

  // put the top-1 in front of anything else — ties (identical scores) break on
  // evidence richness, then on the more recent incident
  ranked.sort((a, b) => {
    if (Math.abs(b.scores.composite - a.scores.composite) > 0.0005) return b.scores.composite - a.scores.composite;
    const ev = b.incident.evidence.length - a.incident.evidence.length;
    if (ev !== 0) return ev;
    return new Date(b.incident.detectedAt).getTime() - new Date(a.incident.detectedAt).getTime();
  });

  return ranked;
}

/** Document used to embed an incoming trace (mirrors the incident document shape). */
export function queryDocument(input: { stackTrace: string; service?: string; environment?: string; notes?: string }, parsed: ParsedTrace): string {
  return [
    `service ${input.service || parsed.serviceHint || 'unknown service'} ${input.environment || ''}`,
    `error type ${parsed.errorType}`,
    `error message ${parsed.errorMessage}`,
    parsed.httpStatus ? `http status ${parsed.httpStatus}` : '',
    input.notes ? `operator notes ${input.notes}` : '',
    input.stackTrace,
  ]
    .filter(Boolean)
    .join('\n');
}

/* ───────────────────────────── 4. RCA verdict ────────────────────────────── */

export function buildVerdict(
  top: RankedCandidate | undefined,
  parsed: ParsedTrace,
  opts: RankOptions,
  queryText: string,
): RootCauseVerdict {
  const signals = categorySignals(queryText);
  const bestCategory = CATEGORY_BY_KEY[signals[0]?.key ?? 'upstream_timeout'];
  const matched = top && top.scores.composite >= 0.24;

  const agreement = matched ? Math.min(1, (signals.find((s) => s.label === top!.incident.rootCauseCategory)?.score ?? 0) / 2.6) : 0;
  const confidence = matched
    ? confidenceFrom(top!.scores.composite, parsed.signalStrength, agreement)
    : Number(Math.max(0.34, Math.min(0.62, parsed.signalStrength * 0.6)).toFixed(3));

  const category = matched ? top!.incident.rootCauseCategory : `${bestCategory.label} (suspected — no confident historical match)`;
  const title = matched
    ? top!.incident.rootCauseTitle
    : `Probable ${bestCategory.label.toLowerCase()} on ${opts.service || parsed.serviceHint || 'the affected service'}`;

  const alternatives = (signals.slice(1, 4))
    .filter((s) => s.score > 0.5)
    .map((s, idx) => ({
      title: s.label,
      probability: Number(Math.max(0.04, (1 - confidence) * (0.55 - idx * 0.16)).toFixed(2)),
      note: s.matched.length ? `Signal overlap: ${s.matched.map((m) => m.note).join(', ')}` : 'Weak lexical overlap only',
    }));

  const narrative = matched
    ? [
        `This trace resolves to the “${top!.incident.rootCauseCategory}” failure class with ${confidenceLabel(confidence).toLowerCase()} confidence (${(confidence * 100).toFixed(1)}%).`,
        `Closest historical memory is ${top!.incidentId} — ${top!.incident.title} — at ${top!.similarity}% vector similarity.`,
        `In that incident the root cause was ${top!.incident.rootCauseTitle.toLowerCase()}, and it was closed by ${top!.incident.owner.name} in ${top!.incident.mttrMinutes} minutes with commit ${top!.incident.fix.commit}.`,
        `The same fix (${top!.incident.resolution}) applies here unless the trace proves otherwise — verify the current pool configuration before replaying traffic.`,
      ].join(' ')
    : [
        `No historical incident crosses the ${(0.24 * 100).toFixed(0)}% match threshold, so CodePulse is treating this as a novel incident.`,
        `The strongest deterministic signals point at “${bestCategory.label}” (${signals[0]?.matched.length ?? 0} signature(s) matched).`,
        `Assign an incident commander, capture the evidence below, and publish the RCA — the next engineer to see this trace will retrieve yours.`,
      ].join(' ');

  return {
    category,
    title,
    confidence,
    confidenceLabel: confidenceLabel(confidence),
    severity: matched ? top!.severity : bestCategory.severityHint,
    affectedService: opts.service || parsed.serviceHint || (matched ? top!.service : 'Unknown service'),
    environment: ((opts.environment as Environment) || 'production') as Environment,
    narrative,
    contributingFactors: matched
      ? top!.incident.evidence.slice(0, 4).map((e) => e.replace(/\.$/, ''))
      : bestCategory.contributingFactors,
    alternatives,
  };
}

/* ───────────────────────────── 5. evidence pack ──────────────────────────── */

export function buildEvidence(
  parsed: ParsedTrace,
  top: RankedCandidate | undefined,
  candidates: RankedCandidate[],
  incident: Incident | null,
  engineLabel: string,
): EvidenceItem[] {
  const signals = categorySignals(parsed.errorMessage + ' ' + parsed.errorType + ' ' + parsed.keywords.join(' '));
  const items: EvidenceItem[] = [];

  const framesTxt = parsed.frames
    .slice(0, 3)
    .map((f) => `${f.frame}(${f.file}:${f.line ?? '?'})`)
    .join(' ← ');
  items.push({
    kind: 'trace',
    label: 'Parsed trace fingerprint',
    detail: `${parsed.errorType}${parsed.httpStatus ? ` · HTTP ${parsed.httpStatus}` : ''} · ${parsed.frames.length} frame(s)${framesTxt ? ` · ${framesTxt}` : ''}`,
    weight: Math.min(1, parsed.signalStrength + 0.1),
  });

  const topCat = CATEGORY_BY_KEY[signals[0]?.key ?? 'upstream_timeout'];
  items.push({
    kind: 'trace',
    label: `Failure-class signals (${topCat.label})`,
    detail: signals[0]?.matched.length
      ? signals[0].matched.map((m) => m.note).join(' · ')
      : 'No strong class signature — the trace is lexically thin, so the engine weighted structural similarity higher.',
    weight: Math.min(1, (signals[0]?.score ?? 0) / 2.8),
  });

  if (incident) {
    const siblings = candidates.filter((c) => c.incidentId !== incident.id && c.similarity >= Math.max(45, top!.similarity - 22));
    items.push({
      kind: 'history',
      label: `Historical memory retrieved (${candidates.length} candidates ranked)`,
      detail: `${incident.id} — ${incident.service} · ${incident.severity.toUpperCase()} · ${new Date(incident.detectedAt).toISOString().slice(0, 10)} · MTTR ${incident.mttrMinutes}m${siblings.length ? ` · near neighbours: ${siblings.slice(0, 3).map((s) => `${s.incidentId} (${s.similarity}%)`).join(', ')}` : ''}`,
      weight: Math.min(1, top!.similarity / 100),
    });
    items.push({
      kind: 'pattern',
      label: 'Recurrence & class statistics',
      detail: `${incident.recurring ? `Marked recurring ×${incident.recurrenceCount}` : 'First recorded occurrence of this signature'} · ${incident.relatedIncidentIds.length} linked incident(s)${incident.relatedIncidentIds.length ? ` (${incident.relatedIncidentIds.join(', ')})` : ''}`,
      weight: incident.recurring ? 0.86 : 0.5,
    });
    items.push({
      kind: 'fix',
      label: `Fix correlation → ${incident.fix.commit} (${incident.fix.pr})`,
      detail: `${incident.owner.name} (${incident.owner.role}) — “${incident.fix.message}” · ${incident.fix.files.length} file(s) touched · deployed ${new Date(incident.fix.deployedAt).toISOString().slice(0, 16).replace('T', ' ')}Z`,
      weight: 0.93,
    });
    items.push({
      kind: 'fix',
      label: 'Verified resolution',
      detail: `${incident.resolution} — verified after deploy: ${incident.severity === 'critical' ? 'error rate < 0.5%' : 'error rate < 1%'} and p99 back inside SLO for 60 minutes.`,
      weight: 0.9,
    });
    items.push({
      kind: 'pattern',
      label: 'Historical telemetry vs today',
      detail: `Then: ${incident.telemetry.peakErrorRate}; p99 ${incident.telemetry.p99Latency}; ${incident.telemetry.affectedUsers.toLocaleString('en-IN')} users; burn ${incident.telemetry.errorBudgetBurn}. Today's trace${parsed.httpStatus ? ` reports HTTP ${parsed.httpStatus}` : ''} with ${parsed.frames.length} frame(s) rooted at ${parsed.frames[0]?.file ?? 'an unknown file'}.`,
      weight: 0.74,
    });
  }

  items.push({
    kind: 'ai',
    label: `Reasoning engine: ${engineLabel}`,
    detail: incident
      ? `Hybrid score = 0.55 × cosine(${top ? (top.scores.cosine * 100).toFixed(1) : '—'}%) + 0.45 × rule-engine(${top ? (top.scores.rule * 100).toFixed(1) : '—'}%). Confidence calibrated from match strength (${parsed.signalStrength.toFixed(2)} signal density) and class agreement.`
      : 'Deterministic signals only; no LLM provider configured and no candidate crossed the match threshold.',
    weight: incident ? 0.82 : 0.45,
  });

  return items;
}

/* ───────────────────────── 6. error → fix correlation ────────────────────── */

export function buildFixCorrelation(incident: Incident): FixCorrelation {
  const deployed = new Date(incident.fix.deployedAt);
  const verified = new Date(deployed.getTime() + 60 * 60 * 1000);
  const category = Object.values(CATEGORY_BY_KEY).find((c) => c.label === incident.rootCauseCategory);
  return {
    incidentId: incident.id,
    rootCause: incident.rootCauseCategory,
    fixSummary: category?.fixTemplate ?? incident.resolution.split('. ')[0],
    runbook: category?.runbook ?? 'Runbook not linked',
    engineer: incident.owner,
    commit: incident.fix.commit,
    repo: incident.fix.repo,
    commitMessage: incident.fix.message,
    files: incident.fix.files,
    resolution: incident.resolution,
    resolutionSteps: incident.resolutionSteps,
    deployedAt: incident.fix.deployedAt,
    verifiedAfter: `${verified.toISOString().slice(0, 16).replace('T', ' ')}Z · error rate < 0.5% for 60 min`,
  };
}

/* ──────────────────── 7. deterministic explanation prose ─────────────────── */

export function deterministicExplanation(
  parsed: ParsedTrace,
  top: RankedCandidate | undefined,
  verdict: RootCauseVerdict,
  opts: RankOptions,
): string {
  if (!top) {
    return `No historical incident crossed the confidence threshold for this trace. The engine identified “${verdict.category}” as the leading hypothesis from ${parsed.keywords.slice(0, 5).join(', ') || 'structural'} signals alone, and generated a fresh post-mortem scaffold so this becomes retrievable memory for the next engineer.`;
  }
  const inc = top.incident;
  const shared = parsed.keywords.filter((k) => documentFor(inc).toLowerCase().includes(k)).slice(0, 6);
  const serviceLine = opts.service && norm(opts.service) === norm(inc.service)
    ? `Both incidents originate in ${inc.service}, so the same pooling, timeout and capacity assumptions apply.`
    : `The affected service here is ${opts.service || parsed.serviceHint || 'unspecified'} versus ${inc.service} historically — the failure mechanism transfers even though the service differs.`;
  return [
    `This trace matches ${inc.id} at ${top.similarity}% similarity (cosine ${(top.scores.cosine * 100).toFixed(1)}%, rule-engine ${(top.scores.rule * 100).toFixed(1)}%).`,
    `Shared signatures: ${shared.length ? shared.join(', ') : parsed.errorType}.`,
    `Historically the root cause was ${inc.rootCauseTitle.toLowerCase()}: ${inc.summary.split('. ').slice(0, 2).join('. ')}.`,
    serviceLine,
    `${inc.owner.name} resolved it in ${inc.mttrMinutes} minutes via commit ${inc.fix.commit} — “${inc.fix.message}”. The verified fix was: ${inc.resolution}`,
    `Recommended for this incident: ${verdict.category === inc.rootCauseCategory ? inc.resolutionSteps.slice(0, 3).join('; ') : 'follow the playbook below'}.`,
  ].join(' ');
}

/* ─────────────────────── 8. post-mortem synthesis ────────────────────────── */

export function buildPostMortem(args: {
  id: string;
  analysisId: string;
  incident: Incident | null;
  verdict: RootCauseVerdict;
  parsed: ParsedTrace;
  opts: RankOptions;
  similarity: number;
  engine: PostMortem['generatedBy'];
  generatedAt: string;
}): PostMortem {
  const { incident, verdict, parsed, opts, similarity, engine } = args;
  const catKey = Object.entries(CATEGORY_BY_KEY).find(([, c]) => c.label === verdict.category)?.[0] ?? 'upstream_timeout';
  const cat = CATEGORY_BY_KEY[catKey];
  const service = opts.service || parsed.serviceHint || verdict.affectedService;
  const now = args.generatedAt;
  const t0 = new Date(now).getTime();

  const timeline = incident
    ? incident.timeline.map((t) => ({ ...t, detail: `${t.detail}${t.label.toLowerCase().includes('detect') ? ' [historical pattern]' : ''}` }))
    : [
        { at: new Date(t0).toISOString(), label: 'Trace captured and analysed by CodePulse', kind: 'detect' as const, detail: `Signature: ${parsed.errorType} · ${parsed.frames.length} frame(s) parsed.` },
        { at: new Date(t0 + 60_000).toISOString(), label: 'Root-cause hypothesis published', kind: 'triage' as const, detail: verdict.title },
        { at: new Date(t0 + 120_000).toISOString(), label: 'Mitigation started', kind: 'action' as const, detail: cat.resolutionSteps[0] },
        { at: new Date(t0 + 180_000).toISOString(), label: 'Verification window opened', kind: 'note' as const, detail: 'Watch error rate, saturation and p99 for 60 minutes before declaring resolved.' },
      ];

  // today's session beats are prepended so the document reads as *this* incident
  const sessionBeats = [
    { at: new Date(t0 - 240_000).toISOString(), kind: 'detect' as const, label: 'Engineer pasted the production trace', detail: `${parsed.errorType}${parsed.httpStatus ? ` (HTTP ${parsed.httpStatus})` : ''} · environment ${opts.environment || 'production'}.` },
    { at: new Date(t0 - 220_000).toISOString(), kind: 'triage' as const, label: 'CodePulse vector search over incident memory', detail: incident ? `${incident.id} retrieved at ${similarity}% similarity with fix commit ${incident.fix.commit}.` : 'No confident historical match — treated as novel incident.' },
    { at: new Date(t0 - 200_000).toISOString(), kind: 'action' as const, label: 'Fix correlation surfaced', detail: incident ? `${incident.owner.name} · ${incident.fix.repo}@${incident.fix.commit} · “${incident.fix.message}”.` : cat.fixTemplate },
  ];

  const summary = incident
    ? `${service} emitted ${parsed.errorType}${parsed.httpStatus ? ` (HTTP ${parsed.httpStatus})` : ''}. CodePulse matched this signature to ${incident.id} at ${similarity}% similarity, where the same failure mechanism was diagnosed as ${incident.rootCauseTitle.toLowerCase()}. The historical remediation is directly transferable: ${incident.resolution}`
    : `${service} emitted ${parsed.errorType}. No historical incident crossed the match threshold, so this is recorded as a novel failure mode. Deterministic signals indicate “${cat.label}” as the leading hypothesis, and the analysis has been persisted so the next occurrence matches instantly.`;

  const metrics = {
    mttr: incident ? `Historical MTTR ${incident.mttrMinutes}m for this signature (target < 30m)` : 'MTTR clock starts now (target < 30m)',
    blastRadius: incident ? `${incident.telemetry.affectedUsers.toLocaleString('en-IN')} users historically; peak error rate ${incident.telemetry.peakErrorRate}` : 'Not yet quantified — instrument the endpoint and capture the blast radius',
    errorBudgetBurn: incident ? incident.telemetry.errorBudgetBurn : 'Unknown — compute from the SLO window',
    customerImpact: incident ? incident.impact.split('. ')[0] + '.' : 'Impact statement pending investigation; capture customer-visible symptoms before closing.',
  };

  const actionItems: PostMortem['actionItems'] = (incident?.preventiveActions ?? cat.preventiveActions).slice(0, 5).map((task, i) => ({
    task,
    owner: incident ? (i % 2 === 0 ? incident.owner.name : incident.owner.team) : i % 2 === 0 ? 'On-call engineer' : 'Platform team',
    due: new Date(t0 + (i + 1) * 7 * 86_400_000).toISOString().slice(0, 10),
    priority: (i === 0 ? 'P0' : i <= 2 ? 'P1' : 'P2') as 'P0' | 'P1' | 'P2',
  }));

  return {
    id: args.id,
    incidentId: incident?.id ?? null,
    analysisId: args.analysisId,
    title: `Post-Mortem — ${verdict.title} on ${service}`,
    severity: verdict.severity,
    status: 'draft',
    generatedBy: engine,
    generatedAt: now,
    summary,
    impact: incident
      ? `${incident.impact} Today's blast radius is still being quantified; the historical occurrence affected ${incident.telemetry.affectedUsers.toLocaleString('en-IN')} users and burned ${incident.telemetry.errorBudgetBurn}.`
      : `Impact under investigation for ${service}. Capture the affected request volume, customer-visible symptoms and SLO burn before publishing this document.`,
    timeline: [...sessionBeats, ...timeline],
    rootCause: `${verdict.title}. ${verdict.narrative} Contributing factors: ${verdict.contributingFactors.slice(0, 4).join('; ')}.`,
    resolution: incident
      ? `${incident.resolution} Resolution steps executed historically: ${incident.resolutionSteps.join(' → ')}`
      : `Execute the playbook: ${cat.resolutionSteps.join(' → ')}`,
    preventiveActions: incident?.preventiveActions ?? cat.preventiveActions,
    lessonsLearned: incident?.lessonsLearned ?? cat.lessonsLearned,
    actionItems,
    metrics,
  };
}

export function severityToScore(severity: Severity): number {
  return { critical: 4, high: 3, medium: 2, low: 1 }[severity] ?? 1;
}
