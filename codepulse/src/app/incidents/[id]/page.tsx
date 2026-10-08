'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Avatar, Badge, CopyChip, EmptyState, KeyValue, LogView, ProgressBar, SectionCard, SeverityBadge, Skeleton, StatusBadge } from '@/components/ui';
import { PostMortemDoc } from '@/components/PostMortemDoc';
import { toast } from '@/components/Toaster';
import { IconAlert, IconArrowRight, IconBrain, IconCheck, IconChart, IconGit, IconLayers, IconRepeat, IconSparkle, IconUser } from '@/components/icons';
import { useApi, postJson } from '@/lib/useApi';
import { dateOnly, dt, duration, relTime } from '@/lib/format';
import type { Incident, PostMortem } from '@/lib/types';

interface DetailResponse {
  ok: boolean;
  incident: Incident;
  related: { id: string; title: string; service: string; severity: string; similarityContext: string; mttrMinutes: number; detectedAt: string }[];
  reuse: {
    timesRetrieved: number;
    lastRetrievedAt: string | null;
    analyses: { id: string; createdAt: string; similarity: number; service: string }[];
    postMortems: { id: string; title: string; generatedAt: string; status: string }[];
  };
  db: string;
  canonicalFix: string;
  runbook: string;
}

export default function IncidentDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = (params?.id ?? '').toString().toUpperCase();
  const { data, loading, error } = useApi<DetailResponse>(id ? `/api/incidents/${id}` : null);
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<PostMortem | null>(null);

  if (loading && !data) {
    return (
      <div className="stack" style={{ gap: 16 }}>
        <Skeleton height={130} />
        <div className="grid grid-2">
          <Skeleton height={260} />
          <Skeleton height={260} />
        </div>
      </div>
    );
  }

  if (error || !data?.incident) {
    return (
      <SectionCard>
        <EmptyState
          icon={<IconAlert width={24} height={24} />}
          title={error ?? `Incident ${id} not found`}
          detail="The incident may not exist in memory, or the database is unreachable."
          action={<Link href="/incidents" className="btn btn-primary btn-sm">Back to repository</Link>}
        />
      </SectionCard>
    );
  }

  const inc = data.incident;

  return (
    <div className="stack" style={{ gap: 18 }}>
      {/* header */}
      <section className="panel animate-in">
        <div className="panel-body stack" style={{ gap: 16 }}>
          <div className="row row-wrap" style={{ gap: 10 }}>
            <span className="mono" style={{ color: '#c3c6ff', fontSize: 15, fontWeight: 650 }}>{inc.id}</span>
            <SeverityBadge severity={inc.severity} />
            <StatusBadge status={inc.status} />
            <Badge tone="ghost">{inc.environment}</Badge>
            {inc.recurring ? <Badge tone="medium" dot>recurring ×{inc.recurrenceCount}</Badge> : null}
            <span className="spacer" />
            <CopyChip text={inc.id} label={`copy ${inc.id}`} />
            <Link href="/analyze" className="btn btn-ghost btn-sm">
              <IconSparkle width={13} height={13} />
              Analyse a similar trace
            </Link>
          </div>

          <div>
            <h2 style={{ fontSize: 21, margin: '0 0 8px', letterSpacing: -0.5 }}>{inc.title}</h2>
            <p className="muted small" style={{ margin: 0, maxWidth: 880 }}>{inc.summary}</p>
          </div>

          <div className="grid grid-4" style={{ gap: 12 }}>
            {[
              { k: 'MTTR', v: duration(inc.mttrMinutes), s: `detected ${relTime(inc.detectedAt)}` },
              { k: 'Affected users', v: inc.telemetry.affectedUsers.toLocaleString('en-IN'), s: inc.telemetry.peakErrorRate },
              { k: 'p99 latency', v: inc.telemetry.p99Latency, s: inc.telemetry.errorBudgetBurn },
              { k: 'Root-cause class', v: inc.rootCauseCategory, s: `signature ${inc.signature}` },
            ].map((m) => (
              <div key={m.k} className="panel" style={{ padding: 13 }}>
                <div className="tiny dim" style={{ textTransform: 'uppercase', letterSpacing: 0.7, fontWeight: 650 }}>{m.k}</div>
                <div className="small" style={{ marginTop: 5, fontWeight: 600 }}>{m.v}</div>
                <div className="tiny dim" style={{ marginTop: 3 }}>{m.s}</div>
              </div>
            ))}
          </div>

          <div className="row row-wrap" style={{ gap: 7 }}>
            {inc.tags.map((tag) => (
              <span className="chip" key={tag} style={{ fontSize: 10.5 }}>{tag}</span>
            ))}
          </div>
        </div>
      </section>

      <div className="split">
        <div className="stack" style={{ gap: 16 }}>
          <SectionCard title="Error & stack trace" subtitle={`${inc.errorType} · captured at detection time`}>
            <div className="stack" style={{ gap: 12 }}>
              <div className="callout critical">
                <IconAlert width={16} height={16} style={{ marginTop: 2, flex: 'none' }} />
                <div>
                  <div className="small" style={{ fontWeight: 620 }}>{inc.errorType}</div>
                  <div className="small muted">{inc.errorMessage}</div>
                </div>
              </div>
              <LogView text={inc.stackTrace} maxHeight={360} />
            </div>
          </SectionCard>

          <SectionCard title="Evidence" subtitle="Signals the on-call engineer used to confirm the cause">
            <div className="stack" style={{ gap: 10 }}>
              {inc.evidence.map((e) => (
                <div className="row" key={e} style={{ gap: 10, alignItems: 'flex-start' }}>
                  <IconCheck width={14} height={14} style={{ marginTop: 4, color: 'var(--ok)', flex: 'none' }} />
                  <span className="small muted">{e}</span>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Timeline" subtitle="Reconstructed from the live incident channel">
            <div className="timeline">
              {inc.timeline.map((event, i) => (
                <div className={`timeline-item ${event.kind}`} key={`${event.at}-${i}`}>
                  <div className="timeline-time">{dt(event.at)}</div>
                  <div className="timeline-label">{event.label}</div>
                  <div className="timeline-detail">{event.detail}</div>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Impact & resolution" subtitle="Blameless account of what happened and what fixed it">
            <div className="stack" style={{ gap: 14 }}>
              <div>
                <div className="label" style={{ marginBottom: 6 }}>Impact</div>
                <p className="small muted" style={{ margin: 0 }}>{inc.impact}</p>
              </div>
              <div>
                <div className="label" style={{ marginBottom: 6 }}>Resolution</div>
                <p className="small muted" style={{ margin: 0 }}>{inc.resolution}</p>
              </div>
              <div>
                <div className="label" style={{ marginBottom: 8 }}>Steps applied</div>
                <div className="stack" style={{ gap: 8 }}>
                  {inc.resolutionSteps.map((step, i) => (
                    <div className="row" key={step} style={{ gap: 10, alignItems: 'flex-start' }}>
                      <span
                        className="mono tiny"
                        style={{
                          width: 20, height: 20, borderRadius: 6, display: 'grid', placeItems: 'center',
                          background: 'rgba(16,185,129,.14)', border: '1px solid rgba(16,185,129,.3)', color: '#8ff0cd', flex: 'none',
                        }}
                      >
                        {i + 1}
                      </span>
                      <span className="small muted">{step}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="label" style={{ marginBottom: 8 }}>Preventive actions</div>
                <div className="stack" style={{ gap: 8 }}>
                  {inc.preventiveActions.map((action) => (
                    <div className="row" key={action} style={{ gap: 9, alignItems: 'flex-start' }}>
                      <span className="dot dot-low" style={{ marginTop: 6 }} />
                      <span className="small muted">{action}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="label" style={{ marginBottom: 8 }}>Lessons learned</div>
                <div className="stack" style={{ gap: 8 }}>
                  {inc.lessonsLearned.map((lesson) => (
                    <div className="row" key={lesson} style={{ gap: 9, alignItems: 'flex-start' }}>
                      <span className="dot dot-ok" style={{ marginTop: 6 }} />
                      <span className="small muted">{lesson}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </SectionCard>
        </div>

        <div className="stack" style={{ gap: 16 }}>
          <SectionCard title="Error → fix correlation" subtitle="The chain that makes this memory reusable">
            <div className="stack" style={{ gap: 14 }}>
              <div className="row" style={{ gap: 12 }}>
                <Avatar name={inc.owner.name} hue={inc.owner.hue} size="lg" />
                <div>
                  <div style={{ fontWeight: 620 }}>{inc.owner.name}</div>
                  <div className="tiny dim">{inc.owner.role}</div>
                  <div className="tiny dim">{inc.owner.team} · {inc.owner.handle}</div>
                </div>
                <span className="spacer" />
                <IconUser width={16} height={16} style={{ color: 'var(--text-3)' }} />
              </div>

              <div className="panel" style={{ padding: 13, background: 'linear-gradient(120deg, rgba(139,92,246,.16), transparent)' }}>
                <div className="label">Historical fix</div>
                <div className="small" style={{ marginTop: 5, fontWeight: 620 }}>{data.canonicalFix}</div>
                <div className="tiny dim" style={{ marginTop: 5 }}>
                  runbook {data.runbook} · applied as: {inc.resolutionSteps[0]}
                </div>
              </div>

              <div className="panel" style={{ padding: 13, background: 'linear-gradient(120deg, rgba(99,102,241,.13), transparent)' }}>
                <div className="row" style={{ gap: 8 }}>
                  <IconGit width={14} height={14} style={{ color: '#c3c6ff' }} />
                  <span className="mono small" style={{ color: '#c3c6ff' }}>{inc.fix.repo}@{inc.fix.commit}</span>
                  <span className="spacer" />
                  <span className="badge badge-info">{inc.fix.pr}</span>
                </div>
                <div className="small" style={{ marginTop: 7 }}>{inc.fix.message}</div>
                <div className="tiny dim" style={{ marginTop: 6 }}>
                  branch {inc.fix.branch} · deployed {dt(inc.fix.deployedAt)}
                </div>
              </div>

              <div>
                <div className="label" style={{ marginBottom: 6 }}>Diff summary</div>
                <p className="small muted" style={{ margin: 0 }}>{inc.fix.diffSummary}</p>
              </div>

              <div>
                <div className="label" style={{ marginBottom: 6 }}>Files touched</div>
                <div className="stack" style={{ gap: 5 }}>
                  {inc.fix.files.map((file) => (
                    <div className="row mono tiny" key={file} style={{ gap: 7 }}>
                      <IconGit width={11} height={11} style={{ color: 'var(--text-3)' }} />
                      {file}
                    </div>
                  ))}
                </div>
              </div>

              <div className="divider" />
              <div className="row" style={{ gap: 10 }}>
                <IconChart width={15} height={15} style={{ color: 'var(--text-3)' }} />
                <div className="small">
                  Retrieved <strong>{data.reuse.timesRetrieved}</strong> time(s) by analyses
                  {data.reuse.lastRetrievedAt ? ` · last ${relTime(data.reuse.lastRetrievedAt)}` : ''}
                </div>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Telemetry at incident time" subtitle="Numbers quoted in the review">
            <KeyValue
              items={[
                { k: 'Peak error rate', v: inc.telemetry.peakErrorRate },
                { k: 'p99 latency', v: inc.telemetry.p99Latency },
                { k: 'Affected users', v: inc.telemetry.affectedUsers.toLocaleString('en-IN') },
                { k: 'Error budget burn', v: inc.telemetry.errorBudgetBurn },
                { k: 'Detected', v: dt(inc.detectedAt) },
                { k: 'Resolved', v: dt(inc.resolvedAt) },
                { k: 'Duration', v: duration(inc.mttrMinutes) },
                { k: 'Significance', v: dateOnly(inc.detectedAt) },
              ]}
            />
            <div style={{ marginTop: 14 }}>
              <div className="row small">
                <span>Error-budget burn vs SLO</span>
                <span className="spacer" />
                <span className="mono tiny">{inc.telemetry.errorBudgetBurn}</span>
              </div>
              <ProgressBar value={Math.min(100, (inc.mttrMinutes / 60) * 100)} tone={inc.severity === 'critical' ? 'critical' : 'warn'} />
            </div>
          </SectionCard>

          <SectionCard title="Related memory" subtitle="Same class or explicitly linked incidents">
            <div className="stack" style={{ gap: 10 }}>
              {data.related.map((rel) => (
                <Link key={rel.id} href={`/incidents/${rel.id}`} className="panel card card-hover" style={{ padding: 12 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <span className="mono tiny" style={{ color: '#c3c6ff' }}>{rel.id}</span>
                    <SeverityBadge severity={rel.severity} small />
                    <span className="spacer" />
                    <span className="tiny dim">{rel.mttrMinutes}m</span>
                  </div>
                  <div className="small" style={{ marginTop: 5, fontWeight: 560 }}>{rel.title}</div>
                  <div className="tiny dim">
                    {rel.service} · {rel.similarityContext}
                  </div>
                </Link>
              ))}
              {data.related.length === 0 ? <div className="small dim">No related incidents recorded.</div> : null}
            </div>
          </SectionCard>

          <SectionCard
            title="Post-mortems"
            subtitle="Documents generated from this incident"
            right={
              <button
                className="btn btn-primary btn-sm"
                disabled={generating}
                onClick={async () => {
                  setGenerating(true);
                  try {
                    const res = await postJson<{ ok: boolean; postMortem: PostMortem }>('/api/postmortems', { incidentId: inc.id });
                    setGenerated(res.postMortem);
                    toast('Post-mortem generated', `${res.postMortem.id} saved to the database.`, 'ok');
                  } catch (err) {
                    toast('Generation failed', (err as Error).message, 'critical');
                  } finally {
                    setGenerating(false);
                  }
                }}
              >
                <IconBrain width={13} height={13} />
                {generating ? 'Generating…' : 'Generate'}
              </button>
            }
          >
            <div className="stack" style={{ gap: 10 }}>
              {data.reuse.postMortems.map((pm) => (
                <Link key={pm.id} href={`/postmortems/${pm.id}`} className="row panel card-hover" style={{ padding: 11, gap: 9 }}>
                  <IconRepeat width={14} height={14} style={{ color: 'var(--text-3)' }} />
                  <div>
                    <div className="small mono">{pm.id}</div>
                    <div className="tiny dim">{dt(pm.generatedAt)} · {pm.status}</div>
                  </div>
                  <span className="spacer" />
                  <IconArrowRight width={14} height={14} style={{ color: 'var(--text-3)' }} />
                </Link>
              ))}
              {data.reuse.postMortems.length === 0 && !generated ? (
                <div className="small dim">No post-mortem yet. Generate one from this incident’s recorded memory.</div>
              ) : null}
            </div>
          </SectionCard>

          {(data.reuse.analyses.length > 0 || generated) ? (
            <SectionCard title="Live reuse" subtitle="Analyses that retrieved this incident">
              <div className="stack" style={{ gap: 10 }}>
                {data.reuse.analyses.map((a) => (
                  <div className="row" key={a.id} style={{ gap: 10 }}>
                    <span className="mono tiny dim">{a.id}</span>
                    <span className="small">{a.service}</span>
                    <span className="spacer" />
                    <span className="mono tiny">{a.similarity}%</span>
                    <span className="tiny dim">{relTime(a.createdAt)}</span>
                  </div>
                ))}
                {generated ? (
                  <div className="callout ok">
                    <IconCheck width={15} height={15} style={{ marginTop: 2, flex: 'none' }} />
                    <div className="small">
                      {generated.id} generated from this incident — <button className="btn btn-ghost btn-sm" onClick={() => router.push(`/postmortems/${generated.id}`)}>open document</button>
                    </div>
                  </div>
                ) : null}
              </div>
            </SectionCard>
          ) : null}
        </div>
      </div>

      {generated ? (
        <div className="animate-in">
          <PostMortemDoc postMortem={generated} compact />
        </div>
      ) : null}

      <div className="row row-wrap" style={{ gap: 10 }}>
        <Link href="/incidents" className="btn btn-ghost btn-sm">
          <IconLayers width={13} height={13} />
          Back to repository
        </Link>
        {inc.relatedIncidentIds.map((relId) => (
          <Link key={relId} href={`/incidents/${relId}`} className="btn btn-ghost btn-sm mono">
            {relId}
          </Link>
        ))}
      </div>
    </div>
  );
}
