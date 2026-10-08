'use client';

import { Fragment, useMemo, useState } from 'react';
import { Badge, KeyValue, SectionCard, Skeleton } from '@/components/ui';
import { toast } from '@/components/Toaster';
import { IconBrain, IconCheck, IconClock, IconDownload, IconShield, IconTerminal } from '@/components/icons';
import { useApi, postJson } from '@/lib/useApi';
import { dt, relTime } from '@/lib/format';
import type { AiLog } from '@/lib/types';

interface TelemetryResponse {
  ok: boolean;
  provider: { provider: string; model: string; live: boolean };
  summary: { total: number; heartbeats: number; lastHeartbeatAt: string | null; intervalMs: number; kinds: string[] };
  logs: AiLog[];
}

const KIND_TONE: Record<string, string> = {
  heartbeat: 'info',
  reasoning: 'accent',
  postmortem: 'ok',
  embedding: 'ghost',
  seed: 'medium',
  analysis: 'accent',
};

export default function LogbookPage() {
  const { data, loading, refresh } = useApi<TelemetryResponse>('/api/telemetry?limit=120', { pollMs: 60_000 });
  const [kind, setKind] = useState<string>('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  const logs = useMemo(() => (data?.logs ?? []).filter((l) => (kind === 'all' ? true : l.kind === kind)), [data, kind]);

  const stats = useMemo(() => {
    const all = data?.logs ?? [];
    return {
      total: all.length,
      heartbeats: all.filter((l) => l.kind === 'heartbeat').length,
      fallbacks: all.filter((l) => l.fallback).length,
      avgLatency: all.length ? Math.round(all.reduce((a, b) => a + b.latencyMs, 0) / all.length) : 0,
      tokens: all.reduce((a, b) => a + b.tokensEst, 0),
    };
  }, [data]);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(data?.logs ?? [], null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `codepulse-logbook-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Logbook exported', `${(data?.logs ?? []).length} telemetry rows saved as JSON.`, 'ok');
  };

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="grid grid-4">
        <SectionCard>
          <div className="kpi-label"><span className="kpi-icon"><IconTerminal width={14} height={14} /></span>Logbook rows</div>
          <div className="kpi-value">{stats.total}</div>
          <div className="kpi-sub">persisted in the AI log table</div>
        </SectionCard>
        <SectionCard>
          <div className="kpi-label"><span className="kpi-icon"><IconClock width={14} height={14} /></span>Heartbeats</div>
          <div className="kpi-value">{stats.heartbeats}</div>
          <div className="kpi-sub">
            every {Math.round((data?.summary.intervalMs ?? 600_000) / 60000)} min · last {data?.summary.lastHeartbeatAt ? relTime(data.summary.lastHeartbeatAt) : '—'}
          </div>
        </SectionCard>
        <SectionCard>
          <div className="kpi-label"><span className="kpi-icon"><IconBrain width={14} height={14} /></span>Avg latency</div>
          <div className="kpi-value">{stats.avgLatency}<span style={{ fontSize: 15, opacity: 0.6 }}> ms</span></div>
          <div className="kpi-sub">{stats.fallbacks} deterministic fallbacks</div>
        </SectionCard>
        <SectionCard>
          <div className="kpi-label"><span className="kpi-icon"><IconShield width={14} height={14} /></span>Redaction</div>
          <div className="kpi-value" style={{ fontSize: 19 }}>active</div>
          <div className="kpi-sub">tokens, JWTs, bearer keys masked before storage</div>
        </SectionCard>
      </div>

      <SectionCard
        title="Engine provenance"
        subtitle="Provider, model and heartbeat policy — no key material is ever stored or returned"
        right={
          <div className="row row-wrap" style={{ gap: 8 }}>
            <button
              className="btn btn-sm"
              onClick={async () => {
                try {
                  await postJson('/api/telemetry?force=1', {});
                  toast('Heartbeat written', 'A new logbook row was appended.', 'ok');
                  refresh();
                } catch (err) {
                  toast('Heartbeat failed', (err as Error).message, 'critical');
                }
              }}
            >
              <IconCheck width={13} height={13} />
              Write heartbeat now
            </button>
            <button className="btn btn-ghost btn-sm" onClick={exportJson}>
              <IconDownload width={13} height={13} />
              Export JSON
            </button>
          </div>
        }
      >
        <div className="grid grid-2" style={{ gap: 18 }}>
          <KeyValue
            items={[
              { k: 'Provider', v: data?.provider.live ? `${data.provider.provider} (server-side)` : 'PulseReasoner v1 (built-in)' },
              { k: 'Model', v: <span className="mono">{data?.provider.model ?? '—'}</span> },
              { k: 'Mode', v: data?.provider.live ? 'LLM reasoning + PulseReasoner retrieval' : 'Fully deterministic, offline, zero-latency' },
              { k: 'Keys', v: data?.provider.live ? 'loaded from server env at call time' : 'no LLM key configured' },
            ]}
          />
          <div className="stack" style={{ gap: 10 }}>
            <div className="callout info">
              <IconShield width={15} height={15} style={{ marginTop: 2, flex: 'none' }} />
              <div className="small">
                Telemetry rows store a SHA-256 prompt hash, a redacted prompt preview, latency, token estimate and the provider that
                answered. Secrets are stripped before the write — see <span className="mono">redact()</span> in{' '}
                <span className="mono">lib/ai/providers.ts</span>.
              </div>
            </div>
            <div className="row row-wrap" style={{ gap: 8 }}>
              {(data?.summary.kinds ?? []).map((k) => (
                <span className="chip" key={k}>{k}</span>
              ))}
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="AI prompt telemetry"
        subtitle="Every model interaction, in order — click a row to inspect the prompt"
        right={
          <div className="row row-wrap" style={{ gap: 6 }}>
            {['all', 'reasoning', 'postmortem', 'embedding', 'heartbeat', 'seed'].map((k) => (
              <button key={k} className={`btn btn-sm ${kind === k ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setKind(k)}>
                {k}
              </button>
            ))}
          </div>
        }
        padding={false}
      >
        {loading && !data ? (
          <div className="panel-body stack" style={{ gap: 10 }}>
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} height={40} />)}
          </div>
        ) : logs.length === 0 ? (
          <div className="empty-state">No telemetry rows for “{kind}” yet.</div>
        ) : (
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Kind</th>
                  <th>Provider / model</th>
                  <th>Latency</th>
                  <th>Tokens</th>
                  <th>Prompt hash</th>
                  <th>Preview</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <Fragment key={log.id}>
                    <tr onClick={() => setExpanded(expanded === log.id ? null : log.id)} style={{ cursor: 'pointer' }}>
                      <td className="small dim nowrap">{dt(log.at)}</td>
                      <td>
                        <Badge tone={(KIND_TONE[log.kind] as 'info') ?? 'ghost'}>{log.kind}</Badge>
                      </td>
                      <td className="small">
                        {log.provider}
                        <div className="tiny dim mono">{log.model}</div>
                      </td>
                      <td className="mono small">{log.latencyMs} ms</td>
                      <td className="mono small">{log.tokensEst}</td>
                      <td className="mono tiny dim">{log.promptHash}</td>
                      <td className="small" style={{ maxWidth: 320 }}>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{log.promptPreview}</div>
                      </td>
                    </tr>
                    {expanded === log.id ? (
                      <tr>
                        <td colSpan={7} style={{ background: 'rgba(126,143,255,.04)' }}>
                          <div className="grid grid-2" style={{ gap: 14 }}>
                            <div>
                              <div className="label" style={{ marginBottom: 6 }}>Prompt (redacted)</div>
                              <pre className="log-view" style={{ maxHeight: 260, fontSize: 11.5 }}>{log.promptFull}</pre>
                            </div>
                            <div>
                              <div className="label" style={{ marginBottom: 6 }}>Model output (redacted)</div>
                              <pre className="log-view" style={{ maxHeight: 260, fontSize: 11.5 }}>{log.outputPreview || '(none — deterministic engine)'}</pre>
                              <div className="row row-wrap" style={{ gap: 8, marginTop: 10 }}>
                                <span className="chip">fallback {String(log.fallback)}</span>
                                {log.analysisId ? <span className="chip">analysis {log.analysisId}</span> : null}
                                {log.metadata
                                  ? Object.entries(log.metadata).slice(0, 4).map(([k, v]) => (
                                      <span className="chip" key={k}>{k}={String(v)}</span>
                                    ))
                                  : null}
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
