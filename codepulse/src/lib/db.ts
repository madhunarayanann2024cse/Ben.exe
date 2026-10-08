/**
 * CodePulse — persistence layer.
 *
 * ┌ Supabase PostgreSQL (service-role, server-side only)
 * │   • incidents / analyses / post_mortems / ai_logs
 * │   • pgvector `match_incidents` RPC for ANN ranking when the extension is
 * │     present (vector(384) + ivfflat index) — see supabase/schema.sql
 * └ Embedded durable store (./data/codepulse.json)
 *     • automatic fallback if Supabase env vars are missing or the table isn't
 *       created yet, so the live demo can never fail on stage
 *
 * Nothing in this file is ever imported by client components.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { AiLog, AnalysisRecord, DbBackend, Incident, PostMortem } from './types';
import { buildSeedIncidents, SEED_VERSION } from './seed';
import { cosine } from './vector';

export interface TelemetryEntry {
  id: string;
  at: string;
  kind: 'heartbeat';
  provider: string;
  model: string;
  fallback: boolean;
  latencyMs: number;
  tokensEst: number;
  promptHash: string;
  promptPreview: string;
  promptFull: string;
  outputPreview: string;
  metadata?: Record<string, string | number | boolean>;
}

interface StoreShape {
  version: string;
  seededAt: string | null;
  incidents: Incident[];
  analyses: AnalysisRecord[];
  postMortems: PostMortem[];
  aiLogs: (AiLog | TelemetryEntry)[];
}

export interface DbInfo {
  backend: DbBackend;
  label: string;
  supabaseConfigured: boolean;
  pgvector: boolean;
  vectorSearch: 'pgvector-rpc' | 'in-process-cosine';
  incidents: number;
  analyses: number;
  postMortems: number;
  aiLogs: number;
  seededAt: string | null;
  warnings: string[];
}

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_SCHEMA = process.env.SUPABASE_SCHEMA || 'public';
export const supabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_KEY);

/** bounded diagnostic buffer (latest 12 notices) — surfaced by /api/health */
const dbWarnings: string[] = [];
function note(msg: string) {
  dbWarnings.push(msg);
  if (dbWarnings.length > 12) dbWarnings.shift();
}

/* ─────────────────────────────── local store ─────────────────────────────── */

const DATA_FILE =
  process.env.CODEPULSE_DATA_FILE ||
  (process.env.VERCEL ? '/tmp/codepulse-data.json' : path.join(process.cwd(), 'data', 'codepulse.json'));

let memoryStore: StoreShape | null = null;
let writeChain: Promise<unknown> = Promise.resolve();

function emptyStore(): StoreShape {
  return { version: SEED_VERSION, seededAt: null, incidents: [], analyses: [], postMortems: [], aiLogs: [] };
}

async function readLocal(): Promise<StoreShape> {
  if (memoryStore) return memoryStore;
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw) as StoreShape;
    memoryStore = { ...emptyStore(), ...parsed };
  } catch {
    memoryStore = emptyStore();
    // seed immediately so every read path has the historical corpus available
    memoryStore.incidents = buildSeedIncidents();
    memoryStore.seededAt = new Date().toISOString();
    memoryStore.aiLogs = [];
    await writeLocal();
  }
  return memoryStore;
}

async function writeLocal(): Promise<void> {
  if (!memoryStore) return;
  const snapshot = JSON.stringify(memoryStore, null, 2);
  writeChain = writeChain.then(async () => {
    try {
      await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
      await fs.writeFile(DATA_FILE, snapshot, 'utf8');
    } catch (err) {
      console.error('[codepulse/db] local write failed:', (err as Error).message);
    }
  });
  await writeChain;
}

/* ─────────────────────────────── supabase REST ───────────────────────────── */

let supabaseReady: boolean | null = null;


function sbHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Accept-Profile': SUPABASE_SCHEMA,
    'Content-Profile': SUPABASE_SCHEMA,
    ...extra,
  };
}

