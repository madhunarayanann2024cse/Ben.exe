'use client';

/**
 * CodePulse — hand-built SVG chart set.
 * Zero chart dependencies: deterministic, crisp, themeable, and safe inside a
 * sandboxed preview (no external scripts, fonts or images).
 */

import { useMemo, useState } from 'react';
import type { SeriesPoint } from '@/lib/analytics';

export function Sparkline({ data, color = '#8b5cf6', height = 38, width = 120 }: { data: number[]; color?: string; height?: number; width?: number }) {
  if (!data.length) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const span = max - min || 1;
  const step = width / Math.max(1, data.length - 1);
  const points = data.map((v, i) => `${(i * step).toFixed(1)},${(height - ((v - min) / span) * (height - 6) - 3).toFixed(1)}`);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <polyline points={points.join(' ')} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" opacity={0.95} />
      <polyline points={`0,${height} ${points.join(' ')} ${width},${height}`} fill={`${color}22`} stroke="none" />
    </svg>
  );
}

export function AreaChart({
  data,
  height = 240,
  series = [
    { key: 'incidents' as const, label: 'Incidents', color: '#6366f1' },
    { key: 'critical' as const, label: 'Critical', color: '#f43f5e' },
  ],
  showMttr = true,
}: {
  data: SeriesPoint[];
  height?: number;
  series?: { key: 'incidents' | 'critical' | 'mttr'; label: string; color: string }[];
  showMttr?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 900;
  const padL = 34;
  const padB = 26;
  const padT = 14;
  const innerW = width - padL - 12;
  const innerH = height - padB - padT;
  const maxVal = Math.max(1, ...data.map((d) => Math.max(d.incidents, d.critical)));
  const step = innerW / Math.max(1, data.length - 1);

  const paths = series.map((s) => {
    const pts = data.map((d, i) => {
      const v = s.key === 'mttr' ? d.mttr : s.key === 'critical' ? d.critical : d.incidents;
      const norm = s.key === 'mttr' ? v / Math.max(1, ...data.map((x) => x.mttr)) : v / maxVal;
      return { x: padL + i * step, y: padT + innerH - norm * innerH, v };
    });
    const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const area = `${line} L${padL + (data.length - 1) * step},${padT + innerH} L${padL},${padT + innerH} Z`;
    return { ...s, line, area, pts };
  });

  const gridLines = [0, 0.25, 0.5, 0.75, 1];
  const labelEvery = Math.max(1, Math.ceil(data.length / 10));

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        preserveAspectRatio="none"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * width;
          const idx = Math.round((x - padL) / step);
          setHover(idx >= 0 && idx < data.length ? idx : null);
        }}
        role="img"
        aria-label={`Incident trend over ${data.length} days`}
      >
        <defs>
          {paths.map((p) => (
            <linearGradient key={p.key} id={`grad-${p.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={p.color} stopOpacity="0.42" />
              <stop offset="100%" stopColor={p.color} stopOpacity="0.02" />
            </linearGradient>
          ))}
        </defs>
        <g className="chart-grid">
          {gridLines.map((g) => (
            <line key={g} x1={padL} x2={width - 12} y1={padT + innerH * (1 - g)} y2={padT + innerH * (1 - g)} />
          ))}
        </g>
        {paths.map((p) => (
          <g key={p.key}>
            <path d={p.area} fill={`url(#grad-${p.key})`} />
            <path d={p.line} fill="none" stroke={p.color} strokeWidth={2.1} strokeLinejoin="round" strokeLinecap="round" />
            {p.pts.map((pt, i) => (
              <circle key={i} cx={pt.x} cy={pt.y} r={hover === i ? 4.4 : p.key === 'incidents' ? 2.4 : 2} fill={p.color} opacity={p.key === 'critical' && pt.v === 0 ? 0.35 : 1} />
            ))}
          </g>
        ))}
        <g className="chart-axis">
          {data.map((d, i) =>
            i % labelEvery === 0 ? (
              <text key={d.date + i} x={padL + i * step} y={height - 8} textAnchor="middle">
                {d.label}
              </text>
            ) : null,
          )}
          {gridLines.map((g) => (
            <text key={`y${g}`} x={8} y={padT + innerH * (1 - g) + 3}>
              {Math.round(maxVal * g)}
            </text>
          ))}
        </g>
        {hover !== null ? (
          <line
            x1={padL + hover * step}
            x2={padL + hover * step}
            y1={padT}
            y2={padT + innerH}
            stroke="rgba(139,92,246,.5)"
            strokeDasharray="3 3"
          />
        ) : null}
      </svg>
      {hover !== null ? (
        <div
          style={{
            position: 'absolute',
            left: `${((padL + hover * step) / width) * 100}%`,
            top: 6,
            transform: 'translateX(-50%)',
            background: 'rgba(10,12,20,.95)',
            border: '1px solid var(--border-strong)',
            borderRadius: 10,
            padding: '8px 11px',
            fontSize: 11.5,
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            boxShadow: 'var(--shadow)',
          }}
        >
          <div style={{ fontWeight: 600 }}>{data[hover].label}</div>
          <div className="mono">incidents {data[hover].incidents} · critical {data[hover].critical}</div>
          {showMttr ? <div className="mono dim">mttr {data[hover].mttr || '—'}m</div> : null}
        </div>
      ) : null}
    </div>
  );
}

