import { NextResponse } from 'next/server';
import { analyzeIncident } from '@/lib/analyze';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DEMO_MAX = 20_000;

export async function POST(request: Request) {
  const started = Date.now();
  let body: { stackTrace?: string; service?: string; environment?: string; notes?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const stackTrace = (body.stackTrace ?? '').trim();
  if (stackTrace.length < 12) {
    return NextResponse.json(
      { ok: false, error: 'stackTrace is required (paste at least one line of the production log).' },
      { status: 400 },
    );
  }
  if (stackTrace.length > DEMO_MAX) {
    return NextResponse.json({ ok: false, error: `stackTrace exceeds ${DEMO_MAX} characters.` }, { status: 413 });
  }

  try {
    const result = await analyzeIncident({
      stackTrace,
      service: body.service?.slice(0, 120),
      environment: body.environment?.slice(0, 40),
      notes: body.notes?.slice(0, 2000),
    });
    return NextResponse.json(
      { ok: true, result: { ...result, serverMs: Date.now() - started } },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    console.error('[codepulse] analyze failed:', err);
    return NextResponse.json(
      { ok: false, error: `Analysis failed: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}
