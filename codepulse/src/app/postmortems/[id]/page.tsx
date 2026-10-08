'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useState } from 'react';
import { EmptyState, SectionCard, Skeleton } from '@/components/ui';
import { PostMortemDoc } from '@/components/PostMortemDoc';
import { Toaster, toast } from '@/components/Toaster';
import { IconAlert, IconArrowRight, IconDoc } from '@/components/icons';
import { useApi, postJson } from '@/lib/useApi';
import type { PostMortem } from '@/lib/types';

interface PmResponse {
  ok: boolean;
  total: number;
  postMortems: PostMortem[];
}

export default function PostMortemDetailPage() {
  const params = useParams<{ id: string }>();
  const id = (params?.id ?? '').toString();
  const { data, loading, refresh } = useApi<PmResponse>('/api/postmortems?limit=100');
  const [postMortem, setPostMortem] = useState<PostMortem | null>(null);

  const current = postMortem ?? data?.postMortems.find((p) => p.id === id) ?? null;

  const regenerate = useCallback(async () => {
    if (!current) return;
    try {
      const res = await postJson<{ ok: boolean; postMortem: PostMortem }>('/api/postmortems', {
        incidentId: current.incidentId ?? undefined,
        analysisId: current.analysisId ?? undefined,
      });
      setPostMortem(res.postMortem);
      toast('Post-mortem regenerated', `${res.postMortem.id} persisted to the database.`, 'ok');
      refresh();
    } catch (err) {
      toast('Regeneration failed', (err as Error).message, 'critical');
    }
  }, [current, refresh]);

  if (loading && !data) {
    return (
      <div className="stack" style={{ gap: 16 }}>
        <Skeleton height={120} />
        <Skeleton height={340} />
      </div>
    );
  }

  if (!current) {
    return (
      <SectionCard>
        <EmptyState
          icon={<IconAlert width={24} height={24} />}
          title={`Post-mortem ${id} not found`}
          detail="It may have been generated in a different environment, or the database returned no matching document."
          action={
            <Link href="/postmortems" className="btn btn-primary btn-sm">
              Back to library
            </Link>
          }
        />
      </SectionCard>
    );
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row row-wrap" style={{ gap: 10 }}>
        <Link href="/postmortems" className="btn btn-ghost btn-sm">
          <IconDoc width={13} height={13} />
          Library
        </Link>
        {current.incidentId ? (
          <Link href={`/incidents/${current.incidentId}`} className="btn btn-ghost btn-sm">
            Linked memory {current.incidentId}
            <IconArrowRight width={12} height={12} />
          </Link>
        ) : null}
        <span className="spacer" />
        <span className="chip mono">{current.id}</span>
      </div>

      <PostMortemDoc postMortem={current} onRegenerate={regenerate} />
      <Toaster />
    </div>
  );
}
