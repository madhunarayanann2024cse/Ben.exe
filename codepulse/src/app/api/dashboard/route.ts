import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { buildDashboard } from '@/lib/analytics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const [incidents, analyses, posts, logs, info] = await Promise.all([
    db.getIncidents(),
    db.getAnalyses(200),
    db.getPostMortems(200),
    db.getAiLogs(200),
    db.info(),
  ]);

  const data = buildDashboard(incidents, analyses, posts.length, logs.length);
  return NextResponse.json(
    { ok: true, data, db: { backend: info.backend, label: info.label, vectorSearch: info.vectorSearch, incidents: info.incidents } },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
