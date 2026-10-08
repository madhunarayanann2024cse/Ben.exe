/**
 * CodePulse — analysis orchestrator.
 *
 * The full flow executed for every "Analyze Incident" click, entirely on the
 * server:
 *
 *  1. parse      — fingerprint the pasted trace (type, message, frames, HTTP)
 *  2. embed      — 384-d vector of the trace (same embedder as the corpus)
 *  3. retrieve   — pgvector / in-process cosine ANN over incident memory
 *  4. re-rank    — hybrid blend of cosine × domain rule engine
 *  5. reason     — LLM (if a key is configured) or built-in PulseReasoner
 *  6. correlate  — error → incident → root cause → engineer → commit → fix
 *  7. explain    — why this match, which signals drove it
 *  8. post-mortem— generated document with actions, owners, lessons
 *  9. persist    — analysis + post-mortem + AI telemetry to the live database
 */

import { db, type DbInfo } from './db';
import { embed } from './vector';
import {
  buildEvidence,
  buildFixCorrelation,
  buildPostMortem,
  buildVerdict,
  deterministicExplanation,
  parseTrace,
  queryDocument,
  rankCandidates,
} from './pulsereasoner';
import { llmComplete, providerInfo } from './ai/providers';
import { PROMPTS, logAi, heartbeat } from './telemetry';
import type { AnalysisRecord, AnalysisResult, EngineKind, PostMortem, RootCauseVerdict } from './types';

export interface AnalyzeInput {
  stackTrace: string;
  service?: string;
  environment?: string;
  notes?: string;
}

