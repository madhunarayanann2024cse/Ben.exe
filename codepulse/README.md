# CodePulse — AI Incident Memory & Root-Cause Intelligence

> **"Your Engineering Team Never Forgets."**
> Built for the **Zephoria 2K26 · Pirate Vibecoding Hackathon — PS-07**

Paste a production stack trace. CodePulse retrieves the closest incident from your team's
history using vector similarity, predicts the root cause, shows **who** solved it before,
**which Git commit** fixed it and **what exactly they changed** — then writes the blameless
post-mortem and persists the whole analysis to the database.

---

## The 60-second demo (verified output)

Paste this trace into **Analyze Incident**:

```
ERROR 500
java.sql.SQLException:
Connection timed out
Unable to acquire JDBC connection
Pool exhausted
at PaymentService.java:142
Service: Payment API
```

CodePulse returns — in **~30 ms, fully offline**:

| Result | Value |
| --- | --- |
| Historical match | **INC-1042** — *Payment API — HikariCP pool exhausted, 500s on charge endpoint* |
| Similarity | **94.0 %** (cosine 70.9 % × rule-engine 88.9 % hybrid) |
| Root cause | **Database connection pool exhaustion** |
| Confidence / severity | **94 % Very High** · **critical** |
| Resolved by | **Arun Kumar** — Senior Backend Engineer, Payments Platform |
| Git commit | **`8f42a1`** in `zephoria/payment-api` (PR #2291) |
| Historical fix | **“Increase database connection pool from 50 to 150”** (runbook RB-DB-004) |
| Evidence | 8 weighted items (trace fingerprint, class signals, memory, recurrence, fix, telemetry, engine) |
| Post-mortem | `pm_…` — summary · impact · 9-beat timeline · root cause · resolution · 4 preventive actions · 4 action items · 3 lessons |
| Persistence | analysis + post-mortem + AI telemetry written to the live database |

Reproduce it yourself — one command, 47 assertions:

```bash
node scripts/demo-flow.mjs http://localhost:3000
# 🎉 ALL CHECKS PASSED — 47 passed, 0 failed
```

---

## Modules (all seven from the brief)

| # | Module | Route | What it does |
| --- | --- | --- | --- |
| 1 | **Dashboard** | `/` | Total / critical / recurring incidents, average resolution time, reliability-posture gauge, 14-day trend chart, severity donut, root-cause + service distribution, recent incidents, recurrence watchlist, generated intelligence feed |
| 2 | **Analysis workspace** | `/analyze` | Stack-trace input, service + environment fields, sample traces, staged AI pipeline animation, **Analyze Incident** button |
| 3 | **Historical repository** | `/incidents`, `/incidents/[id]` | Full-text search, service/severity/status/class filters, sorting, side preview, deep incident pages with stack trace, evidence, timeline, fix correlation, related memory |
| 4 | **AI root-cause intelligence** | in `/analyze` | Confidence ring, predicted root cause, severity, affected service, contributing factors, alternative hypotheses with probabilities, retrieval score breakdown |
| 5 | **Error → fix correlation** | in `/analyze` & incident pages | Error → Historical incident → Root cause → Engineer → Git commit → Resolution chain, commit message, files touched, diff summary, verified-after window, runbook |
| 6 | **Post-mortem generator** | `/postmortems`, `/postmortems/[id]` | Summary, impact + metrics, timeline, root cause, resolution, preventive actions, action items with owners and due dates, lessons learned; regenerate & export as `.md` |
| 7 | **Analytics** | `/analytics` | 30-day incident trend, weekly volume, severity mix, service performance table, root-cause distribution, service × class heatmap, AI match-quality panel, MTTR vs target |
| + | **Captain’s Logbook** | `/logbook` | AI prompt telemetry, provider provenance, 10-minute heartbeats, redaction state, JSON export |

---

## Stack

- **Next.js 15** (App Router, React 19, TypeScript, Turbopack) — one deployable unit, 0 ms cold-start API routes
- **Supabase PostgreSQL** (+ **pgvector**) for incidents, analyses, post-mortems and AI logs
- **Embedded durable store** (`data/codepulse.json`) automatic fallback so a live demo can never fail on stage
- **Own 384-d vector engine** — signed feature hashing, sub-linear TF, domain keyword boosting, character 4-grams, L2 normalisation → cosine similarity (no external embedding dependency required)
- **Hybrid retrieval** — `0.55 × cosine + 0.45 × domain rule engine`, then a calibrated monotone similarity curve
- **LLM reasoning (optional)** — OpenAI / Gemini / Anthropic, **server-side only**; falls back to the built-in **PulseReasoner** engine which is fully functional offline
- **Zero UI dependencies** — hand-built SVG charts, glass-panel design system in pure CSS

```
src/
├─ app/
│  ├─ page.tsx                     # 1 Dashboard
│  ├─ analyze/page.tsx             # 2 + 4 + 5 Analysis workspace
│  ├─ incidents/…                  # 3 Repository + detail
│  ├─ postmortems/…                # 6 Post-mortem library + document
│  ├─ analytics/page.tsx           # 7 Analytics
│  ├─ logbook/page.tsx             # Captain's Logbook (AI telemetry)
│  └─ api/                         # analyze · incidents · dashboard · analytics
│                                  # postmortems · telemetry · seed · health
├─ lib/
│  ├─ ai/providers.ts              # server-side LLM + embeddings, timeouts, redaction
│  ├─ analyze.ts                   # the 9-step orchestrator
│  ├─ pulsereasoner.ts             # parse · rank · RCA · evidence · post-mortem
│  ├─ vector.ts                    # embedder, cosine, calibration
│  ├─ taxonomy.ts                  # 12 root-cause classes + playbooks
│  ├─ seed.ts                      # 16 realistic historical incidents
│  ├─ db.ts                        # Supabase PostgREST + durable local fallback
│  ├─ analytics.ts                 # dashboard/analytics aggregation
│  └─ telemetry.ts                 # prompt logging + 10-minute heartbeat
├─ components/                     # Shell, charts (SVG), ui primitives, PostMortemDoc
└─ supabase/schema.sql             # tables, pgvector index, match_incidents() RPC, RLS
```

---

## Quickstart

```bash
npm install
cp .env.example .env.local     # optional — the app runs fully without any keys
npm run dev                    # http://localhost:3000
```

Open **`/analyze?demo=1`** — the challenge trace loads and the full pipeline runs automatically.

### Connect Supabase (recommended for the submitted build)

1. Create a project at [supabase.com](https://supabase.com) → **SQL Editor** → paste `supabase/schema.sql` → **Run**.
   This creates the four tables, the `ivfflat` index on `vector(384)`, the `match_incidents()` RPC and enables RLS.
2. Project Settings → API → copy the URL and the **service_role** key into `.env.local`:
   ```env
   SUPABASE_URL=https://xxxx.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...
   ```
3. Restart, then `curl -X POST localhost:3000/api/seed` (or just open the app — it self-seeds an empty table).
4. Confirm on `/api/health`: `"backend": "supabase-postgres"`, `"vectorSearch": "pgvector-rpc"`.

### Optional LLM reasoning

```env
OPENAI_API_KEY=sk-...            # or GEMINI_API_KEY / ANTHROPIC_API_KEY
OPENAI_MODEL=gpt-4o-mini
```

When a key is present the LLM writes the root-cause narrative, the explanation and the
post-mortem prose; retrieval, scoring, the fix correlation and every number stay
deterministic so the demo output is reproducible. If the provider errors or times out
(14 s bound), the route degrades to PulseReasoner and says so in `warnings`.

---

## Deploy to Vercel

```bash
npm i -g vercel
vercel                                  # preview
vercel --prod                           # production
```

Then add the same environment variables in **Vercel → Project → Settings → Environment
Variables** (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, optionally the AI keys) and redeploy.

Notes:
- Route handlers run on the **Node.js** runtime; `maxDuration = 60` is set on `/api/analyze`.
- Without Supabase env vars on Vercel the app uses an ephemeral `/tmp` store — perfect for a
  no-setup preview, but add Supabase for a durable demo.
- `.env.local` is git-ignored; no secret is ever bundled into client JavaScript.

---

## Security & data integrity

| Control | Implementation |
| --- | --- |
| No client-side keys | Every provider call lives in `src/app/api/*` + `src/lib/ai/providers.ts` (Node-only). No `NEXT_PUBLIC_*` secret exists, and `/api/health` returns configuration **booleans**, never values. |
| Least-privilege DB access | Supabase is reached with the **service_role** key over PostgREST from the server; RLS is enabled with *no* permissive policies so anon/authenticated keys read zero rows. |
| Prompt redaction | `redact()` strips JWTs, bearer tokens, `sk-…` keys and `password=/secret=/token=` pairs before any telemetry row is written. |
| Integrity of AI records | Each log stores a SHA-256 prompt hash, latency, token estimate, provider and a `fallback` flag — the logbook is auditable. |
| Input validation | `/api/analyze` enforces 12 ≤ length ≤ 20 000 chars, trims free-text fields, and every route is `no-store` + server-rendered. |
| Verifiable secrets posture | `GET /api/health → ai.keysPresent` reports which keys are configured (true/false) without revealing them. |

---

## AI telemetry (hackathon “logbook” requirement)

Every run writes to the `ai_logs` table (Supabase) or the embedded store:

- `analysis` — the composed SRE prompt, retrieved memory, prompt hash, structured verdict output
- `reasoning` / `postmortem` — LLM request + response when a provider is configured
- `embedding` — vector dimensionality, retrieval backend, signal count
- `heartbeat` — **every 10 minutes** (browser timer calls `POST /api/telemetry`; server-side rate-limited)
- `seed` — corpus ingestion provenance

Inspect it live at **`/logbook`** — filter by kind, expand any row to read the redacted
prompt and output, then export the whole logbook as JSON.

---

## Verification

```bash
npm run build                 # production build + type check
npx tsx scripts/engine-check.ts   # 11-case retrieval regression (prints a score bar per case)
node scripts/demo-flow.mjs        # 47-assertion end-to-end demo walkthrough
```

`scripts/engine-check.ts` asserts that every production failure class routes to the right
historical incident (pool exhaustion → INC-1042, Redis failover → INC-1036, OOMKilled →
INC-1031, schema drift → INC-1028, JWKS rotation → INC-1024, CPU throttling → INC-1019,
certificate expiry → INC-1015, Kafka lag → INC-1011, deadlock → INC-1007 …) and that a
nonsense trace is **not** forced onto a match.

---

## Seeded historical corpus (16 incidents · 12 classes)

Pool exhaustion (`INC-1042`, `INC-0994`, `INC-0981`) · upstream timeouts (`INC-1039`, `INC-0990`)
· Redis failover & eviction (`INC-1036`, `INC-0986`) · JVM heap leak (`INC-1031`) · failed
deployment (`INC-1028`) · signing-key rotation (`INC-1024`) · CPU throttling (`INC-1019`) ·
TLS expiry (`INC-1015`) · Kafka poison message (`INC-1011`) · Postgres deadlock (`INC-1007`) ·
edge cache poisoning (`INC-1003`) · Elasticsearch red cluster (`INC-0998`).

Each record carries a stack trace, evidence, impact, resolution steps, preventive actions,
lessons, telemetry, a timeline, an owning engineer and a Git commit — so retrieval has
something real to match on.

---

<p align="center"><strong>CodePulse — Your Engineering Team Never Forgets.</strong></p>