async function sbFetch(pathname: string, init: RequestInit = {}): Promise<Response> {
  const url = `${SUPABASE_URL}/rest/v1/${pathname}`;
  return fetch(url, { ...init, headers: { ...sbHeaders(), ...(init.headers as Record<string, string>) }, cache: 'no-store' });
}

/** Probe the remote schema once per process. */
async function probeSupabase(): Promise<boolean> {
  if (!supabaseConfigured) return false;
  if (supabaseReady !== null) return supabaseReady;
  try {
    const res = await sbFetch('incidents?select=id&limit=1', { method: 'GET' });
    if (res.ok) {
      supabaseReady = true;
      note('Supabase PostgreSQL connected (service-role, server-side only).');
    } else {
      supabaseReady = false;
      const body = await res.text();
      note(
        `Supabase reachable but table "incidents" is unavailable (HTTP ${res.status}): ${body.slice(0, 160)} — run supabase/schema.sql. Using embedded store.`,
      );
    }
  } catch (err) {
    supabaseReady = false;
    note(`Supabase unreachable (${(err as Error).message}). Using embedded store.`);
  }
  return supabaseReady;
}

async function sbSelect<T>(table: string, query = 'select=*'): Promise<T[]> {
  const res = await sbFetch(`${table}?${query}`, { method: 'GET' });
  if (!res.ok) throw new Error(`select ${table} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T[];
}

async function sbUpsert(table: string, rows: unknown[]): Promise<void> {
  if (rows.length === 0) return;
  const res = await sbFetch(table, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`upsert ${table} failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
}

/* ─────────────────────────── row <-> model mapping ───────────────────────── */

function incidentToRow(i: Incident) {
  return {
    id: i.id,
    title: i.title,
    service: i.service,
    environment: i.environment,
    severity: i.severity,
    status: i.status,
    detected_at: i.detectedAt,
    resolved_at: i.resolvedAt,
    mttr_minutes: i.mttrMinutes,
    recurring: i.recurring,
    recurrence_count: i.recurrenceCount,
    root_cause_category: i.rootCauseCategory,
    root_cause_title: i.rootCauseTitle,
    summary: i.summary,
    error_type: i.errorType,
    error_message: i.errorMessage,
    signature: i.signature,
    stack_trace: i.stackTrace,
    evidence: i.evidence,
    impact: i.impact,
    resolution: i.resolution,
    resolution_steps: i.resolutionSteps,
    preventive_actions: i.preventiveActions,
    lessons_learned: i.lessonsLearned,
    owner: i.owner,
    fix: i.fix,
    related_incident_ids: i.relatedIncidentIds,
    tags: i.tags,
    telemetry: i.telemetry,
    timeline: i.timeline,
    embedding: i.embedding ? JSON.stringify(i.embedding) : null,
    embedding_version: i.embeddingVersion ?? null,
  };
}

function rowToIncident(r: Record<string, unknown>): Incident {
  let embedding: number[] | undefined;
  const raw = r.embedding;
  if (Array.isArray(raw)) embedding = raw as number[];
  else if (typeof raw === 'string' && raw.startsWith('[')) {
    try {
      embedding = JSON.parse(raw) as number[];
    } catch {
      embedding = undefined;
    }
  }
  return {
    id: String(r.id),
    title: String(r.title),
    service: String(r.service),
    environment: r.environment as Incident['environment'],
    severity: r.severity as Incident['severity'],
    status: r.status as Incident['status'],
    detectedAt: String(r.detected_at),
    resolvedAt: (r.resolved_at as string) ?? null,
    mttrMinutes: Number(r.mttr_minutes ?? 0),
    recurring: Boolean(r.recurring),
    recurrenceCount: Number(r.recurrence_count ?? 0),
    rootCauseCategory: String(r.root_cause_category),
    rootCauseTitle: String(r.root_cause_title),
    summary: String(r.summary),
    errorType: String(r.error_type),
    errorMessage: String(r.error_message),
    signature: String(r.signature),
    stackTrace: String(r.stack_trace),
    evidence: (r.evidence as string[]) ?? [],
    impact: String(r.impact),
    resolution: String(r.resolution),
    resolutionSteps: (r.resolution_steps as string[]) ?? [],
    preventiveActions: (r.preventive_actions as string[]) ?? [],
    lessonsLearned: (r.lessons_learned as string[]) ?? [],
    owner: r.owner as Incident['owner'],
    fix: r.fix as Incident['fix'],
    relatedIncidentIds: (r.related_incident_ids as string[]) ?? [],
    tags: (r.tags as string[]) ?? [],
    telemetry: r.telemetry as Incident['telemetry'],
    timeline: (r.timeline as Incident['timeline']) ?? [],
    embedding,
    embeddingVersion: (r.embedding_version as string) ?? undefined,
  };
}

function analysisToRow(a: AnalysisRecord, result: unknown) {
  return {
    id: a.id,
    created_at: a.createdAt,
    service: a.service,
    environment: a.environment,
    stack_trace: a.stackTrace,
    notes: a.notes ?? null,
    engine: a.engine,
    matched_incident_id: a.matchedIncidentId,
    similarity: a.similarity,
    confidence: a.confidence,
    predicted_root_cause: a.predictedRootCause,
    predicted_severity: a.predictedSeverity,
    post_mortem_id: a.postMortemId,
    took_ms: a.tookMs,
    result,
  };
}

function postMortemToRow(p: PostMortem) {
  return {
    id: p.id,
    incident_id: p.incidentId,
    analysis_id: p.analysisId,
    title: p.title,
    severity: p.severity,
    status: p.status,
    generated_by: p.generatedBy,
    generated_at: p.generatedAt,
    summary: p.summary,
    impact: p.impact,
    timeline: p.timeline,
    root_cause: p.rootCause,
    resolution: p.resolution,
    preventive_actions: p.preventiveActions,
    lessons_learned: p.lessonsLearned,
    action_items: p.actionItems,
    metrics: p.metrics,
  };
}

function logToRow(l: AiLog | TelemetryEntry) {
  return {
    id: l.id,
    at: l.at,
    kind: l.kind,
    provider: l.provider,
    model: l.model,
    fallback: l.fallback,
    latency_ms: l.latencyMs,
    tokens_est: l.tokensEst,
    prompt_hash: l.promptHash,
    prompt_preview: l.promptPreview,
    prompt_full: l.promptFull,
    output_preview: l.outputPreview,
    analysis_id: (l as AiLog).analysisId ?? null,
    metadata: l.metadata ?? {},
  };
}

/* ───────────────────────────────── public API ────────────────────────────── */

export const db = {
  id(prefix: string): string {
    return `${prefix}_${crypto.randomBytes(5).toString('hex')}`;
  },

  async info(): Promise<DbInfo> {
    const remote = await probeSupabase();
    const store = await readLocal();
    let incidents = store.incidents.length;
    let analyses = store.analyses.length;
    let postMortems = store.postMortems.length;
    let aiLogs = store.aiLogs.length;
    let seededAt = store.seededAt;

    if (remote) {
      try {
        const inc = await sbSelect<{ id: string }>('incidents', 'select=id');
        const ana = await sbSelect<{ id: string }>('analyses', 'select=id&limit=1000');
        const pm = await sbSelect<{ id: string }>('post_mortems', 'select=id&limit=1000');
        const logs = await sbSelect<{ id: string }>('ai_logs', 'select=id&limit=2000');
        incidents = inc.length;
        analyses = ana.length;
        postMortems = pm.length;
        aiLogs = logs.length;
        seededAt = store.seededAt ?? null;
      } catch {
        /* ignore — fall back to local counters */
      }
    }

    const backend: DbBackend = remote ? 'supabase-postgres' : 'local-file';
    return {
      backend,
      label: remote ? 'Supabase PostgreSQL' : 'Embedded durable store (Supabase not configured)',
      supabaseConfigured,
      pgvector: remote,
      vectorSearch: remote ? 'pgvector-rpc' : 'in-process-cosine',
      incidents,
      analyses,
      postMortems,
      aiLogs,
      seededAt,
      warnings: dbWarnings,
    };
  },

  /** Load the incident corpus from whichever backend is live. */
  async getIncidents(): Promise<Incident[]> {
    if (await probeSupabase()) {
      try {
        const rows = await sbSelect<Record<string, unknown>>('incidents', 'select=*&order=detected_at.desc');
        if (rows.length > 0) return rows.map(rowToIncident);
        // empty remote table → seed it from the canonical corpus
        const seeds = buildSeedIncidents();
        await sbUpsert('incidents', seeds.map(incidentToRow));
        return seeds;
      } catch (err) {
        note(`Supabase read failed: ${(err as Error).message}`);
      }
    }
    return (await readLocal()).incidents;
  },

  async getIncident(id: string): Promise<Incident | null> {
    const all = await this.getIncidents();
    return all.find((i) => i.id.toUpperCase() === id.toUpperCase()) ?? null;
  },

  /**
   * ANN ranking. Uses the pgvector `match_incidents` RPC when the extension is
   * present (vector(384) + ivfflat), otherwise ranks with in-process cosine
   * over the same 384-d vectors — identical results, no external dependency.
   */
  async vectorSearch(
    embedding: number[],
    limit = 6,
  ): Promise<{ ranked: { id: string; similarity: number }[]; backend: DbInfo['vectorSearch'] }> {
    const incidents = await this.getIncidents();
    const local = incidents
      .map((i) => ({ id: i.id, similarity: i.embedding ? cosine(embedding, i.embedding) : 0 }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    if (await probeSupabase()) {
      try {
        const res = await sbFetch('rpc/match_incidents', {
          method: 'POST',
          body: JSON.stringify({ query_embedding: embedding, match_threshold: 0, match_count: limit }),
        });
        if (res.ok) {
          const remote = (await res.json()) as { id: string; similarity: number }[];
          if (Array.isArray(remote) && remote.length > 0) {
            return { ranked: remote, backend: 'pgvector-rpc' };
          }
        }
      } catch {
        /* fall through to in-process ranking */
      }
    }
    return { ranked: local, backend: 'in-process-cosine' };
  },

  async saveAnalysis(record: AnalysisRecord, fullResult: unknown): Promise<void> {
    if (await probeSupabase()) {
      try {
        await sbUpsert('analyses', [analysisToRow(record, fullResult)]);
        return;
      } catch (err) {
        note(`Supabase analysis write failed: ${(err as Error).message}`);
      }
    }
    const store = await readLocal();
    store.analyses.unshift(record);
    store.analyses = store.analyses.slice(0, 500);
    await writeLocal();
  },

  async getAnalyses(limit = 25): Promise<AnalysisRecord[]> {
    if (await probeSupabase()) {
      try {
        const rows = await sbSelect<Record<string, unknown>>(
          'analyses',
          `select=id,created_at,service,environment,engine,matched_incident_id,similarity,confidence,predicted_root_cause,predicted_severity,post_mortem_id,took_ms&order=created_at.desc&limit=${limit}`,
        );
        return rows.map((r) => ({
          id: String(r.id),
          createdAt: String(r.created_at),
          service: String(r.service),
          environment: String(r.environment),
          stackTrace: '',
          engine: r.engine as AnalysisRecord['engine'],
          matchedIncidentId: (r.matched_incident_id as string) ?? null,
          similarity: Number(r.similarity ?? 0),
          confidence: Number(r.confidence ?? 0),
          predictedRootCause: String(r.predicted_root_cause),
          predictedSeverity: r.predicted_severity as AnalysisRecord['predictedSeverity'],
          postMortemId: (r.post_mortem_id as string) ?? null,
          tookMs: Number(r.took_ms ?? 0),
        }));
      } catch (err) {
        note(`Supabase analyses read failed: ${(err as Error).message}`);
      }
    }
    return (await readLocal()).analyses.slice(0, limit);
  },

  async savePostMortem(pm: PostMortem): Promise<void> {
    if (await probeSupabase()) {
      try {
        await sbUpsert('post_mortems', [postMortemToRow(pm)]);
        return;
      } catch (err) {
        note(`Supabase post-mortem write failed: ${(err as Error).message}`);
      }
    }
    const store = await readLocal();
    store.postMortems = [pm, ...store.postMortems.filter((p) => p.id !== pm.id)].slice(0, 300);
    await writeLocal();
  },

  async getPostMortems(limit = 20): Promise<PostMortem[]> {
    if (await probeSupabase()) {
      try {
        const rows = await sbSelect<Record<string, unknown>>('post_mortems', `select=*&order=generated_at.desc&limit=${limit}`);
        return rows.map((r) => ({
          id: String(r.id),
          incidentId: (r.incident_id as string) ?? null,
          analysisId: (r.analysis_id as string) ?? null,
          title: String(r.title),
          severity: r.severity as PostMortem['severity'],
          status: r.status as PostMortem['status'],
          generatedBy: r.generated_by as PostMortem['generatedBy'],
          generatedAt: String(r.generated_at),
          summary: String(r.summary),
          impact: String(r.impact),
          timeline: (r.timeline as PostMortem['timeline']) ?? [],
          rootCause: String(r.root_cause),
          resolution: String(r.resolution),
          preventiveActions: (r.preventive_actions as string[]) ?? [],
          lessonsLearned: (r.lessons_learned as string[]) ?? [],
          actionItems: (r.action_items as PostMortem['actionItems']) ?? [],
          metrics: (r.metrics as PostMortem['metrics']) ?? { mttr: '', blastRadius: '', errorBudgetBurn: '', customerImpact: '' },
        }));
      } catch (err) {
        note(`Supabase post-mortem read failed: ${(err as Error).message}`);
      }
    }
    return (await readLocal()).postMortems.slice(0, limit);
  },

  async getPostMortem(id: string): Promise<PostMortem | null> {
    const all = await this.getPostMortems(200);
    return all.find((p) => p.id === id) ?? null;
  },

  async logAi(entry: AiLog | TelemetryEntry): Promise<void> {
    if (await probeSupabase()) {
      try {
        await sbUpsert('ai_logs', [logToRow(entry)]);
        return;
      } catch (err) {
        note(`Supabase ai_log write failed: ${(err as Error).message}`);
      }
    }
    const store = await readLocal();
    store.aiLogs = [entry, ...store.aiLogs].slice(0, 600);
    await writeLocal();
  },

  async getAiLogs(limit = 60): Promise<(AiLog | TelemetryEntry)[]> {
    if (await probeSupabase()) {
      try {
        const rows = await sbSelect<Record<string, unknown>>('ai_logs', `select=*&order=at.desc&limit=${limit}`);
        if (rows.length > 0) {
          return rows.map((r) => ({
            id: String(r.id),
            at: String(r.at),
            kind: r.kind as AiLog['kind'],
            provider: String(r.provider),
            model: String(r.model),
            fallback: Boolean(r.fallback),
            latencyMs: Number(r.latency_ms ?? 0),
            tokensEst: Number(r.tokens_est ?? 0),
            promptHash: String(r.prompt_hash),
            promptPreview: String(r.prompt_preview),
            promptFull: String(r.prompt_full ?? r.prompt_preview),
            outputPreview: String(r.output_preview),
            analysisId: (r.analysis_id as string) ?? undefined,
            metadata: (r.metadata as AiLog['metadata']) ?? {},
          }));
        }
      } catch (err) {
        note(`Supabase ai_log read failed: ${(err as Error).message}`);
      }
    }
    return (await readLocal()).aiLogs.slice(0, limit);
  },

  async resetLocal(): Promise<void> {
    memoryStore = null;
    await readLocal();
  },
};

export type Db = typeof db;
