/**
 * CodePulse — seed corpus.
 * 16 production incidents spanning every failure class required by the brief:
 * database connection failures, API timeouts, Redis failures, memory leaks,
 * failed deployments, authentication errors, CPU exhaustion, certificate
 * failures and message-queue problems.
 *
 * Dates are generated relative to seed time so the dashboard always looks live.
 */

import type { Incident, TimelineEvent, Severity, Engineer, Environment, IncidentStatus } from './types';
import { CATEGORY_BY_KEY } from './taxonomy';
import { embed, tokenize } from './vector';

const DAY = 86_400_000;

function iso(msAgo: number): string {
  return new Date(Date.now() - msAgo).toISOString();
}

function daysAgo(d: number, h = 0, m = 0): string {
  return iso(d * DAY + h * 3_600_000 + m * 60_000);
}

function at(base: string, minutes: number): string {
  return new Date(new Date(base).getTime() + minutes * 60_000).toISOString();
}

export const ENGINEERS: Record<string, Engineer> = {
  arun: { name: 'Arun Kumar', role: 'Senior Backend Engineer', team: 'Payments Platform', handle: '@arun.k', hue: 214 },
  meera: { name: 'Meera Nair', role: 'Staff SRE', team: 'Reliability', handle: '@meera.n', hue: 268 },
  vikram: { name: 'Vikram Shah', role: 'Platform Engineer', team: 'Core Infrastructure', handle: '@vikram.s', hue: 176 },
  priya: { name: 'Priya Raghavan', role: 'Database Reliability Engineer', team: 'Data Platform', handle: '@priya.r', hue: 292 },
  sameer: { name: 'Sameer Qureshi', role: 'Security Engineer', team: 'Identity & Access', handle: '@sameer.q', hue: 340 },
  divya: { name: 'Divya Menon', role: 'Senior SRE', team: 'Reliability', handle: '@divya.m', hue: 32 },
  rahul: { name: 'Rahul Verma', role: 'Infrastructure Lead', team: 'Edge & Networking', handle: '@rahul.v', hue: 196 },
};

type TimelineSpec = [number, TimelineEvent['kind'], string, string];

interface SeedSpec {
  id: string;
  title: string;
  service: string;
  environment: Environment;
  severity: Severity;
  status: IncidentStatus;
  detectedAt: string;
  mttrMinutes: number;
  recurring?: boolean;
  recurrenceCount?: number;
  category: string;
  rootCauseTitle: string;
  summary: string;
  errorType: string;
  errorMessage: string;
  stackTrace: string;
  evidence: string[];
  impact: string;
  resolution: string;
  owner: Engineer;
  fix: {
    commit: string;
    repo: string;
    branch: string;
    pr: string;
    message: string;
    files: string[];
    diffSummary: string;
  };
  related?: string[];
  tags: string[];
  telemetry: Incident['telemetry'];
  timeline: TimelineSpec[];
  resolutionSteps?: string[];
  preventiveActions?: string[];
  lessonsLearned?: string[];
}