export function Donut({
  data,
  size = 190,
  thickness = 20,
  centerLabel,
  centerValue,
}: {
  data: { name: string; value: number; color: string }[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerValue?: string | number;
}) {
  const total = data.reduce((a, b) => a + b.value, 0) || 1;
  const r = size / 2 - thickness / 2 - 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="row" style={{ gap: 22, flexWrap: 'wrap', justifyContent: 'center' }}>
      <div style={{ position: 'relative', width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(126,143,255,.08)" strokeWidth={thickness} />
          {data.map((d) => {
            const len = (d.value / total) * c;
            const el = (
              <circle
                key={d.name}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={d.color}
                strokeWidth={thickness}
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
                style={{ transition: 'stroke-dasharray .9s cubic-bezier(.2,.8,.2,1)' }}
                opacity={0.94}
              />
            );
            offset += len;
            return el;
          })}
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
          <div>
            <div style={{ fontSize: 25, fontWeight: 700, letterSpacing: -0.8 }}>{centerValue ?? total}</div>
            {centerLabel ? <div className="tiny dim" style={{ textTransform: 'uppercase', letterSpacing: 0.8 }}>{centerLabel}</div> : null}
          </div>
        </div>
      </div>
      <div className="stack" style={{ gap: 9, minWidth: 130 }}>
        {data.map((d) => (
          <div key={d.name} className="row" style={{ gap: 9 }}>
            <span className="swatch" style={{ background: d.color }} />
            <span className="small" style={{ minWidth: 62 }}>{d.name}</span>
            <span className="mono small" style={{ marginLeft: 'auto' }}>{d.value}</span>
            <span className="tiny dim mono">{Math.round((d.value / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function HBars({
  data,
  color = 'linear-gradient(90deg,#6366f1,#8b5cf6)',
  suffix = '',
}: {
  data: { name: string; value: number; hint?: string; color?: string }[];
  color?: string;
  suffix?: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="bars">
      {data.map((d, i) => (
        <div className="bar-row" key={d.name + i}>
          <div title={d.name} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {d.name}
            {d.hint ? <span className="tiny dim"> · {d.hint}</span> : null}
          </div>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${(d.value / max) * 100}%`, background: d.color ?? color, animationDelay: `${i * 45}ms` }} />
          </div>
          <div className="bar-val">
            {d.value}
            {suffix}
          </div>
        </div>
      ))}
    </div>
  );
}

export function Heatmap({
  rows,
  cols,
  cells,
}: {
  rows: string[];
  cols: string[];
  cells: { service: string; category: string; value: number }[];
}) {
  const max = Math.max(1, ...cells.map((c) => c.value));
  const valueAt = (r: string, c: string) => cells.find((x) => x.service === r && x.category === c)?.value ?? 0;
  const color = (v: number) => {
    if (v === 0) return 'rgba(126,143,255,.05)';
    const t = v / max;
    return `rgba(${Math.round(99 + t * 40)}, ${Math.round(102 - t * 40)}, ${Math.round(241 - t * 120)}, ${0.22 + t * 0.68})`;
  };
  return (
    <div className="scroll-x">
      <div className="heat" style={{ gridTemplateColumns: `minmax(140px, 190px) repeat(${cols.length}, minmax(78px, 1fr))` }}>
        <div />
        {cols.map((c) => (
          <div key={c} className="heat-label tiny dim" title={c} style={{ textAlign: 'center', whiteSpace: 'normal', lineHeight: 1.15 }}>
            {c.length > 18 ? `${c.slice(0, 16)}…` : c}
          </div>
        ))}
        {rows.map((r) => (
          <div key={r} style={{ display: 'contents' }}>
            <div className="heat-label" title={r}>{r}</div>
            {cols.map((c) => (
              <div key={r + c} className="heat-cell" style={{ background: color(valueAt(r, c)) }} title={`${r} · ${c}: ${valueAt(r, c)} incident(s)`}>
                {valueAt(r, c) || ''}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function Gauge({ value, label, size = 150, color = '#8b5cf6', target }: { value: number; label: string; size?: number; color?: string; target?: number }) {
  const r = size / 2 - 12;
  const c = Math.PI * r; // half circle
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div style={{ position: 'relative', width: size, height: size * 0.72 }}>
      <svg width={size} height={size * 0.72} viewBox={`0 0 ${size} ${size * 0.72}`}>
        <path d={`M 12 ${size * 0.6} A ${r} ${r} 0 0 1 ${size - 12} ${size * 0.6}`} fill="none" stroke="rgba(126,143,255,.12)" strokeWidth={11} strokeLinecap="round" />
        <path
          d={`M 12 ${size * 0.6} A ${r} ${r} 0 0 1 ${size - 12} ${size * 0.6}`}
          fill="none"
          stroke={color}
          strokeWidth={11}
          strokeLinecap="round"
          strokeDasharray={`${(pct / 100) * c} ${c}`}
          style={{ transition: 'stroke-dasharray 1s cubic-bezier(.2,.8,.2,1)', filter: `drop-shadow(0 0 10px ${color}55)` }}
        />
        {target !== undefined ? (
          <line
            x1={size / 2 + r * Math.cos(Math.PI - (target / 100) * Math.PI)}
            y1={size * 0.6 - r * Math.sin(Math.PI - (target / 100) * Math.PI)}
            x2={size / 2 + (r + 12) * Math.cos(Math.PI - (target / 100) * Math.PI)}
            y2={size * 0.6 - (r + 12) * Math.sin(Math.PI - (target / 100) * Math.PI)}
            stroke="var(--text-3)"
            strokeWidth={2}
          />
        ) : null}
      </svg>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 6, textAlign: 'center' }}>
        <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: -0.7 }}>{pct}</div>
        <div className="tiny dim" style={{ textTransform: 'uppercase', letterSpacing: 0.7 }}>{label}</div>
      </div>
    </div>
  );
}

export function ScoreBreakdownBars({ items }: { items: { label: string; weight: number; hit: number; note: string }[] }) {
  const maxWeight = Math.max(...items.map((i) => i.weight), 0.01);
  return (
    <div className="stack" style={{ gap: 10 }}>
      {items.map((i) => {
        const contribution = i.weight * i.hit;
        const pct = (contribution / maxWeight) * 100;
        const tone = i.hit >= 0.75 ? '#10b981' : i.hit >= 0.4 ? '#f59e0b' : 'rgba(126,143,255,.35)';
        return (
          <div key={i.label}>
            <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
              <span className="small" style={{ fontWeight: 560 }}>{i.label}</span>
              <span className="spacer" />
              <span className="tiny mono dim">w {i.weight.toFixed(2)}</span>
              <span className="tiny mono" style={{ color: tone, minWidth: 42, textAlign: 'right' }}>{i.hit.toFixed(2)}</span>
            </div>
            <div className="progress thin" style={{ marginTop: 4 }}>
              <span style={{ width: `${Math.max(1.5, pct)}%`, background: `linear-gradient(90deg, ${tone}, ${tone}99)` }} />
            </div>
            <div className="tiny dim" style={{ marginTop: 3 }}>{i.note}</div>
          </div>
        );
      })}
    </div>
  );
}

export function SimilarityMeter({ value, height = 10 }: { value: number; height?: number }) {
  const cols = useMemo(() => {
    const tone = value >= 85 ? ['#10b981', '#34d399'] : value >= 60 ? ['#f59e0b', '#fbbf24'] : ['#f43f5e', '#fb7185'];
    return `linear-gradient(90deg, ${tone[0]}, ${tone[1]})`;
  }, [value]);
  return (
    <div className="progress" style={{ height }}>
      <span style={{ width: `${Math.max(3, Math.min(100, value))}%`, background: cols }} />
    </div>
  );
}
