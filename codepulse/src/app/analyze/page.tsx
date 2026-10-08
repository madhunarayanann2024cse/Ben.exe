'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SimilarityMeter, ScoreBreakdownBars } from '@/components/charts';
import { Avatar, Badge, ConfidenceRing, CopyChip, EmptyState, LogView, ProgressBar, SectionCard, SeverityBadge, Skeleton } from '@/components/ui';
import { PostMortemDoc, downloadMarkdown } from '@/components/PostMortemDoc';
import { toast } from '@/components/Toaster';
import {
  IconAlert, IconArrowRight, IconBolt, IconBrain, IconCheck, IconClock, IconDoc, IconGit, IconLayers, IconRefresh,
  IconShield, IconSparkle, IconTerminal, IconUser,
} from '@/components/icons';
import { postJson } from '@/lib/useApi';
import { DEMO_TRACE, confidenceColor, dtShort, duration, relTime, similarityTone } from '@/lib/format';
import type { AnalysisResult, RootCauseVerdict, PostMortem } from '@/lib/types';

const SAMPLES: { label: string; service: string; environment: string; trace: string }[] = [
  { label: 'JDBC pool exhaustion', service: 'Payment API', environment: 'production', trace: DEMO_TRACE },
  {
    label: 'Redis failover',
    service: 'Session Service',
    environment: 'production',
    trace: `ERROR 500 io.lettuce.core.RedisConnectionException: Connection refused: cache-cluster-03:6379
org.springframework.data.redis.RedisConnectionFailureException: Unable to connect to Redis
\tat io.lettuce.core.cluster.RedisClusterClient.connect(RedisClusterClient.java:303)
\tat com.zephoria.session.SessionRepository.lookup(SessionRepository.java:88)
CLUSTER STATE: fail · node role=replica unreachable · retry budget exhausted
Service: Session Service`,
  },
  {
    label: 'Kafka consumer lag',
    service: 'Order Events',
    environment: 'production',
    trace: `ERROR org.apache.kafka.common.errors.SerializationException: Error deserializing value for partition order-events-7 at offset 88412
\tat com.zephoria.orders.OrderEventConsumer.onMessage(OrderEventConsumer.java:112)
Consumer group order-fulfilment lag=412308 · partition stuck at offset · DLQ routing not configured
Service: Order Events`,
  },
  {
    label: 'TLS cert expired',
    service: 'Edge Gateway',
    environment: 'production',
    trace: `ERROR 525 javax.net.ssl.SSLHandshakeException: Received fatal alert: certificate_expired
\tat com.zephoria.edge.tls.TlsTerminator.handshake(TlsTerminator.java:214)
certificate CN=*.zephoria.io notAfter in the past · cert-manager renewal failed (DNS-01 429)
Service: Edge Gateway`,
  },
  {
    label: 'OOMKilled (heap leak)',
    service: 'Search Indexer',
    environment: 'production',
    trace: `FATAL java.lang.OutOfMemoryError: Java heap space
\tat com.zephoria.search.EmbeddingCache.put(EmbeddingCache.java:54)
GC(612) Pause Full (G1 Evacuation Pause) 1986M->1943M(2048M) 4.212s
Last pod event: OOMKilled (exit code 137) restartCount=14
Service: Search Indexer`,
  },
];

const PIPELINE = [
  'Fingerprinting the trace',
  'Embedding into 384-d vector space',
  'Vector search over incident memory',
  'Hybrid re-rank (cosine × rule engine)',
  'Predicting root cause & severity',
  'Correlating engineer + Git fix',
  'Generating the post-mortem',
  'Persisting analysis to database',
];

