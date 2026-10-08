'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface ApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  lastLoadedAt: number | null;
}

/** Minimal typed fetch hook — no client dependency beyond React. */
export function useApi<T>(url: string | null, options: { pollMs?: number } = {}): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(Boolean(url));
  const [error, setError] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);
  const [nonce, setNonce] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    const load = async () => {
      if (!data) setLoading(true);
      try {
        const res = await fetch(url, { cache: 'no-store' });
        const json = (await res.json()) as T & { ok?: boolean; error?: string };
        if (cancelled) return;
        if (!res.ok || json.ok === false) throw new Error(json.error || `Request failed (${res.status})`);
        setData(json);
        setError(null);
        setLastLoadedAt(Date.now());
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    const timer = options.pollMs ? setInterval(load, options.pollMs) : null;
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, nonce, options.pollMs]);

  return { data, loading, error, refresh, lastLoadedAt };
}

/** POST helper with typed response and error surfacing. */
export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as T & { ok?: boolean; error?: string };
  if (!res.ok || json.ok === false) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}
