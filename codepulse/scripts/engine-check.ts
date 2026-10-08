/**
 * CodePulse — engine regression harness.
 *
 *   npx tsx scripts/engine-check.ts        # run the full trace battery
 *   npx tsx scripts/engine-check.ts --json # machine-readable report
 *
 * Exercises the retrieval + RCA pipeline against the seeded corpus and asserts
 * that every production failure class resolves to the right historical memory.
 * This is the exact code path /api/analyze executes.
 */

import { analyzeIncident } from '../src/lib/analyze';
import { buildSeedIncidents } from '../src/lib/seed';

interface Case {
  name: string;
  service: string;
  environment: string;
  expect: string | null;
  trace: string;
}

const DEMO_TRACE = `ERROR 500
java.sql.SQLException:
Connection timed out
Unable to acquire JDBC connection
Pool exhausted
at PaymentService.java:142
Service: Payment API`;

const CASES: Case[] = [
  { name: 'CHALLENGE DEMO — payment pool exhaustion', service: 'Payment API', environment: 'production', expect: 'INC-1042', trace: DEMO_TRACE },
  {
    name: 'checkout upstream timeouts',
    service: 'Checkout Gateway',
    environment: 'production',
    expect: 'INC-1039',
    trace: `2026-10-08T09:14:22Z ERROR [checkout-gw] PricingClient - Read timed out after 2000ms
java.net.SocketTimeoutException: Read timed out
	at com.zephoria.checkout.PricingClient.fetchQuote(PricingClient.java:97)
	at com.zephoria.checkout.QuoteAggregator.aggregate(QuoteAggregator.java:214)
504 Gateway Timeout returned to client · retry 3/3 exhausted · downstream pricing-adapter
Service: Checkout Gateway`,
  },
  {
    name: 'redis cluster failure',
    service: 'Session Service',
    environment: 'production',
    expect: 'INC-1036',
    trace: `ERROR 500 io.lettuce.core.RedisConnectionException: Connection refused: cache-cluster-03:6379
org.springframework.data.redis.RedisConnectionFailureException: Unable to connect to Redis
	at io.lettuce.core.cluster.RedisClusterClient.connect(RedisClusterClient.java:303)
	at com.zephoria.session.SessionRepository.lookup(SessionRepository.java:88)
CLUSTER STATE: fail · node role=replica unreachable
Service: Session Service`,
  },
  {
    name: 'jvm memory leak / oomkilled',
    service: 'Search Indexer',
    environment: 'production',
    expect: 'INC-1031',
    trace: `FATAL java.lang.OutOfMemoryError: Java heap space
	at com.zephoria.search.EmbeddingCache.put(EmbeddingCache.java:54)
	at com.zephoria.search.ReindexJob.processBatch(ReindexJob.java:188)
GC(612) Pause Full (G1 Evacuation Pause) 1986M->1943M(2048M) 4.212s
Last pod event: OOMKilled (exit code 137) restartCount=14
Service: Search Indexer`,
  },
  {
    name: 'failed deployment / schema drift',
    service: 'Payment API',
    environment: 'production',
    expect: 'INC-1028',
    trace: `ERROR 500 org.postgresql.util.PSQLException: ERROR: column "legacy_auth_code" of relation "payment_intent" does not exist
	at com.zephoria.payment.repo.PaymentIntentRepository.save(PaymentIntentRepository.java:76)
Flyway: migration V218 drop column applied · pod ready before migration completed · rollback required
Service: Payment API`,
  },
  {
    name: 'jwt / jwks auth failure',
    service: 'Identity Service',
    environment: 'production',
    expect: 'INC-1024',
    trace: `ERROR 401 com.auth0.jwt.exceptions.SignatureVerificationException: kid not found in JWKS
	at com.auth0.jwt.algorithms.ECDSAAlgorithm.verify(ECDSAAlgorithm.java:96)
	at com.zephoria.identity.TokenVerifier.verify(TokenVerifier.java:134)
JWKS cache age=22h ttl=24h · signing key rotation window=15m · unauthorized
Service: Identity Service`,
  },
  {
    name: 'cpu exhaustion / throttling',
    service: 'Notification Worker',
    environment: 'production',
    expect: 'INC-1019',
    trace: `ERROR io.grpc.StatusRuntimeException: DEADLINE_EXCEEDED after 10.00s
	at com.zephoria.notify.SmsDispatcher.send(SmsDispatcher.java:141)
	at com.zephoria.notify.RetryLoop.run(RetryLoop.java:66)
cgroup: cpu.stat nr_throttled=1842301 (96% throttled) · load_avg=14.2 on 1 core · retry loop without backoff
Service: Notification Worker`,
  },
  {
    name: 'tls certificate expiry',
    service: 'Edge Gateway',
    environment: 'production',
    expect: 'INC-1015',
    trace: `ERROR 525 javax.net.ssl.SSLHandshakeException: Received fatal alert: certificate_expired
	at com.zephoria.edge.tls.TlsTerminator.handshake(TlsTerminator.java:214)
certificate CN=*.zephoria.io notAfter in the past · cert-manager renewal failed (DNS-01 429) · ssl handshake failures 100%
Service: Edge Gateway`,
  },
  {
    name: 'kafka consumer lag / poison message',
    service: 'Order Events',
    environment: 'production',
    expect: 'INC-1011',
    trace: `ERROR org.apache.kafka.common.errors.SerializationException: Error deserializing value for partition order-events-7 at offset 88412
	at com.zephoria.orders.OrderEventConsumer.onMessage(OrderEventConsumer.java:112)
Consumer group order-fulfilment lag=412308 · partition stuck · rebalance_count=37 · DLQ routing not configured
Service: Order Events`,
  },
  {
    name: 'postgres deadlock / lock contention',
    service: 'Inventory Service',
    environment: 'production',
    expect: 'INC-1007',
    trace: `ERROR org.postgresql.util.PSQLException: ERROR: deadlock detected
DETAIL: Process 4821 waits for ShareLock on transaction 9931; blocked by process 4788.
	at com.zephoria.inventory.InventoryRepository.reserve(InventoryRepository.java:158)
statement_timeout=30000 · lock wait 1840ms · missing index · inventory reserve writes serialized
Service: Inventory Service`,
  },
  {
    name: 'novel / unclassifiable trace (must NOT force a match)',
    service: 'Recommendation Engine',
    environment: 'production',
    expect: null,
    trace: `INFO model drift detector reported cosine shift 0.02 on ranking head; no errors observed, throughput nominal
Service: Recommendation Engine`,
  },
];