const SPECS: SeedSpec[] = [
  /* ────────────────────────── INC-1042 · the demo anchor ───────────────────── */
  {
    id: 'INC-1042',
    title: 'Payment API — HikariCP pool exhausted, 500s on charge endpoint',
    service: 'Payment API',
    environment: 'production',
    severity: 'critical',
    status: 'resolved',
    detectedAt: daysAgo(6, 2, 15),
    mttrMinutes: 47,
    recurring: true,
    recurrenceCount: 2,
    category: 'db_pool_exhaustion',
    rootCauseTitle: 'Database connection pool exhaustion',
    summary:
      'A traffic step-change after the flash-sale campaign tripled concurrent payment workers while the HikariCP pool stayed pinned at 50 connections. Connections were held by a long-running settlement transaction, so every new charge request waited past the 30s connection timeout and failed with HTTP 500 on PaymentService.java:142.',
    errorType: 'java.sql.SQLTransientConnectionException',
    errorMessage: 'HikariPool-1 - Connection is not available, request timed out after 30000ms. Unable to acquire JDBC connection. Pool exhausted.',
    stackTrace: `2026-10-02T04:41:07.882Z ERROR [payment-api,9f3c1d2a8b4e6f01] 1 --- [nio-8080-exec-217] c.z.payment.PaymentService : Charge authorisation failed
org.springframework.jdbc.CannotGetJdbcConnectionException: Failed to obtain JDBC Connection
	at org.springframework.jdbc.datasource.DataSourceUtils.getConnection(DataSourceUtils.java:82)
	at org.springframework.jdbc.core.JdbcTemplate.execute(JdbcTemplate.java:376)
	at com.zephoria.payment.PaymentService.authoriseCharge(PaymentService.java:142)
	at com.zephoria.payment.web.ChargeController.post(ChargeController.java:88)
Caused by: java.sql.SQLTransientConnectionException: HikariPool-1 - Connection is not available, request timed out after 30000ms.
	at com.zaxxer.hikari.pool.HikariPool.getConnection(HikariPool.java:147)
Caused by: java.sql.SQLException: Connection timed out
	at org.postgresql.core.v3.ConnectionFactoryImpl.openConnectionImpl(ConnectionFactoryImpl.java:347)
HikariPool-1 - Pool stats (total=50, active=50, idle=0, waiting=213)
HikariPool-1 - Unable to acquire JDBC connection for thread [nio-8080-exec-217]
Service: Payment API · env=production · region=ap-south-1`,
    evidence: [
      'HikariPool-1 pool stats show total=50, active=50, idle=0, waiting=213 at the moment of failure',
      '213 threads queued for a connection — concurrency grew 3.1x while maximumPoolSize stayed at 50',
      'pg_stat_activity showed 11 sessions "idle in transaction" for > 90s, matching the settlement batch window',
      'Error rate map aligned 1:1 with payment-worker replica count (18 → 54 pods), proving the pool was the constraint',
      'Identical signature observed in INC-0994 (pool 25 → 50) — same class, larger blast radius',
    ],
    impact:
      '47 minutes of degraded charging: 18,420 charge attempts failed with HTTP 500, an estimated ₹3.1 Cr of GMV deferred and 4,812 settlement webhooks parked in the retry queue. Refund and balance-read paths stayed healthy because they use the read replica.',
    resolution:
      'Raised maximumPoolSize 50 → 150 with connectionTimeout 5s, killed the long-running settlement transaction, added bounded retry with jitter and replayed the webhook backlog.',
    owner: ENGINEERS.arun,
    fix: {
      commit: '8f42a1',
      repo: 'zephoria/payment-api',
      branch: 'fix/pool-size-150',
      pr: '#2291',
      message: 'fix(db): raise HikariCP maximumPoolSize 50→150, fail-fast 5s timeout, add jittered acquire retry',
      files: [
        'src/main/resources/application-prod.yml',
        'src/main/java/com/zephoria/payment/config/DataSourceConfig.java',
        'src/main/java/com/zephoria/payment/PaymentService.java',
        'src/test/java/com/zephoria/payment/PoolSaturationIT.java',
      ],
      diffSummary:
        'application-prod.yml: maximum-pool-size 50 → 150, connection-timeout 30000 → 5000, leak-detection-threshold 10000 added. DataSourceConfig.java: + RetryTemplate(3 attempts, exp backoff 120ms + jitter). PaymentService.java: acquisition wrapped in circuit breaker; settlement batch moved to a dedicated 8-connection pool.',
    },
    related: ['INC-0994', 'INC-0981'],
    tags: ['jdbc', 'hikaricp', 'connection-pool', 'payments', 'saturation', 'postgres'],
    telemetry: {
      peakErrorRate: '38.4% of charge requests (HTTP 500)',
      p99Latency: '30,412 ms (connection acquisition timeout)',
      affectedUsers: 18_420,
      errorBudgetBurn: '11.8x for the 47-minute window',
    },
    timeline: [
      [0, 'detect', 'Alert: payment_api_5xx_rate > 5%', 'Grafana alert CP-PAY-01 paged the on-call rotation at 38.4% 5xx.'],
      [3, 'triage', 'Arun Kumar claims incident', 'Confirmed pool saturation from Hikari metrics; read path unaffected.'],
      [9, 'action', 'Pool raised 50 → 150 (rolling restart)', 'Rolling restart of payment workers, connection-timeout cut to 5s to fail fast.'],
      [21, 'action', 'Long-running transaction terminated', 'pg_terminate_backend on 11 idle-in-transaction sessions from the settlement batch.'],
      [34, 'resolve', 'Error rate back under 0.5%', 'Traffic recovered; DLQ replay of 4,812 webhooks started in throttled batches.'],
      [47, 'note', 'MTTR 47m · commit 8f42a1 merged', 'Fix promoted to production; pool-saturation IT added to CI.'],
    ],
  },

  /* ────────────────────────────── INC-1039 · API timeout ──────────────────── */
  {
    id: 'INC-1039',
    title: 'Checkout Gateway — pricing service read timeouts triggered retry storm',
    service: 'Checkout Gateway',
    environment: 'production',
    severity: 'high',
    status: 'resolved',
    detectedAt: daysAgo(5, 7, 40),
    mttrMinutes: 38,
    recurring: true,
    recurrenceCount: 1,
    category: 'upstream_timeout',
    rootCauseTitle: 'Upstream pricing adapter missed promise SLA — retry amplification',
    summary:
      'The pricing adapter released by the Catalog squad answered in 4.8s p99 against a 2s caller budget. Checkout retried 3x per request, converting a slow dependency into a self-inflicted DDoS and pushing gateway 504s to 9.4%.',
    errorType: 'java.net.SocketTimeoutException',
    errorMessage: 'Read timed out after 2000ms calling pricing-adapter:8080/v2/quote (attempt 3 of 3)',
    stackTrace: `2026-10-03T11:22:45.019Z WARN [checkout-gw,3a71c9be21d4f509] 1 --- [reactor-http-epoll-14] c.z.checkout.PricingClient : Read timed out
java.net.SocketTimeoutException: Read timed out after 2000ms
	at java.base/sun.nio.ch.Net.poll(Net.java:122)
	at reactor.netty.http.client.HttpClientConnect$MonoHttpConnect.lambda$subscribe$0(HttpClientConnect.java:276)
	at com.zephoria.checkout.PricingClient.fetchQuote(PricingClient.java:97)
	at com.zephoria.checkout.QuoteAggregator.aggregate(QuoteAggregator.java:214)
	at com.zephoria.checkout.web.CheckoutController.summary(CheckoutController.java:131)
Retry 3/3 exhausted in 6.4s · downstream= pricing-adapter · deadline_budget=2000ms · observed_p99=4800ms
HTTP 504 Gateway Timeout returned to client (9.4% of window)
Service: Checkout Gateway · env=production`,
    evidence: [
      'pricing-adapter p99 latency 4,800ms vs 2,000ms caller deadline (SLA breach of 2.4x)',
      'Retry count 3/3 with no jitter multiplied inbound load 2.7x during the breach',
      'No circuit breaker on PricingClient — every slow response was retried instead of shed',
      'Load shed curve matches retry timeline within 15s, proving amplification was self-inflicted',
    ],
    impact:
      'Checkout summaries degraded for 38 minutes; 9.4% of sessions saw gateway timeouts, mobile conversion fell 6.1% versus the same hour last week and 1,930 carts were abandoned mid-checkout.',
    resolution:
      'Aligned deadlines to the caller budget (1.5s client read timeout), enabled Resilience4j circuit breaker at 50% failure rate and capped retries at 2 with exponential jitter.',
    owner: ENGINEERS.meera,
    fix: {
      commit: 'c21d904',
      repo: 'zephoria/checkout-gateway',
      branch: 'fix/deadline-budget',
      pr: '#2274',
      message: 'fix(upstream): align pricing deadlines to caller budget, add CB + jittered retry cap',
      files: [
        'src/main/resources/application.yml',
        'src/main/java/com/zephoria/checkout/PricingClient.java',
        'src/main/java/com/zephoria/checkout/QuoteAggregator.java',
      ],
      diffSummary:
        'response-timeout 2000 → 1500ms, retry.maxAttempts 3 → 2, retry.jitter added; Resilience4j circuit breaker (failureRateThreshold 50, slidingWindow 20, waitDurationInOpenState 10s) registered on PricingClient with a per-tenant bulkhead.',
    },
    related: ['INC-0990'],
    tags: ['timeout', 'latency', 'circuit-breaker', 'checkout', 'retry-storm'],
    telemetry: {
      peakErrorRate: '9.4% HTTP 504 at the gateway',
      p99Latency: '6,400 ms end-to-end (retries included)',
      affectedUsers: 27_600,
      errorBudgetBurn: '3.4x for 38 minutes',
    },
    timeline: [
      [0, 'detect', 'Gateway 504 alert CP-CHK-07', 'p99 crossed 4s; Pages fired to Checkout on-call.'],
      [6, 'triage', 'Confirmed upstream pricing breach', 'Pricing p99 4.8s with no circuit breaker on the client.'],
      [14, 'action', 'Circuit breaker enabled (canary 10%)', 'Failure rate 61% above the 50% threshold; breaker opened.'],
      [27, 'action', 'Retries capped at 2 with jitter', 'Load shed restored; 504s fell to 1.1%.'],
      [38, 'resolve', 'Deadline budget enforced in prod', 'p99 940ms; error budget consumption stopped.'],
    ],
  },

  /* ────────────────────────────── INC-1036 · Redis ────────────────────────── */
  {
    id: 'INC-1036',
    title: 'Session Service — Redis cluster failover wiped session lookups',
    service: 'Session Service',
    environment: 'production',
    severity: 'high',
    status: 'resolved',
    detectedAt: daysAgo(5, 1, 5),
    mttrMinutes: 29,
    category: 'redis_failure',
    rootCauseTitle: 'Redis cluster failover with fixed-interval client retries',
    summary:
      'A managed cache node was failed over during a maintenance window with no client drain. Lettuce retried every 50ms, saturating the remaining nodes, while the lack of an L1 cache sent 38% of authenticated traffic straight into the primary database.',
    errorType: 'org.springframework.data.redis.RedisConnectionFailureException',
    errorMessage: 'Unable to connect to Redis; nested exception is io.lettuce.core.RedisConnectionException: Connection refused: cache-cluster-03:6379',
    stackTrace: `2026-10-03T17:04:12.551Z ERROR [session-svc,7d21ab9f30c5e4aa] 1 --- [lettuce-nioEventLoop-4-1] o.s.d.r.c.RedisConnectionFailureException :
Unable to connect to Redis; nested exception is io.lettuce.core.RedisConnectionException
io.lettuce.core.RedisConnectionException: Connection refused: cache-cluster-03:6379
	at io.lettuce.core.protocol.RedisCommandHandler.write(RedisCommandHandler.java:159)
	at io.lettuce.core.cluster.RedisClusterClient.connect(RedisClusterClient.java:303)
	at com.zephoria.session.SessionRepository.lookup(SessionRepository.java:88)
	at com.zephoria.session.AuthFilter.doFilter(AuthFilter.java:61)
CLUSTER STATE: fail · slots_assigned=15234/16384 · node cache-cluster-03 role=replica→unreachable
Retry budget exhausted: 118 retries in 5.9s (fixed 50ms interval, no jitter)
Service: Session Service · env=production`,
    evidence: [
      '118 client retries in 5.9s at a fixed 50ms interval — retry fan-out saturated healthy nodes',
      'Cluster state fail with 1,150 slots unmapped; replica promotion took 12s',
      'Database CPU climbed 41% → 91% as session misses fell through to Postgres',
      'No L1 in-process cache existed, so a cache outage became a database outage',
    ],
    impact:
      '29 minutes of elevated authentication latency; 12,400 users experienced 401-then-retry flows, session-bound checkout dropped 4.7% and the primary database absorbed an extra 41k queries/min.',
    resolution:
      'Restored cluster topology, replaced fixed-interval retries with exponential backoff + jitter, cut command timeout to 250ms and deployed an L1 Caffeine cache for hot session keys.',
    owner: ENGINEERS.vikram,
    fix: {
      commit: '4b7e35f',
      repo: 'zephoria/session-service',
      branch: 'fix/redis-topology-backoff',
      pr: '#2268',
      message: 'fix(cache): topology-aware Lettuce backoff + L1 Caffeine cache for session keys',
      files: [
        'src/main/java/com/zephoria/session/config/RedisConfig.java',
        'src/main/java/com/zephoria/session/SessionRepository.java',
        'deploy/k8s/session-svc-pdb.yaml',
      ],
      diffSummary:
        'LettuceClusterClientOptions: autoReconnect with exponential backoff (100ms → 5s, jitter 0.3), commandTimeout 250ms, topologyRefresh 30s. Added Caffeine L1 (maximumSize 20k, expireAfterWrite 30s) in front of Redis lookups. Added a PodDisruptionBudget so cache maintenance can no longer evict all sessions at once.',
    },
    related: ['INC-0986'],
    tags: ['redis', 'cache', 'failover', 'sessions', 'retry-storm'],
    telemetry: {
      peakErrorRate: '6.2% of session lookups',
      p99Latency: '3,180 ms auth filter',
      affectedUsers: 12_400,
      errorBudgetBurn: '2.6x for 29 minutes',
    },
    timeline: [
      [0, 'detect', 'Cache error-rate alert CP-SES-12', 'Redis connection failures paged Session on-call.'],
      [5, 'triage', 'Cluster state fail identified', '1,150 slots unmapped after replica promotion.'],
      [11, 'action', 'Cache clients drained, topology forced', 'Removed unhealthy node from the topology seed list.'],
      [19, 'action', 'L1 cache enabled (feature flag)', 'Postgres CPU fell from 91% to 63%.'],
      [29, 'resolve', 'Session p99 < 120ms, alert cleared', 'Lettuce backoff config shipped in commit 4b7e35f.'],
    ],
  },

  /* ────────────────────────────── INC-1031 · memory leak ──────────────────── */
  {
    id: 'INC-1031',
    title: 'Search Indexer — unbounded embedding cache caused OOMKilled loop',
    service: 'Search Indexer',
    environment: 'production',
    severity: 'critical',
    status: 'resolved',
    detectedAt: daysAgo(4, 4, 20),
    mttrMinutes: 63,
    category: 'memory_leak',
    rootCauseTitle: 'Unbounded in-heap embedding cache leaking across reindex passes',
    summary:
      'A static Map caching document embeddings grew with every reindex pass (vector size doubled in the v9 model), exhausting the 2 GiB heap. Pods were OOMKilled 14 times in 70 minutes and search freshness lagged 41 minutes behind publishing.',
    errorType: 'java.lang.OutOfMemoryError',
    errorMessage: 'java.lang.OutOfMemoryError: Java heap space — retained 1.94 GiB of 2 GiB after 6 full GC cycles',
    stackTrace: `2026-10-04T13:58:31.704Z ERROR [search-indexer,1b9f44c7e2a0d613] 1 --- [indexer-worker-7] c.z.search.EmbeddingCache :
java.lang.OutOfMemoryError: Java heap space
	at java.base/java.util.Arrays.copyOf(Arrays.java:3537)
	at com.zephoria.search.EmbeddingCache.put(EmbeddingCache.java:54)
	at com.zephoria.search.ReindexJob.processBatch(ReindexJob.java:188)
	at com.zephoria.search.ReindexJob.lambda$run$2(ReindexJob.java:121)
GC(612) Pause Full (G1 Evacuation Pause) 1986M->1943M(2048M) 4.212s
Last pod event: OOMKilled (exit code 137) · restartCount=14 · freshness_lag=41m
Service: Search Indexer · env=production`,
    evidence: [
      'Post-full-GC retained heap grew monotonically from 410 MB to 1.94 GB over 19 hours',
      'Heap dump dominator tree: EmbeddingCache holds 71% of retained heap, entries never evicted',
      'restartCount=14 with exit code 137 (OOMKilled) inside a 70-minute window',
      'Vector dimension doubled with the v9 embedding model while heap stayed at 2 GiB',
    ],
    impact:
      'Search freshness lagged 41 minutes; 62% of newly published documents were not discoverable and catalog reindex throughput fell to 18% of nominal, delaying the merchandising campaign by one hour.',
    resolution:
      'Replaced the static cache with a size-bounded Caffeine cache, raised heap 2 → 4 GiB with G1 tuning and added a soak-test leak canary to the pipeline.',
    owner: ENGINEERS.priya,
    fix: {
      commit: '9d0c77b',
      repo: 'zephoria/search-indexer',
      branch: 'fix/bounded-embedding-cache',
      pr: '#2255',
      message: 'fix(memory): bound embedding cache with Caffeine, heap 2→4Gi, G1 tuning + leak canary',
      files: [
        'src/main/java/com/zephoria/search/EmbeddingCache.java',
        'src/main/java/com/zephoria/search/ReindexJob.java',
        'deploy/k8s/indexer-deployment.yaml',
        'ci/soak-leak-canary.sh',
      ],
      diffSummary:
        'EmbeddingCache rewritten on Caffeine (maximumWeight 512MB, weigher by vector bytes, expireAfterWrite 30m). Deployment: -Xmx4g, MaxGCPauseMillis=200, G1HeapRegionSize=8M, HeapDumpOnOutOfMemoryError with dumps shipped to object storage. CI: soak test fails the build on > 5% retained-heap growth over 6h.',
    },
    related: [],
    tags: ['jvm', 'memory-leak', 'oomkill', 'gc', 'search'],
    telemetry: {
      peakErrorRate: '100% of indexer pods for 14 restart cycles',
      p99Latency: '41 min index freshness lag',
      affectedUsers: 96_000,
      errorBudgetBurn: '4.1x for 63 minutes',
    },
    timeline: [
      [0, 'detect', 'CrashLoopBackOff alert CP-IDX-03', 'Pod restart count crossed 5 in 15 minutes.'],
      [8, 'triage', 'Heap dump captured', 'Dominator tree pointed at EmbeddingCache (71% retained).'],
      [22, 'action', 'Heap raised to 4 GiB as stop-gap', 'Stabilised pods; GC pause still > 2s.'],
      [41, 'action', 'Bounded Caffeine cache deployed', 'Retained heap flatlined at 1.1 GB post-GC.'],
      [63, 'resolve', 'Freshness lag < 90s, incident closed', 'Soak canary added to CI in commit 9d0c77b.'],
    ],
  },

  /* ────────────────────────── INC-1028 · failed deployment ────────────────── */
  {
    id: 'INC-1028',
    title: 'Payment API — release 218 broke schema contract, checkout writes failed',
    service: 'Payment API',
    environment: 'production',
    severity: 'critical',
    status: 'resolved',
    detectedAt: daysAgo(4, 9, 0),
    mttrMinutes: 23,
    category: 'failed_deployment',
    rootCauseTitle: 'Non-backwards-compatible migration shipped with the release',
    summary:
      'Release 218 dropped two columns the live build still wrote to. Pods started serving before the migration job finished, so 100% of checkout writes failed with "column does not exist" until revision 217 was restored.',
    errorType: 'org.postgresql.util.PSQLException',
    errorMessage: 'ERROR: column "legacy_auth_code" of relation "payment_intent" does not exist',
    stackTrace: `2026-10-04T18:12:09.331Z ERROR [payment-api,rev218] 1 --- [nio-8080-exec-64] o.h.engine.jdbc.spi.SqlExceptionHelper :
ERROR: column "legacy_auth_code" of relation "payment_intent" does not exist
	Position: 118
org.postgresql.util.PSQLException: ERROR: column "legacy_auth_code" of relation "payment_intent" does not exist
	at org.postgresql.core.v3.QueryExecutorImpl.receiveErrorResponse(QueryExecutorImpl.java:2725)
	at com.zephoria.payment.repo.PaymentIntentRepository.save(PaymentIntentRepository.java:76)
	at com.zephoria.payment.PaymentService.createIntent(PaymentService.java:198)
Flyway: migration V218__drop_legacy_auth_code applied at 18:11:44 · pod ready at 18:11:39
Service: Payment API · env=production · release=218`,
    evidence: [
      'Pod readiness at 18:11:39 preceded migration completion at 18:11:44 — a 5-second inversion',
      'Rolling deploy showed 100% error on new replicas, 0% on old ones (classic bad-release signature)',
      'Migration was destructive (DROP COLUMN) with no expand/contract phase',
      'Canary window of 60s was shorter than the p95 checkout sampling interval',
    ],
    impact:
      '23 minutes of total checkout write outage: 100% of intent creation failed, 6,140 customers saw a generic error page and the support queue spiked 9x.',
    resolution:
      'Rolled back to revision 217, converted the migration to expand/contract and gated deploys on a migration dry-run with automated error-budget abort.',
    owner: ENGINEERS.arun,
    fix: {
      commit: '1e5fa2c',
      repo: 'zephoria/payment-api',
      branch: 'fix/expand-contract-migration',
      pr: '#2249',
      message: 'fix(deploy): expand/contract migration + pre-deploy dry-run gate, abort on >0.5% errors',
      files: [
        'db/migration/V218__expand_payment_intent.sql',
        'db/migration/V219__contract_payment_intent.sql',
        'ci/deploy-gate.sh',
        '.github/workflows/release.yml',
      ],
      diffSummary:
        'V218 split into expand (add nullable new column, dual-write) and V219 (drop legacy column one release later). deploy-gate.sh runs migrations as a pre-deploy job with a dry-run against a shadow schema and aborts the rollout when canary error rate exceeds 0.5% over a 10-minute window.',
    },
    related: [],
    tags: ['deployment', 'migration', 'rollback', 'schema-drift', 'payments'],
    telemetry: {
      peakErrorRate: '100% of payment_intent writes',
      p99Latency: 'n/a — hard failures',
      affectedUsers: 6_140,
      errorBudgetBurn: '14.2x for 23 minutes',
    },
    timeline: [
      [0, 'detect', 'Checkout write-failure alert CP-PAY-09', 'Error rate jumped to 100% on new replicas.'],
      [4, 'triage', 'Release 218 correlated', 'Migration/pod readiness inversion found in logs.'],
      [9, 'action', 'Rollback to revision 217', 'Deployment rolled back; writes recovered in 90s.'],
      [16, 'action', 'Migration rewritten as expand/contract', 'Dual-write path prepared for the next release.'],
      [23, 'resolve', 'Deploy gate enforced', 'Release pipeline now aborts on canary error budget burn.'],
    ],
  },

  /* ─────────────────────────── INC-1024 · auth failure ───────────────────── */
  {
    id: 'INC-1024',
    title: 'Identity Service — JWKS cache served retired signing key, mass 401s',
    service: 'Identity Service',
    environment: 'production',
    severity: 'critical',
    status: 'resolved',
    detectedAt: daysAgo(3, 5, 30),
    mttrMinutes: 34,
    recurring: true,
    recurrenceCount: 1,
    category: 'auth_failure',
    rootCauseTitle: 'Stale JWKS cache outlived the signing-key rotation window',
    summary:
      'A scheduled signing-key rotation retired the old key after 15 minutes while every consumer cached JWKS for 24 hours. All token verification started failing with 401 until the cache was invalidated and both keys were dual-published.',
    errorType: 'com.auth0.jwt.exceptions.SignatureVerificationException',
    errorMessage: 'The Token\'s Signature has been verified against a key that no longer exists in the JWKS (kid=zpk_2024_11, cache_age=22h)',
    stackTrace: `2026-10-05T06:38:57.220Z ERROR [identity-svc,8c14de0b7719a3f5] 1 --- [http-nio-9000-exec-88] c.z.identity.TokenVerifier :
com.auth0.jwt.exceptions.SignatureVerificationException: kid not found in JWKS
	at com.auth0.jwt.algorithms.ECDSAAlgorithm.verify(ECDSAAlgorithm.java:96)
	at com.zephoria.identity.TokenVerifier.verify(TokenVerifier.java:134)
	at com.zephoria.identity.AuthHandler.authenticate(AuthHandler.java:72)
	at com.zephoria.identity.web.SessionController.me(SessionController.java:58)
JWKS cache: age=22h ttl=24h kids=[zpk_2024_11] · issuer kids=[zpk_2025_01]
HTTP 401 returned to 11,480 sessions · rotation window=15m
Service: Identity Service · env=production`,
    evidence: [
      'JWKS cache age 22h with a 24h TTL versus a 15-minute rotation window',
      'Cache held kid=zpk_2024_11 while the issuer had already published zpk_2025_01',
      'The refresh path was TTL-only — a `kid` miss never triggered re-fetch',
      '401 rate (100% of token verifications) started exactly 4 minutes after rotation',
    ],
    impact:
      '34 minutes of authentication failures: 11,480 users were signed out mid-session, mobile clients with cached tokens failed all API calls and 2 internal services halted deploys because their CI tokens were rejected.',
    resolution:
      'Restored dual-published signing keys, flushed JWKS caches fleet-wide, cut TTL to 10 minutes with kid-miss refresh and added a synthetic auth probe per region.',
    owner: ENGINEERS.sameer,
    fix: {
      commit: '7a3c187',
      repo: 'zephoria/identity-service',
      branch: 'fix/jwks-refresh-on-kid-miss',
      pr: '#2241',
      message: 'fix(auth): refresh JWKS on kid miss, TTL 24h→10m, enforce dual-publish rotation',
      files: [
        'src/main/java/com/zephoria/identity/JwksCache.java',
        'src/main/java/com/zephoria/identity/TokenVerifier.java',
        'ops/key-rotation/rotate.sh',
        'monitoring/synthetic-auth-probe.ts',
      ],
      diffSummary:
        'JwksCache now re-fetches on any unknown `kid` with single-flight locking and stale-while-revalidate; TTL 24h → 10m. TokenVerifier accepts the union of active keys during a 24h grace period. rotate.sh enforces dual-publish (new key live 24h before retirement) and blocks on probe health before completing.',
    },
    related: [],
    tags: ['auth', 'jwt', 'jwks', 'key-rotation', 'security'],
    telemetry: {
      peakErrorRate: '100% of token verifications (401)',
      p99Latency: '48 ms (fail-fast rejection)',
      affectedUsers: 11_480,
      errorBudgetBurn: '9.7x for 34 minutes',
    },
    timeline: [
      [0, 'detect', 'Auth failure-rate alert CP-IDN-02', '401s at 100% across all regions.'],
      [5, 'triage', 'Rotation window correlated', '22-hour-old JWKS cache with a 15-minute rotation.'],
      [12, 'action', 'Old key re-published (dual publish)', 'Rotation rolled back to restore verification.'],
      [24, 'action', 'JWKS caches flushed fleet-wide', 'kid-miss refresh deployed behind a flag.'],
      [34, 'resolve', 'Sessions re-validated, alert cleared', 'Synthetic per-region auth probe added to monitoring.'],
    ],
  },

  /* ─────────────────────────── INC-1019 · CPU exhaustion ──────────────────── */
  {
    id: 'INC-1019',
    title: 'Notification Worker — CPU throttling from unbatched retry loop',
    service: 'Notification Worker',
    environment: 'production',
    severity: 'high',
    status: 'resolved',
    detectedAt: daysAgo(3, 12, 10),
    mttrMinutes: 42,
    category: 'cpu_exhaustion',
    rootCauseTitle: 'Runaway retry loop pinned workers at the CPU limit',
    summary:
      'A failing SMS provider caused a tight retry loop with no backoff; 400 goroutines per pod spun on one core, cgroup throttling hit 96% and 1.2M notifications queued up behind the stalled workers.',
    errorType: 'io.grpc.StatusRuntimeException',
    errorMessage: 'DEADLINE_EXCEEDED: deadline exceeded after 10.00s for notification-gateway/Send (retry loop, 400 goroutines/pod)',
    stackTrace: `2026-10-05T19:47:03.884Z ERROR [notif-worker,2f8b64aa90c1d7e3] 1 --- [grpc-default-executor-311] c.z.notify.SmsDispatcher :
io.grpc.StatusRuntimeException: DEADLINE_EXCEEDED: deadline exceeded after 10.00s
	at io.grpc.stub.ClientCalls.toStatusRuntimeException(ClientCalls.java:271)
	at com.zephoria.notify.SmsDispatcher.send(SmsDispatcher.java:141)
	at com.zephoria.notify.RetryLoop.run(RetryLoop.java:66)
	at com.zephoria.notify.NotificationConsumer.consume(NotificationConsumer.java:98)
cgroup: cpu.stat nr_throttled=1,842,301 throttled_usec=42.9s/45s (96% throttled)
goroutines=412 per pod · load_avg=14.2 on 1 core · no backoff configured
Service: Notification Worker · env=production`,
    evidence: [
      'cgroup throttling 96% of quota (42.9s of 45s throttled) with load average 14.2 on a 1-core limit',
      'Retry loop had no backoff — 412 goroutines per pod spun on the same failing provider',
      'CPU limit 750m was below the measured serialization cost of the new payload format',
      'Delay graph shows a perfect staircase: each retry wave added 10s of queue time',
    ],
    impact:
      '1.2M notifications were delayed up to 55 minutes; OTP delivery latency breached the 60s product SLA for 42 minutes and 8,900 users retried their login OTP, inflating provider cost by 3x.',
    resolution:
      'Capped worker concurrency at 64, replaced the retry loop with jittered exponential backoff and a per-provider token bucket, and raised the CPU limit to 2 cores with throttling-based HPA.',
    owner: ENGINEERS.divya,
    fix: {
      commit: '2f8b64d',
      repo: 'zephoria/notification-worker',
      branch: 'fix/backoff-and-concurrency',
      pr: '#2237',
      message: 'fix(cpu): cap concurrency 400→64, jittered backoff, token-bucket per provider, HPA on throttling',
      files: [
        'internal/notify/retry.go',
        'internal/notify/dispatcher.go',
        'deploy/k8s/notif-worker.yaml',
        'internal/notify/retry_test.go',
      ],
      diffSummary:
        'retry.go: replaced tight loop with exponential backoff (200ms → 8s, jitter 0.4) and a circuit breaker per provider. dispatcher.go: worker pool capped at 64 with a token bucket (200 rps). Deployment: cpu limit 750m → 2, HPA scaled on container_cpu_cfs_throttled_ratio > 5%.',
    },
    related: [],
    tags: ['cpu', 'throttling', 'retry-storm', 'notifications', 'k8s'],
    telemetry: {
      peakErrorRate: '21% provider DEADLINE_EXCEEDED',
      p99Latency: '55 min notification delay',
      affectedUsers: 340_000,
      errorBudgetBurn: '3.1x for 42 minutes',
    },
    timeline: [
      [0, 'detect', 'Throttling alert CP-NOT-05', 'CPU CFS throttled ratio crossed 40%.'],
      [7, 'triage', 'Retry loop identified', 'Provider outage plus no backoff = spin cycle.'],
      [18, 'action', 'Concurrency capped at 64', 'Throttling fell to 12%; queue began draining.'],
      [30, 'action', 'Backoff + token bucket deployed', 'Provider error rate normalised.'],
      [42, 'resolve', 'Backlog drained, SLA restored', 'OTP p99 back under 60s; HPA policy updated.'],
    ],
  },

  /* ────────────────────────── INC-1015 · certificate ─────────────────────── */
  {
    id: 'INC-1015',
    title: 'Edge Gateway — expired wildcard certificate blocked all public traffic',
    service: 'Edge Gateway',
    environment: 'production',
    severity: 'critical',
    status: 'resolved',
    detectedAt: daysAgo(2, 8, 45),
    mttrMinutes: 18,
    category: 'certificate_failure',
    rootCauseTitle: 'Silent cert-manager renewal failure → expired TLS certificate',
    summary:
      'cert-manager\'s DNS-01 solver was rate-limited 21 days before expiry and never retried successfully. The wildcard certificate lapsed at 03:00 UTC and edge TLS handshakes failed for every public hostname until a renewed certificate was installed manually.',
    errorType: 'javax.net.ssl.SSLHandshakeException',
    errorMessage: 'Received fatal alert: certificate_expired (CN=*.zephoria.io, notAfter=2026-10-06T03:00:00Z)',
    stackTrace: `2026-10-06T03:00:41.512Z ERROR [edge-gateway,5f2a91c0b8d3e647] 1 --- [epoll-7] c.z.edge.tls.TlsTerminator :
javax.net.ssl.SSLHandshakeException: Received fatal alert: certificate_expired
	at java.base/sun.security.ssl.Alert.createSSLException(Alert.java:131)
	at java.base/sun.security.ssl.SSLTransport.decode(SSLTransport.java:519)
	at com.zephoria.edge.tls.TlsTerminator.handshake(TlsTerminator.java:214)
	at com.zephoria.edge.http.RequestPipeline.accept(RequestPipeline.java:97)
cert-manager: order failed 21d ago → DNS-01 solver rate limit (429) · renewals_attempted=0 since
Certificate CN=*.zephoria.io notAfter=2026-10-06T03:00:00Z · handshake_failures=100%
Service: Edge Gateway · env=production`,
    evidence: [
      'cert-manager order failed 21 days earlier with a persistent DNS-01 rate-limit (429) error',
      'No expiry alert existed below the 7-day threshold and the failure was silent',
      'Handshake failure rate went to exactly 100% at the notAfter timestamp',
      'The only documented recovery path was a manual certificate upload (no automated fallback)',
    ],
    impact:
      '18 minutes of total public-traffic outage: every HTTPS request to the platform failed at the TLS layer, affecting an estimated 480k sessions across web and mobile.',
    resolution:
      'Installed the renewed wildcard certificate on the edge cluster, repaired DNS-01 solver permissions and added multi-stage expiry alerting with per-host synthetic TLS probes.',
    owner: ENGINEERS.rahul,
    fix: {
      commit: 'b6d4e9a',
      repo: 'zephoria/edge-gateway',
      branch: 'fix/cert-renewal-alerting',
      pr: '#2233',
      message: 'fix(tls): repair cert-manager DNS-01 solver, add 30/14/7/3-day expiry alerts + TLS probes',
      files: [
        'ops/cert-manager/cluster-issuer.yaml',
        'ops/cert-manager/rbac-dns01.yaml',
        'monitoring/tls-probe/hosts.yaml',
        'runbooks/RB-TLS-002.md',
      ],
      diffSummary:
        'Fixed DNS-01 RBAC so the solver can write TXT records; added retry budget with exponential backoff. Prometheus rules for cert expiry at 30/14/7/3 days across ingress, mesh and outbound mTLS. Synthetic TLS probe per host every 5 minutes with handshake validation and paging on failure.',
    },
    related: [],
    tags: ['tls', 'certificate', 'expiry', 'edge', 'cert-manager'],
    telemetry: {
      peakErrorRate: '100% of TLS handshakes',
      p99Latency: 'n/a — connection refused at handshake',
      affectedUsers: 480_000,
      errorBudgetBurn: 'entire monthly budget in 18 minutes',
    },
    timeline: [
      [0, 'detect', 'Edge handshake failure alert CP-EDG-01', '100% TLS handshake failures across POPs.'],
      [3, 'triage', 'Certificate expiry confirmed', 'notAfter passed 41 seconds before the alert.'],
      [9, 'action', 'Renewed wildcard installed', 'Manual install from the CA console; traffic recovered.'],
      [14, 'action', 'DNS-01 solver repaired', 'RBAC fix unblocked automated renewal.'],
      [18, 'resolve', 'TLS probes green, runbook updated', 'Expiry alerting deployed in commit b6d4e9a.'],
    ],
  },

  /* ─────────────────────────── INC-1011 · message queue ──────────────────── */
  {
    id: 'INC-1011',
    title: 'Order Events — poison message stalled Kafka partition, 412k backlog',
    service: 'Order Events',
    environment: 'production',
    severity: 'high',
    status: 'resolved',
    detectedAt: daysAgo(2, 3, 0),
    mttrMinutes: 56,
    recurring: true,
    recurrenceCount: 3,
    category: 'message_queue',
    rootCauseTitle: 'Poison message with no DLQ routing blocked a partition head',
    summary:
      'A malformed order event failed deserialization, was retried forever at the partition head and stalled consumption. Consumer lag reached 412k messages before the poison pill was quarantined and the backlog drained in parallel.',
    errorType: 'org.apache.kafka.common.errors.SerializationException',
    errorMessage: 'Error deserializing key/value for partition order-events-7 at offset 88,412. Payload truncated. (max.poll.interval.ms exceeded)',
    stackTrace: `2026-10-06T14:31:18.077Z ERROR [order-events,4c7b2d91f0a6e835] 1 --- [ntainer#3-0-C-1] o.s.k.l.KafkaMessageListenerContainer :
Error deserializing key/value for partition order-events-7 at offset 88412
org.apache.kafka.common.errors.SerializationException: Error deserializing value
	at org.apache.kafka.common.serialization.JsonDeserializer.deserialize(JsonDeserializer.java:79)
	at com.zephoria.orders.OrderEventConsumer.onMessage(OrderEventConsumer.java:112)
	at org.springframework.kafka.listener.KafkaMessageListenerContainer$ListenerConsumer.doInvoke(KafkaMessageListenerContainer.java:1521)
Consumer group order-fulfilment: lag=412,308 · partition 7 stuck at offset 88412
max.poll.interval.ms=300000 exceeded · rebalance_count=37 in 20m · DLQ routing: NOT CONFIGURED
Service: Order Events · env=production`,
    evidence: [
      'Consumer lag 412,308 messages with partition 7 pinned at offset 88,412 (head-of-line blocking)',
      '37 rebalances in 20 minutes because the handler blocked past max.poll.interval.ms',
      'DLQ routing was never configured — every failure retried in place forever',
      '3.1k orders stuck in PROCESSING; downstream invoicing built a 74-minute delay',
    ],
    impact:
      '412k events delayed: fulfilment lagged 74 minutes, 3,110 orders sat in PROCESSING, invoice generation drifted past the daily close and two downstream reports were stale.',
    resolution:
      'Quarantined the poison message to a new DLQ, scaled consumers from 6 to 18 partitions in parallel and deployed an idempotent handler with 3-attempt DLQ routing plus a replay CLI.',
    owner: ENGINEERS.meera,
    fix: {
      commit: '5c9a203',
      repo: 'zephoria/order-events',
      branch: 'fix/dlq-and-idempotency',
      pr: '#2229',
      message: 'fix(kafka): DLQ after 3 attempts, idempotent handler, lag-in-seconds alerts, replay CLI',
      files: [
        'src/main/java/com/zephoria/orders/OrderEventConsumer.java',
        'src/main/java/com/zephoria/orders/DlqRouter.java',
        'src/main/java/com/zephoria/orders/IdempotencyStore.java',
        'tools/replay-dlq.sh',
      ],
      diffSummary:
        'DefaultErrorHandler replaced with a 3-attempt FixedBackOff (2s) then DeadLetterPublishingRecoverer into order-events.DLQ with headers carrying attempt count and exception class. Idempotency on (order_id, event_version) backed by a Redis SETNX with 24h TTL. Alerts now fire on lag measured in seconds (lag > 300s) instead of message count. replay-dlq.sh supports rate-limited re-drive.',
    },
    related: [],
    tags: ['kafka', 'consumer-lag', 'dlq', 'poison-message', 'orders'],
    telemetry: {
      peakErrorRate: '100% of partition 7 consumption',
      p99Latency: '74 min end-to-end event delay',
      affectedUsers: 52_400,
      errorBudgetBurn: '2.2x for 56 minutes',
    },
    timeline: [
      [0, 'detect', 'Consumer lag alert CP-ORD-04', 'Lag crossed 100k on the order-fulfilment group.'],
      [11, 'triage', 'Poison message isolated', 'Offset 88,412 failing deserialization in a loop.'],
      [19, 'action', 'Partition head quarantined', 'Offsets skipped to the DLQ topic; consumption resumed.'],
      [35, 'action', 'Consumers scaled 6 → 18', 'Backlog drained at 24k msg/min.'],
      [56, 'resolve', 'Lag < 30s, DLQ replay complete', 'Idempotent handler shipped in commit 5c9a203.'],
    ],
  },

  /* ─────────────────────────── INC-1007 · db locking ─────────────────────── */
  {
    id: 'INC-1007',
    title: 'Inventory Service — lock contention and slow query storm on reserve()',
    service: 'Inventory Service',
    environment: 'production',
    severity: 'high',
    status: 'resolved',
    detectedAt: daysAgo(1, 6, 0),
    mttrMinutes: 41,
    category: 'db_locking',
    rootCauseTitle: 'Inverted lock ordering plus a missing covering index',
    summary:
      'Two write paths acquired inventory and order rows in opposite order, producing deadlocks under concurrency. A missing composite index turned each reservation into a sequential scan, holding locks long enough to serialize checkout.',
    errorType: 'org.postgresql.util.PSQLException',
    errorMessage: 'ERROR: deadlock detected — Process 4821 waits for ShareLock on transaction 9931; blocked by process 4788 (lock acquisition order inverted)',
    stackTrace: `2026-10-07T02:14:52.401Z ERROR [inventory-svc,91cb3e77d0a4f268] 1 --- [nio-8080-exec-142] o.h.engine.jdbc.spi.SqlExceptionHelper :
ERROR: deadlock detected
DETAIL: Process 4821 waits for ShareLock on transaction 9931; blocked by process 4788.
	Process 4788: UPDATE inventory SET reserved = reserved + 1 WHERE sku=$1 AND warehouse_id=$2
	Process 4821: UPDATE orders SET status='RESERVED' WHERE id=$3
	at org.postgresql.core.v3.QueryExecutorImpl.receiveErrorResponse(QueryExecutorImpl.java:2725)
	at com.zephoria.inventory.InventoryRepository.reserve(InventoryRepository.java:158)
	at com.zephoria.inventory.ReservationService.reserve(ReservationService.java:203)
statement_timeout=30000 · seq_scan on inventory (2.4M rows) · avg_lock_wait=1,840ms
Service: Inventory Service · env=production`,
    evidence: [
      'Deadlock detail shows inverted lock acquisition (inventory → orders vs orders → inventory)',
      'EXPLAIN ANALYZE: sequential scan on inventory (2.4M rows) for every reservation',
      'Average lock wait 1,840ms, p99 11.2s across the incident window',
      'Transactions wrapped two outbound HTTP calls, holding row locks for 300ms+',
    ],
    impact:
      'Checkout conversion fell 34% for 41 minutes; 4,260 reservations failed and were retried by clients, doubling write pressure during the busiest hour of the day.',
    resolution:
      'Killed the blocking sessions, enforced consistent lock ordering (inventory → order), shrank transactions below 20ms with the outbox pattern and added the covering index with an EXPLAIN regression test.',
    owner: ENGINEERS.priya,
    fix: {
      commit: '3a71fdc',
      repo: 'zephoria/inventory-service',
      branch: 'fix/lock-ordering-index',
      pr: '#2221',
      message: 'fix(db): consistent lock ordering, outbox instead of in-tx HTTP, covering index on reserve',
      files: [
        'src/main/java/com/zephoria/inventory/ReservationService.java',
        'src/main/java/com/zephoria/inventory/InventoryRepository.java',
        'db/migration/V217__inventory_covering_index.sql',
        'ci/explain-regression-test.sql',
      ],
      diffSummary:
        'ReservationService now always locks inventory before orders and runs in a sub-20ms transaction; outbound pricing/notification calls moved to a transactional outbox with async delivery. V217 adds a covering index on inventory (sku, warehouse_id, status) INCLUDE (reserved, version). CI runs EXPLAIN and fails the build on any Seq Scan over the reservation query.',
    },
    related: [],
    tags: ['postgres', 'deadlock', 'lock-contention', 'index', 'inventory'],
    telemetry: {
      peakErrorRate: '31% of reservation writes',
      p99Latency: '11.2 s lock wait',
      affectedUsers: 22_800,
      errorBudgetBurn: '2.7x for 41 minutes',
    },
    timeline: [
      [0, 'detect', 'Deadlock-rate alert CP-INV-06', 'Deadlocks above 20/min for 5 minutes.'],
      [8, 'triage', 'Lock order inversion found', 'Two write paths grabbing rows in opposite order.'],
      [17, 'action', 'Blocking sessions terminated', 'pg_terminate_backend plus advisory lock around the batch job.'],
      [29, 'action', 'Covering index created concurrently', 'Seq scan replaced by index-only scan; lock waits fell 92%.'],
      [41, 'resolve', 'Conversion rate recovered', 'Outbox pattern shipped in commit 3a71fdc.'],
    ],
  },

  /* ────────────────────────────── INC-1003 · CDN ─────────────────────────── */
  {
    id: 'INC-1003',
    title: 'Media Edge — cache-key regression served personalised HTML cross-user',
    service: 'Media Edge',
    environment: 'production',
    severity: 'high',
    status: 'resolved',
    detectedAt: daysAgo(1, 13, 30),
    mttrMinutes: 26,
    category: 'edge_cache',
    rootCauseTitle: 'Personalisation header missing from the edge cache key',
    summary:
      'A new personalisation header was not included in the CDN cache key, so personalised homepage fragments were cached and served to other users. A negative-cache guard was also missing, which cached error responses for 60 seconds.',
    errorType: 'HTTP 502 / cache-key violation',
    errorMessage: 'X-Cache: HIT (cache_key missing x-user-bucket) — personalised fragment served to a different user bucket',
    stackTrace: `2026-10-07T10:02:11.006Z ERROR [edge-gateway,pop-sin3] 1 --- [edge-worker-22] c.z.edge.cache.CacheKeyBuilder :
Cache-key violation detected: personalisation header not part of the key
X-Cache: HIT · cache_key=GET:/home:/device=mobile · expected_key=GET:/home:/device=mobile:/x-user-bucket=b7
origin 5xx cached for 60s (no negative-cache guard) · 502_rate=4.1% · affected_pop=22%
	at com.zephoria.edge.cache.CacheKeyBuilder.compute(CacheKeyBuilder.java:74)
	at com.zephoria.edge.http.RequestPipeline.serve(RequestPipeline.java:188)
Service: Media Edge · env=production`,
    evidence: [
      'Cache key omitted x-user-bucket while the origin varied on it (22% of POPs affected)',
      'Origin 5xx responses were cached with a 60s TTL due to a missing negative-cache guard',
      'Edge config change was applied to 100% of POPs with no canary stage',
      'Cache hit ratio jumped 68% → 94%, hiding the personalisation regression',
    ],
    impact:
      '26 minutes of incorrect personalisation: an estimated 9% of visitors saw another user’s cart badge and recommendation rail, plus a 4.1% 502 rate from cached error responses.',
    resolution:
      'Purged the edge cache globally, added the personalisation header to the cache key, introduced a negative-cache guard and rolled edge config out through 5% canary POPs.',
    owner: ENGINEERS.sameer,
    fix: {
      commit: 'e8b52c7',
      repo: 'zephoria/edge-gateway',
      branch: 'fix/cache-key-personalisation',
      pr: '#2218',
      message: 'fix(edge): include x-user-bucket in cache key, block caching of 5xx/Set-Cookie, canary POP rollout',
      files: [
        'src/main/java/com/zephoria/edge/cache/CacheKeyBuilder.java',
        'src/main/java/com/zephoria/edge/http/RequestPipeline.java',
        'config/edge/cache-rules.yaml',
      ],
      diffSummary:
        'CacheKeyBuilder includes x-user-bucket and device class; RequestPipeline skips cache writes for status >= 500 and any response carrying Set-Cookie. cache-rules.yaml stages config changes at 5% of POPs for 15 minutes with automated abort on 5xx drift.',
    },
    related: [],
    tags: ['cdn', 'cache', 'personalisation', 'edge', '5xx'],
    telemetry: {
      peakErrorRate: '4.1% HTTP 502 + 9% mis-personalised sessions',
      p99Latency: '210 ms (unchanged)',
      affectedUsers: 61_300,
      errorBudgetBurn: '1.9x for 26 minutes',
    },
    timeline: [
      [0, 'detect', 'Support reports of mixed-up cart badges', 'CS triage flagged cross-user personalisation.'],
      [6, 'triage', 'Cache-key violation confirmed', 'CacheKeyBuilder lacked x-user-bucket.'],
      [11, 'action', 'Global cache purge', 'Purged all POPs; negative cache disabled.'],
      [19, 'action', 'Corrected cache key deployed', 'Canary at 5% of POPs, then full rollout.'],
      [26, 'resolve', '502 rate < 0.2%, personalisation verified', 'Canary policy added to edge config pipeline.'],
    ],
  },

  /* ──────────────────────────── INC-0998 · search cluster ────────────────── */
  {
    id: 'INC-0998',
    title: 'Catalog Search — Elasticsearch red cluster from disk watermark',
    service: 'Catalog Search',
    environment: 'production',
    severity: 'medium',
    status: 'resolved',
    detectedAt: daysAgo(1, 20, 0),
    mttrMinutes: 52,
    category: 'search_cluster',
    rootCauseTitle: 'Disk watermark breach with no ILM retention policy',
    summary:
      'Two data nodes crossed the 90% flood watermark, forcing Elasticsearch into read-only blocks and leaving 14 primary shards unassigned. Product search returned degraded results for 27 minutes until disk was reclaimed.',
    errorType: 'org.elasticsearch.cluster.block.ClusterBlockException',
    errorMessage: 'blocked by: [FORBIDDEN/12/index read-only / allow delete (api)]; 14 unassigned primary shards (cluster state RED)',
    stackTrace: `2026-10-07T14:58:22.778Z ERROR [catalog-search,es-data-2] 1 --- [search-thread-9] c.z.search.QueryExecutor :
org.elasticsearch.cluster.block.ClusterBlockException: blocked by: [FORBIDDEN/12/index read-only / allow delete (api)]
	at org.elasticsearch.action.support.replication.TransportReplicationAction$AsyncPrimaryAction.onResponse(TransportReplicationAction.java:371)
	at com.zephoria.search.QueryExecutor.execute(QueryExecutor.java:143)
	at com.zephoria.search.web.SearchController.query(SearchController.java:88)
cluster: status=RED · unassigned_primary_shards=14 · disk_high_watermark=90% exceeded on es-data-1,es-data-2
ILM policy: NOT CONFIGURED · retention=manual · hot_node_indices=120 days of data
Service: Catalog Search · env=production`,
    evidence: [
      'Disk usage 92% / 91% on two data nodes — above the high (90%) and flood (95%) watermarks',
      '14 primary shards unassigned because allocation was blocked by the watermark',
      'No ILM policy: 120 days of searchable data lived on hot nodes with manual deletion only',
      'Search timeout rate 18% and zero-result rate doubled during the window',
    ],
    impact:
      'Product search returned degraded or empty result sets for 27 minutes; search-attributed revenue fell 22% and category browsing p99 crossed 4.9s.',
    resolution:
      'Freed disk by deleting expired indices, applied an ILM hot/warm/cold policy, rebalanced shards across three zones and added watermark capacity forecasting.',
    owner: ENGINEERS.divya,
    fix: {
      commit: '6d3f818',
      repo: 'zephoria/catalog-search',
      branch: 'fix/ilm-retention-policy',
      pr: '#2212',
      message: 'fix(es): ILM hot→warm→cold retention, watermark alerts, cross-zone shard rebalance',
      files: [
        'ops/elasticsearch/ilm-policy.json',
        'ops/elasticsearch/rebalance-zones.sh',
        'monitoring/alert-rules/es-capacity.yaml',
      ],
      diffSummary:
        'ILM: hot 7d → warm 30d (force-merge) → cold 90d → delete 180d with rollover at 40GB/7d. Allocation awareness across three zones with replica pinning. Alerts at 75/85/90% disk plus unassigned-shard paging and a weekly capacity forecast job.',
    },
    related: [],
    tags: ['elasticsearch', 'cluster-red', 'disk-watermark', 'ilm', 'search'],
    telemetry: {
      peakErrorRate: '18% search timeouts',
      p99Latency: '4,910 ms',
      affectedUsers: 145_000,
      errorBudgetBurn: '1.6x for 52 minutes',
    },
    timeline: [
      [0, 'detect', 'Cluster health alert CP-SRCH-02', 'Cluster turned RED with 14 unassigned primaries.'],
      [9, 'triage', 'Watermark breach identified', 'Disk 92% on two data nodes; read-only blocks active.'],
      [23, 'action', 'Expired indices deleted, blocks cleared', 'Freed 1.4 TB; shards began allocating.'],
      [39, 'action', 'ILM policy applied cluster-wide', 'Retention automated hot/warm/cold.'],
      [52, 'resolve', 'Cluster GREEN, search p99 < 400ms', 'Capacity forecast job added to monitoring.'],
    ],
  },

  /* ──────────────────── INC-0994 · earlier recurrence of pool exhaustion ──── */
  {
    id: 'INC-0994',
    title: 'Payment API — first pool exhaustion incident (pool 25 → 50)',
    service: 'Payment API',
    environment: 'production',
    severity: 'high',
    status: 'resolved',
    detectedAt: daysAgo(34, 5, 0),
    mttrMinutes: 31,
    recurring: true,
    recurrenceCount: 1,
    category: 'db_pool_exhaustion',
    rootCauseTitle: 'Database connection pool exhaustion (first occurrence)',
    summary:
      'The first occurrence of pool saturation on Payment API, triggered by a batch settlement job sharing the application pool with live traffic. The pool was raised from 25 to 50 — a band-aid that the INC-1042 recurrence outgrew.',
    errorType: 'java.sql.SQLTransientConnectionException',
    errorMessage: 'HikariPool-1 - Connection is not available, request timed out after 30000ms (total=25, active=25, waiting=96)',
    stackTrace: `2026-09-04T02:19:44.117Z ERROR [payment-api,7ab2c8e1d90f4c53] 1 --- [nio-8080-exec-88] c.z.payment.SettlementBatch :
Unable to acquire JDBC connection for settlement batch
java.sql.SQLTransientConnectionException: HikariPool-1 - Connection is not available, request timed out after 30000ms.
	at com.zaxxer.hikari.pool.HikariPool.getConnection(HikariPool.java:147)
	at org.springframework.jdbc.core.JdbcTemplate.execute(JdbcTemplate.java:376)
	at com.zephoria.payment.SettlementBatch.run(SettlementBatch.java:74)
HikariPool-1 - Pool stats (total=25, active=25, idle=0, waiting=96)
Caused by: java.sql.SQLException: Connection timed out
Service: Payment API · env=production`,
    evidence: [
      'Pool stats total=25 active=25 idle=0 waiting=96 — full saturation during the batch window',
      'Settlement batch shared the same pool as live charge traffic (no isolation)',
      'Two prior near-misses at 21/25 connections had been dismissed as noise',
      'Fix raised the pool to 50 without isolating the batch — the root cause of INC-1042',
    ],
    impact:
      '31 minutes of elevated payment errors (22% of charge attempts) during the settlement window, with 3,240 failed charges replayed later.',
    resolution:
      'Raised the pool 25 → 50 and rescheduled the settlement batch to the low-traffic window, but did not isolate the batch pool (identified as a contributing factor to the later recurrence).',
    owner: ENGINEERS.arun,
    fix: {
      commit: 'a74e121',
      repo: 'zephoria/payment-api',
      branch: 'fix/pool-50-settlement-window',
      pr: '#2087',
      message: 'fix(db): pool 25→50 and move settlement batch to off-peak window',
      files: ['src/main/resources/application-prod.yml', 'src/main/java/com/zephoria/payment/SettlementBatch.java'],
      diffSummary: 'maximum-pool-size 25 → 50; settlement cron moved from 02:00 to 04:30 UTC; batch size halved to 5,000 rows.',
    },
    related: ['INC-1042'],
    tags: ['jdbc', 'hikaricp', 'connection-pool', 'payments', 'recurring'],
    telemetry: {
      peakErrorRate: '22% of charge requests',
      p99Latency: '30,120 ms',
      affectedUsers: 3_240,
      errorBudgetBurn: '4.9x for 31 minutes',
    },
    timeline: [
      [0, 'detect', 'Payment 5xx alert CP-PAY-01', '22% charge failures at the start of the batch window.'],
      [5, 'triage', 'Pool saturation confirmed', 'Batch job sharing the live pool.'],
      [14, 'action', 'Batch cancelled, pool raised to 50', 'Immediate recovery after restart.'],
      [31, 'resolve', 'Errors cleared, batch rescheduled', 'Recurrence risk noted but not fully mitigated.'],
    ],
  },

  /* ──────────────────────────── INC-0990 · third-party PSP ───────────────── */
  {
    id: 'INC-0990',
    title: 'Checkout Gateway — third-party PSP 504s during peak sale hour',
    service: 'Checkout Gateway',
    environment: 'production',
    severity: 'medium',
    status: 'resolved',
    detectedAt: daysAgo(41, 8, 0),
    mttrMinutes: 44,
    category: 'upstream_timeout',
    rootCauseTitle: 'External payment provider degraded under peak load',
    summary:
      'The external payment provider returned 504s above their contracted SLA during the sale hour. Checkout had no provider failover, so card authorisations failed until the secondary provider was enabled manually.',
    errorType: 'org.springframework.web.client.HttpServerErrorException',
    errorMessage: '504 Gateway Timeout from psp-gateway:443/v3/authorise after 5000ms (provider incident P-88213)',
    stackTrace: `2026-08-28T12:44:03.550Z ERROR [checkout-gw,6b1e0d7a2c9f3548] 1 --- [nio-8080-exec-211] c.z.checkout.PspClient :
504 Gateway Timeout from upstream PSP
org.springframework.web.client.HttpServerErrorException$GatewayTimeout: 504 GATEWAY_TIMEOUT
	at org.springframework.web.client.RestTemplate.handleResponse(RestTemplate.java:820)
	at com.zephoria.checkout.PspClient.authorise(PspClient.java:118)
	at com.zephoria.checkout.PaymentOrchestrator.authorise(PaymentOrchestrator.java:176)
provider_status_page: degraded · failover_provider: configured but disabled (manual switch)
Service: Checkout Gateway · env=production`,
    evidence: [
      'Provider status page confirmed degradation (incident P-88213) with 504s above SLA',
      'Secondary provider was configured but required a manual switch — no automated failover',
      'Authorisation failures were retried on the same degraded provider',
      'Peak-hour traffic made the impact disproportionately large (sale event)',
    ],
    impact:
      '44 minutes of failed card authorisations during the sale hour: 5,180 failed checkouts and an estimated ₹92L of lost GMV.',
    resolution:
      'Failed over to the secondary provider manually, then automated weighted routing with health-based failover and per-provider circuit breakers.',
    owner: ENGINEERS.rahul,
    fix: {
      commit: '0c4d6b8',
      repo: 'zephoria/checkout-gateway',
      branch: 'feat/psp-failover',
      pr: '#2140',
      message: 'feat(psp): weighted multi-provider routing with health-based failover and per-provider CB',
      files: ['src/main/java/com/zephoria/checkout/psp/RoutingStrategy.java', 'src/main/java/com/zephoria/checkout/psp/PspHealthCheck.java'],
      diffSummary:
        'Added weighted routing (primary 90 / secondary 10) with health-based failover: two consecutive 5xx windows above 5% shift weight to the healthy provider within 15s. Per-provider circuit breakers and contract-SLA alarms added.',
    },
    related: ['INC-1039'],
    tags: ['timeout', 'third-party', 'psp', 'failover', 'checkout'],
    telemetry: {
      peakErrorRate: '14% of authorisations',
      p99Latency: '5,010 ms (provider timeout)',
      affectedUsers: 5_180,
      errorBudgetBurn: '1.4x for 44 minutes',
    },
    timeline: [
      [0, 'detect', 'PSP error-rate alert CP-PAY-14', '504s from the provider above 5%.'],
      [10, 'triage', 'Provider incident confirmed', 'Status page P-88213 acknowledged degradation.'],
      [18, 'action', 'Manual failover to secondary PSP', 'Authorisations recovered within 2 minutes.'],
      [44, 'resolve', 'Traffic rebalanced, fix merged', 'Automated weighted failover shipped.'],
    ],
  },

  /* ─────────────────────────── INC-0986 · Redis eviction ─────────────────── */
  {
    id: 'INC-0986',
    title: 'Session Service — Redis maxmemory eviction storm invalidated sessions',
    service: 'Session Service',
    environment: 'staging',
    severity: 'medium',
    status: 'mitigated',
    detectedAt: daysAgo(52, 4, 0),
    mttrMinutes: 36,
    category: 'redis_failure',
    rootCauseTitle: 'maxmemory-policy volatile-lru evicting live sessions',
    summary:
      'Memory pressure from a debugging feature (full request bodies stored as session context) pushed Redis to maxmemory. The volatile-lru policy evicted live sessions, logging users out in staging and nearly reaching production.',
    errorType: 'eviction storm / session invalidation',
    errorMessage: 'evicted_keys=184,203 in 12m under volatile-lru policy; session invalidation rate 47%',
    stackTrace: `2026-08-17T06:32:19.884Z WARN [session-svc,3f8c1b0a5e7d9246] 1 --- [lettuce-nioEventLoop-2-1] c.z.session.SessionRepository :
Session missing after write — probable eviction
redis INFO: used_memory=3.94G maxmemory=4.00G evicted_keys=184203 (volatile-lru) hit_rate=71%→52%
	at com.zephoria.session.SessionRepository.lookup(SessionRepository.java:88)
	at com.zephoria.session.AuthFilter.doFilter(AuthFilter.java:61)
debug_request_body_logging=true · avg_session_size=48KB (expected 2KB)
Service: Session Service · env=staging`,
    evidence: [
      'evicted_keys=184,203 in 12 minutes; hit rate collapsed 71% → 52%',
      'Average session size 48KB vs 2KB expected — debugging feature stored full request bodies',
      'maxmemory-policy volatile-lru evicted keys that were still live sessions',
      'Staging-only impact; the same build was scheduled to ship to production that week',
    ],
    impact:
      'Staging environment only: 47% session invalidation rate, all QA flows logged out mid-test and the release candidate was blocked for one day.',
    resolution:
      'Disabled request-body logging, switched to a dedicated session namespace with noeviction + TTL, and added session-size alerting to the release checklist.',
    owner: ENGINEERS.vikram,
    fix: {
      commit: '91b0aef',
      repo: 'zephoria/session-service',
      branch: 'fix/session-namespace-noeviction',
      pr: '#2104',
      message: 'fix(cache): dedicated session namespace, noeviction policy, session-size alerts',
      files: ['src/main/java/com/zephoria/session/SessionRepository.java', 'infra/redis/session-cache.tf', 'config/feature-flags.yaml'],
      diffSummary:
        'Session data namespaced to db 3 with maxmemory-policy noeviction and per-key TTL; request-body logging feature-flagged off by default. Alerts on avg session size > 6KB and evicted_keys > 0.',
    },
    related: ['INC-1036'],
    tags: ['redis', 'eviction', 'memory', 'sessions', 'staging'],
    telemetry: {
      peakErrorRate: '47% session invalidation',
      p99Latency: '1,240 ms',
      affectedUsers: 900,
      errorBudgetBurn: 'staging only',
    },
    timeline: [
      [0, 'detect', 'Session-miss alert (staging)', '47% invalidation rate during QA regression run.'],
      [8, 'triage', 'Eviction storm identified', 'used_memory at 98% of maxmemory with volatile-lru.'],
      [20, 'action', 'Debug logging disabled', 'Session size returned to 2KB average.'],
      [36, 'resolve', 'noeviction namespace deployed', 'Session-size alerting added to the release checklist.'],
    ],
  },

  /* ──────────────────── INC-0981 · connection failure, different cause ───── */
  {
    id: 'INC-0981',
    title: 'Analytics ETL — PgBouncer client limit hit by parallel batch workers',
    service: 'Analytics ETL',
    environment: 'production',
    severity: 'medium',
    status: 'resolved',
    detectedAt: daysAgo(60, 2, 0),
    mttrMinutes: 25,
    category: 'db_pool_exhaustion',
    rootCauseTitle: 'PgBouncer client connection limit exceeded by an ETL fan-out',
    summary:
      'A data backfill spawned 600 parallel workers against a 200-client PgBouncer pool. Connections were refused with "no more connections allowed", which looks like pool exhaustion but was actually a topology/limit problem — a useful negative example for the matcher.',
    errorType: 'org.postgresql.util.PSQLException',
    errorMessage: 'FATAL: no more connections allowed (max_client_conn=200). Connection timed out. (pgbouncer)',
    stackTrace: `2026-08-09T01:08:44.220Z ERROR [analytics-etl,5d9a7712ce8b30f4] 1 --- [etl-pool-118] o.p.d.PgConnection :
FATAL: no more connections allowed (max_client_conn=200)
org.postgresql.util.PSQLException: FATAL: no more connections allowed
	at org.postgresql.core.v3.ConnectionFactoryImpl.doAuthentication(ConnectionFactoryImpl.java:693)
	at com.zephoria.etl.BatchWorker.run(BatchWorker.java:112)
pgbouncer: max_client_conn=200 pool_size=40 active_workers=600 · refusals=3,911 in 4m
Service: Analytics ETL · env=production`,
    evidence: [
      'PgBouncer refused 3,911 connections with max_client_conn=200 while 600 workers were requested',
      'The application pool was healthy — this was a proxy-topology limit, not pool exhaustion',
      'Backfill job had no concurrency cap and ignored PgBouncer limits',
      'Database CPU stayed at 34% — proving the primary was not the bottleneck',
    ],
    impact:
      '25 minutes of failed batch ingestion: the nightly analytics refresh ran 90 minutes late and two executive dashboards showed stale data for the morning review.',
    resolution:
      'Capped ETL worker concurrency at 120, raised PgBouncer max_client_conn to 400 with pool_mode=transaction, and added a limit-aware backfill scheduler.',
    owner: ENGINEERS.divya,
    fix: {
      commit: 'd5a1c33',
      repo: 'zephoria/analytics-etl',
      branch: 'fix/pgbouncer-aware-concurrency',
      pr: '#2098',
      message: 'fix(etl): concurrency cap from PgBouncer limits, transaction pool mode, backfill scheduler',
      files: ['src/main/java/com/zephoria/etl/BatchWorker.java', 'infra/pgbouncer/pgbouncer.ini', 'src/main/java/com/zephoria/etl/BackfillScheduler.java'],
      diffSummary:
        'Worker concurrency derived at runtime from max_client_conn × 0.6 with a hard cap of 120; pool_mode switched to transaction with server_idle_timeout 30s; backfill scheduler queues work rather than fanning out.',
    },
    related: ['INC-1042'],
    tags: ['pgbouncer', 'connections', 'etl', 'database', 'limits'],
    telemetry: {
      peakErrorRate: '92% of ETL worker connections',
      p99Latency: 'n/a — connection refused',
      affectedUsers: 4_200,
      errorBudgetBurn: '1.1x for 25 minutes',
    },
    timeline: [
      [0, 'detect', 'ETL failure alert CP-ETL-02', 'Connection refusals above 1,000/min.'],
      [6, 'triage', 'PgBouncer limit identified', 'max_client_conn=200 vs 600 requested workers.'],
      [13, 'action', 'Backfill cancelled, limits raised', 'Refusals stopped within 60 seconds.'],
      [25, 'resolve', 'Refresh completed, scheduler deployed', 'Concurrency now derived from proxy limits.'],
    ],
  },
];

