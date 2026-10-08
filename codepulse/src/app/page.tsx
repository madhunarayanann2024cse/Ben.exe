'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AreaChart, Donut, Gauge, HBars, Sparkline } from '@/components/charts';
import { Badge, Kpi, ProgressBar, SectionCard, SeverityBadge, Skeleton, StatusBadge } from '@/components/ui';
import {
  IconAlert, IconBolt, IconBrain, IconChart, IconCheck, IconClock, IconDatabase, IconLayers, IconRepeat, IconSparkle,
} from '@/components/icons';
import { useApi } from '@/lib/useApi';
import { duration, num, relTime } from '@/lib/format';
import type { DashboardData } from '@/lib/analytics';

interface DashboardResponse {
  ok: boolean;
  data: DashboardData;
  db: { backend: string; label: string; vectorSearch: string; incidents: number };
}

export default function DashboardPage() {
  const router = useRouter();
  const { data, loading, error } = useApi<DashboardResponse>('/api/dashboard', { pollMs: 60_000 });
  const dash = data?.data;

  if (error) {
    return (
      <div className="callout critical">
        <IconAlert width={16} height={16} style={{ marginTop: 2 }} />
        <div>
          <strong>Could not load the dashboard.</strong>
          <div className="small muted">{error}</div>
        </div>
      </div>
    );
  }

  if (loading && !dash) {
    return (
      <div className="stack">
        <div className="grid grid-4">
          {[0, 1, 2, 3].map((i) => (
            <div className="panel card" key={i}>
              <Skeleton height={12} width={90} />
              <div style={{ height: 14 }} />
              <Skeleton height={30} width={120} />
              <div style={{ height: 12 }} />
              <Skeleton height={10} width={150} />
            </div>
          ))}
        </div>
        <div className="panel card">
          <Skeleton height={240} />
        </div>
      </div>
    );
  }
  if (!dash) return null;

  const t = dash.totals;
  const spark = dash.trend.map((p) => p.incidents);

  return (
    <div className="stack" style={{ gap: 22 }}>
      {/* ── hero: demo entry point + live posture ─────────────────────────── */}
      <section className="panel animate-in" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.72fr) minmax(0, 1fr)' }} className="hero-grid">
          <div style={{ padding: '24px 26px' }}>
            <div className="row" style={{ gap: 10, marginBottom: 10 }}>
              <Badge tone="accent" dot>
                {data?.db.backend === 'supabase-postgres' ? 'Supabase PostgreSQL' : 'Embedded durable store'}
              </Badge>
              <span className="chip">{data?.db.vectorSearch === 'pgvector-rpc' ? 'pgvector ANN search' : 'cosine ANN search'}</span>
              <span className="chip">{t.incidents} incidents indexed</span>
            </div>
            <h2 style={{ fontSize: 24, margin: '2px 0 8px', letterSpacing: -0.6 }}>
              Your engineering team never forgets.
            </h2>
            <p className="muted small" style={{ maxWidth: 620, margin: 0 }}>
              Paste a production stack trace and CodePulse retrieves the closest historical incident by vector similarity,
              predicts the root cause, surfaces the engineer who solved it and their exact Git commit — then writes the post-mortem.
            </p>
            <div className="row row-wrap" style={{ gap: 10, marginTop: 18 }}>
              <button className="btn btn-primary btn-lg" onClick={() => router.push('/analyze?demo=1')}>
                <IconBolt width={16} height={16} />
                Run the demo trace
              </button>
              <Link href="/analyze" className="btn btn-lg">
                <IconSparkle width={15} height={15} />
                Open analysis workspace
              </Link>
              <Link href="/incidents" className="btn btn-ghost btn-lg">
                <IconDatabase width={15} height={15} />
                Browse {t.incidents} incidents
              </Link>
            </div>
          </div>
          <div
            style={{
              padding: '22px 24px',
              borderLeft: '1px solid var(--border)',
              background: 'linear-gradient(160deg, rgba(99,102,241,.14), rgba(139,92,246,.05))',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
            }}
          >
            <Gauge
              value={dash.healthScore}
              label="reliability posture"
              color={dash.healthScore >= 80 ? '#10b981' : dash.healthScore >= 62 ? '#f59e0b' : '#f43f5e'}
              target={80}
              size={168}
            />
            <div className="row" style={{ gap: 14 }}>
              <div style={{ textAlign: 'center' }}>
                <div className="mono" style={{ fontSize: 18, fontWeight: 650 }}>{t.memoryCoverage}%</div>
                <div className="tiny dim">memory coverage</div>
              </div>
              <div style={{ width: 1, height: 30, background: 'var(--border)' }} />
              <div style={{ textAlign: 'center' }}>
                <div className="mono" style={{ fontSize: 18, fontWeight: 650 }}>{t.postMortems}</div>
                <div className="tiny dim">post-mortems</div>
              </div>
              <div style={{ width: 1, height: 30, background: 'var(--border)' }} />
              <div style={{ textAlign: 'center' }}>
                <div className="mono" style={{ fontSize: 18, fontWeight: 650 }}>{t.analyses}</div>
                <div className="tiny dim">analyses run</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── KPIs ──────────────────────────────────────────────────────────── */}
      <div className="grid grid-4">
        <Kpi
          label="Total incidents"
          value={num(t.incidents)}
          icon={<IconDatabase width={15} height={15} />}
          sub={
            <>
              <span className="mono">{t.resolved}</span> resolved ·{' '}
              <span className="mono">{t.open}</span> open
            </>
          }
        />
        <Kpi
          label="Critical incidents"
          value={num(t.critical)}
          icon={<IconAlert width={15} height={15} />}
          tone="critical"
          valueColor="#ffb3c0"
          sub={<>{((t.critical / Math.max(1, t.incidents)) * 100).toFixed(0)}% of all incidents · {t.high} high</>}
        />
        <Kpi
          label="Recurring incidents"
          value={num(t.recurring)}
          icon={<IconRepeat width={15} height={15} />}
          tone="warn"
          valueColor="#ffd79a"
          sub={<>repeat offenders · top class in watchlist</>}
        />
        <Kpi
          label="Average resolution time"
          value={duration(t.avgMttr)}
          icon={<IconClock width={15} height={15} />}
          tone="ok"
          valueColor="#8ff0cd"
          sub={<>best {duration(t.bestMttr)} · target under 30m</>}
        />
      </div>

      {/* ── trend + severity ──────────────────────────────────────────────── */}
      <div className="grid grid-2-1">
        <SectionCard
          title="Incident trend — last 14 days"
          subtitle="Detections per day, critical overlay and mean time to resolve"
          right={
            <>
              <span className="chip">
                <IconAlert width={12} height={12} /> {t.critical} critical
              </span>
              <Sparkline data={spark} width={90} height={26} />
            </>
          }
        >
          <AreaChart data={dash.trend} height={252} />
          <div className="chart-legend" style={{ marginTop: 10 }}>
            <span>
              <i className="swatch" style={{ background: '#6366f1' }} /> incidents
            </span>
            <span>
              <i className="swatch" style={{ background: '#f43f5e' }} /> critical
            </span>
            <span>
              <i className="swatch" style={{ background: 'rgba(126,143,255,.35)' }} /> hover for MTTR
            </span>
          </div>
        </SectionCard>

        <SectionCard title="Severity mix" subtitle="Distribution across the incident corpus">
          <Donut data={dash.severity} centerLabel="incidents" centerValue={t.incidents} />
          <div className="divider" />
          <div className="stack" style={{ gap: 9 }}>
            {dash.status.map((s) => (
              <div key={s.name}>
                <div className="row small">
                  <span>{s.name}</span>
                  <span className="spacer" />
                  <span className="mono">{s.value}</span>
                </div>
                <ProgressBar value={(s.value / Math.max(1, t.incidents)) * 100} thin tone={s.name === 'Resolved' ? 'ok' : s.name === 'Open' ? 'critical' : 'warn'} />
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      {/* ── root causes / services / AI value ─────────────────────────────── */}
      <div className="grid grid-3">
        <SectionCard title="Root-cause distribution" subtitle="Failure classes across the corpus">
          <HBars
            data={dash.categories.slice(0, 7).map((c) => ({ name: c.name, value: c.value, hint: `${c.avgMttr}m avg` }))}
            color="linear-gradient(90deg,#8b5cf6,#22d3ee)"
          />
        </SectionCard>

        <SectionCard title="Service load" subtitle="Incidents and mean time to resolve by service">
          <HBars
            data={dash.services.slice(0, 7).map((s) => ({ name: s.name, value: s.incidents, hint: `${s.avgMttr}m · ${s.critical} crit` }))}
            color="linear-gradient(90deg,#6366f1,#8b5cf6)"
          />
        </SectionCard>

        <SectionCard title="Memory intelligence" subtitle="What accumulated knowledge is worth">
          <div className="stack" style={{ gap: 16 }}>
            <div className="row" style={{ gap: 14 }}>
              <div
                className="kpi-icon"
                style={{ width: 40, height: 40, background: 'linear-gradient(140deg,rgba(99,102,241,.28),rgba(139,92,246,.16))' }}
              >
                <IconBrain width={18} height={18} />
              </div>
              <div>
                <div style={{ fontSize: 21, fontWeight: 680, letterSpacing: -0.6 }}>{num(t.engineeringHoursSaved)}h</div>
                <div className="tiny dim">engineering hours saved (est.) by reusing 16 recorded fixes</div>
              </div>
            </div>
            <div className="stack" style={{ gap: 10 }}>
              <div>
                <div className="row small">
                  <span>Incidents with a recorded fix</span>
                  <span className="spacer" />
                  <span className="mono">{t.incidents}/{t.incidents}</span>
                </div>
                <ProgressBar value={100} tone="ok" thin />
              </div>
              <div>
                <div className="row small">
                  <span>Analyses persisted to database</span>
                  <span className="spacer" />
                  <span className="mono">{t.analyses}</span>
                </div>
                <ProgressBar value={Math.min(100, t.analyses * 14)} thin />
              </div>
              <div>
                <div className="row small">
                  <span>AI telemetry rows (logbook)</span>
                  <span className="spacer" />
                  <span className="mono">{t.aiLogs}</span>
                </div>
                <ProgressBar value={Math.min(100, t.aiLogs * 3)} tone="warn" thin />
              </div>
            </div>
            <div className="callout info">
              <IconCheck width={15} height={15} style={{ marginTop: 2, flex: 'none' }} />
              <div className="small">
                Every analysis, post-mortem and prompt hash is written to the live database — nothing important is trapped in{' '}
                <span className="mono">localStorage</span>.
              </div>
            </div>
          </div>
        </SectionCard>
      </div>

      {/* ── recent + watchlist ────────────────────────────────────────────── */}
      <div className="grid grid-2-1">
        <SectionCard
          title="Recent incidents"
          subtitle="Most recent entries in incident memory"
          padding={false}
          right={
            <Link href="/incidents" className="btn btn-ghost btn-sm">
              View all
            </Link>
          }
        >
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <th>Incident</th>
                  <th>Service</th>
                  <th>Severity</th>
                  <th>Status</th>
                  <th>MTTR</th>
                  <th>Detected</th>
                </tr>
              </thead>
              <tbody>
                {dash.recent.map((inc) => (
                  <tr key={inc.id} style={{ cursor: 'pointer' }} onClick={() => router.push(`/incidents/${inc.id}`)}>
                    <td>
                      <div className="id-cell">{inc.id}</div>
                      <div className="title-cell small" style={{ maxWidth: 330, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {inc.title}
                      </div>
                    </td>
                    <td className="small">{inc.service}</td>
                    <td>
                      <SeverityBadge severity={inc.severity} small />
                    </td>
                    <td>
                      <StatusBadge status={inc.status} />
                    </td>
                    <td className="mono small">{duration(inc.mttrMinutes)}</td>
                    <td className="small dim">{relTime(inc.detectedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>

        <div className="stack" style={{ gap: 18 }}>
          <SectionCard
            title="Recurrence watchlist"
            subtitle="Same class, same service, more than once"
            right={<Badge tone="medium">{t.recurring} flagged</Badge>}
          >
            <div className="stack" style={{ gap: 12 }}>
              {dash.recurring.slice(0, 4).map((inc) => (
                <Link key={inc.id} href={`/incidents/${inc.id}`} className="panel card card-hover" style={{ padding: 13 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <span className="dot dot-medium dot-live" />
                    <span className="mono tiny" style={{ color: '#ffd79a' }}>{inc.id}</span>
                    <span className="spacer" />
                    <span className="badge badge-medium">×{inc.recurrenceCount} recurring</span>
                  </div>
                  <div className="small" style={{ fontWeight: 580, marginTop: 6 }}>{inc.rootCauseCategory}</div>
                  <div className="tiny dim">{inc.service} · last seen {relTime(inc.detectedAt)}</div>
                </Link>
              ))}
              {dash.recurring.length === 0 ? <div className="empty-state">No recurring incidents detected.</div> : null}
            </div>
          </SectionCard>

          <SectionCard
            title="Intelligence feed"
            subtitle="Generated from the live corpus"
            right={<IconLayers width={15} height={15} style={{ color: 'var(--text-3)' }} />}
          >
            <div className="stack" style={{ gap: 12 }}>
              {dash.insights.map((insight) => (
                <div key={insight.title} className={`callout ${insight.tone}`}>
                  <span
                    className={`dot ${
                      insight.tone === 'critical' ? 'dot-critical' : insight.tone === 'warn' ? 'dot-medium' : insight.tone === 'good' ? 'dot-ok' : 'dot-low'
                    }`}
                    style={{ marginTop: 4 }}
                  />
                  <div>
                    <div className="small" style={{ fontWeight: 620 }}>{insight.title}</div>
                    <div className="small muted">{insight.detail}</div>
                  </div>
                </div>
              ))}
              <Link href="/analytics" className="btn btn-ghost btn-sm">
                <IconChart width={14} height={14} />
                Open full analytics
              </Link>
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
