-- ═══════════════════════════════════════════════════════════════════════════
--  CodePulse — Supabase PostgreSQL schema (with pgvector)
--  Run this in Supabase → SQL Editor once, then POST /api/seed (or just open
--  the app: it self-seeds on first read).
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists vector;
create extension if not exists pgcrypto;

-- ───────────────────────────── incidents (memory) ──────────────────────────
create table if not exists incidents (
  id                  text primary key,
  title               text not null,
  service             text not null,
  environment         text not null,
  severity            text not null,
  status              text not null,
  detected_at         timestamptz not null,
  resolved_at         timestamptz,
  mttr_minutes        integer not null default 0,
  recurring           boolean not null default false,
  recurrence_count    integer not null default 0,
  root_cause_category text not null,
  root_cause_title    text not null,
  summary             text not null,
  error_type          text not null,
  error_message       text not null,
  signature           text not null,
  stack_trace         text not null,
  evidence            jsonb not null default '[]',
  impact              text not null,
  resolution          text not null,
  resolution_steps    jsonb not null default '[]',
  preventive_actions  jsonb not null default '[]',
  lessons_learned     jsonb not null default '[]',
  owner               jsonb not null,
  fix                 jsonb not null,
  related_incident_ids jsonb not null default '[]',
  tags                jsonb not null default '[]',
  telemetry           jsonb not null default '{}',
  timeline            jsonb not null default '[]',
  embedding           vector(384),
  embedding_version   text,
  created_at          timestamptz not null default now()
);

-- ───────────────────────── analyses (every run persisted) ──────────────────
create table if not exists analyses (
  id                     text primary key,
  created_at             timestamptz not null default now(),
  service                text not null,
  environment            text not null,
  stack_trace            text not null,
  notes                  text,
  engine                 text not null,
  matched_incident_id    text references incidents(id) on delete set null,
  similarity             numeric(5,2) not null default 0,
  confidence             numeric(4,3) not null default 0,
  predicted_root_cause   text not null,
  predicted_severity     text not null,
  post_mortem_id         text,
  took_ms                integer not null default 0,
  result                 jsonb not null
);

-- ──────────────────────────────── post-mortems ─────────────────────────────
create table if not exists post_mortems (
  id                 text primary key,
  incident_id        text references incidents(id) on delete set null,
  analysis_id        text,
  title              text not null,
  severity           text not null,
  status             text not null default 'draft',
  generated_by       text not null,
  generated_at       timestamptz not null default now(),
  summary            text not null,
  impact             text not null,
  timeline           jsonb not null default '[]',
  root_cause         text not null,
  resolution         text not null,
  preventive_actions jsonb not null default '[]',
  lessons_learned    jsonb not null default '[]',
  action_items       jsonb not null default '[]',
  metrics            jsonb not null default '{}'
);

-- ───────────── AI telemetry: every model call + 10-minute heartbeat ────────
create table if not exists ai_logs (
  id             text primary key,
  at             timestamptz not null default now(),
  kind           text not null,
  provider       text not null,
  model          text not null,
  fallback       boolean not null default true,
  latency_ms     integer not null default 0,
  tokens_est     integer not null default 0,
  prompt_hash    text not null,
  prompt_preview text not null,
  prompt_full    text not null,
  output_preview text not null,
  analysis_id    text,
  metadata       jsonb not null default '{}'
);

create index if not exists incidents_detected_idx on incidents (detected_at desc);
create index if not exists incidents_service_idx  on incidents (service);
create index if not exists analyses_created_idx   on analyses (created_at desc);
create index if not exists ai_logs_at_idx         on ai_logs (at desc);

-- Approximate-nearest-neighbour index over the 384-d embeddings (cosine).
create index if not exists incidents_embedding_idx
  on incidents using ivfflat (embedding vector_cosine_ops) with (lists = 24);

-- ─────────────────────── vector search RPC (pgvector path) ─────────────────
--  The app calls this for ranking when pgvector is present; it falls back to
--  in-process cosine otherwise, so behaviour is identical either way.
create or replace function match_incidents(
  query_embedding vector(384),
  match_threshold  float default 0.0,
  match_count      int default 5
)
returns table (id text, similarity float)
language sql stable as $$
  select i.id,
         1 - (i.embedding <=> query_embedding) as similarity
  from incidents i
  where i.embedding is not null
    and 1 - (i.embedding <=> query_embedding) > match_threshold
  order by i.embedding <=> query_embedding
  limit match_count;
$$;

-- ───────────────────────────── RLS (locked down) ───────────────────────────
--  Public/anon keys must never read incident memory. All access flows through
--  the Next.js server routes with the service-role key.
alter table incidents    enable row level security;
alter table analyses     enable row level security;
alter table post_mortems enable row level security;
alter table ai_logs      enable row level security;
-- (No permissive policies are created → anon/authenticated keys get zero rows.)
