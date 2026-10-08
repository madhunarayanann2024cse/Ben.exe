'use client';

import { useState } from 'react';
import { AreaChart, Donut, Gauge, HBars, Heatmap, Sparkline } from '@/components/charts';
import { Badge, Kpi, ProgressBar, SectionCard, SeverityBadge, Skeleton } from '@/components/ui';
import { IconAlert, IconBrain, IconChart, IconClock, IconRepeat, IconShield, IconLayers, IconDatabase } from '@/components/icons';
import { useApi } from '@/lib/useApi';
import { duration, num } from '@/lib/format';
import type { AnalyticsData } from '@/lib/analytics';

interface AnalyticsResponse {
  ok: boolean;
  data: AnalyticsData;
}

export default function AnalyticsPage() {
  const { data, loading } = useApi<AnalyticsResponse>('/api/analytics', { pollMs: 120_000 });
  const [activeTab, setActiveTab] = useState<'all' | 'heatmap' | 'services' | 'ai'>('all');
  const a = data?.data;

  if (loading && !a) {
    return (
      <div className="stack" style={{ gap: 20 }}>
        <div className="grid grid-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} height={130} style={{ borderRadius: 14 }} />)}
        </div>
        <Skeleton height={320} style={{ borderRadius: 14 }} />
      </div>
    );
  }
  if (!a) return null;

  const totalIncidents = a.services.reduce((acc, s) => acc + s.incidents, 0);

  return (
    <div className="stack" style={{ gap: 22 }}>
      {/* ── Top Navigation Tabs & Quick Stats ────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div className="row" style={{ gap: 6, background: 'rgba(16, 21, 38, 0.7)', padding: 4, borderRadius: 12, border: '1px solid var(--border)' }}>
          <button
            type="button"
            className={`btn btn-sm ${activeTab === 'all' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setActiveTab('all')}
          >
            <IconChart width={14} height={14} />
            <span>Complete Overview</span>
          </button>
          <button
            type="button"
            className={`btn btn-sm ${activeTab === 'heatmap' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setActiveTab('heatmap')}
          >
            <IconLayers width={14} height={14} />
            <span>Failure Heatmap</span>
          </button>
          <button
            type="button"
            className={`btn btn-sm ${activeTab === 'services' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setActiveTab('services')}
          >
            <IconDatabase width={14} height={14} />
            <span>Services & MTTR</span>
          </button>
          <button
            type="button"
            className={`btn btn-sm ${activeTab === 'ai' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setActiveTab('ai')}
          >
            <IconBrain width={14} height={14} />
            <span>AI Reasoning Quality</span>
          </button>
        </div>

        <div className="row" style={{ gap: 8 }}>
          <span className="badge badge-accent">
            <span className="dot dot-ok dot-live" />
            <span>14-day rolling window</span>
          </span>
          <span className="chip">{a.services.length} Microservices</span>
        </div>
      </div>

      {/* ── High-Level KPI Cards ────────────────────────────────────────── */}
      <div className="grid grid-4">
        <Kpi
          label="Mean Time to Resolve"
          value={duration(a.reliability.avgMttr)}
          icon={<IconClock width={16} height={16} />}
          tone="ok"
          valueColor="#6ee7b7"
          sub={<>Target: 30m · p50 {a.reliability.p50}m · p90 {a.reliability.p90}m</>}
        />
        <Kpi
          label="Resolution Rate"
          value={`${a.reliability.resolvedRate}%`}
          icon={<IconShield width={16} height={16} />}
          valueColor="#93c5fd"
          sub={<>{totalIncidents} recorded production RCAs</>}
        />
        <Kpi
          label="Recurrence Rate"
          value={`${a.reliability.recurrenceRate}%`}
          icon={<IconRepeat width={16} height={16} />}
          tone="warn"
          valueColor="#fde047"
          sub={<>Repeat failure classes requiring architectural playbooks</>}
        />
        <Kpi
          label="AI Incident Queries"
          value={num(a.aiUsage.analyses)}
          icon={<IconBrain width={16} height={16} />}
          valueColor="#c4b5fd"
          sub={<>avg similarity {a.aiUsage.avgSimilarity || '—'}% · {a.aiUsage.avgLatencyMs} ms median</>}
        />
      </div>

      {/* ── Section: Volume & Posture ───────────────────────────────────── */}
      {(activeTab === 'all' || activeTab === 'services') && (
        <div className="grid grid-2-1">
          <SectionCard
            title="Incident Volume & Detections (30 Days)"
            subtitle="Incident detections, critical classifications and resolution velocity"
            right={<Badge tone="info">{a.trend.reduce((acc, t) => acc + t.incidents, 0)} detections</Badge>}
          >
            <AreaChart data={a.trend} height={260} />
            <div className="chart-legend" style={{ marginTop: 14 }}>
              <span><i className="swatch" style={{ background: '#6366f1' }} /> Total Incidents</span>
              <span><i className="swatch" style={{ background: '#f43f5e' }} /> Critical Severity</span>
            </div>
          </SectionCard>

          <SectionCard title="Reliability Posture" subtitle="MTTR performance relative to the 30-min SLO">
            <div className="stack" style={{ gap: 16, alignItems: 'center' }}>
              <Gauge
                value={Math.max(6, Math.min(100, Math.round((a.reliability.mttrTarget / Math.max(1, a.reliability.avgMttr)) * 70)))}
                label="SLO compliance"
                target={70}
                color={a.reliability.avgMttr <= 30 ? '#10b981' : a.reliability.avgMttr <= 45 ? '#f59e0b' : '#f43f5e'}
                size={185}
              />
              <div className="stack" style={{ gap: 14, width: '100%' }}>
                <div>
                  <div className="row small">
                    <span style={{ color: 'var(--text-2)' }}>AI-Assisted MTTR Projection</span>
                    <span className="spacer" />
                    <span className="mono" style={{ color: '#6ee7b7', fontWeight: 600 }}>{duration(a.reliability.aiAssistedMttr)}</span>
                  </div>
                  <ProgressBar value={100 - (a.reliability.aiAssistedMttr / Math.max(1, a.reliability.avgMttr)) * 100} tone="ok" thin />
                  <div className="tiny dim" style={{ marginTop: 4 }}>
                    Reusing recorded fixes instead of re-deriving them
                  </div>
                </div>
                <div>
                  <div className="row small">
                    <span style={{ color: 'var(--text-2)' }}>Resolved Within Target (30m)</span>
                    <span className="spacer" />
                    <span className="mono">{a.services.reduce((acc, s) => acc + (s.avgMttr <= 30 ? 1 : 0), 0)} / {a.services.length} services</span>
                  </div>
                  <ProgressBar value={(a.services.reduce((acc, s) => acc + (s.avgMttr <= 30 ? 1 : 0), 0) / Math.max(1, a.services.length)) * 100} thin />
                </div>
                <div className="row row-wrap" style={{ gap: 8 }}>
                  <span className="chip">5xx errors resolved fastest</span>
                  <span className="chip">Connection pool leaks slowest</span>
                </div>
              </div>
            </div>
          </SectionCard>
        </div>
      )}

      {/* ── Section: Distributions ──────────────────────────────────────── */}
      {activeTab === 'all' && (
        <div className="grid grid-3">
          <SectionCard title="Severity Distribution" subtitle="Composition across all active incidents">
            <Donut data={a.severityMix} centerLabel="incidents" />
          </SectionCard>

          <SectionCard title="Root-Cause Taxonomy" subtitle="Dominant failure classifications">
            <HBars
              data={a.categories.slice(0, 8).map((c) => ({ name: c.name, value: c.value, hint: `${c.share}% · ${c.avgMttr}m` }))}
              color="linear-gradient(90deg,#8b5cf6,#06b6d4)"
            />
          </SectionCard>

          <SectionCard title="Weekly Incident Flow" subtitle="Eight-week rolling cadence">
            <HBars
              data={a.weekly.map((w) => ({ name: w.label, value: w.incidents, hint: `${w.critical} critical` }))}
              color="linear-gradient(90deg,#6366f1,#8b5cf6)"
            />
          </SectionCard>
        </div>
      )}

      {/* ── Section: Service Performance & AI Match Quality ─────────────── */}
      {(activeTab === 'all' || activeTab === 'services' || activeTab === 'ai') && (
        <div className="grid grid-2-1">
          <SectionCard title="Service Reliability Matrix" subtitle="Volume, severity distribution, and mean recovery duration" padding={false}>
            <div className="scroll-x">
              <table className="table">
                <thead>
                  <tr>
                    <th>Service Component</th>
                    <th>Incidents</th>
                    <th>Critical Count</th>
                    <th>Avg MTTR</th>
                    <th>Recovery Variance</th>
                  </tr>
                </thead>
                <tbody>
                  {a.services.map((s) => (
                    <tr key={s.name}>
                      <td className="title-cell">{s.name}</td>
                      <td className="mono">{s.incidents}</td>
                      <td>
                        <SeverityBadge severity={s.critical > 1 ? 'critical' : s.critical === 1 ? 'high' : 'low'} small />
                        <span className="mono tiny" style={{ marginLeft: 8 }}>{s.critical}</span>
                      </td>
                      <td className="mono" style={{ fontWeight: 600 }}>{duration(s.avgMttr)}</td>
                      <td style={{ minWidth: 160 }}>
                        <ProgressBar
                          value={Math.min(100, (s.avgMttr / Math.max(...a.services.map((x) => x.avgMttr))) * 100)}
                          tone={s.avgMttr > 45 ? 'critical' : s.avgMttr > 30 ? 'warn' : 'ok'}
                          thin
                        />
                        <div className="tiny dim" style={{ marginTop: 4 }}>
                          {s.mttrDelta >= 0 ? `+${s.mttrDelta}m vs avg` : `${s.mttrDelta}m vs avg`}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>

          <SectionCard title="AI Retrieval Accuracy" subtitle="Vector match similarity & engine performance">
            <div className="stack" style={{ gap: 14 }}>
              <div className="row" style={{ gap: 14 }}>
                <Sparkline data={a.aiUsage.matchQuality.map((m) => m.similarity).reverse()} width={140} height={46} color="#06b6d4" />
                <div>
                  <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: -0.6, color: '#38bdf8' }}>{a.aiUsage.avgSimilarity || 0}%</div>
                  <div className="tiny dim">Mean top-1 similarity</div>
                </div>
              </div>

              <div className="stack" style={{ gap: 10 }}>
                {a.aiUsage.engineMix.map((m) => (
                  <div key={m.name}>
                    <div className="row small">
                      <span style={{ color: 'var(--text-2)' }}>{m.name}</span>
                      <span className="spacer" />
                      <span className="mono">{m.value}</span>
                    </div>
                    <ProgressBar value={(m.value / Math.max(1, a.aiUsage.analyses)) * 100} thin />
                  </div>
                ))}
              </div>

              <div className="row row-wrap" style={{ gap: 8 }}>
                <span className="badge badge-accent">{a.aiUsage.highConfidence} High Confidence</span>
                <span className="chip">{a.aiUsage.avgLatencyMs} ms Latency</span>
              </div>

              <div className="divider" style={{ margin: '12px 0' }} />

              <div>
                <div className="label" style={{ marginBottom: 10 }}>Recent Live Match Queries</div>
                <div className="stack" style={{ gap: 8 }}>
                  {a.aiUsage.matchQuality.slice(0, 5).map((m) => (
                    <div className="row small" key={m.label + m.service} style={{ padding: '4px 0', borderBottom: '1px solid rgba(126, 143, 255, 0.05)' }}>
                      <span className="mono tiny dim">{m.label}</span>
                      <span className="spacer" />
                      <span className="tiny" style={{ color: 'var(--text-2)' }}>{m.service}</span>
                      <span className="mono" style={{ minWidth: 46, textAlign: 'right', fontWeight: 600, color: '#a5b4fc' }}>{m.similarity}%</span>
                    </div>
                  ))}
                  {a.aiUsage.matchQuality.length === 0 ? <div className="small dim">No analyses yet — run one from the workspace.</div> : null}
                </div>
              </div>
            </div>
          </SectionCard>
        </div>
      )}

      {/* ── Section: Service × Root-Cause Heatmap ───────────────────────── */}
      {(activeTab === 'all' || activeTab === 'heatmap') && (
        <SectionCard
          title="Service × Root-Cause Failure Heatmap"
          subtitle="Identifies recurring architectural patterns where identical failure modes trigger repeatedly across services"
          right={<Badge tone="accent"><IconChart width={12} height={12} /> {a.heatmap.filter((h) => h.value > 0).length} active cells</Badge>}
        >
          <div style={{ overflowX: 'auto', padding: '6px 0' }}>
            <Heatmap
              rows={Array.from(new Set(a.heatmap.map((h) => h.service)))}
              cols={Array.from(new Set(a.heatmap.map((h) => h.category)))}
              cells={a.heatmap}
            />
          </div>
          <div className="callout info" style={{ marginTop: 16 }}>
            <IconAlert width={16} height={16} style={{ marginTop: 2, flex: 'none' }} />
            <div className="small">
              <strong>Architectural Insight:</strong> Concentrated heatmap clusters highlight repeated structural failure
              modes (e.g. database pool limits, unhandled timeouts) that should be resolved with global runbooks rather than isolated single-commit patches.
            </div>
          </div>
        </SectionCard>
      )}
    </div>
  );
}
