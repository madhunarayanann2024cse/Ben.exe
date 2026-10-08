/**
 * CodePulse — server-side AI provider client.
 *
 * SECURITY: this module is imported exclusively from route handlers that run on
 * the Node.js server. Keys are read from `process.env` at call time, are never
 * referenced with a NEXT_PUBLIC_ prefix, and never appear in any response body
 * (only the resolved provider/model name and a redacted log id are surfaced).
 *
 * Priority: OPENAI > GEMINI > ANTHROPIC > built-in PulseReasoner (offline).
 * Every call is bounded by an AbortSignal timeout so a slow provider can never
 * stall the live demo; a failed call degrades to the deterministic engine.
 */

import crypto from 'node:crypto';

export interface LlmResult {
  ok: boolean;
  text: string;
  provider: string;
  model: string;
  latencyMs: number;
  tokensEst: number;
  error?: string;
}

export interface EmbedResult {
  ok: boolean;
  vectors: number[][];
  provider: string;
  model: string;
  dims: number;
  latencyMs: number;
  error?: string;
}

export interface ProviderInfo {
  provider: 'openai' | 'gemini' | 'anthropic' | 'pulsereasoner';
  label: string;
  model: string;
  live: boolean;
  embedModel: string;
  configured: { openai: boolean; gemini: boolean; anthropic: boolean };
}

const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 14_000);

export function providerInfo(): ProviderInfo {
  const openai = Boolean(process.env.OPENAI_API_KEY);
  const gemini = Boolean(process.env.GEMINI_API_KEY);
  const anthropic = Boolean(process.env.ANTHROPIC_API_KEY);

  if (openai) {
    return {
      provider: 'openai',
      label: 'OpenAI (server-side)',
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      live: true,
      embedModel: process.env.OPENAI_EMBED_MODEL || 'text-embedding-3-small',
      configured: { openai, gemini, anthropic },
    };
  }
  if (gemini) {
    return {
      provider: 'gemini',
      label: 'Google Gemini (server-side)',
      model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
      live: true,
      embedModel: 'text-embedding-004',
      configured: { openai, gemini, anthropic },
    };
  }
  if (anthropic) {
    return {
      provider: 'anthropic',
      label: 'Anthropic Claude (server-side)',
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
      live: true,
      embedModel: 'pulse-hash-384',
      configured: { openai, gemini, anthropic },
    };
  }
  return {
    provider: 'pulsereasoner',
    label: 'PulseReasoner (built-in, offline)',
    model: 'pulse-reasoner-v1',
    live: false,
    embedModel: 'pulse-hash-384',
    configured: { openai, gemini, anthropic },
  };
}

export function hashPrompt(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.round(text.length / 4));
}

