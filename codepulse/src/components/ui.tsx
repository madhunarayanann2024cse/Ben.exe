'use client';

import type { ReactNode } from 'react';
import { useState } from 'react';
import { avatarGradient, initials, logLineClass, sevClass, statusClass, statusDot } from '@/lib/format';
import { toast } from './Toaster';

export function Badge({
  children,
  tone = 'ghost',
  dot,
  title,
}: {
  children: ReactNode;
  tone?: 'critical' | 'high' | 'medium' | 'low' | 'ok' | 'info' | 'accent' | 'ghost';
  dot?: boolean;
  title?: string;
}) {
  return (
    <span className={`badge badge-${tone}`} title={title}>
      {dot ? <span className={`dot dot-${tone === 'ghost' ? 'low' : tone}`} /> : null}
      {children}
    </span>
  );
}

export function SeverityBadge({ severity, small }: { severity: string; small?: boolean }) {
  return (
    <span className={`badge ${sevClass(severity)}`} style={small ? { fontSize: 10, padding: '2px 7px' } : undefined}>
      <span className={`dot dot-${severity}`} />
      {severity.toUpperCase()}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`badge ${statusClass(status)}`}>
      <span className={`dot ${statusDot(status)}`} />
      {status}
    </span>
  );
}

export function Kpi({
  label,
  value,
  sub,
  icon,
  tone = 'info',
  valueColor,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  tone?: 'info' | 'critical' | 'warn' | 'ok';
  valueColor?: string;
}) {
  const toneAccent =
    tone === 'critical' ? 'var(--critical)' : tone === 'warn' ? 'var(--warn)' : tone === 'ok' ? 'var(--ok)' : 'var(--accent)';

  return (
    <div
      className="panel card-hover kpi"
      style={{
        borderTop: `2.5px solid ${toneAccent}`,
      }}
    >
      <div className="kpi-label">
        {icon ? <span className="kpi-icon" style={{ borderColor: `${toneAccent}44` }}>{icon}</span> : null}
        {label}
      </div>
      <div className="kpi-value" style={{ color: valueColor ?? '#fff' }}>{value}</div>
      {sub ? <div className="kpi-sub">{sub}</div> : null}
      <span
        className={`dot ${tone === 'critical' ? 'dot-critical' : tone === 'warn' ? 'dot-medium' : tone === 'ok' ? 'dot-ok' : 'dot-low'} dot-live`}
        style={{ position: 'absolute', top: 18, right: 18 }}
      />
    </div>
  );
}

export function ProgressBar({ value, tone, thin }: { value: number; tone?: string; thin?: boolean }) {
  return (
    <div className={`progress ${tone ?? ''} ${thin ? 'thin' : ''}`}>
      <span style={{ width: `${Math.max(2, Math.min(100, value))}%` }} />
    </div>
  );
}

export function Avatar({ name, hue, size = 'md' }: { name: string; hue: number; size?: 'md' | 'lg' }) {
  return (
    <span
      className={`avatar ${size === 'lg' ? 'avatar-lg' : ''}`}
      style={{ background: avatarGradient(hue) }}
      title={name}
    >
      {initials(name)}
    </span>
  );
}

export function ConfidenceRing({
  value,
  size = 96,
  label = 'confidence',
  color = '#8b5cf6',
}: {
  value: number;
  size?: number;
  label?: string;
  color?: string;
}) {
  const pct = Math.max(0, Math.min(1, value));
  const r = size / 2 - 8;
  const c = 2 * Math.PI * r;
  return (
    <div className="conf-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(126,143,255,.14)" strokeWidth={7} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={7}
          strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`}
          style={{ transition: 'stroke-dasharray 1s cubic-bezier(.2,.8,.2,1)', filter: `drop-shadow(0 0 8px ${color}66)` }}
        />
      </svg>
      <div style={{ position: 'absolute', textAlign: 'center' }}>
        <div className="val">{(pct * 100).toFixed(0)}%</div>
        <div className="lbl">{label}</div>
      </div>
    </div>
  );
}

export function CopyChip({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="chip"
      style={{ cursor: 'pointer', background: 'rgba(126,143,255,.06)' }}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          toast('Copied to clipboard', text.slice(0, 70), 'ok');
          setTimeout(() => setCopied(false), 1600);
        } catch {
          toast('Clipboard unavailable', 'Copy manually from the code block.', 'warn');
        }
      }}
      title="Copy"
    >
      <span className="mono">{copied ? '✓ copied' : label ?? text}</span>
    </button>
  );
}

export function SectionCard({
  title,
  subtitle,
  right,
  children,
  padding = true,
  className = '',
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  padding?: boolean;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {title ? (
        <header className="panel-head">
          <div>
            <h3>{title}</h3>
            {subtitle ? <div className="section-sub">{subtitle}</div> : null}
          </div>
          {right ? <div className="right">{right}</div> : null}
        </header>
      ) : null}
      <div className={padding ? 'panel-body' : ''}>{children}</div>
    </section>
  );
}

export function LogView({ text, maxHeight = 420 }: { text: string; maxHeight?: number }) {
  const lines = (text ?? '').split('\n');
  return (
    <div className="log-view" style={{ maxHeight }}>
      {lines.map((line, i) => (
        <div key={i} className={logLineClass(line)}>
          <span className="dim mono tiny" style={{ marginRight: 10, userSelect: 'none' }}>
            {String(i + 1).padStart(3, '0')}
          </span>
          {line || '\u00A0'}
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, detail, action }: { icon?: ReactNode; title: string; detail?: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      {icon ? <div style={{ fontSize: 26, opacity: 0.75 }}>{icon}</div> : null}
      <div style={{ fontWeight: 600, color: 'var(--text-2)' }}>{title}</div>
      {detail ? <div className="small" style={{ maxWidth: 460 }}>{detail}</div> : null}
      {action}
    </div>
  );
}

export function Skeleton({ height = 14, width = '100%', style }: { height?: number; width?: number | string; style?: React.CSSProperties }) {
  return <div className="skeleton" style={{ height, width, ...style }} />;
}

export function KeyValue({ items }: { items: { k: string; v: ReactNode }[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, max-content) 1fr', gap: '9px 16px', alignItems: 'baseline' }}>
      {items.map((item) => (
        <div key={item.k} style={{ display: 'contents' }}>
          <div className="tiny dim" style={{ textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 600 }}>{item.k}</div>
          <div className="small">{item.v}</div>
        </div>
      ))}
    </div>
  );
}
