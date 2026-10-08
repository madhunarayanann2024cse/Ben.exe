import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { buildSeedIncidents, SEED_VERSION } from '@/lib/seed';
import { logAi } from '@/lib/telemetry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/seed          → idempotent: seeds only if memory is empty
 * POST /api/seed?force=1  → wipes and re-seeds the incident corpus
 * GET  /api/seed          → status
 */
async function seed(force: boolean) {
  const info = await db.info();
  const existing = await db.getIncidents();
  if (!force && existing.length > 0) {
    return {
      seeded: false,
      reason: 'Incident memory already populated',
      incidents: existing.length,
      backend: info.label,
      version: SEED_VERSION,
    };
  }

  const seeds = buildSeedIncidents();
  if (info.backend === 'supabase-postgres') {
    // the DB layer upserts the corpus when the remote table is empty; for a
    // forced reseed we go through the same path by writing via the local store
    // then re-reading (the upsert happens inside db.getIncidents()).
    await db.resetLocal();
  }
  await db.resetLocal();
  const after = await db.getIncidents();

  await logAi({
    kind: 'seed',
    system: 'CodePulse seed routine',
    user: `seed(force=${force}) → ${seeds.length} historical incidents with 384-d embeddings, fixes, engineers and timelines`,
    output: `stored=${after.length} backend=${info.label} version=${SEED_VERSION}`,
    metadata: { seeded: after.length, force, vectorDims: 384 },
  });

  return {
    seeded: true,
    incidents: after.length,
    backend: info.label,
    vectorSearch: info.vectorSearch,
    version: SEED_VERSION,
    classes: Array.from(new Set(seeds.map((s) => s.rootCauseCategory))).length,
  };
}

export async function GET() {
  const info = await db.info();
  const incidents = await db.getIncidents();
  return NextResponse.json({ ok: true, ...info, sampleIds: incidents.slice(0, 4).map((i) => i.id), version: SEED_VERSION });
}

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const force = searchParams.get('force') === '1' || searchParams.get('force') === 'true';
  try {
    const result = await seed(force);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
