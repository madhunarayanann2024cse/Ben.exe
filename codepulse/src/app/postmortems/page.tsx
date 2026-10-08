'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Badge, EmptyState, SectionCard, SeverityBadge, Skeleton } from '@/components/ui';
import { downloadMarkdown } from '@/components/PostMortemDoc';
import { IconArrowRight, IconDoc, IconDownload, IconSparkle } from '@/components/icons';
import { useApi } from '@/lib/useApi';
import { dt, relTime } from '@/lib/format';
import type { PostMortem } from '@/lib/types';

interface PmResponse {
  ok: boolean;
  total: number;
  postMortems: PostMortem[];
}

export default function PostMortemsPage() {
  const { data, loading } = useApi<PmResponse>('/api/postmortems?limit=60');
  const [filter, setFilter] = useState<'all' | 'critical' | 'high'>('all');

  const list = (data?.postMortems ?? []).filter((p) => (filter === 'all' ? true : p.severity === filter));

  return (
    <div className="stack" style={{ gap: 18 }}>
      <section className="panel">
        <div className="panel-body row row-wrap" style={{ gap: 14 }}>
          <div>
            <h2 className="section-title">Generated documents</h2>
            <div className="section-sub">
              Every document is persisted with its analysis, linked incident and generation engine.
            </div>
          </div>
          <span className="spacer" />
          <div className="row row-wrap" style={{ gap: 8 }}>
            {(['all', 'critical', 'high'] as const).map((f) => (
              <button key={f} className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setFilter(f)}>
                {f === 'all' ? 'All severities' : f === 'critical' ? 'Critical' : 'High'}
              </button>
            ))}
            <Link href="/analyze" className="btn btn-sm">
              <IconSparkle width={13} height={13} />
              Generate from a trace
            </Link>
          </div>
        </div>
      </section>

      {loading && !data ? (
        <div className="grid grid-2">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} height={168} />)}
        </div>
      ) : list.length === 0 ? (
        <SectionCard>
          <EmptyState
            icon={<IconDoc width={26} height={26} />}
            title="No post-mortems match this filter"
            detail="Run an analysis from the workspace (or generate one from an incident) and the document will appear here."
            action={<Link href="/analyze?demo=1" className="btn btn-primary btn-sm">Run the demo analysis</Link>}
          />
        </SectionCard>
      ) : (
        <div className="grid grid-2">
          {list.map((pm, i) => (
            <section key={pm.id} className={`panel card card-hover animate-in d${(i % 5) + 1}`}>
              <div className="panel-body stack" style={{ gap: 12 }}>
                <div className="row row-wrap" style={{ gap: 8 }}>
                  <span className="mono tiny dim">{pm.id}</span>
                  <SeverityBadge severity={pm.severity} small />
                  <Badge tone={pm.status === 'published' ? 'ok' : 'ghost'}>{pm.status}</Badge>
                  <Badge tone="accent">{pm.generatedBy === 'llm' ? 'LLM + retrieval' : 'PulseReasoner'}</Badge>
                  <span className="spacer" />
                  <span className="tiny dim">{relTime(pm.generatedAt)}</span>
                </div>
                <h3 style={{ fontSize: 15, margin: 0, letterSpacing: -0.2 }}>{pm.title}</h3>
                <p className="small muted" style={{ margin: 0, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {pm.summary}
                </p>
                <div className="row row-wrap" style={{ gap: 8 }}>
                  <span className="chip">{pm.preventiveActions.length} preventive actions</span>
                  <span className="chip">{pm.actionItems.length} action items</span>
                  <span className="chip">{pm.timeline.length} timeline beats</span>
                  {pm.incidentId ? <span className="chip">memory {pm.incidentId}</span> : null}
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <Link href={`/postmortems/${pm.id}`} className="btn btn-primary btn-sm">
                    Open document
                    <IconArrowRight width={13} height={13} />
                  </Link>
                  <button className="btn btn-ghost btn-sm" onClick={() => downloadMarkdown(pm)}>
                    <IconDownload width={13} height={13} />
                    .md
                  </button>
                  <span className="spacer" />
                  <span className="tiny dim">{dt(pm.generatedAt)}</span>
                </div>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
