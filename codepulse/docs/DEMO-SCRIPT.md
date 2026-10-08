# CodePulse — 3-minute demo script (judge-ready)

**Pre-flight (do this once, before judging starts)**

```bash
npm install && npm run dev        # http://localhost:3000
open http://localhost:3000        # leave it on the dashboard
```
- Verify the sidebar footer shows **Supabase Postgres** (or *Embedded store*) and the chip in the
  top-right shows **PulseReasoner v1** (or your LLM model).
- Have `/analyze?demo=1` bookmarked — it loads the trace **and** runs the analysis in one click.
- Optional dry run: `node scripts/demo-flow.mjs` → 🎉 47/47 checks.

---

## 0:00 – 0:25 · Dashboard (the posture)

**Say:** *“CodePulse is the memory layer for incident response. On the left, everything the team
has already survived: 16 incidents, 5 critical, 5 recurring classes, average resolution 38
minutes. This gauge is the reliability posture; the feed underneath is generated from the live
corpus, not hard-coded.”*

**Click:** scroll once to show the trend chart, severity donut, root-cause distribution and the
recurrence watchlist (**“Database connection pool exhaustion keeps coming back”**).

## 0:25 – 0:45 · The problem

**Say:** *“Every one of these was solved once. The knowledge lives in a Slack thread, a Jira
ticket, one engineer's memory. So the next engineer re-derives the same root cause from scratch.
CodePulse turns every RCA into retrievable memory.”*

## 0:45 – 1:10 · Paste the trace

**Click:** **Analyze Incident** in the sidebar → paste (or hit the *JDBC pool exhaustion* sample):

```
ERROR 500
java.sql.SQLException:
Connection timed out
Unable to acquire JDBC connection
Pool exhausted
at PaymentService.java:142
Service: Payment API
```

Service `Payment API`, environment `production` → **Analyze Incident**.

**Say:** *“Nine server-side steps: parse → embed into 384 dimensions → vector search → hybrid
re-rank → RCA → fix correlation → explanation → post-mortem → persist.”* (staged pipeline animates).

## 1:10 – 1:45 · The match (the money shot)

**Say as it lands:**
- **“94% similarity to INC-1042.”** Show the split: cosine 70.9 % × rule-engine 88.9 % hybrid.
- **Runner-up INC-0994 at 91.8 %** — *“the earlier occurrence of the same class, exactly what a
  real retrieval system should surface.”*
- Open the score breakdown: class signals, exception class, weighted keyword overlap, error
  signature, service identity, environment, tags — each with a weight and a hit ratio.

## 1:45 – 2:10 · Root cause + who fixed it

**Say:** *“Root cause: **Database connection pool exhaustion**. Confidence 94 %, severity
critical, affected service Payment API. Contributing factors come from the historical RCA:
pool sized at 50 while concurrency tripled, a long-running settlement transaction holding
connections, no circuit breaker.”*

**Point at Error → Fix correlation chain:** Error → INC-1042 → root cause → **Arun Kumar** →
**commit `8f42a1`** → resolution.
*“Arun solved this in 47 minutes. The fix was literally **“Increase database connection pool from
50 to 150”** — runbook RB-DB-004. Here are the four files he touched.”*

## 2:10 – 2:35 · Evidence + post-mortem

**Say:** *“Eight weighted evidence items — trace fingerprint, class signals, retrieved memory,
recurrence statistics, the fix, historical telemetry vs today's.”*

**Scroll to the post-mortem:** *“Generated, not templated: summary, impact, a nine-beat timeline,
root cause, resolution, four preventive actions, four action items with owners and due dates,
three lessons learned. Blameless, engineering-grade.”*

**Click:** **Export .md** (downloads) → **Regenerate & save** (writes a new row to the DB).

## 2:35 – 2:55 · It persisted, and it's auditable

**Click:** sidebar → **Captain’s Logbook**. *“Every AI interaction is logged with a SHA-256
prompt hash, latency, token estimate, provider and a fallback flag — plus a heartbeat every ten
minutes. Secrets are redacted before the write. This is the telemetry requirement, live.”*

**Click:** **Incident Memory** → search `redis` → open **INC-1036** → *“full incident page:
stack trace, evidence, timeline, fix, related memory, and how many times the memory has been
reused.”*

## 2:55 – 3:00 · Close

**Say:** *“One analysis, 30 milliseconds, fully offline — and the next engineer who sees this
trace gets the answer in seconds instead of 47 minutes. **CodePulse — your engineering team
never forgets.**”*

---

## Backup plans (never lose the demo)

| Risk | Mitigation |
| --- | --- |
| Supabase flaky / not configured | The app auto-falls back to the embedded durable store and the sidebar says so. Every feature keeps working. |
| No LLM key | PulseReasoner produces the same match, numbers and document structure. The run-details panel states the engine. |
| LLM slow or erroring | 14 s timeout → automatic degradation to PulseReasoner, surfaced in `warnings`. |
| Judge asks “is the match faked?” | Open **Retrieval score breakdown** (weights + hits), the **candidate list** with runner-ups, and run `npx tsx scripts/engine-check.ts` — 11 independent cases route correctly, including a *nonsense trace that correctly refuses to match*. |
| Judge asks “is it really stored?” | `curl localhost:3000/api/postmortems?analysisId=… ` or check Supabase Table Editor; `/api/health` shows the row counts. |

## Answers to the questions judges actually ask

- **How is similarity computed?** Signed-hash 384-d embeddings (domain keyword boosting + char
  4-grams), L2-normalised; cosine blended 55/45 with a rule engine; the blend is mapped through a
  calibrated monotone curve fitted against the corpus (0.79 composite → 94 %).
- **Where is pgvector used?** `vector(384)` column + `ivfflat` cosine index + `match_incidents()`
  RPC; the app prefers the RPC and falls back to in-process cosine over the same vectors.
- **What if there is no historical match?** The threshold refuses the match, the run is stored as
  a novel failure mode and a fresh post-mortem scaffold is generated — so *this* incident becomes
  memory for the next engineer.
- **Why not just ask an LLM?** An LLM alone cannot know your team's history, the engineer's name,
  the commit hash or the verified fix. Retrieval provides ground truth; the LLM (optional) only
  improves prose.
