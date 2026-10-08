'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Avatar, Badge, EmptyState, KeyValue, SectionCard, SeverityBadge, Skeleton, StatusBadge } from '@/components/ui';
import { toast } from '@/components/Toaster';
import { IconAlert, IconDatabase, IconGit, IconRepeat, IconSearch, IconSparkle } from '@/components/icons';
import { useApi } from '@/lib/useApi';
import { dt, duration, relTime } from '@/lib/format';

interface IncidentListItem {
  id: string;
  title: string;
  service: string;
  environment: string;
  severity: string;
  status: string;
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
  tags: string[];
  owner: { name: string; role: string; team: string; hue: number };
  fix: { commit: string; repo: string; pr: string; message: string };
  logExcerpt: string;
}

interface IncidentsResponse {
  ok: boolean;
  total: number;
  filtered: number;
  incidents: IncidentListItem[];
  facets: { services: string[]; severities: string[]; statuses: string[]; categories: string[] };
}

export default function IncidentsPage() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [service, setService] = useState('all');
  const [severity, setSeverity] = useState('all');
  const [status, setStatus] = useState('all');
  const [category, setCategory] = useState('all');
  const [recurringOnly, setRecurringOnly] = useState(false);
  const [sort, setSort] = useState('recent');
  const [selected, setSelected] = useState<IncidentListItem | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 260);
    return () => clearTimeout(t);
  }, [q]);

  const url = useMemo(() => {
    const params = new URLSearchParams({
      q: debouncedQ,
      service,
      severity,
      status,
      category,
      sort,
      recurring: String(recurringOnly),
      limit: '100',
    });
    return `/api/incidents?${params.toString()}`;
  }, [debouncedQ, service, severity, status, category, sort, recurringOnly]);

  const { data, loading } = useApi<IncidentsResponse>(url);
  const incidents = data?.incidents ?? [];

  const stats = useMemo(() => {
    const list = incidents;
    return {
      shown: list.length,
      critical: list.filter((i) => i.severity === 'critical').length,
      recurring: list.filter((i) => i.recurring).length,
      avgMttr: list.length ? Math.round(list.reduce((a, b) => a + b.mttrMinutes, 0) / list.length) : 0,
    };
  }, [incidents]);

  return (
    <div className="stack" style={{ gap: 18 }}>
      <section className="panel">
        <div className="panel-body stack" style={{ gap: 14 }}>
          <div className="row row-wrap" style={{ gap: 12 }}>
            <div style={{ position: 'relative', flex: '1 1 320px' }}>
              <IconSearch width={15} height={15} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--text-3)' }} />
              <input
                className="input"
                style={{ paddingLeft: 34 }}
                placeholder="Search incident id, service, root cause, error text, tags, stack trace…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <div className="row row-wrap" style={{ gap: 8 }}>
              <button className={`btn btn-sm ${recurringOnly ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setRecurringOnly((v) => !v)}>
                <IconRepeat width={13} height={13} />
                Recurring only
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => { setQ(''); setService('all'); setSeverity('all'); setStatus('all'); setCategory('all'); setRecurringOnly(false); setSort('recent'); }}>
                Reset
              </button>
            </div>
          </div>

          <div className="grid grid-4" style={{ gap: 10 }}>
            <select className="select" value={service} onChange={(e) => setService(e.target.value)}>
              <option value="all">All services</option>
              {data?.facets.services.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <select className="select" value={severity} onChange={(e) => setSeverity(e.target.value)}>
              <option value="all">All severities</option>
              {data?.facets.severities.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="all">All statuses</option>
              {data?.facets.statuses.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <select className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="all">All root-cause classes</option>
              {data?.facets.categories.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div className="row row-wrap" style={{ gap: 10 }}>
            <span className="chip"><IconDatabase width={12} height={12} /> {data?.total ?? 0} in memory</span>
            <span className="chip">{stats.shown} shown</span>
            <span className="chip" style={{ color: '#ffb3c0' }}>{stats.critical} critical</span>
            <span className="chip">{stats.recurring} recurring</span>
            <span className="chip">avg MTTR {duration(stats.avgMttr)}</span>
            <span className="spacer" />
            <span className="tiny dim">Sort</span>
            <select className="select" style={{ width: 190 }} value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="recent">Most recent</option>
              <option value="severity">Severity (critical first)</option>
              <option value="mttr">Longest to resolve</option>
              <option value="recurrence">Most recurrences</option>
            </select>
          </div>
        </div>
      </section>

      <div className="grid" style={{ gridTemplateColumns: selected ? 'minmax(0, 1.55fr) minmax(0, 1fr)' : '1fr', gap: 16 }}>
        <SectionCard
          title="Incident memory"
          subtitle={loading ? 'Loading…' : `${incidents.length} matching record(s)`}
          padding={false}
          right={
            <Link href="/analyze" className="btn btn-primary btn-sm">
              <IconSparkle width={13} height={13} />
              Run semantic analysis
            </Link>
          }
        >
          {loading && incidents.length === 0 ? (
            <div className="panel-body stack" style={{ gap: 10 }}>
              {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} height={44} />)}
            </div>
          ) : incidents.length === 0 ? (
            <EmptyState
              icon={<IconAlert width={24} height={24} />}
              title="No incidents match these filters"
              detail="Loosen a filter or clear the search to see the full memory."
              action={<button className="btn btn-ghost btn-sm" onClick={() => { setQ(''); setService('all'); setSeverity('all'); setStatus('all'); setCategory('all'); setRecurringOnly(false); }}>Clear filters</button>}
            />
          ) : (
            <div className="scroll-x">
              <table className="table">
                <thead>
                  <tr>
                    <th>Incident</th>
                    <th>Root-cause class</th>
                    <th>Severity</th>
                    <th>Owner / fix</th>
                    <th>MTTR</th>
                    <th>Detected</th>
                  </tr>
                </thead>
                <tbody>
                  {incidents.map((inc) => (
                    <tr
                      key={inc.id}
                      onClick={() => setSelected(inc)}
                      style={{ cursor: 'pointer', background: selected?.id === inc.id ? 'rgba(126,143,255,.08)' : undefined }}
                    >
                      <td>
                        <div className="row" style={{ gap: 7 }}>
                          <span className="id-cell">{inc.id}</span>
                          {inc.recurring ? <span className="badge badge-medium" style={{ fontSize: 9.5, padding: '1px 6px' }}>×{inc.recurrenceCount}</span> : null}
                        </div>
                        <div className="title-cell small" style={{ maxWidth: 330, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {inc.title}
                        </div>
                        <div className="tiny dim">{inc.service} · {inc.environment}</div>
                      </td>
                      <td>
                        <div className="small" style={{ maxWidth: 220 }}>{inc.rootCauseCategory}</div>
                        <div className="tiny dim mono" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inc.errorType}</div>
                      </td>
                      <td>
                        <SeverityBadge severity={inc.severity} small />
                        <div style={{ marginTop: 5 }}>
                          <StatusBadge status={inc.status} />
                        </div>
                      </td>
                      <td>
                        <div className="row" style={{ gap: 8 }}>
                          <Avatar name={inc.owner.name} hue={inc.owner.hue} />
                          <div>
                            <div className="small">{inc.owner.name}</div>
                            <div className="tiny mono dim">
                              <IconGit width={10} height={10} style={{ verticalAlign: -1 }} /> {inc.fix.commit}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="mono small">{duration(inc.mttrMinutes)}</td>
                      <td className="small dim">{relTime(inc.detectedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        {selected ? (
          <div className="stack" style={{ gap: 16 }}>
            <SectionCard
              title={selected.id}
              subtitle={selected.service}
              right={
                <button className="btn btn-ghost btn-sm" onClick={() => setSelected(null)}>
                  Close
                </button>
              }
            >
              <div className="stack" style={{ gap: 14 }}>
                <div className="row row-wrap" style={{ gap: 8 }}>
                  <SeverityBadge severity={selected.severity} />
                  <StatusBadge status={selected.status} />
                  <Badge tone="ghost">{selected.environment}</Badge>
                  {selected.recurring ? <Badge tone="medium" dot>recurring ×{selected.recurrenceCount}</Badge> : null}
                </div>
                <div style={{ fontWeight: 620 }}>{selected.title}</div>
                <p className="small muted" style={{ margin: 0 }}>{selected.summary}</p>
                <KeyValue
                  items={[
                    { k: 'Root cause', v: selected.rootCauseTitle },
                    { k: 'Class', v: selected.rootCauseCategory },
                    { k: 'Detected', v: dt(selected.detectedAt) },
                    { k: 'Resolved', v: dt(selected.resolvedAt) },
                    { k: 'MTTR', v: duration(selected.mttrMinutes) },
                    { k: 'Engineer', v: `${selected.owner.name} · ${selected.owner.team}` },
                    { k: 'Commit', v: <span className="mono">{selected.fix.repo}@{selected.fix.commit}</span> },
                    { k: 'PR', v: <span className="mono">{selected.fix.pr}</span> },
                  ]}
                />
                <div className="row row-wrap" style={{ gap: 6 }}>
                  {selected.tags.map((tag) => (
                    <span className="chip" key={tag} style={{ fontSize: 10.5 }}>{tag}</span>
                  ))}
                </div>
                <div className="log-view" style={{ maxHeight: 180, fontSize: 11.5 }}>{selected.logExcerpt}</div>
                <div className="row row-wrap" style={{ gap: 8 }}>
                  <button className="btn btn-primary btn-sm" onClick={() => router.push(`/incidents/${selected.id}`)}>
                    Open full incident
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      void fetch('/api/postmortems', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ incidentId: selected.id }),
                      })
                        .then((r) => r.json())
                        .then((res: { ok: boolean; postMortem?: { id: string } }) => {
                          if (res.ok && res.postMortem) {
                            toast('Post-mortem generated', `${res.postMortem.id} saved.`, 'ok');
                            router.push(`/postmortems/${res.postMortem.id}`);
                          }
                        })
                        .catch(() => toast('Generation failed', 'Could not generate the post-mortem.', 'critical'));
                    }}
                  >
                    Generate post-mortem
                  </button>
                </div>
              </div>
            </SectionCard>
          </div>
        ) : null}
      </div>
    </div>
  );
}