/* ───────────────────────────── materialisation ───────────────────────────── */

function buildTimeline(detectedAt: string, specs: TimelineSpec[]): TimelineEvent[] {
  return specs.map(([minutes, kind, label, detail]) => ({ at: at(detectedAt, minutes), kind, label, detail }));
}

/** Canonical embedding document — used for BOTH incident seeding and query embedding. */
export function documentFor(incident: Pick<Incident,
  'title' | 'service' | 'rootCauseTitle' | 'rootCauseCategory' | 'errorType' | 'errorMessage' | 'signature' | 'tags' | 'stackTrace' | 'summary'>): string {
  return [
    incident.title,
    `service ${incident.service}`,
    `root cause ${incident.rootCauseTitle}`,
    `category ${incident.rootCauseCategory}`,
    `error type ${incident.errorType}`,
    `error message ${incident.errorMessage}`,
    `signature ${incident.signature}`,
    `tags ${incident.tags.join(' ')}`,
    incident.stackTrace,
    incident.summary,
  ].join('\n');
}

export function buildSeedIncidents(): Incident[] {
  return SPECS.map((s) => {
    const cat = CATEGORY_BY_KEY[s.category];
    const resolvedAt = at(s.detectedAt, s.mttrMinutes);
    const signatureTokens = Array.from(new Set(tokenize(`${s.errorType} ${s.errorMessage} ${s.title}`))).slice(0, 12);
    const incident: Incident = {
      id: s.id,
      title: s.title,
      service: s.service,
      environment: s.environment,
      severity: s.severity,
      status: s.status,
      detectedAt: s.detectedAt,
      resolvedAt: s.status === 'open' ? null : resolvedAt,
      mttrMinutes: s.mttrMinutes,
      recurring: Boolean(s.recurring),
      recurrenceCount: s.recurrenceCount ?? 0,
      rootCauseCategory: cat.label,
      rootCauseTitle: s.rootCauseTitle,
      summary: s.summary,
      errorType: s.errorType,
      errorMessage: s.errorMessage,
      signature: `${signatureTokens.slice(0, 6).join(' ') || s.errorType} @ ${s.service}`,
      stackTrace: s.stackTrace,
      evidence: s.evidence,
      impact: s.impact,
      resolution: s.resolution,
      resolutionSteps: s.resolutionSteps ?? cat.resolutionSteps,
      preventiveActions: s.preventiveActions ?? cat.preventiveActions,
      lessonsLearned: s.lessonsLearned ?? cat.lessonsLearned,
      owner: s.owner,
      fix: {
        commit: s.fix.commit,
        repo: s.fix.repo,
        branch: s.fix.branch,
        pr: s.fix.pr,
        message: s.fix.message,
        files: s.fix.files,
        diffSummary: s.fix.diffSummary,
        deployedAt: at(s.detectedAt, s.mttrMinutes + 22),
      },
      relatedIncidentIds: s.related ?? [],
      tags: s.tags,
      telemetry: s.telemetry,
      timeline: buildTimeline(s.detectedAt, s.timeline),
    };
    incident.embedding = embed(documentFor(incident));
    incident.embeddingVersion = 'pulse-hash-384-v3';
    return incident;
  });
}

export const SEED_VERSION = 'codepulse-seed-v1-16-incidents';
