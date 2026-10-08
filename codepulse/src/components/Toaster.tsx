'use client';

import { useEffect, useState } from 'react';

export interface ToastItem {
  id: number;
  title: string;
  detail?: string;
  tone?: 'info' | 'ok' | 'warn' | 'critical';
}

const EVENT = 'codepulse:toast';

export function toast(title: string, detail?: string, tone: ToastItem['tone'] = 'info') {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<ToastItem>(EVENT, { detail: { id: Date.now() + Math.random(), title, detail, tone } }));
}

const TONE_DOT: Record<string, string> = {
  info: 'dot-low',
  ok: 'dot-ok',
  warn: 'dot-medium',
  critical: 'dot-critical',
};

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const handler = (event: Event) => {
      const item = (event as CustomEvent<ToastItem>).detail;
      setItems((prev) => [...prev.slice(-3), item]);
      setTimeout(() => setItems((prev) => prev.filter((i) => i.id !== item.id)), 5200);
    };
    window.addEventListener(EVENT, handler);
    return () => window.removeEventListener(EVENT, handler);
  }, []);

  if (items.length === 0) return null;
  return (
    <div className="toast-wrap" role="status" aria-live="polite">
      {items.map((item) => (
        <div className="toast" key={item.id}>
          <div className="t-title">
            <span className={`dot ${TONE_DOT[item.tone ?? 'info']}`} />
            {item.title}
          </div>
          {item.detail ? <div className="t-detail">{item.detail}</div> : null}
        </div>
      ))}
    </div>
  );
}
