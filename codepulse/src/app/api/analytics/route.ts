import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { buildAnalytics } from '@/lib/analytics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const [incidents, analyses] = await Promise.all([db.getIncidents(), db.getAnalyses(300)]);
  const data = buildAnalytics(incidents, analyses);
  return NextResponse.json({ ok: true, data }, { headers: { 'Cache-Control': 'no-store' } });
}
