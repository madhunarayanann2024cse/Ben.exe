import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { buildPostMortem } from '@/lib/pulsereasoner';
import { parseTrace } from '@/lib/pulsereasoner';
import type { PostMortem } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/postmortems?analysisId=…&incidentId=…&limit=20 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const analysisId = searchParams.get('analysisId');
  const incidentId = searchParams.get('incidentId');
  const limit = Math.min(100, Number(searchParams.get('limit') ?? 20));

  let list = await db.getPostMortems(limit);
  if (analysisId) list = list.filter((p) => p.analysisId === analysisId);
  if (incidentId) list = list.filter((p) => p.incidentId === incidentId);

  return NextResponse.json({ ok: true, total: list.length, postMortems: list }, { headers: { 'Cache-Control': 'no-store' } });
}

/**
 * POST /api/postmortems
 * Generates + persists a post-mortem for an existing historical incident
 * (used by the repository detail page), or re-generates one for an analysis.
 */
export async function POST(request: Request) {
  let body: { incidentId?: string; analysisId?: string; stackTrace?: string; service?: string; environment?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const incident = body.incidentId ? await db.getIncident(body.incidentId) : null;
  if (body.incidentId && !incident) {
    return NextResponse.json({ ok: false, error: `Incident ${body.incidentId} not found.` }, { status: 404 });
  }

  const trace = body.stackTrace?.trim() || incident?.stackTrace || '';
  const service = body.service || incident?.service || 'Unknown Service';
  const environment = body.environment || incident?.environment || 'production';
  const parsed = parseTrace(trace, service, environment);
  const analysisId = body.analysisId || db.id('an');

  const postMortem: PostMortem = buildPostMortem({
    id: db.id('pm'),
    analysisId,
    incident,
    verdict: {
      category: incident?.rootCauseCategory ?? 'Unclassified',
      title: incident?.rootCauseTitle ?? `${parsed.errorType} on ${service}`,
      confidence: incident ? 0.93 : 0.55,
      confidenceLabel: incident ? 'Very High' : 'Moderate',
      severity: incident?.severity ?? 'high',
      affectedService: service,
      environment: environment as PostMortem extends never ? never : 'production' | 'staging' | 'canary',
      narrative: incident
        ? `Regenerated from historical memory ${incident.id}. ${incident.summary}`
        : `Generated from a raw trace with no historical match. ${parsed.errorType} observed on ${service}.`,
      contributingFactors: incident?.evidence.slice(0, 4) ?? [],
      alternatives: [],
    },
    parsed,
    opts: { service, environment },
    similarity: 100,
    engine: 'pulsereasoner',
    generatedAt: new Date().toISOString(),
  });

  await db.savePostMortem(postMortem);
  return NextResponse.json({ ok: true, postMortem, db: (await db.info()).label }, { status: 201 });
}