function AnalyzeWorkspace() {
  const router = useRouter();
  const params = useSearchParams();
  const [trace, setTrace] = useState('');
  const [service, setService] = useState('Payment API');
  const [environment, setEnvironment] = useState('production');
  const [notes, setNotes] = useState('');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [postMortem, setPostMortem] = useState<PostMortem | null>(null);
  const resultRef = useRef<HTMLDivElement | null>(null);
  const autoRan = useRef(false);

  const runAnalysis = useCallback(
    async (payload: { stackTrace: string; service: string; environment: string; notes?: string }) => {
      setRunning(true);
      setError(null);
      setResult(null);
      setPostMortem(null);
      const started = Date.now();
      try {
        const res = await postJson<{ ok: boolean; result: AnalysisResult }>('/api/analyze', {
          stackTrace: payload.stackTrace,
          service: payload.service,
          environment: payload.environment,
          notes: payload.notes,
        });
        const wait = Math.max(0, 900 - (Date.now() - started));
        if (wait) await new Promise((r) => setTimeout(r, wait));
        setResult(res.result);
        setPostMortem(res.result.postMortem);
        toast(
          res.result.match ? `Matched ${res.result.match.incidentId} at ${res.result.match.similarity}%` : 'No confident historical match',
          res.result.persisted ? `Analysis + post-mortem persisted to ${res.result.dbBackend === 'supabase-postgres' ? 'Supabase Postgres' : 'the embedded store'}.` : 'Persisted with warnings — see footer.',
          res.result.match && res.result.match.similarity >= 85 ? 'ok' : 'warn',
        );
        setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
      } catch (err) {
        setError((err as Error).message);
        toast('Analysis failed', (err as Error).message, 'critical');
      } finally {
        setRunning(false);
      }
    },
    [],
  );

  // ?demo=1 → prefill + auto-run the challenge trace (one-click demo)
  useEffect(() => {
    if (params.get('demo') !== '1' || autoRan.current) return;
    autoRan.current = true;
    setTrace(DEMO_TRACE);
    setService('Payment API');
    setEnvironment('production');
    void runAnalysis({ stackTrace: DEMO_TRACE, service: 'Payment API', environment: 'production' });
  }, [params, runAnalysis]);

  const [runStart, setRunStart] = useState(0);
  useEffect(() => {
    if (running) setRunStart(Date.now());
  }, [running]);

  const activeStage = Math.min(PIPELINE.length - 1, Math.floor(((Date.now() - runStart) / 2400) % PIPELINE.length));
  const charCount = trace.length;

  const regeneratePostMortem = useCallback(async () => {
    if (!result) return;
    try {
      const res = await postJson<{ ok: boolean; postMortem: PostMortem }>('/api/postmortems', {
        incidentId: result.match?.incidentId ?? undefined,
        analysisId: result.analysisId,
        stackTrace: trace,
        service,
        environment,
      });
      setPostMortem(res.postMortem);
      toast('Post-mortem regenerated', `${res.postMortem.id} saved to the database.`, 'ok');
    } catch (err) {
      toast('Post-mortem generation failed', (err as Error).message, 'critical');
    }
  }, [result, trace, service, environment]);

  const match = result?.match ?? null;
  const fix = result?.fix ?? null;
  const confidence = result?.rootCause.confidence ?? 0;

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="split">
        {/* ── left: input ─────────────────────────────────────────────────── */}
        <div className="stack" style={{ gap: 16 }}>
          <section className="panel">
            <header className="panel-head">
              <span className="kpi-icon" style={{ width: 28, height: 28 }}>
                <IconTerminal width={15} height={15} />
              </span>
              <div>
                <h3>Production trace</h3>
                <div className="section-sub">Paste the raw stack trace, log excerpt or alert payload</div>
              </div>
              <div className="right">
                <span className="tiny dim mono">{charCount.toLocaleString('en-IN')} chars</span>
              </div>
            </header>
            <div className="panel-body stack" style={{ gap: 14 }}>
              <div className="row row-wrap" style={{ gap: 7 }}>
                <span className="tiny dim" style={{ marginRight: 2 }}>Load a sample:</span>
                {SAMPLES.map((s) => (
                  <button
                    key={s.label}
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setTrace(s.trace);
                      setService(s.service);
                      setEnvironment(s.environment);
                      toast('Sample loaded', `${s.label} · ${s.service}`, 'info');
                    }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              <textarea
                className="textarea"
                placeholder={`Paste the stack trace here…\n\nERROR 500\njava.sql.SQLException: Connection timed out\nUnable to acquire JDBC connection\nPool exhausted\n\tat PaymentService.java:142\nService: Payment API`}
                value={trace}
                onChange={(e) => setTrace(e.target.value)}
                spellCheck={false}
              />

              <div className="grid grid-3" style={{ gap: 12 }}>
                <div className="field">
                  <label className="label">Service</label>
                  <input className="input" value={service} onChange={(e) => setService(e.target.value)} placeholder="Payment API" />
                </div>
                <div className="field">
                  <label className="label">Environment</label>
                  <select className="select" value={environment} onChange={(e) => setEnvironment(e.target.value)}>
                    <option value="production">production</option>
                    <option value="staging">staging</option>
                    <option value="canary">canary</option>
                  </select>
                </div>
                <div className="field">
                  <label className="label">Operator notes (optional)</label>
                  <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. started after the 14:00 deploy" />
                </div>
              </div>

              <div className="row row-wrap" style={{ gap: 10 }}>
                <button
                  className="btn btn-primary btn-lg"
                  disabled={running || trace.trim().length < 12}
                  onClick={() => void runAnalysis({ stackTrace: trace, service, environment, notes })}
                >
                  {running ? <span className="stage-spinner" /> : <IconBolt width={16} height={16} />}
                  {running ? `Analyzing… ${((Date.now() - runStart) / 1000).toFixed(1)}s` : 'Analyze Incident'}
                </button>
                <button className="btn btn-ghost" onClick={() => { setTrace(''); setResult(null); setPostMortem(null); setError(null); }}>
                  Clear
                </button>
                <span className="spacer" />
                <span className="tiny dim">
                  Everything runs server-side · keys never reach the browser
                </span>
              </div>

              {running ? (
                <div className="stack" style={{ gap: 8 }}>
                  <div className="analyzing-bar" />
                  <div className="stage-list">
                    {PIPELINE.map((stage, i) => {
                      const state = i < activeStage ? 'done' : i === activeStage ? 'active' : 'pending';
                      return (
                        <div className={`stage ${state === 'pending' ? 'pending' : ''}`} key={stage} style={{ animationDelay: `${i * 40}ms` }}>
                          {state === 'active' ? (
                            <span className="stage-spinner" />
                          ) : (
                            <IconCheck width={14} height={14} style={{ color: state === 'done' ? 'var(--ok)' : 'var(--text-3)' }} />
                          )}
                          <span className="small">{stage}</span>
                          <span className="stage-ms">{state === 'done' ? 'ok' : state === 'active' ? 'running' : 'queued'}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          {error ? (
            <div className="callout critical">
              <IconAlert width={16} height={16} style={{ marginTop: 2 }} />
              <div>
                <strong>Analysis failed.</strong>
                <div className="small muted">{error}</div>
              </div>
            </div>
          ) : null}

          {result ? (
            <SectionCard title="Parsed fingerprint" subtitle="What the engine extracted before retrieval" padding>
              <div className="grid grid-2" style={{ gap: 14 }}>
                <div className="stack" style={{ gap: 10 }}>
                  <div>
                    <div className="label">Error type</div>
                    <div className="mono small" style={{ color: '#c3c6ff' }}>{result.parsed.errorType}</div>
                  </div>
                  <div>
                    <div className="label">Message</div>
                    <div className="small muted">{result.parsed.errorMessage}</div>
                  </div>
                  <div className="row row-wrap" style={{ gap: 8 }}>
                    {result.parsed.httpStatus ? <span className="chip">HTTP {result.parsed.httpStatus}</span> : null}
                    <span className="chip">{result.parsed.frames.length} frames</span>
                    <span className="chip">signal density {result.parsed.signalStrength.toFixed(2)}</span>
                  </div>
                </div>
                <div className="stack" style={{ gap: 8 }}>
                  <div className="label">Frames</div>
                  {result.parsed.frames.slice(0, 5).map((f) => (
                    <div className="row small mono" key={`${f.file}-${f.line}`} style={{ gap: 8 }}>
                      <span className="dim">{f.service ?? '—'}</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.file}:{f.line ?? '?'}</span>
                    </div>
                  ))}
                  <div className="row row-wrap" style={{ gap: 6, marginTop: 4 }}>
                    {result.parsed.keywords.slice(0, 8).map((k) => (
                      <span className="chip" key={k} style={{ fontSize: 10.5 }}>{k}</span>
                    ))}
                  </div>
                </div>
              </div>
            </SectionCard>
          ) : null}
        </div>

        {/* ── right: live analysis ────────────────────────────────────────── */}
        <div className="stack" style={{ gap: 16 }} ref={resultRef}>
          {!result && !running ? (
            <SectionCard>
              <EmptyState
                icon={<IconBrain width={26} height={26} style={{ color: 'var(--accent-2)' }} />}
                title="Waiting for a trace"
                detail="Paste a production stack trace and hit Analyze Incident. CodePulse will retrieve the closest historical incident by vector similarity, predict the root cause, and surface the engineer, commit and fix that resolved it last time."
                action={
                  <button className="btn btn-primary" onClick={() => { setTrace(DEMO_TRACE); setService('Payment API'); setEnvironment('production'); }}>
                    <IconSparkle width={14} height={14} />
                    Load the challenge demo trace
                  </button>
                }
              />
            </SectionCard>
          ) : null}

          {running ? (
            <SectionCard title="AI pipeline running" subtitle="Vector search · hybrid re-rank · reasoning · post-mortem">
              <div className="stack" style={{ gap: 12 }}>
                <div className="row">
                  <span className="dot dot-low dot-live" />
                  <span className="small">{PIPELINE[activeStage]}…</span>
                  <span className="spacer" />
                  <span className="mono tiny dim">{((Date.now() - runStart) / 1000).toFixed(1)}s</span>
                </div>
                <Skeleton height={64} />
                <Skeleton height={14} width="70%" />
                <Skeleton height={14} width="52%" />
                <Skeleton height={90} />
              </div>
            </SectionCard>
          ) : null}

          {result ? (
            <>
              {/* match card */}
              <section className="panel animate-in" style={{ borderColor: 'var(--border-strong)' }}>
                <header className="panel-head" style={{ background: 'linear-gradient(100deg, rgba(99,102,241,.16), transparent)' }}>
                  <span className="kpi-icon" style={{ width: 28, height: 28, background: 'linear-gradient(140deg,rgba(99,102,241,.34),rgba(139,92,246,.2))' }}>
                    <IconLayers width={15} height={15} />
                  </span>
                  <div>
                    <h3>Historical memory match</h3>
                    <div className="section-sub">
                      {match ? 'Closest incident retrieved by vector similarity' : 'No incident crossed the confidence threshold'}
                    </div>
                  </div>
                  <div className="right">
                    <span className="chip">{result.tookMs} ms total</span>
                  </div>
                </header>
                <div className="panel-body stack" style={{ gap: 16 }}>
                  {match ? (
                    <>
                      <div className="row" style={{ gap: 20, flexWrap: 'wrap' }}>
                        <div style={{ position: 'relative' }}>
                          <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: -1.6, lineHeight: 1 }}>
                            {match.similarity}
                            <span style={{ fontSize: 18, opacity: 0.6 }}>%</span>
                          </div>
                          <div className="tiny dim" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>similarity</div>
                        </div>
                        <div style={{ flex: 1, minWidth: 240 }}>
                          <SimilarityMeter value={match.similarity} height={12} />
                          <div className="row row-wrap" style={{ gap: 8, marginTop: 9 }}>
                            <span className={`badge badge-${similarityTone(match.similarity) === 'ok' ? 'ok' : similarityTone(match.similarity) === 'warn' ? 'medium' : 'critical'}`}>
                              {match.similarity >= 85 ? 'high-confidence reuse' : match.similarity >= 60 ? 'partial match' : 'weak match'}
                            </span>
                            <span className="chip">cosine {(match.scores.cosine * 100).toFixed(1)}%</span>
                            <span className="chip">rule engine {(match.scores.rule * 100).toFixed(1)}%</span>
                            <span className="chip">composite {match.scores.composite.toFixed(3)}</span>
                          </div>
                        </div>
                      </div>

                      <Link
                        href={`/incidents/${match.incidentId}`}
                        className="panel card card-hover"
                        style={{ padding: 15, display: 'block', background: 'linear-gradient(120deg, rgba(99,102,241,.12), rgba(139,92,246,.05))' }}
                      >
                        <div className="row" style={{ gap: 9, flexWrap: 'wrap' }}>
                          <span className="mono" style={{ color: '#c3c6ff', fontWeight: 600 }}>{match.incidentId}</span>
                          <SeverityBadge severity={match.severity} small />
                          <span className="badge badge-ghost">{match.service}</span>
                          <span className="spacer" />
                          <span className="tiny dim">open full incident <IconArrowRight width={12} height={12} style={{ verticalAlign: -2 }} /></span>
                        </div>
                        <div style={{ fontWeight: 600, marginTop: 8 }}>{match.title}</div>
                        <div className="small muted" style={{ marginTop: 4 }}>
                          {(match.summary ?? '').split('. ').slice(0, 2).join('. ')}.
                        </div>
                      </Link>

                      <div className="grid grid-2" style={{ gap: 16 }}>
                        <div>
                          <div className="label" style={{ marginBottom: 8 }}>Why these two incidents are the same</div>
                          <p className="small muted" style={{ margin: 0 }}>{result.explanation}</p>
                        </div>
                        <div>
                          <div className="label" style={{ marginBottom: 8 }}>Retrieval score breakdown</div>
                          <ScoreBreakdownBars items={match.scores.breakdown} />
                        </div>
                      </div>

                      {result.candidates.length > 1 ? (
                        <div>
                          <div className="label" style={{ marginBottom: 8 }}>Other candidates considered</div>
                          <div className="stack" style={{ gap: 9 }}>
                            {result.candidates.slice(1, 5).map((c) => (
                              <Link key={c.incidentId} href={`/incidents/${c.incidentId}`} className="row" style={{ gap: 10 }}>
                                <span className="mono tiny" style={{ minWidth: 76, color: 'var(--text-2)' }}>{c.incidentId}</span>
                                <div style={{ flex: 1 }}>
                                  <div className="row tiny" style={{ gap: 8 }}>
                                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }}>{c.title}</span>
                                    <span className="spacer" />
                                    <span className="mono">{c.similarity}%</span>
                                  </div>
                                  <ProgressBar value={c.similarity} thin tone={similarityTone(c.similarity)} />
                                </div>
                              </Link>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className="callout warn">
                      <IconAlert width={16} height={16} style={{ marginTop: 2 }} />
                      <div>
                        <strong>Novel failure mode.</strong> No historical incident is similar enough to reuse a fix. CodePulse persisted
                        this analysis so the next occurrence retrieves it instantly.
                      </div>
                    </div>
                  )}
                </div>
              </section>

              {/* root cause */}
              <section className="panel animate-in d1">
                <header className="panel-head">
                  <span className="kpi-icon" style={{ width: 28, height: 28 }}>
                    <IconBrain width={15} height={15} />
                  </span>
                  <div>
                    <h3>AI root-cause intelligence</h3>
                    <div className="section-sub">Prediction anchored on retrieved memory</div>
                  </div>
                  <div className="right">
                    <Badge tone="accent">{result.engineLabel}</Badge>
                  </div>
                </header>
                <div className="panel-body stack" style={{ gap: 16 }}>
                  <div className="row" style={{ gap: 20, flexWrap: 'wrap', alignItems: 'center' }}>
                    <ConfidenceRing value={confidence} label="confidence" color={confidenceColor(confidence)} size={104} />
                    <div style={{ flex: 1, minWidth: 250 }}>
                      <div className="row row-wrap" style={{ gap: 8, marginBottom: 8 }}>
                        <SeverityBadge severity={result.rootCause.severity} />
                        <span className="badge badge-info">{result.rootCause.affectedService}</span>
                        <span className="badge badge-ghost">{result.rootCause.environment}</span>
                        <span className="badge badge-ghost">{result.rootCause.confidenceLabel}</span>
                      </div>
                      <h3 style={{ fontSize: 18, margin: '0 0 6px', letterSpacing: -0.4 }}>{result.rootCause.title}</h3>
                      <div className="tiny dim mono" style={{ marginBottom: 8 }}>class · {result.rootCause.category}</div>
                      <p className="small muted" style={{ margin: 0 }}>{result.rootCause.narrative}</p>
                    </div>
                  </div>

                  <div className="divider" />
                  <div className="grid grid-2" style={{ gap: 18 }}>
                    <div>
                      <div className="label" style={{ marginBottom: 8 }}>Contributing factors</div>
                      <div className="stack" style={{ gap: 8 }}>
                        {result.rootCause.contributingFactors.map((f) => (
                          <div className="row" key={f} style={{ gap: 9, alignItems: 'flex-start' }}>
                            <span className="dot dot-medium" style={{ marginTop: 6 }} />
                            <span className="small muted">{f}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="label" style={{ marginBottom: 8 }}>Alternatives considered</div>
                      {result.rootCause.alternatives.length ? (
                        <div className="stack" style={{ gap: 10 }}>
                          {result.rootCause.alternatives.map((alt) => (
                            <div key={alt.title}>
                              <div className="row small">
                                <span>{alt.title}</span>
                                <span className="spacer" />
                                <span className="mono tiny">{(alt.probability * 100).toFixed(0)}%</span>
                              </div>
                              <ProgressBar value={alt.probability * 100} thin tone="warn" />
                              <div className="tiny dim" style={{ marginTop: 3 }}>{alt.note}</div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="small dim">No competing hypothesis above the noise floor.</div>
                      )}
                    </div>
                  </div>
                </div>
              </section>

              {/* fix chain */}
              {fix ? (
                <section className="panel animate-in d2">
                  <header className="panel-head">
                    <span className="kpi-icon" style={{ width: 28, height: 28 }}>
                      <IconGit width={15} height={15} />
                    </span>
                    <div>
                      <h3>Error → fix correlation</h3>
                      <div className="section-sub">Who solved this before, and exactly what they changed</div>
                    </div>
                  </header>
                  <div className="panel-body stack" style={{ gap: 16 }}>
                    <div className="chain">
                      {[
                        { label: 'Error', value: result.parsed.errorType, meta: result.parsed.httpStatus ? `HTTP ${result.parsed.httpStatus}` : 'trace', tone: 'critical' },
                        { label: 'Historical incident', value: fix.incidentId, meta: fix.repo, tone: 'accent' },
                        { label: 'Root cause', value: fix.rootCause, meta: 'class', tone: 'medium' },
                        { label: 'Engineer', value: fix.engineer.name, meta: fix.engineer.role, tone: 'info' },
                        { label: 'Git commit', value: fix.commit, meta: fix.repo, tone: 'ok' },
                        { label: 'Resolution', value: fix.resolution.split(' ').slice(0, 5).join(' ') + '…', meta: 'verified fix', tone: 'ok' },
                      ].map((node) => (
                        <div className="chain-node" key={node.label}>
                          <div className="chain-label">{node.label}</div>
                          <div className="chain-value" style={{ color: node.tone === 'critical' ? '#ffb3c0' : node.tone === 'accent' ? '#c3c6ff' : undefined }}>
                            {node.value}
                          </div>
                          <div className="chain-meta">{node.meta}</div>
                        </div>
                      ))}
                    </div>

                    <div className="grid grid-2" style={{ gap: 18 }}>
                      <div className="stack" style={{ gap: 12 }}>
                        <div className="row" style={{ gap: 12 }}>
                          <Avatar name={fix.engineer.name} hue={fix.engineer.hue} size="lg" />
                          <div>
                            <div style={{ fontWeight: 620 }}>{fix.engineer.name}</div>
                            <div className="tiny dim">
                              {fix.engineer.role} · {fix.engineer.team} · {fix.engineer.handle}
                            </div>
                          </div>
                          <span className="spacer" />
                          <IconUser width={16} height={16} style={{ color: 'var(--text-3)' }} />
                        </div>
                        <div className="panel" style={{ padding: 13, background: 'linear-gradient(120deg, rgba(139,92,246,.14), transparent)' }}>
                          <div className="label">Historical fix (reuse verbatim)</div>
                          <div className="small" style={{ marginTop: 5, fontWeight: 620 }}>{fix.fixSummary}</div>
                          <div className="tiny dim" style={{ marginTop: 5 }}>runbook {fix.runbook}</div>
                        </div>
                        <div className="panel" style={{ padding: 13, background: 'linear-gradient(120deg, rgba(16,185,129,.1), transparent)' }}>
                          <div className="label">Commit</div>
                          <div className="mono small" style={{ color: '#8ff0cd', marginTop: 4 }}>
                            {fix.repo}@{fix.commit}
                          </div>
                          <div className="small" style={{ marginTop: 6 }}>{fix.commitMessage}</div>
                          <div className="tiny dim" style={{ marginTop: 6 }}>
                            deployed {dtShort(fix.deployedAt)} · verified {fix.verifiedAfter}
                          </div>
                        </div>
                        <div>
                          <div className="label" style={{ marginBottom: 6 }}>Files touched</div>
                          <div className="stack" style={{ gap: 5 }}>
                            {fix.files.map((file) => (
                              <div className="row mono tiny" key={file} style={{ gap: 7 }}>
                                <IconGit width={12} height={12} style={{ color: 'var(--text-3)' }} />
                                {file}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="stack" style={{ gap: 12 }}>
                        <div>
                          <div className="label" style={{ marginBottom: 8 }}>Resolution applied last time</div>
                          <div className="stack" style={{ gap: 8 }}>
                            {fix.resolutionSteps.map((step, i) => (
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
                        <div className="callout ok">
                          <IconCheck width={15} height={15} style={{ marginTop: 2, flex: 'none' }} />
                          <div className="small">
                            <strong>Reuse recommendation:</strong> apply this fix again before re-investigating. The evidence above shows the
                            same failure mechanism, the same service boundary and the same saturation signature.
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>
              ) : null}

              {/* evidence */}
              <SectionCard
                title="Evidence pack"
                subtitle="Every signal behind this prediction, with its retrieval weight"
                right={<Badge tone="info">{result.evidence.length} items</Badge>}
              >
                <div className="stack" style={{ gap: 0 }}>
                  {result.evidence.map((item) => (
                    <div className="evidence-item" key={item.label}>
                      <span className="evidence-icon">
                        {item.kind === 'trace' ? '⌁' : item.kind === 'history' ? '⌗' : item.kind === 'fix' ? '⎇' : item.kind === 'pattern' ? '⟳' : '✦'}
                      </span>
                      <div style={{ flex: 1 }}>
                        <div className="row" style={{ gap: 8 }}>
                          <span className="evidence-label">{item.label}</span>
                          <span className="spacer" />
                          <span className="tiny mono dim">w {item.weight.toFixed(2)}</span>
                        </div>
                        <div className="evidence-detail">{item.detail}</div>
                        <div className="progress thin" style={{ marginTop: 6 }}>
                          <span style={{ width: `${Math.max(4, item.weight * 100)}%` }} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </SectionCard>

              {/* post mortem */}
              {postMortem ? (
                <div className="animate-in d3">
                  <PostMortemDoc postMortem={postMortem} compact onRegenerate={regeneratePostMortem} />
                </div>
              ) : null}

              {/* run details */}
              <SectionCard title="Run details" subtitle="Pipeline timings, engine provenance and persistence">
                <div className="grid grid-2" style={{ gap: 16 }}>
                  <div className="stack" style={{ gap: 8 }}>
                    {result.stages.map((stage) => (
                      <div className="row small" key={stage.name} style={{ gap: 10 }}>
                        <IconCheck width={13} height={13} style={{ color: 'var(--ok)' }} />
                        <span>{stage.name}</span>
                        <span className="spacer" />
                        <span className="mono tiny dim">{stage.ms} ms</span>
                      </div>
                    ))}
                  </div>
                  <div className="stack" style={{ gap: 10 }}>
                    <div className="panel" style={{ padding: 12 }}>
                      <div className="label">Engine</div>
                      <div className="small" style={{ marginTop: 3 }}>{result.engineLabel}</div>
                    </div>
                    <div className="panel" style={{ padding: 12 }}>
                      <div className="label">Database</div>
                      <div className="small" style={{ marginTop: 3 }}>
                        {result.dbBackend === 'supabase-postgres' ? 'Supabase PostgreSQL (pgvector)' : 'Embedded durable store'}
                        {' · '}
                        <span style={{ color: result.persisted ? '#8ff0cd' : '#ffd79a' }}>
                          {result.persisted ? 'analysis + post-mortem persisted' : 'persistence degraded'}
                        </span>
                      </div>
                    </div>
                    <div className="row row-wrap" style={{ gap: 8 }}>
                      <CopyChip text={result.analysisId} label={`analysis ${result.analysisId}`} />
                      <CopyChip text={JSON.stringify(result.postMortem, null, 2)} label="copy post-mortem JSON" />
                      <button className="btn btn-ghost btn-sm" onClick={() => postMortem && downloadMarkdown(postMortem)}>
                        <IconDoc width={13} height={13} />
                        Export .md
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => router.push('/incidents')}>
                        <IconLayers width={13} height={13} />
                        Browse memory
                      </button>
                    </div>
                    {result.warnings.length ? (
                      <div className="callout warn">
                        <IconShield width={15} height={15} style={{ marginTop: 2, flex: 'none' }} />
                        <div className="stack" style={{ gap: 4 }}>
                          {result.warnings.map((w) => (
                            <div className="tiny" key={w}>{w}</div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </SectionCard>
            </>
          ) : null}

          {!result && !running ? (
            <SectionCard title="How the pipeline works" subtitle="Nine server-side steps, one click">
              <div className="stack" style={{ gap: 10 }}>
                {[
                  ['1 · Parse', 'Fingerprint error type, message, frames, HTTP status and weighted domain keywords'],
                  ['2 · Embed', 'Project the trace into the same 384-d vector space as incident memory'],
                  ['3 · Retrieve', 'ANN search (pgvector RPC or in-process cosine) over every historical incident'],
                  ['4 · Re-rank', 'Blend cosine with a domain rule engine: failure-class signals, exception class, service, tags'],
                  ['5 · Reason', 'Predict root cause, severity and confidence — LLM if a key is configured, PulseReasoner otherwise'],
                  ['6 · Correlate', 'Surface the engineer, Git commit, files and verified resolution from the matched incident'],
                  ['7 · Explain', 'Show why the match holds, with the score breakdown and evidence weights'],
                  ['8 · Document', 'Generate the blameless post-mortem: summary, impact, timeline, actions, lessons'],
                  ['9 · Persist', 'Write analysis, post-mortem and redacted AI telemetry to the live database'],
                ].map(([step, detail]) => (
                  <div className="row" key={step} style={{ gap: 12, alignItems: 'flex-start' }}>
                    <span className="chip" style={{ minWidth: 78, justifyContent: 'center' }}>{step}</span>
                    <span className="small muted">{detail}</span>
                  </div>
                ))}
                <div className="row row-wrap" style={{ gap: 8, marginTop: 4 }}>
                  <span className="chip"><IconClock width={12} height={12} /> median run &lt; 2s offline</span>
                  <span className="chip"><IconShield width={12} height={12} /> server-side keys only</span>
                  <span className="chip"><IconRefresh width={12} height={12} /> every run persisted</span>
                  <span className="chip"><IconTerminal width={12} height={12} /> logged to Captain’s Logbook</span>
                </div>
                <Link href="/logbook" className="btn btn-ghost btn-sm">
                  Inspect AI telemetry log
                </Link>
              </div>
            </SectionCard>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function AnalyzePage() {
  return (
    <Suspense fallback={<SectionCard><Skeleton height={280} /></SectionCard>}>
      <AnalyzeWorkspace />
    </Suspense>
  );
}
