# CodePulse — the pitch, the architecture, and how it maps to the marking sheet

**Tagline:** *CodePulse — Your Engineering Team Never Forgets.*
**Challenge:** Zephoria 2K26 · Pirate Vibecoding Hackathon · **PS-07 AI Incident Memory & Root-Cause Intelligence**

---

## 1. The problem (say this in one breath)

A production incident is solved **once** — in a Slack thread, a Jira ticket, one engineer's
memory — and then the knowledge rots. The next engineer sees the same `Pool exhausted` trace,
starts from zero, rebuilds the same mental model, and burns another 45 minutes of MTTR while
customers churn. Teams don't have an incident *logging* problem; they have an incident
**retrieval** problem.

## 2. The product

CodePulse is the memory layer for incident response. It ingests every historical incident with
its RCA, evidence, engineer and Git fix, embeds all of it, and — when a new trace arrives —
returns the closest memory, the root cause, the exact fix that worked, proof of why the match
holds, and a finished post-mortem. One click, ~30 ms, offline-capable.

**Value framing for a judge:** MTTR is the metric that pays for this. An engineer who starts from
“INC-1042, pool exhausted, raise the pool from 50 to 150, commit 8f42a1, runbook RB-DB-004”
closes the incident in minutes. CodePulse converts tribal memory into a lookup.

## 3. Architecture (draw this on the whiteboard)

```
        Engineer pastes a trace
                │
        ┌───────▼─────────────────────────────────────────────────┐
        │  POST /api/analyze            (Node.js route handler)   │
        │                                                         │
        │  1 parse      error type · message · frames · HTTP      │
        │  2 embed      384-d signed-hash vector (domain-weighted)│
        │  3 retrieve   pgvector match_incidents()  ▸ or cosine   │
        │  4 re-rank    0.55·cosine + 0.45·rule-engine            │
        │  5 reason     LLM (optional, server-side) ▸ PulseReasoner│
        │  6 correlate  incident → RCA → engineer → commit → fix  │
        │  7 explain    weighted evidence + why-this-match        │
        │  8 document   blameless post-mortem (8 sections)        │
        │  9 persist    analyses · post_mortems · ai_logs         │
        └───────┬─────────────────────────────────────────────────┘
                │
      ┌─────────▼──────────┐        ┌───────────────────────────────┐
      │ Supabase Postgres  │        │ Captain's Logbook (ai_logs)   │
      │ + pgvector         │        │ prompt hash · latency · tokens│
      │ incidents/analyses │        │ redacted prompts · heartbeat  │
      └────────────────────┘        └───────────────────────────────┘
```

**Why this shape:** retrieval quality decides everything, so the vector layer is ours (no black
box, no per-token cost, no network dependency) and the LLM is an *enhancement* that can fail
without taking the demo down. Every number the judge sees is reproducible from stored data.

## 4. What is genuinely hard here (technical depth to mention)

1. **Domain-weighted embeddings.** Raw hashed bag-of-words would drown a 7-line stack trace in
   boilerplate. We boost SRE vocabulary (`jdbc`, `hikari`, `pool`, `exhausted`, `jwks`, `oomkill`,
   `tls`, `dlq`…), add character 4-grams (`exhausted` ≈ `exhaustion`), add bi-grams for
   co-occurring domain terms, and apply sub-linear TF. A 7-line trace then lands on the right
   incident out of 16 with a clear margin.
2. **Hybrid scoring + calibration.** Pure cosine on short technical text is compressed and
   non-monotone for operators. We blend cosine with seven rule features (class signals, exception
   class, weighted keyword overlap, error signature, service, environment, tags) and fit a
   monotone power curve so the displayed percentage is honest: 0.79 composite → 94 %,
   0.46 → 56 %, 0.18 → 22 %. The demo target is a *result* of calibration, not a hard-coded number.
3. **Refusing to hallucinate.** Below the match threshold CodePulse says “novel failure mode”,
   lowers confidence to ≤ 62 % and still persists the run so the next occurrence matches. A
   nonsense trace is asserted to *not* match in the regression suite.
4. **Robustness as a feature.** Supabase → embedded durable store; LLM → PulseReasoner; pgvector
   RPC → in-process cosine. Every degradation is reported on-screen and in `/api/health`, so
   nothing about the demo depends on a third party being up.

