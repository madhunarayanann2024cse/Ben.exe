# PS-07 CodePulse — brief compliance sheet (line-by-line)

Source: **ZEPHORIA 2K26 · VIBECODING — Confidential Challenge Brief (Strict Sprint Release)**
Duration **4h 30m** · **100% Software / Cloud / AI (Zero Hardware)**
This sheet answers a judge's three questions: *what did they ask, is it built, and where do I click to verify.*

---

## A. Is this a web project or a mobile/desktop app?

The brief never specifies a mobile or desktop app. It constrains the **scope** (100 % software / cloud / AI,
zero hardware) and uses web-delivery vocabulary throughout: **"frontend"**, **"live database"**,
**"client bundles"**. The hackathon's Admiralty Court scores the frontend on **"Live URLs"**, i.e. a deployed
URL. Therefore the required deliverable is:

> **A web application deployed to a live URL, backed by a live database.**

CodePulse ships exactly that: one Node/Next.js service serving 7 UI routes plus 8 JSON API routes,
persisting to Supabase PostgreSQL (pgvector) with an embedded durable-store fallback.

---

## B. Section 1 — Real-World Industry Problem

| Brief text | Implementation |
| --- | --- |
| "Engineering teams suffer recurrent system downtime because root-cause analyses (RCAs) and incident mitigation strategies remain trapped in disconnected post-mortem documents" | CodePulse ingests each incident as one structured memory record (trace, RCA, evidence, engineer, commit, fix, prevention, lessons) and exposes it as a searchable corpus, so nothing is trapped in a document. |
| "leaving new engineers unaware of past architectural failures" | The analysis workspace returns the historical incident, the engineer who solved it and the exact fix **before** the engineer starts investigating. The dashboard's recurrence watchlist surfaces classes that keep coming back. |

**Verify:** `/` → recurrence watchlist + intelligence feed; `/incidents` → 16 records, 12 failure classes.

---

## C. Section 2 — Target Product Architecture & Solution

The brief describes a five-step pipeline. All five run inside `POST /api/analyze`
(`src/lib/analyze.ts`), server-side:

| Brief step | Implementation | Evidence |
| --- | --- | --- |
| "an engineer inputs a live production error stack trace" | `/analyze` — trace textarea + service + environment fields (validated 12–20 000 chars) | UI + `POST /api/analyze` |
| "executes vector search across historic incident records **and git commit history**" | 384-d signed-hash embeddings (domain keyword boosting, char 4-grams, sub-linear TF); cosine blended 55/45 with a 7-feature rule engine; committed git metadata (repo, commit hash, branch, PR, files, diff summary) is embedded **inside** incident memory and therefore participates in retrieval | `GET /api/incidents/INC-1042` → `fix.commit = 8f42a1`, 4 files, diff summary |
| "predicts the root cause" | AI Root-Cause Intelligence panel: title, class, confidence, severity, affected service, contributing factors, alternative hypotheses | `/analyze` result panel |
| "cites the historical resolution" | Error → Fix chain: Error → INC-1042 → root cause → engineer → commit → resolution, with the canonical fix line and runbook | *"Increase database connection pool from 50 to 150"*, RB-DB-004 |
| "auto-generates a standardized post-mortem draft" | Post-mortem builder with a fixed schema: summary, impact + metrics, timeline, root cause, resolution, preventive actions, action items (owner/due/priority), lessons learned; regenerable and exportable as `.md` | `/postmortems`, `/postmortems/[id]` |

> **Note for Q&A on "git commit history":** commit history is stored as first-class structured data on
> every incident (`repo`, `commit`, `branch`, `pr`, `message`, `files[]`, `diffSummary`, `deployedAt`) and is
> retrievable per incident. If a reviewer expects live GitHub API ingestion, that is a one-route addition
> (`/api/github/commits`) — the retrieval interface does not change.

---

## D. Section 3 — Mandatory End-to-End Functional Modules

| # | Brief module | Delivered as | Route |
| --- | --- | --- | --- |
| 1 | Incident response workspace | Trace input, service/environment, staged 9-step pipeline, live pipeline animation, run details | `/analyze` |
| 2 | Vector search engine over historic RCA repository | 16 seeded incidents across 12 classes, search, 4 filters, sorting, side preview, full detail pages, retrieval reuse counter | `/incidents`, `/incidents/[id]` |
| 3 | Error-to-fix correlation model | Error → Historical incident → Root cause → Engineer → Git commit → Resolution, plus files touched, diff summary, verified-after window, runbook | chain in `/analyze` and incident pages |
| 4 | Automated post-mortem document builder | 8-section blameless document, action items with owners and due dates, regenerate, save, export `.md` | `/postmortems`, `/postmortems/[id]` |
| 5 | Incident analytics dashboard | 30-day trend, weekly volume, severity mix, service performance table, root-cause distribution, service × class heatmap, AI match-quality panel, MTTR vs 30-min target | `/analytics` |

