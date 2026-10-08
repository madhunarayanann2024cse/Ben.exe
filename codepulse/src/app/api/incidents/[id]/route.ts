import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { CATEGORY_BY_KEY } from '@/lib/taxonomy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const incident = await db.getIncident(id);
  if (!incident) {
    return NextResponse.json({ ok: false, error: `Incident ${id} not found in memory.` }, { status: 404 });
  }
  const all = await db.getIncidents();
  const related = all
    .filter((i) => i.id !== incident.id)
    .filter((i) => i.rootCauseCategory === incident.rootCauseCategory || incident.relatedIncidentIds.includes(i.id))
    .map((i) => ({
      id: i.id,
      title: i.title,
      service: i.service,
      severity: i.severity,
      similarityContext: i.rootCauseCategory === incident.rootCauseCategory ? 'same root-cause class' : 'explicitly linked',
      mttrMinutes: i.mttrMinutes,
      detectedAt: i.detectedAt,
    }))
    .slice(0, 5);

  const category = Object.values(CATEGORY_BY_KEY).find((c) => c.label === incident.rootCauseCategory);
  const canonicalFix = category?.fixTemplate ?? incident.resolution.split('. ')[0];
  const runbook = category?.runbook ?? 'Runbook not linked';

  const analyses = (await db.getAnalyses(100)).filter((a) => a.matchedIncidentId === incident.id);
  const postMortems = (await db.getPostMortems(100)).filter((p) => p.incidentId === incident.id);

  return NextResponse.json(
    {
      ok: true,
      incident: { ...incident, embedding: undefined, embeddingVersion: undefined },
      canonicalFix,
      runbook,
      related,
      reuse: {
        timesRetrieved: analyses.length,
        lastRetrievedAt: analyses[0]?.createdAt ?? null,
        analyses: analyses.slice(0, 5),
        postMortems: postMortems.map((p) => ({ id: p.id, title: p.title, generatedAt: p.generatedAt, status: p.status })),
      },
      db: (await db.info()).label,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