/** Redact anything that looks like a secret before it is written to telemetry. */
export function redact(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, 'sk-***redacted***')
    .replace(/Bearer\s+[A-Za-z0-9._-]{12,}/gi, 'Bearer ***redacted***')
    .replace(/eyJ[A-Za-z0-9._-]{20,}/g, '***jwt-redacted***')
    .replace(/(password|passwd|pwd|api[_-]?key|secret|token)\s*[=:]\s*["']?[^\s"',}]{4,}/gi, '$1=***redacted***');
}

export async function llmComplete(opts: {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  json?: boolean;
}): Promise<LlmResult> {
  const info = providerInfo();
  const started = Date.now();
  const maxTokens = opts.maxTokens ?? 900;

  try {
    if (info.provider === 'openai') {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: info.model,
          temperature: opts.temperature ?? 0.2,
          max_tokens: maxTokens,
          ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
          messages: [
            { role: 'system', content: opts.system },
            { role: 'user', content: opts.user },
          ],
        }),
      });
      if (!res.ok) throw new Error(`openai ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: { total_tokens?: number } };
      const text = data.choices?.[0]?.message?.content?.trim() ?? '';
      return {
        ok: Boolean(text),
        text,
        provider: 'openai',
        model: info.model,
        latencyMs: Date.now() - started,
        tokensEst: data.usage?.total_tokens ?? estimateTokens(opts.system + opts.user),
      };
    }

    if (info.provider === 'gemini') {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${info.model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
      const res = await fetch(url, {
        method: 'POST',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: opts.system }] },
          contents: [{ role: 'user', parts: [{ text: opts.user }] }],
          generationConfig: {
            temperature: opts.temperature ?? 0.2,
            maxOutputTokens: maxTokens,
            ...(opts.json ? { responseMimeType: 'application/json' } : {}),
          },
        }),
      });
      if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim() ?? '';
      return {
        ok: Boolean(text),
        text,
        provider: 'gemini',
        model: info.model,
        latencyMs: Date.now() - started,
        tokensEst: estimateTokens(opts.system + opts.user + text),
      };
    }

    if (info.provider === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY as string,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: info.model,
          max_tokens: maxTokens,
          temperature: opts.temperature ?? 0.2,
          system: opts.system,
          messages: [{ role: 'user', content: opts.user }],
        }),
      });
      if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = (await res.json()) as { content?: { text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
      const text = data.content?.map((c) => c.text ?? '').join('').trim() ?? '';
      return {
        ok: Boolean(text),
        text,
        provider: 'anthropic',
        model: info.model,
        latencyMs: Date.now() - started,
        tokensEst: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
      };
    }
  } catch (err) {
    return {
      ok: false,
      text: '',
      provider: info.provider,
      model: info.model,
      latencyMs: Date.now() - started,
      tokensEst: 0,
      error: (err as Error).message,
    };
  }

  return {
    ok: false,
    text: '',
    provider: 'pulsereasoner',
    model: info.model,
    latencyMs: Date.now() - started,
    tokensEst: 0,
    error: 'no LLM provider configured — using built-in PulseReasoner',
  };
}

/** Optional neural embeddings (OpenAI only). Falls back to the hash embedder. */
export async function embedTexts(texts: string[], dims = 384): Promise<EmbedResult> {
  const started = Date.now();
  if (!process.env.OPENAI_API_KEY || (process.env.OPENAI_EMBED_MODEL ?? '').startsWith('pulse')) {
    return { ok: false, vectors: [], provider: 'pulsereasoner', model: 'pulse-hash-384', dims, latencyMs: 0, error: 'not configured' };
  }
  try {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: process.env.OPENAI_EMBED_MODEL || 'text-embedding-3-small',
        input: texts,
        dimensions: dims,
      }),
    });
    if (!res.ok) throw new Error(`openai embeddings ${res.status}`);
    const data = (await res.json()) as { data?: { embedding: number[] }[] };
    return {
      ok: true,
      vectors: data.data?.map((d) => d.embedding) ?? [],
      provider: 'openai',
      model: process.env.OPENAI_EMBED_MODEL || 'text-embedding-3-small',
      dims,
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    return { ok: false, vectors: [], provider: 'openai', model: 'text-embedding-3-small', dims, latencyMs: Date.now() - started, error: (err as Error).message };
  }
}

/** Provider-agnostic "ping" used by the health panel (no billable content). */
export async function providerHealth(): Promise<{ provider: string; model: string; live: boolean; note: string }> {
  const info = providerInfo();
  if (!info.live) {
    return {
      provider: info.provider,
      model: info.model,
      live: false,
      note: 'Built-in PulseReasoner active — deterministic, offline, zero-latency. Add an API key to route reasoning through an LLM.',
    };
  }
  const probe = await llmComplete({
    system: 'You are a health probe. Reply with the single word: OK',
    user: 'ping',
    maxTokens: 5,
    temperature: 0,
  });
  return {
    provider: info.provider,
    model: info.model,
    live: probe.ok,
    note: probe.ok ? `Provider responded in ${probe.latencyMs}ms.` : `Provider error: ${probe.error}`,
  };
}