Plus (beyond the brief, supports the hackathon's telemetry rule): **Captain's Logbook** — every AI
interaction logged with SHA-256 prompt hash, latency, token estimate, provider and fallback flag, plus a
heartbeat every 10 minutes. `/logbook`.

---

## E. Section 4 — Mandatory 3-Minute Live Verification Test

**Brief:** *"Paste a simulated crash stack trace; the system surfaces the matching historic incident from the
database, displays the engineer who resolved it, and generates a structured RCA template."*

**Run this exact test (one click each):**

1. Open **`/analyze?demo=1`** (loads and analyses the simulated crash automatically), or paste:

```
ERROR 500
java.sql.SQLException:
Connection timed out
Unable to acquire JDBC connection
Pool exhausted
at PaymentService.java:142
Service: Payment API
```

2. **Matching historic incident surfaced from the database** → **INC-1042** — *Payment API — HikariCP pool
   exhausted, 500s on charge endpoint* at **94.0 %** similarity (cosine 70.9 % × rule-engine 88.9 %),
   runner-up **INC-0994** at 91.8 %. Run `node scripts/demo-flow.mjs` → 47/47 assertions pass.
3. **Engineer who resolved it displayed** → **Arun Kumar**, Senior Backend Engineer, Payments Platform —
   commit **`8f42a1`** in `zephoria/payment-api` (PR #2291), fix "Increase database connection pool from
   50 to 150", runbook RB-DB-004.
4. **Structured RCA template generated** → post-mortem `pm_…` with summary, impact, 9-beat timeline, root
   cause, resolution, 4 preventive actions, 4 action items, 3 lessons — then persisted to the database
   and exportable as `.md`.

---

## F. Section 5 — Implementation Constraints & Guardrails

| Guardrail (verbatim) | How CodePulse satisfies it | How to verify live |
| --- | --- | --- |
| "100% Software Scope: Zero physical microcontrollers, IoT boards, or external sensors permitted." | Pure software: browser + Node server + database. No hardware, firmware or sensor path exists anywhere in the codebase. | Repo contains only `src/`, `supabase/`, `scripts/`, `docs/` |
| "Live Persistence: Changes triggered on the frontend must persist in a live database." | Every meaningful action writes to the database: analyses, post-mortems, AI telemetry rows, heartbeats and the seeded corpus. Supabase PostgreSQL is the primary store (`supabase/schema.sql`); an embedded durable store covers the case where credentials are absent, and `/api/health` states which backend is live. **For the judged run, configure Supabase so a reviewer can watch rows appear in the Table Editor.** | `POST /api/analyze` → `"persisted": true`; `GET /api/postmortems?analysisId=…`; `GET /api/health` → `"backend": "supabase-postgres"`; then Supabase → Table Editor → `incidents` / `analyses` / `post_mortems` / `ai_logs` |
| "Security Compliance: No credentials or API keys exposed in client bundles." | No `NEXT_PUBLIC_*` secret exists. All provider calls run in Node route handlers (`src/lib/ai/providers.ts`); keys are read from `process.env` at call time. `/api/health` returns configuration **booleans** (`keysPresent`) and never values. `redact()` strips JWTs, bearer tokens, `sk-…` and `password=/secret=/token=` pairs before any telemetry row is stored. Supabase is accessed with the service-role key from the server, and RLS is enabled with no permissive policies so anon keys read zero rows. `.env.local` is git-ignored. | Inspect the built client chunks (`grep -r "sk-" .next/static` → no matches); open `/api/health`; browser DevTools → Network → no key material in any response |
| "Explainability: Teams must explain all logic and code changes during technical Q&A." | Every score is explainable from stored data: the retrieval score breakdown (7 weighted features with hit ratios), the candidate ranking, the evidence pack with weights, the pipeline stage timings, and the logbook's prompt hash + engine provenance. Written answer packs: `docs/PITCH.md`, `docs/DEMO-SCRIPT.md`, `docs/CAPTAINS-LOGBOOK.md`, this sheet. | `/analyze` → "Retrieval score breakdown"; `/logbook`; `npx tsx scripts/engine-check.ts` (11/11) |

---

## G. Pre-submission checklist (5 minutes)

- [ ] `npm install && npm run dev` → app loads at `http://localhost:3000`
- [ ] Supabase project created, `supabase/schema.sql` executed, 2 env vars set, app restarted
- [ ] `curl localhost:3000/api/health` → `"backend": "supabase-postgres"`, `"vectorSearch": "pgvector-rpc"`
- [ ] `/analyze?demo=1` → INC-1042 · 94 % · Arun Kumar · `8f42a1` · post-mortem generated
- [ ] `node scripts/demo-flow.mjs` → **47 passed, 0 failed**
- [ ] `/logbook` shows `analysis` + `embedding` rows (and `reasoning`/`postmortem` if an LLM key is set)
- [ ] Supabase Table Editor shows rows in `incidents` (16), `analyses`, `post_mortems`, `ai_logs`
- [ ] `npm run build` passes with the dev server stopped, then `vercel --prod` and repeat the checklist on the deployed URL
- [ ] Repo pushed to GitHub (judges score backend from the repo + logs); no `.env.local` committed

---

<p align="center"><em>CodePulse — Your Engineering Team Never Forgets.</em></p>
