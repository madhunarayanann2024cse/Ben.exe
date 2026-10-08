'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  IconAlert, IconBolt, IconChart, IconDatabase, IconDoc, IconGrid, IconPulse, IconScan, IconSearch, IconTerminal,
} from './icons';
import { Toaster, toast } from './Toaster';
import { useApi } from '@/lib/useApi';
import { DEMO_TRACE } from '@/lib/format';

interface HealthResponse {
  ok: boolean;
  database: { label: string; backend: string; vectorSearch: string; incidents: number; aiLogs: number; warnings: string[] };
  ai: { label: string; provider: string; model: string; live: boolean };
}

const NAV = [
  { href: '/', label: 'Dashboard', icon: IconGrid, group: 'Operations', key: 'overview' },
  { href: '/analyze', label: 'Analyze Incident', icon: IconScan, group: 'Operations', key: 'analyze' },
  { href: '/incidents', label: 'Incident Memory', icon: IconDatabase, group: 'Knowledge', key: 'incidents' },
  { href: '/postmortems', label: 'Post-Mortems', icon: IconDoc, group: 'Knowledge', key: 'postmortems' },
  { href: '/analytics', label: 'Analytics', icon: IconChart, group: 'Intelligence', key: 'analytics' },
  { href: '/logbook', label: "Captain's Logbook", icon: IconTerminal, group: 'Intelligence', key: 'logbook' },
];

const TITLES: Record<string, { title: string; sub: string }> = {
  '/': { title: 'Incident Command Center', sub: 'Live posture, recurrence pressure and memory coverage' },
  '/analyze': { title: 'Analysis Workspace', sub: 'Paste a trace → match memory → predict root cause → generate the post-mortem' },
  '/incidents': { title: 'Historical Incident Repository', sub: 'Every RCA, fix and engineer recorded as retrievable memory' },
  '/postmortems': { title: 'Post-Mortem Library', sub: 'Blameless documents generated from incident memory' },
  '/analytics': { title: 'Reliability Analytics', sub: 'Trends, severity mix, service load and root-cause distribution' },
  '/logbook': { title: "Captain's Logbook", sub: 'AI prompt telemetry, 10-minute heartbeats and engine provenance' },
};

