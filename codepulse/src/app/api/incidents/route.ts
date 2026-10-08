import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import type { Incident } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface IncidentListItem {
  id: string;
  title: string;
  service: string;
  environment: string;
  severity: Incident['severity'];
  status: Incident['status'];
  detectedAt: string;
  resolvedAt: string | null;
  mttrMinutes: number;
  recurring: boolean;
  recurrenceCount: number;
  rootCauseCategory: string;
  rootCauseTitle: string;
  summary: string;
  errorType: string;
  errorMessage: string;
  signature: string;
  tags: string[];
  owner: Incident['owner'];
  fix: Incident['fix'];
  logExcerpt: string;
  relatedIncidentIds: string[];
}

function project(i: Incident): IncidentListItem {
  return {
    id: i.id,
    title: i.title,
    service: i.service,
    environment: i.environment,
    severity: i.severity,
    status: i.status,
    detectedAt: i.detectedAt,
    resolvedAt: i.resolvedAt,
    mttrMinutes: i.mttrMinutes,
    recurring: i.recurring,
    recurrenceCount: i.recurrenceCount,
    rootCauseCategory: i.rootCauseCategory,
    rootCauseTitle: i.rootCauseTitle,
    summary: i.summary,
    errorType: i.errorType,
    errorMessage: i.errorMessage,
    signature: i.signature,
    tags: i.tags,
    owner: i.owner,
    fix: i.fix,
    logExcerpt: i.stackTrace.split('\n').slice(0, 12).join('\n').slice(0, 700),
    relatedIncidentIds: i.relatedIncidentIds,
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get('q') ?? '').trim().toLowerCase();
  const severity = searchParams.get('severity') ?? 'all';
  const service = searchParams.get('service') ?? 'all';
  const status = searchParams.get('status') ?? 'all';
  const category = searchParams.get('category') ?? 'all';
  const recurringOnly = searchParams.get('recurring') === 'true';
  const sort = searchParams.get('sort') ?? 'recent';
  const limit = Math.min(100, Number(searchParams.get('limit') ?? 50));

  const all = await db.getIncidents();

  let list = all.filter((i) => {
    if (severity !== 'all' && i.severity !== severity) return false;
    if (service !== 'all' && i.service !== service) return false;
    if (status !== 'all' && i.status !== status) return false;
    if (category !== 'all' && i.rootCauseCategory !== category) return false;
    if (recurringOnly && !i.recurring) return false;
    if (q) {
      const haystack = [i.id, i.title, i.service, i.summary, i.rootCauseCategory, i.rootCauseTitle, i.errorType, i.errorMessage, i.tags.join(' '), i.stackTrace]
        .join(' ')
        .toLowerCase();
      const terms = q.split(/\s+/).filter(Boolean);
      if (!terms.every((t) => haystack.includes(t))) return false;
    }
    return true;
  });

  list = list.sort((a, b) => {
    switch (sort) {
      case 'mttr':
        return b.mttrMinutes - a.mttrMinutes;
      case 'severity': {
        const rank = { critical: 4, high: 3, medium: 2, low: 1 } as const;
        return rank[b.severity] - rank[a.severity] || new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime();
      }
      case 'recurrence':
        return b.recurrenceCount - a.recurrenceCount;
      default:
        return new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime();
    }
  });

  const uniq = (xs: string[]) => Array.from(new Set(xs)).sort();

  return NextResponse.json(
    {
      ok: true,
      total: all.length,
      filtered: list.length,
      incidents: list.slice(0, limit).map(project),
      facets: {
        services: uniq(all.map((i) => i.service)),
        severities: ['critical', 'high', 'medium', 'low'],
        statuses: uniq(all.map((i) => i.status)),
        categories: uniq(all.map((i) => i.rootCauseCategory)),
      },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