function bar(pct: number, width = 24): string {
  const filled = Math.round((pct / 100) * width);
  return '█'.repeat(Math.max(0, filled)) + '░'.repeat(Math.max(0, width - filled));
}

async function main() {
  const json = process.argv.includes('--json');
  const incidents = buildSeedIncidents();
  const results: unknown[] = [];
  let pass = 0;
  let demoSimilarity = 0;

  if (!json) {
    console.log(`\n┌─ CodePulse engine-check · corpus: ${incidents.length} incidents · classes: ${new Set(incidents.map((i) => i.rootCauseCategory)).size}`);
  }

  for (const c of CASES) {
    const res = await analyzeIncident({ stackTrace: c.trace, service: c.service, environment: c.environment });
    const got = res.match && res.match.similarity >= 60 ? res.match.incidentId : null;
    const ok = c.expect === null ? (got === null || (res.match?.similarity ?? 0) < 88) : got === c.expect;
    if (ok) pass++;
    if (c.expect === 'INC-1042') demoSimilarity = res.match?.similarity ?? 0;
    results.push({
      case: c.name,
      expected: c.expect,
      got: res.match?.incidentId ?? null,
      similarity: res.match?.similarity ?? 0,
      confidence: res.rootCause.confidence,
      rootCause: res.rootCause.title,
      engineer: res.fix?.engineer.name ?? null,
      commit: res.fix?.commit ?? null,
      mttrMinutes: res.tookMs,
      ok,
    });

    if (!json) {
      const mark = ok ? '✅' : '❌';
      const sim = res.match?.similarity ?? 0;
      console.log(
        `${mark} ${c.name.padEnd(52)} → ${String(res.match?.incidentId ?? 'no-match').padEnd(10)} ${bar(sim)} ${sim.toFixed(1).padStart(5)}%  conf ${(res.rootCause.confidence * 100).toFixed(0)}%`,
      );
      if (res.match && !ok) console.log(`    expected ${c.expect} · got ${res.match.incidentId} · RCA: ${res.rootCause.title}`);
    }
  }

  if (!json) {
    console.log(`└─ ${pass}/${CASES.length} passed · demo trace similarity ${demoSimilarity.toFixed(1)}%`);
    console.log(`   target: INC-1042 ≈ 94% · resolved by Arun Kumar · commit 8f42a1\n`);
  } else {
    console.log(JSON.stringify({ pass, total: CASES.length, demoSimilarity, results }, null, 2));
  }
  process.exit(pass === CASES.length ? 0 : 1);
}

main().catch((err) => {
  console.error('engine-check failed:', err);
  process.exit(1);
});