function titleFor(pathname: string) {
  if (pathname.startsWith('/incidents/')) return { title: 'Incident Detail', sub: 'Full RCA, evidence, fix correlation and related memory' };
  if (pathname.startsWith('/postmortems/')) return { title: 'Post-Mortem Document', sub: 'Summary · impact · timeline · root cause · prevention' };
  return TITLES[pathname] ?? TITLES['/'];
}

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [query, setQuery] = useState('');
  const { data: health } = useApi<HealthResponse>('/api/health', { pollMs: 120_000 });
  const { data: incidentsIndex } = useApi<{ incidents: { id: string; title: string; service: string }[] }>(
    paletteOpen ? '/api/incidents?limit=100&sort=recent' : null,
  );

  const meta = titleFor(pathname);

  // ⌘K / Ctrl+K command palette
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((v) => !v);
      }
      if (event.key === 'Escape') setPaletteOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Captain's Logbook heartbeat — every 10 minutes while a session is open.
  useEffect(() => {
    const interval = Number(process.env.NEXT_PUBLIC_TELEMETRY_INTERVAL_MS || 600_000);
    const tick = () => {
      void fetch('/api/telemetry', { method: 'POST' }).catch(() => undefined);
    };
    const first = setTimeout(tick, 8000);
    const timer = setInterval(tick, Math.max(60_000, interval));
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);

  const paletteItems = useMemo(() => {
    const items: { id: string; label: string; hint: string; action: () => void; group: string }[] = NAV.map((n) => ({
      id: n.href,
      label: n.label,
      hint: n.href,
      group: 'Navigate',
      action: () => {
        router.push(n.href);
        setPaletteOpen(false);
      },
    }));
    items.push({
      id: 'demo-trace',
      label: 'Run the challenge demo trace',
      hint: 'Payment API · JDBC pool exhaustion',
      group: 'Quick action',
      action: () => {
        router.push('/analyze?demo=1');
        setPaletteOpen(false);
        toast('Demo trace loaded', 'Press "Analyze Incident" to run the pipeline.', 'info');
      },
    });
    for (const inc of incidentsIndex?.incidents ?? []) {
      items.push({
        id: inc.id,
        label: `${inc.id} — ${inc.title}`,
        hint: inc.service,
        group: 'Incident memory',
        action: () => {
          router.push(`/incidents/${inc.id}`);
          setPaletteOpen(false);
        },
      });
    }
    const q = query.trim().toLowerCase();
    if (!q) return items.slice(0, 14);
    return items.filter((i) => (i.label + i.hint + i.group).toLowerCase().includes(q)).slice(0, 16);
  }, [query, incidentsIndex, router]);

  const grouped = paletteItems.reduce<Record<string, typeof paletteItems>>((acc, item) => {
    acc[item.group] = acc[item.group] ?? [];
    acc[item.group].push(item);
    return acc;
  }, {});

  return (
    <div className="shell">
      <aside className="sidebar">
        <Link href="/" className="brand">
          <span className="brand-mark">
            <IconPulse width={20} height={20} style={{ color: '#fff', position: 'relative', zIndex: 1 }} />
          </span>
          <span className="brand-text">
            <div className="brand-name">CodePulse</div>
            <div className="brand-tag">Incident Intelligence</div>
          </span>
        </Link>

        {['Operations', 'Knowledge', 'Intelligence'].map((group) => (
          <div key={group} className="nav-section">
            <div className="nav-group">{group}</div>
            <nav className="stack" style={{ gap: 4 }}>
              {NAV.filter((n) => n.group === group).map((item) => {
                const active = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
                const Icon = item.icon;
                return (
                  <Link key={item.href} href={item.href} className={`nav-item ${active ? 'active' : ''}`}>
                    <Icon width={16.5} height={16.5} />
                    <span className="label">{item.label}</span>
                    {item.key === 'incidents' && health?.database.incidents ? (
                      <span className="nav-badge">{health.database.incidents}</span>
                    ) : null}
                  </Link>
                );
              })}
            </nav>
          </div>
        ))}

        <div className="sidebar-foot">
          <button className="btn btn-ghost btn-sm search-trigger-btn" onClick={() => setPaletteOpen(true)}>
            <IconSearch width={14} height={14} />
            <span className="label">Quick search</span>
            <span className="spacer" />
            <span className="kbd label">⌘K</span>
          </button>

          <div className="panel status-panel" style={{ padding: '12px 14px' }}>
            <div className="row" style={{ gap: 8 }}>
              <span className={`dot ${health?.ai.live ? 'dot-ok' : 'dot-low'} dot-live`} />
              <span className="tiny mono status-label">
                {health ? (health.ai.live ? 'LLM ONLINE' : 'PULSEREASONER') : 'CONNECTING'}
              </span>
            </div>
            <div className="foot-text tiny dim" style={{ marginTop: 7, lineHeight: 1.6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <IconDatabase width={12} height={12} style={{ color: 'var(--accent-3)' }} />
                <span>{health?.database.backend === 'supabase-postgres' ? 'Supabase Postgres' : 'Embedded JSON Store'}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                <IconBolt width={12} height={12} style={{ color: 'var(--accent-2)' }} />
                <span>{health?.database.vectorSearch === 'pgvector-rpc' ? 'pgvector ANN' : 'In-process 384-d Cosine'}</span>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="topbar-title-wrap">
            <h1>{meta.title}</h1>
            <div className="sub">{meta.sub}</div>
          </div>
          <div className="topbar-right">
            <button
              type="button"
              className="btn btn-ghost btn-sm demo-quick-pill"
              onClick={() => {
                router.push('/analyze?demo=1');
                toast('Challenge Trace Loaded', 'Running 30ms semantic RCA pipeline…', 'info');
              }}
            >
              <IconBolt width={13} height={13} style={{ color: 'var(--accent-3)' }} />
              <span>Demo Trace</span>
            </button>
            {health ? (
              <span className="chip engine-chip" title={health.ai.label}>
                <span className={`dot ${health.ai.live ? 'dot-ok' : 'dot-low'}`} />
                <span>{health.ai.live ? health.ai.model : 'PulseReasoner v1'}</span>
              </span>
            ) : null}
            <Link href="/analyze" className="btn btn-primary btn-sm">
              <IconBolt width={14} height={14} />
              Analyze Incident
            </Link>
          </div>
        </header>

        {health?.database.warnings?.length ? (
          <div className="callout warn" style={{ marginBottom: 18 }}>
            <IconAlert width={15} height={15} style={{ marginTop: 2, flex: 'none' }} />
            <div>
              <strong>Storage notice:</strong> {health.database.warnings[health.database.warnings.length - 1]}
            </div>
          </div>
        ) : null}

        <div className="content-area">{children}</div>
      </main>

      {paletteOpen ? (
        <div className="modal-backdrop" onClick={() => setPaletteOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 'min(680px, 100%)' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
              <div className="row" style={{ gap: 10 }}>
                <IconSearch width={16} height={16} style={{ color: 'var(--accent-2)' }} />
                <input
                  autoFocus
                  className="input"
                  style={{ border: 'none', background: 'transparent', padding: 0, fontSize: 15 }}
                  placeholder="Search incidents, routes, playbooks, or commands…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && paletteItems[0]) paletteItems[0].action();
                  }}
                />
                <span className="kbd">esc</span>
              </div>
            </div>
            <div style={{ maxHeight: 420, overflowY: 'auto', padding: '10px 12px' }}>
              {Object.entries(grouped).map(([group, items]) => (
                <div key={group} style={{ marginBottom: 8 }}>
                  <div className="nav-group" style={{ padding: '6px 10px 4px', fontSize: 10.5 }}>{group}</div>
                  {items.map((item) => (
                    <button
                      key={item.id}
                      onClick={item.action}
                      className="nav-item"
                      style={{ width: '100%', background: 'transparent', border: 'none', textAlign: 'left', cursor: 'pointer', padding: '9px 12px' }}
                    >
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
                      <span className="spacer" />
                      <span className="tiny dim mono">{item.hint}</span>
                    </button>
                  ))}
                </div>
              ))}
              {paletteItems.length === 0 ? <div className="empty-state">No matches for "{query}".</div> : null}
            </div>
          </div>
        </div>
      ) : null}
      <Toaster />
    </div>
  );
}

