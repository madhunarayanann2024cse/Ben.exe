# Captain's Logbook — AI prompt telemetry & logging integrity

Hackathon rule: *“AI prompt telemetry must be logged every 10 minutes.”*
CodePulse treats that as a first-class product surface, not a compliance chore.

---

## 1. Where it lives

| Layer | Detail |
| --- | --- |
| Table | `ai_logs` (Supabase PostgreSQL) — or the embedded durable store when Supabase is not configured |
| Writer | `src/lib/telemetry.ts → logAi()` — the single choke point every AI interaction passes through |
| UI | `/logbook` — filter by kind, expand any row to read the redacted prompt + model output, export the whole logbook as JSON |
| Heartbeat | Browser timer posts `/api/telemetry` every `NEXT_PUBLIC_TELEMETRY_INTERVAL_MS` (default 600 000 ms = 10 min); the server rate-limits to one row per minute so multiple tabs cannot spam the table |

## 2. What every row records

| Column | Purpose |
| --- | --- |
| `kind` | `analysis` · `reasoning` · `postmortem` · `embedding` · `heartbeat` · `seed` |
| `provider`, `model` | which engine answered (real provenance, not a guess) |
| `fallback` | `true` = deterministic PulseReasoner answered, `false` = LLM answered |
| `latency_ms`, `tokens_est` | cost/latency accounting per interaction |
| `prompt_hash` | SHA-256 of the full (system + user) prompt, truncated to 16 hex chars — lets judges verify two runs used identical prompts without storing anything sensitive twice |
| `prompt_preview` / `prompt_full` | the composed prompt, **redacted**, capped at 220 / 4000 chars |
| `output_preview` | model output or the structured deterministic verdict |
| `analysis_id`, `metadata` | join key back to the analysis + stage/back-end/similarity context |

## 3. Redaction (secrets never reach the database)

`redact()` in `src/lib/ai/providers.ts` runs on **every** stored prompt and output:

```
sk-…                 → sk-***redacted***
Bearer <token>       → Bearer ***redacted***
eyJ… (JWT)           → ***jwt-redacted***
password=/secret=/token=/api_key=  → <key>=***redacted***
```

Keys are read from `process.env` at call time inside Node.js route handlers, never referenced
with a `NEXT_PUBLIC_` prefix, and never returned by any endpoint. `GET /api/health` reports only
`keysPresent: { openai: false, gemini: false, anthropic: false }` style booleans.

## 4. Live snapshot (captured from `/api/telemetry`)

```json
{
  "provider": { "provider": "pulsereasoner", "model": "pulse-reasoner-v1", "live": false },
  "summary": { "total": 4, "heartbeats": 2, "intervalMs": 600000, "kinds": ["heartbeat", "embedding", "analysis"] },
  "logs": [
    {
      "kind": "analysis", "provider": "pulsereasoner", "model": "pulse-reasoner-v1",
      "fallback": true, "latencyMs": 0, "tokensEst": 985,
      "promptHash": "7fee9e27742485f8",
      "promptPreview": "You are CodePulse, a principal SRE and root-cause analyst …",
      "outputPreview": "{ \"engine\": \"pulsereasoner\", \"matchedIncident\": \"INC-1042\", \"similarity\": 94.1, \"rootCause\": \"Database connection pool exhaustion\", \"confidence\": 0.941, \"severity\": \"critical\", \"correlatedFix\": { \"engineer\": \"Arun Kumar\", \"commit\": \"8f42a1\" } … }",
      "metadata": { "stage": "analysis-complete", "matchedIncident": "INC-1042", "similarity": 94.1, "persisted": true, "vectorSearch": "in-process-cosine" }
    },
    {
      "kind": "embedding", "provider": "pulsereasoner", "model": "pulse-hash-384",
      "latencyMs": 0, "tokensEst": 36, "promptHash": "d319c8cbbcfc9ebe",
      "outputPreview": "vector[384] · l2_norm=1.0 · retrieval=in-process-cosine",
      "metadata": { "dims": 384, "backend": "in-process-cosine", "signals": 16 }
    },
    {
      "kind": "heartbeat", "provider": "pulsereasoner", "model": "pulse-reasoner-v1",
      "latencyMs": 0, "tokensEst": 145, "promptHash": "4d83644a9d4d4925",
      "outputPreview": "heartbeat logged · provider=pulsereasoner · model=pulse-reasoner-v1",
      "metadata": { "heartbeatIntervalMs": 600000 }
    },
    {
      "kind": "reasoning", "provider": "openai", "model": "gpt-4o-mini",
      "fallback": false, "latencyMs": 1841, "tokensEst": 1284,
      "promptHash": "<sha256/16>",
      "note": "row appears only when an LLM key is configured — shows provider, real latency, tokens and the model's JSON verdict"
    }
  ]
}
```

## 5. How to demonstrate logging integrity to a judge

1. Open `/logbook` — point out the **Engine provenance** panel (provider, model, redaction state).
2. Run an analysis from `/analyze?demo=1`, come back to `/logbook`, hit refresh — four new rows
   appear (`analysis`, `embedding`, plus `reasoning` + `postmortem` when an LLM key is set).
3. Expand the `analysis` row: judges can read the composed SRE prompt and the structured verdict.
4. Click **Write heartbeat now** → a fresh row is appended live, proving the 10-minute cadence
   writes are real database rows.
5. Click **Export JSON** → hand over the full logbook.
6. `curl https://<your-app>/api/health` → shows `ai.keysPresent`, engine and row counts with zero
   key material in the response.

## 6. Why this design (for the interview)

- **Auditability over vanity:** a hash + redacted prompt proves what was sent without leaking it.
- **Provenance:** `fallback` makes it impossible to mistake deterministic reasoning for an LLM
  answer, so a judge (or an incident reviewer) always knows which engine produced the RCA.
- **Cost visibility:** latency and token estimates per interaction are the raw material for the
  “AI-assisted MTTR” number shown in Analytics.
- **Compliance-friendly:** one choke point (`logAi`) means retention policy, PII scrubbing or an
  export to S3 can be added in one place later.