function tryJson<T>(text: string): T | null {
  if (!text) return null;
  const cleaned = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

function candidateBlock(candidates: { incidentId: string; similarity: number; title: string; service: string; severity: string; rootCause: string; resolution: string; engineer: string; commit: string }[]): string {
  return candidates
    .map(
      (c, i) =>
        `${i + 1}. ${c.incidentId} · ${c.similarity}% · ${c.title}\n   service=${c.service} severity=${c.severity}\n   root_cause=${c.rootCause}\n   resolved_by=${c.engineer} commit=${c.commit}\n   fix=${c.resolution}`,
    )
    .join('\n');
}

export async function analyzeIncident(input: AnalyzeInput): Promise<AnalysisResult> {
  const t0 = Date.now();
  const stages: AnalysisResult['stages'] = [];
  const warnings: string[] = [];
  const mark = (name: string, detail: string, since: number) => stages.push({ name, detail, ms: Date.now() - since });

  /* ── 1. parse ─────────────────────────────────────────────────────────── */
  let t = Date.now();
  const parsed = parseTrace(input.stackTrace, input.service, input.environment);
  const service = (input.service || parsed.serviceHint || 'Unknown Service').trim();
  const environment = (input.environment || 'production').trim();
  mark('Trace parsed', `${parsed.errorType}${parsed.httpStatus ? ` · HTTP ${parsed.httpStatus}` : ''} · ${parsed.frames.length} frame(s) · ${parsed.keywords.length} weighted signals`, t);

  /* ── 2. load memory + embed + retrieve ───────────────────────────────── */
  t = Date.now();
  const incidents = await db.getIncidents();
  const queryText = queryDocument({ ...input, service, environment }, parsed);
  const embedding = embed(queryText);
  const search = await db.vectorSearch(embedding, 10);
  const backend: DbInfo['vectorSearch'] = search.backend;
  mark(
    'Vector retrieval',
    `${incidents.length} incidents indexed · ANN over ${embedding.length}-d vectors via ${backend} · ${search.ranked.length} candidates`,
    t,
  );

  /* ── 3. hybrid re-rank ───────────────────────────────────────────────── */
  t = Date.now();
  const ranked = rankCandidates(queryText, parsed, incidents, { service, environment });
  const candidates = ranked.slice(0, 6);
  const top = candidates[0];
  mark('Hybrid re-rank', `cosine × rule-engine blend across ${ranked.length} memories · top score ${top ? top.similarity : 0}%`, t);

  /* ── 4. verdict + evidence + fix correlation ─────────────────────────── */
  t = Date.now();
  const info = providerInfo();
  let verdict: RootCauseVerdict = buildVerdict(top, parsed, { service, environment }, queryText);
  let explanation = deterministicExplanation(parsed, top, verdict, { service, environment });
  let engine: EngineKind = 'pulsereasoner';
  mark('Root cause hypothesis', `${verdict.title} · confidence ${(verdict.confidence * 100).toFixed(1)}% (${verdict.confidenceLabel})`, t);

  /* ── 5. LLM reasoning (optional, server-side only) ───────────────────── */
  const memoryBlock = candidateBlock(
    candidates.map((c) => ({
      incidentId: c.incidentId,
      similarity: c.similarity,
      title: c.title,
      service: c.service,
      severity: c.severity,
      rootCause: c.incident.rootCauseCategory,
      resolution: c.incident.resolution,
      engineer: c.incident.owner.name,
      commit: c.incident.fix.commit,
    })),
  );

  let llmPostMortem: Partial<PostMortem> | null = null;

  if (info.live) {
    t = Date.now();
    const rootUser = PROMPTS.rootCauseUser(input.stackTrace, memoryBlock, service, environment);
    const pmContext = [
      `service=${service} environment=${environment}`,
      `trace error=${parsed.errorType} :: ${parsed.errorMessage}`,
      `closest incident=${top ? `${top.incidentId} (${top.similarity}%)` : 'none'}`,
      top ? `historical detail:\n${top.incident.stackTrace.slice(0, 1200)}\nimpact=${top.incident.impact}\nresolution=${top.incident.resolution}\nowner=${top.incident.owner.name} commit=${top.incident.fix.commit} mttr=${top.incident.mttrMinutes}m` : '',
      `engine verdict=${verdict.title} confidence=${verdict.confidence}`,
    ].join('\n');

    const [rootRes, pmRes] = await Promise.all([
      llmComplete({ system: PROMPTS.rootCauseSystem, user: rootUser, json: true, maxTokens: 900, temperature: 0.15 }),
      llmComplete({ system: PROMPTS.postMortemSystem, user: PROMPTS.postMortemUser(pmContext), json: true, maxTokens: 1100, temperature: 0.2 }),
    ]);

    const parsedRoot = rootRes.ok
      ? tryJson<{
          rootCauseTitle?: string;
          rootCauseCategory?: string;
          confidence?: number;
          severity?: RootCauseVerdict['severity'];
          affectedService?: string;
          explanation?: string;
          contributingFactors?: string[];
          alternatives?: { title: string; probability: number; note: string }[];
          preventiveActions?: string[];
        }>(rootRes.text)
      : null;

    if (parsedRoot) {
      engine = 'llm';
      verdict = {
        ...verdict,
        title: parsedRoot.rootCauseTitle?.trim() || verdict.title,
        category: parsedRoot.rootCauseCategory?.trim() || verdict.category,
        confidence: parsedRoot.confidence ? Math.max(0.3, Math.min(0.97, Number(parsedRoot.confidence))) : verdict.confidence,
        severity: parsedRoot.severity ?? verdict.severity,
        affectedService: parsedRoot.affectedService?.trim() || verdict.affectedService,
        contributingFactors: parsedRoot.contributingFactors?.length ? parsedRoot.contributingFactors.slice(0, 5) : verdict.contributingFactors,
        alternatives: parsedRoot.alternatives?.length ? parsedRoot.alternatives.slice(0, 3) : verdict.alternatives,
        narrative: parsedRoot.explanation?.trim() || verdict.narrative,
      };
      verdict.confidenceLabel =
        verdict.confidence >= 0.85 ? 'Very High' : verdict.confidence >= 0.7 ? 'High' : verdict.confidence >= 0.55 ? 'Moderate' : 'Low — needs human review';
      if (parsedRoot.preventiveActions?.length && top) {
        llmPostMortem = { preventiveActions: parsedRoot.preventiveActions.slice(0, 6) };
      }
    }

    if (pmRes.ok) {
      const parsedPm = tryJson<Partial<PostMortem>>(pmRes.text);
      if (parsedPm) llmPostMortem = { ...(llmPostMortem ?? {}), ...parsedPm, };
    }

    // a separate, focused explanation call produces the best prose
    const explainRes = await llmComplete({
      system: PROMPTS.explanationSystem,
      user: PROMPTS.explanationUser(
        input.stackTrace,
        top ? `${top.incidentId} — ${top.incident.title}\nroot_cause=${top.incident.rootCauseTitle}\nowner=${top.incident.owner.name}\ncommit=${top.incident.fix.commit}\nfix=${top.incident.resolution}\nstack:\n${top.incident.stackTrace.slice(0, 900)}` : 'none',
        top?.similarity ?? 0,
        verdict.narrative,
      ),
      maxTokens: 320,
      temperature: 0.25,
    });

    if (top && explainRes.ok && explainRes.text.length > 60) explanation = explainRes.text.replace(/\s+/g, ' ').trim();

    mark(
      'LLM reasoning (server-side)',
      `${info.label} · ${info.model} · root-cause ${rootRes.latencyMs}ms, post-mortem ${pmRes.latencyMs}ms, explanation ${explainRes.latencyMs}ms${rootRes.ok ? '' : ' (degraded to PulseReasoner)'}`,
      t,
    );

    if (!rootRes.ok) warnings.push(`LLM root-cause call failed (${rootRes.error ?? 'unknown'}) — deterministic PulseReasoner verdict used.`);

    await logAi({
      kind: 'reasoning',
      system: PROMPTS.rootCauseSystem,
      user: rootUser,
      output: rootRes.text,
      result: rootRes,
      metadata: { stage: 'root-cause', matchedIncident: top?.incidentId ?? 'none', similarity: top?.similarity ?? 0 },
    });
    await logAi({
      kind: 'postmortem',
      system: PROMPTS.postMortemSystem,
      user: pmContext,
      output: pmRes.text,
      result: pmRes,
      metadata: { stage: 'post-mortem' },
    });
  } else {
    warnings.push('No LLM API key configured — analysis produced by the built-in PulseReasoner engine (fully functional, deterministic, offline).');
  }

  /* ── 6. evidence pack + fix correlation ─────────────────────────────── */
  t = Date.now();
  const matchedIncident = top && top.scores.composite >= 0.24 ? top.incident : null;
  const evidence = buildEvidence(parsed, top, candidates, matchedIncident, engine === 'llm' ? `${info.label} + PulseReasoner retrieval` : 'PulseReasoner v1 (deterministic)');
  const fix = matchedIncident ? buildFixCorrelation(matchedIncident) : null;
  mark('Evidence + fix correlation', `${evidence.length} evidence items · ${fix ? `commit ${fix.commit} by ${fix.engineer.name}` : 'no historical fix to reuse'}`, t);

  /* ── 7. post-mortem ─────────────────────────────────────────────────── */
  t = Date.now();
  const analysisId = db.id('an');
  const generatedAt = new Date().toISOString();
  let postMortem = buildPostMortem({
    id: db.id('pm'),
    analysisId,
    incident: matchedIncident,
    verdict,
    parsed,
    opts: { service, environment },
    similarity: top?.similarity ?? 0,
    engine,
    generatedAt,
  });

  if (llmPostMortem) {
    postMortem = {
      ...postMortem,
      summary: llmPostMortem.summary?.trim() || postMortem.summary,
      impact: llmPostMortem.impact?.trim() || postMortem.impact,
      rootCause: llmPostMortem.rootCause?.trim() || postMortem.rootCause,
      resolution: llmPostMortem.resolution?.trim() || postMortem.resolution,
      preventiveActions: llmPostMortem.preventiveActions?.length ? llmPostMortem.preventiveActions : postMortem.preventiveActions,
      lessonsLearned: llmPostMortem.lessonsLearned?.length ? llmPostMortem.lessonsLearned : postMortem.lessonsLearned,
      actionItems: llmPostMortem.actionItems?.length ? llmPostMortem.actionItems : postMortem.actionItems,
      generatedBy: engine,
    };
  }
  mark('Post-mortem generated', `${postMortem.preventiveActions.length} preventive actions · ${postMortem.actionItems.length} action items · ${postMortem.timeline.length} timeline beats`, t);

  /* ── 8. persist everything ──────────────────────────────────────────── */
  t = Date.now();
  const tookMs = Date.now() - t0;
  const record: AnalysisRecord = {
    id: analysisId,
    createdAt: generatedAt,
    service,
    environment,
    stackTrace: input.stackTrace.slice(0, 20_000),
    notes: input.notes,
    engine,
    matchedIncidentId: matchedIncident?.id ?? null,
    similarity: top?.similarity ?? 0,
    confidence: verdict.confidence,
    predictedRootCause: verdict.title,
    predictedSeverity: verdict.severity,
    postMortemId: postMortem.id,
    tookMs,
  };

  const infoAfter = await db.info();
  const result: AnalysisResult = {
    id: analysisId,
    analysisId,
    createdAt: generatedAt,
    tookMs,
    engine,
    engineLabel: engine === 'llm' ? `${info.label} · ${info.model}` : 'PulseReasoner v1 (deterministic)',
    dbBackend: infoAfter.backend,
    parsed,
    match: top ?? null,
    candidates: candidates.map((c) => ({
      incidentId: c.incidentId,
      title: c.title,
      service: c.service,
      severity: c.severity,
      similarity: c.similarity,
      scores: c.scores,
      summary: c.incident.summary,
      rootCauseCategory: c.incident.rootCauseCategory,
      rootCauseTitle: c.incident.rootCauseTitle,
      ownerName: c.incident.owner.name,
      commit: c.incident.fix.commit,
      detectedAt: c.incident.detectedAt,
      mttrMinutes: c.incident.mttrMinutes,
      recurring: c.incident.recurring,
    })),
    rootCause: verdict,
    evidence,
    fix,
    explanation,
    postMortem,
    stages,
    persisted: false,
    warnings: [...warnings, ...infoAfter.warnings],
  };

  let persisted = false;
  try {
    await db.saveAnalysis(record, result);
    await db.savePostMortem(postMortem);
    persisted = true;
  } catch (err) {
    warnings.push(`Persistence warning: ${(err as Error).message}`);
  }
  result.persisted = persisted;
  mark('Persisted to database', `${infoAfter.label} · analysis ${analysisId} + post-mortem ${postMortem.id}${persisted ? '' : ' (write failed — see warnings)'}`, t);

  // Structured analysis telemetry — written for every run, LLM or deterministic,
  // so the Captain's Logbook always carries a complete audit trail.
  await logAi({
    kind: 'analysis',
    system: PROMPTS.rootCauseSystem,
    user: [
      `ANALYSIS ${analysisId} · service=${service} environment=${environment}`,
      `trace fingerprint: ${parsed.errorType}${parsed.httpStatus ? ` HTTP ${parsed.httpStatus}` : ''} · ${parsed.frames.length} frames · signals ${parsed.keywords.slice(0, 8).join(', ')}`,
      'retrieved memory:',
      memoryBlock,
      `pasted trace:\n${input.stackTrace.slice(0, 1200)}`,
    ].join('\n'),
    output: JSON.stringify(
      {
        engine,
        matchedIncident: matchedIncident?.id ?? null,
        similarity: top?.similarity ?? 0,
        scoreSplit: { cosine: top?.scores.cosine ?? 0, rule: top?.scores.rule ?? 0, composite: top?.scores.composite ?? 0 },
        rootCause: verdict.title,
        confidence: verdict.confidence,
        severity: verdict.severity,
        affectedService: verdict.affectedService,
        correlatedFix: fix ? { engineer: fix.engineer.name, commit: fix.commit, runbook: fix.runbook, fixSummary: fix.fixSummary } : null,
        postMortem: postMortem.id,
      },
      null,
      2,
    ),
    analysisId,
    metadata: {
      stage: 'analysis-complete',
      matchedIncident: matchedIncident?.id ?? 'none',
      similarity: top?.similarity ?? 0,
      persisted,
      tookMs,
      vectorSearch: backend,
      engine,
    },
  });

  // embedding + heartbeat telemetry (non-blocking, best effort)
  void logAi({
    kind: 'embedding',
    system: 'Embedding model',
    user: `embed(trace) → ${embedding.length}-d signed-hash vector · service=${service} · tokens=${parsed.keywords.length}`,
    output: `vector[384] · l2_norm=1.0 · retrieval=${backend}`,
    analysisId,
    metadata: { dims: embedding.length, backend, signals: parsed.keywords.length },
  }).catch(() => undefined);

  void heartbeat().catch(() => undefined);

  return result;
}
