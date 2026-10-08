/**
 * CodePulse — AI telemetry & Captain's Logbook.
 *
 * Every model interaction is persisted to `ai_logs` (Supabase) or the embedded
 * store:
 *   • one row per analysis  (prompt, hash, latency, tokens, provider, fallback)
 *   • one row per embedding call
 *   • one heartbeat row every 10 minutes (hackathon "logbook" requirement)
 *
 * Prompts are redacted before storage — secrets, JWTs and bearer tokens never
 * reach the database, and no key material is ever returned to the client.
 */

import { db } from './db';
import { hashPrompt, redact, estimateTokens, providerInfo, type LlmResult } from './ai/providers';
import type { AiLog } from './types';

const HEARTBEAT_INTERVAL_MS = Number(process.env.NEXT_PUBLIC_TELEMETRY_INTERVAL_MS || 600_000);

let lastHeartbeat = 0;

export async function logAi(input: {
  kind: AiLog['kind'];
  system?: string;
  user?: string;
  output?: string;
  result?: LlmResult;
  analysisId?: string;
  metadata?: Record<string, string | number | boolean>;
}): Promise<AiLog> {
  const info = providerInfo();
  const system = input.system ?? '';
  const user = input.user ?? '';
  const combined = `${system}\n${user}`;
  const output = input.output ?? input.result?.text ?? '';

  const entry: AiLog = {
    id: db.id('log'),
    at: new Date().toISOString(),
    kind: input.kind,
    provider: input.result?.provider ?? info.provider,
    model: input.result?.model ?? info.model,
    fallback: !(input.result?.ok ?? false),
    latencyMs: input.result?.latencyMs ?? 0,
    tokensEst: input.result?.tokensEst ?? estimateTokens(combined + output),
    promptHash: hashPrompt(combined),
    promptPreview: redact(combined).slice(0, 220),
    promptFull: redact(combined).slice(0, 4000),
    outputPreview: redact(output).slice(0, 320),
    analysisId: input.analysisId,
    metadata: {
      ...(input.metadata ?? {}),
      providerConfigured: info.live,
      redacted: true,
      hashAlgo: 'sha256/16',
    },
  };

  await db.logAi(entry);
  return entry;
}

/** Called by /api/telemetry/heartbeat and opportunistically from the dashboard. */
export async function heartbeat(force = false): Promise<{ logged: boolean; intervalMs: number; provider: string; model: string }> {
  const now = Date.now();
  const info = providerInfo();
  if (!force && now - lastHeartbeat < Math.min(60_000, HEARTBEAT_INTERVAL_MS)) {
    return { logged: false, intervalMs: HEARTBEAT_INTERVAL_MS, provider: info.provider, model: info.model };
  }
  lastHeartbeat = now;
  const message = [
    'CODEPULSE HEARTBEAT (Captain\'s Logbook)',
    `ts=${new Date(now).toISOString()}`,
    `provider=${info.provider} model=${info.model} live=${info.live}`,
    'engine=PulseReasoner v1 (parse → embed → pgvector cosine → hybrid re-rank → RCA → post-mortem)',
    'retrieval=384-d signed-hash embeddings, domain-weighted, L2-normalised',
    `embedModel=${info.embedModel}`,
    'status=operational · all AI calls executed server-side · secrets never exposed to the client',
  ].join('\n');

  await logAi({
    kind: 'heartbeat',
    system: 'CodePulse telemetry heartbeat — records the AI stack state every 10 minutes for the Captain\'s Logbook.',
    user: message,
    output: `heartbeat logged · provider=${info.provider} · model=${info.model}`,
    metadata: { heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS, uptimeBucket: Math.floor(now / HEARTBEAT_INTERVAL_MS) },
  });

  return { logged: true, intervalMs: HEARTBEAT_INTERVAL_MS, provider: info.provider, model: info.model };
}

/**
 * LLM prompts — kept here so prompt quality is auditable.
 * The prompt is deliberately structured: role → incident context → retrieved
 * memory → evidence → output contract.
 */
export const PROMPTS = {
  rootCauseSystem: `You are CodePulse, a principal SRE and root-cause analyst with 15 years of production experience.
You reason ONLY from the telemetry provided. Never invent service names, engineers, commits or metrics that are not in the context.
Return strict JSON with keys: rootCauseTitle, rootCauseCategory, confidence (0-1), severity (critical|high|medium|low),
affectedService, explanation (max 120 words, written for an on-call engineer), contributingFactors (array of 3-5 strings),
alternatives (array of up to 3 objects {title, probability, note}), preventiveActions (array of 4-5 strings).`,

  rootCauseUser: (trace: string, candidates: string, service: string, environment: string) => `NEW PRODUCTION INCIDENT
service=${service || 'unknown'} environment=${environment || 'unknown'}

STACK TRACE / LOG
\`\`\`
${trace.slice(0, 4000)}
\`\`\`

RETRIEVED HISTORICAL MEMORY (vector search over past incident RCAs, ranked)
${candidates}

TASK
1. Identify the single most likely root cause for this trace.
2. Use the retrieved memory: if a historical incident shares the signature, anchor on its root cause and reference its id.
3. Estimate confidence honestly (0.3-0.97). If the evidence is weak, lower it.
4. Explain the match: which signals (error type, pool stats, timeout values, service, environment) drove the conclusion.
Respond with JSON only.`,

  explanationSystem: `You are CodePulse. Explain a semantic incident match to an on-call engineer in under 110 words.
Be specific and quantitative: reference the shared signatures, the historical incident id, who fixed it, the commit and the concrete fix.
Do not invent facts. Plain prose, no markdown, no bullet lists.`,

  explanationUser: (trace: string, incident: string, similarity: number, verdict: string) => `TODAY'S TRACE
\`\`\`
${trace.slice(0, 1800)}
\`\`\`

CLOSEST HISTORICAL INCIDENT
${incident}

VECTOR SIMILARITY: ${similarity}%
PULSEREASONER VERDICT: ${verdict}`,

  postMortemSystem: `You are CodePulse generating an internal post-mortem document.
Tone: blameless, factual, engineering-grade. Never blame individuals for the outage.
Return strict JSON with keys: summary (60-90 words), impact (50-80 words), rootCause (60-90 words),
resolution (60-90 words), preventiveActions (4-6 strings, each an imperative engineering action),
lessonsLearned (3-4 strings), actionItems (array of {task, owner, due, priority:P0|P1|P2}).`,

  postMortemUser: (ctx: string) => `INCIDENT CONTEXT
${ctx.slice(0, 4500)}

Write the post-mortem for this incident. Use the historical incident's engineers, commit hashes and timelines where they are given in the context. Respond with JSON only.`,
};
