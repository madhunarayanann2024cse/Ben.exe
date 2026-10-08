import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { providerInfo } from '@/lib/ai/providers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/health — safe, key-free system report.
 * Never returns env values: only booleans describing what is configured.
 */
export async function GET() {
  const info = await db.info();
  const provider = providerInfo();
  return NextResponse.json(
    {
      ok: true,
      app: 'CodePulse — AI Incident Memory & Root-Cause Intelligence',
      tagline: 'Your Engineering Team Never Forgets.',
      version: '1.0.0',
      database: {
        backend: info.backend,
        label: info.label,
        supabaseConfigured: info.supabaseConfigured,
        vectorSearch: info.vectorSearch,
        incidents: info.incidents,
        analyses: info.analyses,
        postMortems: info.postMortems,
        aiLogs: info.aiLogs,
        warnings: info.warnings.slice(-3),
      },
      ai: {
        provider: provider.provider,
        label: provider.label,
        model: provider.model,
        live: provider.live,
        embedModel: provider.embedModel,
        // configuration flags only — values are never serialised
        keysPresent: provider.configured,
        engine: provider.live ? 'LLM (server-side) + PulseReasoner retrieval' : 'PulseReasoner v1 (deterministic, offline)',
        keyExposure: 'none — all provider calls execute in Node.js route handlers',
      },
      telemetry: { heartbeatIntervalMs: Number(process.env.NEXT_PUBLIC_TELEMETRY_INTERVAL_MS || 600_000), aiLogRows: info.aiLogs },
      time: new Date().toISOString(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
