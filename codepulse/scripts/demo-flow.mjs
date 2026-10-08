#!/usr/bin/env node
/**
 * CodePulse — end-to-end flow verification.
 *
 *   node scripts/demo-flow.mjs                       # against http://localhost:3000
 *   node scripts/demo-flow.mjs https://your.app      # against the deployed URL
 *
 * Walks the exact hackathon demo path and asserts every promise in the brief:
 *   paste stack trace → analyze → historical match → root cause → engineer/Git
 *   fix → evidence → post-mortem → saved to the database.
 */

const BASE = (process.argv[2] || process.env.CODEPULSE_URL || 'http://localhost:3000').replace(/\/$/, '');

const DEMO_TRACE = `ERROR 500
java.sql.SQLException:
Connection timed out
Unable to acquire JDBC connection
Pool exhausted
at PaymentService.java:142
Service: Payment API`;

let pass = 0;
let fail = 0;
const failures = [];

function check(label, condition, detail = '') {
  if (condition) {
    pass++;
    console.log(`  ✅ ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail++;
    failures.push(label);
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function json(path, init) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}: ${JSON.stringify(body).slice(0, 180)}`);
  return body;
}

const t0 = Date.now();
console.log(`\nCodePulse demo flow → ${BASE}\n`);

console.log('1 · Health & database');
const health = await json('/api/health');
check('service healthy', health.ok === true, health.app);
check('database reachable', health.database.incidents >= 12, `${health.database.incidents} incidents · ${health.database.label}`);
check('no API key exposed to client', health.ai.keyExposure.includes('none'), health.ai.engine);
check('vector search available', Boolean(health.database.vectorSearch), health.database.vectorSearch);

console.log('\n2 · Seed the historical corpus');
const seeded = await json('/api/seed', { method: 'POST' });
check('seed idempotent / populated', seeded.ok === true, `${seeded.incidents ?? verified} incidents stored`);
const incidents = await json('/api/incidents?limit=100');
check('≥12 historical incidents', incidents.total >= 12, `${incidents.total} incidents`);
const requiredClasses = [
  'Database connection pool exhaustion',
  'Upstream dependency timeout / latency cascade',
  'Redis cluster failover / cache connection failure',
  'JVM heap leak / OOMKilled under steady traffic',
  'Failed deployment / bad release rolled back',
  'Authentication / token verification failure',
  'CPU exhaustion / runaway worker loop',
  'Expired TLS certificate / handshake failure',
  'Message queue backlog / poison message',
];
const classes = new Set(incidents.facets.categories);
const missing = requiredClasses.filter((c) => !classes.has(c));
check('all required failure classes seeded', missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : `${classes.size} classes`);
check('repository search works', (await json('/api/incidents?q=redis')).incidents.length >= 1, 'query "redis"');
check('repository filters work', (await json('/api/incidents?severity=critical')).incidents.length >= 1, 'severity=critical');

console.log('\n3 · Analyze the challenge stack trace');
const analysis = await json('/api/analyze', {
  method: 'POST',
  body: JSON.stringify({ stackTrace: DEMO_TRACE, service: 'Payment API', environment: 'production' }),
});
const r = analysis.result;
check('analysis returned', analysis.ok === true, `in ${r.tookMs} ms`);
check('parsed the JDBC exception', /SQLException/.test(r.parsed.errorType), r.parsed.errorType);
check('HTTP 500 detected', r.parsed.httpStatus === '500', String(r.parsed.httpStatus));

console.log('\n4 · Historical match (vector similarity)');
check('matched INC-1042', r.match?.incidentId === 'INC-1042', r.match?.title);
check('similarity ≈ 94%', r.match && r.match.similarity >= 90 && r.match.similarity <= 96, `${r.match?.similarity}%`);
check('score split reported', Boolean(r.match?.scores?.breakdown?.length), `cosine ${r.match?.scores?.cosine} · rule ${r.match?.scores?.rule}`);
check('runner-up is the earlier recurrence', r.candidates?.[1]?.incidentId === 'INC-0994', `${r.candidates?.[1]?.incidentId} at ${r.candidates?.[1]?.similarity}%`);

console.log('\n5 · Root cause prediction');
check('root cause = database connection pool exhaustion', /database connection pool exhaustion/i.test(r.rootCause.title), r.rootCause.title);
check('severity critical', r.rootCause.severity === 'critical', r.rootCause.severity);
check('affected service', /payment api/i.test(r.rootCause.affectedService), r.rootCause.affectedService);
check('confidence ≥ 0.85', r.rootCause.confidence >= 0.85, `${(r.rootCause.confidence * 100).toFixed(1)}% (${r.rootCause.confidenceLabel})`);
check('contributing factors present', r.rootCause.contributingFactors.length >= 3, `${r.rootCause.contributingFactors.length} factors`);

console.log('\n6 · Engineer + Git fix correlation');
check('resolved by Arun Kumar', r.fix?.engineer?.name === 'Arun Kumar', `${r.fix?.engineer?.role}`);
check('commit 8f42a1', r.fix?.commit === '8f42a1', `${r.fix?.repo}@${r.fix?.commit}`);
check('historical fix wording', /increase database connection pool from 50 to 150/i.test(r.fix?.fixSummary ?? ''), r.fix?.fixSummary);
check('runbook attached', Boolean(r.fix?.runbook), r.fix?.runbook);
check('files touched listed', (r.fix?.files?.length ?? 0) >= 1, `${r.fix?.files?.length} files`);

console.log('\n7 · Evidence + explanation');
check('evidence pack built', r.evidence.length >= 5, `${r.evidence.length} items`);
check('explanation explains the match', r.explanation.length > 120, `${r.explanation.slice(0, 96)}…`);

console.log('\n8 · Post-mortem generation');
const pm = r.postMortem;
check('summary', pm.summary.length > 120);
check('impact', pm.impact.length > 80);
check('timeline', pm.timeline.length >= 5, `${pm.timeline.length} beats`);
check('root cause section', pm.rootCause.length > 60);
check('resolution section', pm.resolution.length > 60);
check('preventive actions', pm.preventiveActions.length >= 4, `${pm.preventiveActions.length}`);
check('lessons learned', pm.lessonsLearned.length >= 3, `${pm.lessonsLearned.length}`);
check('action items with owners', pm.actionItems.length >= 4, pm.actionItems.map((a) => `${a.priority}:${a.owner}`).join(', '));

console.log('\n9 · Persistence to the live database');
check('analysis persisted flag', r.persisted === true, r.dbBackend);
check('post-mortem persisted', pm.id?.startsWith('pm_'), pm.id);
const pmList = await json(`/api/postmortems?analysisId=${r.analysisId}`);
check('analysis retrievable from DB', pmList.postMortems.length >= 1, `${pmList.total} document(s) stored`);
const detail = await json('/api/incidents/INC-1042');
check('INC-1042 detail endpoint', detail.ok === true, `${detail.incident.evidence.length} evidence · ${detail.incident.timeline.length} timeline beats`);
check('reuse counter incremented', detail.reuse.timesRetrieved >= 1, `retrieved ${detail.reuse.timesRetrieved}×`);

console.log('\n10 · Dashboards & AI telemetry');
const dash = await json('/api/dashboard');
check('dashboard totals', dash.data.totals.incidents >= 12, `${dash.data.totals.incidents} incidents · ${dash.data.totals.critical} critical · ${dash.data.totals.recurring} recurring · avg MTTR ${dash.data.totals.avgMttr}m`);
check('dashboard trend series', dash.data.trend.length >= 14, `${dash.data.trend.length} days`);
const analytics = await json('/api/analytics');
check('analytics computed', analytics.data.services.length >= 5, `${analytics.data.services.length} services · ${analytics.data.categories.length} classes · heatmap ${analytics.data.heatmap.length} cells`);
const log = await json('/api/telemetry?limit=50');
check('AI telemetry logged', log.summary.total >= 2, `${log.summary.total} rows · kinds: ${log.summary.kinds.join(', ')}`);
check('prompt hash + redaction in telemetry', log.logs.every((l) => l.promptHash && l.promptPreview), log.logs[0]?.promptHash);
const beat = await json('/api/telemetry?force=1', { method: 'POST' });
check('10-minute heartbeat writable', beat.ok === true, `interval ${Math.round((beat.intervalMs ?? 0) / 60000)} min`);

console.log(`\n${'─'.repeat(72)}`);
console.log(`${fail === 0 ? '🎉 ALL CHECKS PASSED' : '⚠️  CHECKS FAILED'} — ${pass} passed, ${fail} failed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (fail) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(`  · ${f}`));
}
console.log(`\nDemo headline → ${r.match?.incidentId} · ${r.match?.similarity}% similarity · ${r.rootCause.title} · ${r.fix?.engineer?.name} · commit ${r.fix?.commit} · "${r.fix?.fixSummary}"\n`);
process.exit(fail === 0 ? 0 : 1);
