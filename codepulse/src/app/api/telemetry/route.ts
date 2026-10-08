import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { heartbeat } from '@/lib/telemetry';
import { providerInfo } from '@/lib/ai/providers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/telemetry — the Captain's Logbook feed (AI prompt telemetry). */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(200, Number(searchParams.get('limit') ?? 60));
  const kind = searchParams.get('kind');

  let logs = await db.getAiLogs(limit);
  if (kind) logs = logs.filter((l) => l.kind === kind);

  const info = providerInfo();
  const heartbeats = logs.filter((l) => l.kind === 'heartbeat');
  return NextResponse.json(
    {
      ok: true,
      provider: { provider: info.provider, model: info.model, live: info.live },
      summary: {
        total: logs.length,
        heartbeats: heartbeats.length,
        lastHeartbeatAt: heartbeats[0]?.at ?? null,
        intervalMs: Number(process.env.NEXT_PUBLIC_TELEMETRY_INTERVAL_MS || 600_000),
        kinds: Array.from(new Set(logs.map((l) => l.kind))),
      },
      logs,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

/** POST /api/telemetry — force a heartbeat entry (used by the UI every 10 min). */
export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const force = searchParams.get('force') === '1' || searchParams.get('force') === 'true';
  const res = await heartbeat(force);
  return NextResponse.json({ ok: true, ...res });
}