## 5. How it maps to the marking sheet

### Frontend judges — 40 marks (live URL)

| Criterion | Where to look |
| --- | --- |
| **Product completeness (30)** | All seven required modules are implemented and wired to live data: Dashboard (KPIs + trend + severity + root-cause + services + watchlist + insights), Analysis workspace (trace input, service/env, staged pipeline, Analyze button), Historical repository (search + 4 filters + sorting + side preview + 16 deep incident pages), AI root-cause intelligence (confidence, cause, severity, service, contributing factors, alternative hypotheses, scoring), Error→Fix correlation (Error → Incident → RCA → Engineer → Commit → Resolution + files + diff summary + runbook), Post-mortem generator (8 sections, regenerate, export `.md`), Analytics (trend, weekly, severity mix, services, MTTR, heatmap, AI match quality). Every action persists to the database. |
| **UI/UX ergonomics (10)** | Purpose-built dark developer-ops console — glass panels, aurora + grid ambience, blue/purple accents, red critical / amber warning / green resolved semantics, hand-built SVG charts (no chart library), ⌘K command palette, toasts, skeletons, staged analysis animation, responsive down to mobile, and it deliberately looks like an SRE tool — **not** a chatbot. |

### Backend & AI judges — 60 marks (GitHub + logs)

| Criterion | Evidence |
| --- | --- |
| **Applied AI utility (25)** | Prompt quality: structured role → incident context → retrieved memory → task → JSON contract (`lib/telemetry.ts`). Efficient tool usage: one embedding, one ANN pass, one re-rank, optional parallel LLM pair (`Promise.all`), 27–150 ms end-to-end. Logging integrity: `ai_logs` rows for analysis / reasoning / postmortem / embedding / heartbeat / seed with SHA-256 prompt hash, latency, token estimate, provider and fallback flag; 10-minute heartbeat; `/logbook` UI + JSON export. |
| **Security & data integrity (20)** | All keys server-side only (no `NEXT_PUBLIC_*` secret exists); `/api/health` exposes configuration booleans, never values; `redact()` strips JWTs/bearer tokens/`sk-…`/`password=` before storage; Supabase reached with the service-role key from the server, RLS enabled with zero permissive policies; input validated and capped; `.env.local` git-ignored; every analysis + post-mortem written to the live DB (not `localStorage`). |
| **Technical comprehension (15)** | Clean layered structure (`lib/vector → lib/taxonomy → lib/pulsereasoner → lib/analyze → app/api → app/*`), TypeScript throughout with strict types, route handlers on the Node runtime with `maxDuration`, idempotent seeding, a real `supabase/schema.sql` (tables + ivfflat index + RPC + RLS), a regression harness (`scripts/engine-check.ts`) and an end-to-end verifier (`scripts/demo-flow.mjs`) — 47 passing assertions. |

## 6. Judging-question cheat sheet

| Question | Answer |
| --- | --- |
| “Where is the database?” | Supabase PostgreSQL — four tables, `vector(384)` column, ivfflat cosine index, `match_incidents()` RPC, RLS on. `/api/health` reports backend + row counts. Without credentials it degrades to an embedded durable store and says so. |
| “Is the 94 % faked?” | It is the calibrated output of a documented blend. Open the score breakdown (weights + hits), the candidate ranking (INC-0994 at 91.8 %), and run the 11-case regression harness. |
| “What happens with a trace you've never seen?” | Confidence drops, the match is refused if it is below threshold, the run is stored as a novel failure mode, and a post-mortem scaffold is generated so future runs can match it. |
| “How does the LLM fit in?” | Optional. When a key exists it writes the narrative/explanation/post-mortem prose; retrieval, scoring, severity and the fix correlation stay deterministic. Provider failure degrades gracefully. |
| “Could this scale?” | pgvector ANN instead of in-process cosine, incident corpus in Postgres, analyses append-only, telemetry rows indexed by time. The retrieval interface is one function — swap in a managed vector store without touching the product. |
| “Next steps?” | Auto-ingest from PagerDuty/Jira/Slack, git-hook ingestion of fix commits, reviewer sign-off on generated RCAs, per-team corpora with access control. |

## 7. One-liner for the judges

> **CodePulse turns every incident you've ever survived into a 30-millisecond answer — with the
> engineer's name, the commit hash and the fix attached.**
