/** Shared formatting helpers (safe on both server and client). */

import type { Severity, IncidentStatus } from './types';

export function dt(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function dtShort(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function dateOnly(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function relTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  return `${months}mo ago`;
}

export function duration(minutes: number): string {
  if (!minutes) return '—';
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

export function sevClass(severity: Severity | string): string {
  switch (severity) {
    case 'critical': return 'badge-critical';
    case 'high': return 'badge-high';
    case 'medium': return 'badge-medium';
    default: return 'badge-low';
  }
}

export function statusClass(status: IncidentStatus | string): string {
  switch (status) {
    case 'resolved': return 'badge-ok';
    case 'mitigated': return 'badge-medium';
    case 'monitoring': return 'badge-info';
    default: return 'badge-critical';
  }
}

export function statusDot(status: IncidentStatus | string): string {
  switch (status) {
    case 'resolved': return 'dot-ok';
    case 'mitigated': return 'dot-medium';
    case 'monitoring': return 'dot-low';
    default: return 'dot-critical';
  }
}

export function hueColor(hue: number, light = 52): string {
  return `hsl(${hue} 78% ${light}%)`;
}

export function avatarGradient(hue: number): string {
  return `linear-gradient(140deg, hsl(${hue} 72% 58%), hsl(${(hue + 42) % 360} 76% 46%))`;
}

export function similarityTone(similarity: number): 'ok' | 'warn' | 'critical' {
  if (similarity >= 85) return 'ok';
  if (similarity >= 60) return 'warn';
  return 'critical';
}

export function confidenceColor(confidence: number): string {
  if (confidence >= 0.85) return '#10b981';
  if (confidence >= 0.7) return '#22d3ee';
  if (confidence >= 0.55) return '#f59e0b';
  return '#f43f5e';
}

export function num(value: number): string {
  return value.toLocaleString('en-IN');
}

export function clamp(x: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, x));
}

/** Colour a raw log line for the log viewer. */
export function logLineClass(line: string): string {
  if (/\b(ERROR|FATAL|CRITICAL|Exception|OOMKilled|refused|timed out|expired)\b/i.test(line)) return 'lg-critical';
  if (/\b(WARN|WARNING|throttl|retry|degraded|slow)\b/i.test(line)) return 'lg-warn';
  if (/^\s*at\s|\bcaused by\b|^\s*\.\.\./i.test(line)) return 'lg-frame';
  if (/\b(INFO|DEBUG|pool stats|trace|span)\b/i.test(line)) return 'lg-info';
  return '';
}

export const DEMO_TRACE = `ERROR 500
java.sql.SQLException:
Connection timed out
Unable to acquire JDBC connection
Pool exhausted
at PaymentService.java:142
Service: Payment API`;
