/**
 * CodePulse — root-cause taxonomy + domain keyword weighting.
 *
 * The taxonomy is what lets PulseReasoner (the offline engine) behave like a
 * specialised SRE model: it maps raw log signals to a canonical failure class,
 * then reuses the class playbook for fix / preventive actions / lessons.
 */

export const EMBED_DIMS = 384;
export const EMBEDDING_VERSION = 'pulse-hash-384-v3';

export type CategoryKey =
  | 'db_pool_exhaustion'
  | 'upstream_timeout'
  | 'redis_failure'
  | 'memory_leak'
  | 'failed_deployment'
  | 'auth_failure'
  | 'cpu_exhaustion'
  | 'certificate_failure'
  | 'message_queue'
  | 'db_locking'
  | 'edge_cache'
  | 'search_cluster';

export interface Category {
  key: CategoryKey;
  label: string;
  /** Regex signals found in the pasted trace */
  patterns: { re: RegExp; weight: number; note: string }[];
  errorTypes: RegExp[];
  severityHint: 'critical' | 'high' | 'medium';
  impactTemplate: string;
  contributingFactors: string[];
  preventiveActions: string[];
  lessonsLearned: string[];
  resolutionSteps: string[];
  fixTemplate: string;
  runbook: string;
}

export const CATEGORIES: Category[] = [
  {
    key: 'db_pool_exhaustion',
    label: 'Database connection pool exhaustion',
    patterns: [
      { re: /pool\s*(is\s*)?(exhaust|full|exhausted)/i, weight: 1.0, note: 'pool exhausted' },
      { re: /unable to acquire jdbc connection/i, weight: 1.0, note: 'unable to acquire JDBC connection' },
      { re: /hikari|hikaricp|dbcp|tomcat jdbc|c3p0|pgbouncer/i, weight: 0.7, note: 'pool implementation' },
      { re: /connection (is )?not available|request timed out after/i, weight: 0.6, note: 'connection acquisition timeout' },
      { re: /too many (client )?connections|max_connections|connection limit/i, weight: 0.8, note: 'connection limit hit' },
      { re: /connection timed out|connect timed out/i, weight: 0.7, note: 'connection timed out' },
      { re: /javax?\.sql|java\.sql|sqltransientconnection/i, weight: 0.6, note: 'JDBC SQL exception' },
      { re: /waiting=\d+|active=\d+|idle=0/i, weight: 0.5, note: 'pool stats' },
    ],
    errorTypes: [/SQLException/i, /SQLTransientConnectionException/i, /JDBCConnectionException/i],
    severityHint: 'critical',
    impactTemplate:
      'Write-path requests to the payments datastore failed for the duration of the saturation window; charges, refunds and webhook settlement retries were rejected with HTTP 500. Read replicas stayed healthy, so balance and history views remained available.',
    contributingFactors: [
      'Connection pool sized for pre-scale traffic (50 connections) while concurrent payment workers tripled',
      'A long-running transaction held connections far beyond the acquisition timeout',
      'No circuit breaker between PaymentService and the primary datastore, so saturation propagated upstream',
      'Alerts fired on error rate instead of pool utilisation, delaying detection by ~6 minutes',
    ],
    preventiveActions: [
      'Raise the HikariCP maximumPoolSize from 50 to 150 and set connectionTimeout to 5s (fail fast)',
      'Add a saturation HPA metric: scale payment workers on pool utilisation > 70%',
      'Add per-connection leak detection (leakDetectionThreshold=10s) and alert on pool wait time p95',
      'Introduce Resilience4j bulkheads so one datastore cannot starve other downstreams',
    ],
    lessonsLearned: [
      'Pool sizing must be derived from worker concurrency, not from historical averages',
      'A timeout without a circuit breaker converts a slow dependency into an outage',
      'Dashboards tracked error rate but not the leading indicator (pool saturation)',
    ],
    resolutionSteps: [
      'Increased maximumPoolSize 50 → 150 and restarted payment workers in a rolling fashion',
      'Killed the long-running transaction holding 11 idle-in-transaction connections',
      'Added transient-connection retry with jittered backoff around the acquisition call',
      'Drained and replayed the payment webhook DLQ (4,812 messages) after latency recovered',
    ],
    fixTemplate: 'Increase database connection pool from 50 to 150',
    runbook: 'RB-DB-004 · Datastore saturation',
  },
  {
    key: 'upstream_timeout',
    label: 'Upstream dependency timeout / latency cascade',
    patterns: [
      { re: /socket ?timeout|read timed out|timeout exception|etimedout|esockettimeout/i, weight: 1.0, note: 'socket read timeout' },
      { re: /504|gateway timeout|upstream (request )?timeout/i, weight: 0.9, note: 'gateway timeout' },
      { re: /\b5 04\b|deadline exceeded/i, weight: 0.8, note: 'deadline exceeded' },
      { re: /circuit ?breaker|hystrix|resilience4j/i, weight: 0.5, note: 'circuit breaker present' },
      { re: /retry|retrying|attempt \d+ of/i, weight: 0.3, note: 'retry loop' },
      { re: /p99|latency|slow/i, weight: 0.2, note: 'latency signal' },
    ],
    errorTypes: [/SocketTimeoutException/i, /TimeoutException/i, /GatewayTimeout/i, /ReadTimeout/i],
    severityHint: 'high',
    impactTemplate:
      'Checkout requests that fanned out to the upstream pricing service degraded past the 2s client deadline; 9.4% of sessions hit gateway timeouts before the circuit breaker isolated the dependency.',
    contributingFactors: [
      'Client timeout (5s) exceeded the caller budget (2s), so retries amplified load',
      'No per-dependency circuit breaker; every slow response created three retries',
      'Upstream service had no bulkhead, so one slow tenant degraded all tenants',
    ],
    preventiveActions: [
      'Align client deadlines to the caller budget (deadline < 60% of client timeout)',
      'Enable Resilience4j circuit breaker with 50% failure threshold over a 20-call window',
      'Add hedged requests only behind a budget guard to avoid retry amplification',
    ],
    lessonsLearned: [
      'Timeouts are contracts: every hop must fit inside the caller budget',
      'Retries without jitter and caps turn a brownout into an outage',
    ],
    resolutionSteps: [
      'Lowered gateway read timeout to 1.5s and enabled circuit breaker over the pricing client',
      'Enabled adaptive retry (max 2 attempts, exponential backoff with jitter)',
      'Added per-tenant bulkhead and weight-based load shedding',
    ],
    fixTemplate: 'Align upstream deadlines with caller budget + enable circuit breaker',
    runbook: 'RB-NET-011 · Upstream latency cascade',
  },
  {
    key: 'redis_failure',
    label: 'Redis cluster failover / cache connection failure',
    patterns: [
      { re: /redis.*(refused|unavailable|closed|timeout|down)/i, weight: 1.0, note: 'redis unavailable' },
      { re: /jedis|lettuce|redisson/i, weight: 0.7, note: 'redis client' },
      { re: /connection refused/i, weight: 0.6, note: 'connection refused' },
      { re: /master|replica|failover|role changed|cluster state/i, weight: 0.6, note: 'cluster failover' },
      { re: /no auth|noperm|wrongpass/i, weight: 0.4, note: 'redis auth' },
      { re: /cache miss storm|hot key/i, weight: 0.5, note: 'cache miss storm' },
    ],
    errorTypes: [/RedisConnectionFailureException/i, /RedisSystemException/i, /ConnectException/i],
    severityHint: 'high',
    impactTemplate:
      'Session lookups and idempotency keys were unavailable; 38% of authenticated requests fell back to the database, pushing primary CPU to 91% before cache connectivity was restored.',
    contributingFactors: [
      'Client retry backoff was fixed at 50ms, hammering a cluster that was mid-failover',
      'No local (Caffeine) cache tier to absorb cache loss',
      'Failover was triggered by an infrastructure maintenance action without a client drain window',
    ],
    preventiveActions: [
      'Use the Lettuce cluster topology client with exponential backoff (100ms → 5s) and jitter',
      'Add an in-process L1 cache with 30s TTL for hot session keys',
      'Gate cache-node maintenance behind a k8s PDB and drain sessions first',
      'Add Redis Cluster State + failover count to the incident dashboard',
    ],
    lessonsLearned: [
      'A cache is an optional dependency: losing it must degrade, not collapse',
      'Fixed retry intervals are DDoS on your own infrastructure during failover',
    ],
    resolutionSteps: [
      'Restored cluster topology (3 primaries / 3 replicas) and forced a full slot re-map',
      'Increased Lettuce retry budget with exponential backoff and reduced command timeout to 250ms',
      'Enabled L1 Caffeine cache for session lookups to absorb the next failover',
    ],
    fixTemplate: 'Harden Redis client with topology-aware backoff + local L1 cache',
    runbook: 'RB-CACHE-002 · Cache failover',
  },
  {
    key: 'memory_leak',
    label: 'JVM heap leak / OOMKilled under steady traffic',
    patterns: [
      { re: /outofmemory|oomkill|java\.lang\.outofmemoryerror|heap space/i, weight: 1.0, note: 'OutOfMemoryError' },
      { re: /gc (pause|overhead)|full gc|g1 evacuation/i, weight: 0.8, note: 'GC pressure' },
      { re: /memory leak|growing|retained heap|heap dump/i, weight: 0.9, note: 'heap growth' },
      { re: /container (restart|killed)|exit code 137|signal 9/i, weight: 0.7, note: 'container killed' },
      { re: /cache.*unbounded|no eviction/i, weight: 0.6, note: 'unbounded cache' },
    ],
    errorTypes: [/OutOfMemoryError/i, /OOMKilled/i, /StackOverflowError/i],
    severityHint: 'critical',
    impactTemplate:
      'Indexer pods restarted 14 times in 70 minutes; search freshness lagged by up to 41 minutes and 62% of freshly published documents were not discoverable.',
    contributingFactors: [
      'An unbounded static cache of document embeddings grew with every reindex pass',
      'Heap sizing (2 GiB) was never revisited after the embedding model doubled vector size',
      'No leak-detection alerting on post-GC retained heap trend',
    ],
    preventiveActions: [
      'Bound caches with Caffeine maximumSize + weight-based eviction (10k entries / 512 MB)',
      'Set -XX:+HeapDumpOnOutOfMemoryError and ship dumps to object storage for autopsy',
      'Alert when post-full-GC retained heap grows > 5% over 6 hours',
      'Add a nightly soak test at 2x production throughput',
    ],
    lessonsLearned: [
      'Unbounded caches are leaks with a nicer name',
      'Memory regressions are invisible until the next traffic step-change',
    ],
    resolutionSteps: [
      'Replaced the static embedding cache with a size-bounded Caffeine cache (TTL 30m)',
      'Increased heap 2 GiB → 4 GiB and tuned G1 (MaxGCPauseMillis=200, heap region 8M)',
      'Added a leak-canary soak job that fails the pipeline on > 5% retained-heap growth',
    ],
    fixTemplate: 'Bound the embedding cache + raise heap and tune G1',
    runbook: 'RB-JVM-007 · Heap leak triage',
  },
  {
    key: 'failed_deployment',
    label: 'Failed deployment / bad release rolled back',
    patterns: [
      { re: /deploy|rollout|release|canary|blue.?green/i, weight: 0.8, note: 'deployment context' },
      { re: /migration|flyway|liquibase|schema change/i, weight: 0.7, note: 'schema migration' },
      { re: /startup probe|readiness|liveness|crashloopbackoff/i, weight: 0.9, note: 'pod crash loop' },
      { re: /no such column|relation .* does not exist|column .* does not exist/i, weight: 1.0, note: 'schema drift' },
      { re: /rollback|revert/i, weight: 0.6, note: 'rollback' },
      { re: /version mismatch|incompatible/i, weight: 0.5, note: 'version mismatch' },
    ],
    errorTypes: [/PSQLException/i, /MigrationException/i, /CrashLoopBackOff/i, /InternalServerError/i],
    severityHint: 'critical',
    impactTemplate:
      'A partially applied schema migration made the new build incompatible with the live database; 100% of checkout writes failed for 23 minutes until the release was rolled back.',
    contributingFactors: [
      'Migration ran inside the deploy job after pods had already started serving traffic',
      'No expand/contract (backwards-compatible) migration pattern',
      'Canary analysis window (60s) was shorter than the p95 traffic sampling window',
    ],
    preventiveActions: [
      'Adopt expand → migrate → contract so every release is compatible with N-1',
      'Run migrations as a pre-deploy job gated on a successful dry-run',
      'Extend canary analysis to 10 minutes with automated error-budget abort',
    ],
    lessonsLearned: [
      'Deploys must be reversible without a database rollback',
      'Canary windows shorter than your traffic cycle are theatre',
    ],
    resolutionSteps: [
      'Rolled back to the previous release (revision 218) and paused the pipeline',
      'Rewrote the migration as expand/contract and replayed it during a low-traffic window',
      'Added a pre-deploy migration dry-run gate with automatic abort on error rate > 0.5%',
    ],
    fixTemplate: 'Roll back release + convert migration to expand/contract',
    runbook: 'RB-DEP-001 · Failed release',
  },
  {
    key: 'auth_failure',
    label: 'Authentication / token verification failure',
    patterns: [
      { re: /401|unauthorized|invalid (token|signature)|jwt/i, weight: 1.0, note: 'JWT / 401' },
      { re: /jwks|kid|key rotation|signing key/i, weight: 0.9, note: 'signing key rotation' },
      { re: /signature verification failed|token expired|tokeninvalid/i, weight: 0.9, note: 'token verification failed' },
      { re: /clock skew|nbf|iat/i, weight: 0.5, note: 'clock skew' },
      { re: /oauth|openid|saml/i, weight: 0.4, note: 'identity provider' },
    ],
    errorTypes: [/JWTVerificationException/i, /SignatureException/i, /UnauthorizedException/i],
    severityHint: 'critical',
    impactTemplate:
      'Every service that verified tokens with the rotated signing key returned 401; 11,480 users were logged out mid-session and all API clients with cached JWKS failed.',
    contributingFactors: [
      'JWKS cache TTL (24h) outlived the signing-key rotation window (15 min)',
      'Key rotation had no dual-publish (old + new) grace period',
      'Only one algorithm/issuer was accepted; no fallback verification path',
    ],
    preventiveActions: [
      'Invalidate JWKS on `kid` miss and set cache TTL to 10 minutes with stale-while-revalidate',
      'Enforce dual-publish: new key live for 24h before old key is retired',
      'Add synthetic auth probe every 60s per region with paging alert',
    ],
    lessonsLearned: [
      'Credential rotation is a distributed-systems problem, not an ops chore',
      'Caching a rotating resource without invalidation guarantees an outage',
    ],
    resolutionSteps: [
      'Restored the previous signing key alongside the new one (dual publish)',
      'Flushed JWKS caches across all auth consumers and reduced TTL to 10 minutes',
      'Deployed kid-miss-triggered refresh and re-issued tokens for affected sessions',
    ],
    fixTemplate: 'Flush JWKS cache, dual-publish signing keys, cut TTL to 10m',
    runbook: 'RB-SEC-003 · Identity verification failure',
  },
  {
    key: 'cpu_exhaustion',
    label: 'CPU exhaustion / runaway worker loop',
    patterns: [
      { re: /cpu (throttl|saturat|exhaust)|load average|100% cpu|high cpu/i, weight: 1.0, note: 'CPU saturation' },
      { re: /throttled|cf ?throttl|cfs_quota/i, weight: 0.9, note: 'cgroup throttling' },
      { re: /infinite loop|hot loop|busy.?wait|spin/i, weight: 0.9, note: 'runaway loop' },
      { re: /retry storm|backoff exhausted|poison/i, weight: 0.6, note: 'retry storm' },
      { re: /latency (spike|degradation)|p99/i, weight: 0.3, note: 'latency degradation' },
    ],
    errorTypes: [/ThrottlingException/i, /TimeoutException/i, /ExecutionException/i],
    severityHint: 'high',
    impactTemplate:
      'Notification workers pinned at CPU limit and were throttled to 4% of quota; 1.2M notifications were delayed by up to 55 minutes.',
    contributingFactors: [
      'Retry backoff was absent — a failing downstream caused a tight retry loop',
      'CPU limit (750m) was below the serialization cost of the new payload format',
      'No concurrency cap per worker; 400 goroutines competed for one core',
    ],
    preventiveActions: [
      'Add jittered exponential backoff and a per-downstream token bucket',
      'Set worker concurrency from measured CPU cost (serialization benchmark in CI)',
      'Alert on cgroup throttling ratio > 5% and scale on it instead of CPU utilisation',
    ],
    lessonsLearned: [
      'CPU throttling looks like flapping latency but is a scheduling problem',
      'Retry loops are the most common self-inflicted CPU incident',
    ],
    resolutionSteps: [
      'Reduced worker concurrency 400 → 64 and enabled exponential backoff with jitter',
      'Raised CPU limit 750m → 2 cores and enabled HPA on throttling metric',
      'Drained the delayed notification backlog through a priority queue',
    ],
    fixTemplate: 'Cap worker concurrency and replace retry loop with jittered backoff',
    runbook: 'RB-CMP-005 · CPU throttling',
  },
  {
    key: 'certificate_failure',
    label: 'Expired TLS certificate / handshake failure',
    patterns: [
      { re: /certificate (has )?expired|expired certificate|cert.*not ?after/i, weight: 1.0, note: 'certificate expired' },
      { re: /sslhandshake|handshake failure|tls|unknown_ca|x509/i, weight: 0.9, note: 'TLS handshake' },
      { re: /certificat(e|ion) path|self.signed|verify failed/i, weight: 0.8, note: 'chain verification' },
      { re: /hostname mismatch|sni/i, weight: 0.6, note: 'hostname mismatch' },
      { re: /error 525|525|526/i, weight: 0.5, note: 'CDN TLS error' },
    ],
    errorTypes: [/SSLHandshakeException/i, /CertPathValidatorException/i, /CertificateExpiredException/i],
    severityHint: 'critical',
    impactTemplate:
      'Edge TLS terminated with handshake failures for 18 minutes; all public traffic to checkout was rejected before the renewed certificate was activated.',
    contributingFactors: [
      'cert-manager renewal failed silently 21 days before expiry (DNS-01 rate limited)',
      'No certificate-expiry alert with multi-week lead time',
      'Manual certificate upload was the only documented recovery path',
    ],
    preventiveActions: [
      'Alert at 30 / 14 / 7 / 3 days before expiry across all ingress certificates',
      'Move to cert-manager with a DNS-01 solver and cluster-wide issuer health checks',
      'Add a synthetic TLS probe per host every 5 minutes with handshake validation',
    ],
    lessonsLearned: [
      'Silent automation failure is more dangerous than known manual steps',
      'Expiry alerts must exist on every layer: ingress, service mesh, and outbound mTLS',
    ],
    resolutionSteps: [
      'Issued and installed the renewed wildcard certificate on the edge cluster',
      'Fixed the DNS-01 solver permissions and forced a cert-manager reconcile',
      'Added TLS probes and expiry alerting to the on-call rotation',
    ],
    fixTemplate: 'Install renewed certificate and repair cert-manager DNS-01 solver',
    runbook: 'RB-TLS-002 · Certificate expiry',
  },
  {
    key: 'message_queue',
    label: 'Message queue backlog / poison message',
    patterns: [
      { re: /queue|kafka|rabbitmq|sqs|pubsub|amqp/i, weight: 0.8, note: 'broker reference' },
      { re: /consumer lag|backlog|offset lag|partition lag/i, weight: 1.0, note: 'consumer lag' },
      { re: /dead letter|dlq|poison (message|pill)/i, weight: 0.9, note: 'DLQ / poison message' },
      { re: /rebalance|partition assignment|group coordinator/i, weight: 0.8, note: 'consumer rebalance' },
      { re: /max.poll.interval|deserializ/i, weight: 0.5, note: 'poll interval / deserialize' },
    ],
    errorTypes: [/MessageListenerExecutionException/i, /DeserializationException/i, /RebalanceInProgressException/i],
    severityHint: 'high',
    impactTemplate:
      'Order events accumulated to a 412k-message backlog; downstream fulfilment and invoicing lagged up to 74 minutes with 3.1k orders stuck in PROCESSING.',
    contributingFactors: [
      'One poison message caused a permanent retry loop, blocking the partition head',
      'No DLQ routing after N attempts and no idempotency key on the consumer',
      'Consumer max.poll.interval was below the p99 handler duration after a payload change',
    ],
    preventiveActions: [
      'Route to DLQ after 3 attempts with the original payload and failure context',
      'Make consumers idempotent on order_id + event_version and add offset checkpoints',
      'Alert on consumer lag in seconds (not messages) and on rebalance frequency',
      'Add a replay CLI for DLQ drain with rate limiting',
    ],
    lessonsLearned: [
      'A single poison message can stall a partition forever without DLQ routing',
      'Lag measured in messages hides the business impact; measure in time',
    ],
    resolutionSteps: [
      'Quarantined the poison message to the DLQ and lifted the partition block',
      'Scaled consumers 6 → 18 partitions in parallel to drain the backlog in 22 minutes',
      'Deployed idempotent handler with 3-attempt DLQ routing and replayed failures',
    ],
    fixTemplate: 'Quarantine poison message, add DLQ routing and idempotent consumer',
    runbook: 'RB-MQ-006 · Consumer backlog',
  },
  {
    key: 'db_locking',
    label: 'Database lock contention / slow query storm',
    patterns: [
      { re: /deadlock|lock wait|lock timeout|could not obtain lock/i, weight: 1.0, note: 'lock contention' },
      { re: /slow query|seq scan|missing index|query plan/i, weight: 0.8, note: 'slow query' },
      { re: /connection.*hung|idle in transaction/i, weight: 0.7, note: 'idle in transaction' },
      { re: /n\+1|orm query storm/i, weight: 0.6, note: 'N+1 query storm' },
      { re: /statement timeout|canceling statement/i, weight: 0.7, note: 'statement timeout' },
    ],
    errorTypes: [/DeadlockLoserDataAccessException/i, /PessimisticLockingFailureException/i, /PSQLException/i],
    severityHint: 'high',
    impactTemplate:
      'Inventory reservation writes serialized behind a deadlock; checkout conversion dropped 34% for 41 minutes before the transaction pattern was corrected.',
    contributingFactors: [
      'Two write paths acquired row locks in opposite order',
      'Missing composite index forced sequential scans under concurrent load',
      'Transactions wrapped HTTP calls, holding locks for hundreds of milliseconds',
    ],
    preventiveActions: [
      'Order lock acquisition consistently (always inventory → order)',
      'Add covering index on (sku, warehouse_id, status) and verify with EXPLAIN in CI',
      'Never call external services inside a transaction; use outbox pattern',
    ],
    lessonsLearned: [
      'Lock ordering is an architectural invariant, not a coding preference',
      'Every ORM convenience must survive a concurrency review',
    ],
    resolutionSteps: [
      'Killed the blocking sessions and released the write lock chain',
      'Standardized lock ordering and shrank transactions to sub-20ms',
      'Added the covering index and an EXPLAIN regression test in CI',
    ],
    fixTemplate: 'Standardize lock ordering + add covering index for inventory writes',
    runbook: 'RB-DB-009 · Lock contention',
  },
  {
    key: 'edge_cache',
    label: 'Edge/CDN cache poisoning and 5xx surge',
    patterns: [
      { re: /cdn|cloudflare|cloudfront|edge cache|varnish/i, weight: 0.9, note: 'edge cache' },
      { re: /cache.?key|vary header|stale.?while.?revalidate/i, weight: 0.8, note: 'cache key issue' },
      { re: /502|503|bad gateway|origin error/i, weight: 0.8, note: 'edge 5xx' },
      { re: /cache (hit|miss) ratio/i, weight: 0.5, note: 'cache ratio' },
      { re: /poison|x-cache/i, weight: 0.4, note: 'cache poisoning' },
    ],
    errorTypes: [/Bad Gateway/i, /OriginTimeout/i, /503 Service Unavailable/i],
    severityHint: 'high',
    impactTemplate:
      'A cache-key regression caused per-user HTML fragments to be cached at the edge; 22% of visitors saw other users’ cart state until the cache was purged.',
    contributingFactors: [
      'New personalization header was not part of the cache key',
      'No canary for edge config changes; the deploy went to 100% of POPs',
      'Missing negative-cache guard, so error responses were cached for 60s',
    ],
    preventiveActions: [
      'Include all personalization headers in the cache key (Vary: x-user-bucket)',
      'Stage edge config changes at 5% of POPs with a 15-minute observation window',
      'Never cache responses with Set-Cookie or 5xx status',
    ],
    lessonsLearned: [
      'Edge config is production code: it needs review, canary and rollback',
      'Personalisation and caching must be designed together',
    ],
    resolutionSteps: [
      'Purged the edge cache globally and disabled fragment caching',
      'Corrected the cache key to include the personalization header',
      'Re-enabled caching at 5% of POPs and promoted after metrics were clean',
    ],
    fixTemplate: 'Purge edge cache and fix cache key to include personalization header',
    runbook: 'RB-EDGE-004 · Edge cache integrity',
  },
  {
    key: 'search_cluster',
    label: 'Search cluster degradation (red shards)',
    patterns: [
      { re: /elasticsearch|opensearch|cluster (red|yellow)|shard (unassigned|failed)/i, weight: 1.0, note: 'search cluster state' },
      { re: /unassigned_shards|cluster_block_exception|circuit_breaking/i, weight: 0.9, note: 'shard / breaker' },
      { re: /bulk.*(fail|reject)|429/i, weight: 0.6, note: 'bulk rejection' },
      { re: /disk watermark|flood stage/i, weight: 0.8, note: 'disk watermark' },
    ],
    errorTypes: [/ClusterBlockException/i, /CircuitBreakingException/i, /SearchPhaseExecutionException/i],
    severityHint: 'high',
    impactTemplate:
      'Search cluster entered red state with 14 unassigned primary shards; product search returned degraded results and category pages timed out for 27 minutes.',
    contributingFactors: [
      'Disk usage crossed the high watermark on two data nodes',
      'Index rotation policy kept 120 days of searchable data on hot nodes',
      'No ILM policy to move cold data to cheaper storage',
    ],
    preventiveActions: [
      'Add ILM policy: hot 7d → warm 30d → cold 90d → delete 180d',
      'Alert on unassigned shards and disk watermark at 75% / 85% / 90%',
      'Pin replicas away from the affected availability zone during maintenance',
    ],
    lessonsLearned: [
      'Search clusters decay slowly then fail suddenly at the disk watermark',
      'Retention policy is a capacity plan, not a cleanup task',
    ],
    resolutionSteps: [
      'Freed disk by deleting expired indices and forcing shard reallocation',
      'Applied ILM policy and rebalanced shards across three zones',
      'Added watermark alerts and a weekly capacity forecast job',
    ],
    fixTemplate: 'Apply ILM retention policy and rebalance shards off saturated nodes',
    runbook: 'RB-SEARCH-003 · Cluster health',
  },
];

export const CATEGORY_BY_KEY: Record<string, Category> = Object.fromEntries(
  CATEGORIES.map((c) => [c.key, c]),
) as Record<string, Category>;

/** Domain keywords get up-weighted so a 30-line stack trace is not drowned by boilerplate. */
export const KEYWORD_WEIGHTS: Record<string, number> = {
  jdbc: 3.2, hikari: 3.0, hikaricp: 3.0, sql: 2.4, sqlstate: 2.6, pool: 2.8, exhausted: 2.4,
  connection: 2.0, timeout: 2.2, timed: 1.6, redis: 3.0, lettuce: 2.6, jedis: 2.6, cluster: 1.8,
  outofmemory: 3.0, oomkill: 3.0, heap: 2.6, gc: 2.2, memory: 2.2, leak: 2.4, certificate: 3.2,
  cert: 2.8, tls: 2.8, ssl: 2.6, handshake: 2.4, x509: 2.6, expired: 2.4, jwt: 3.0, token: 2.2,
  jwks: 3.0, unauthorized: 2.4, signature: 2.2, kafka: 3.0, rabbitmq: 3.0, queue: 2.4, consumer: 2.2,
  lag: 2.2, dlq: 2.8, partition: 2.0, rebalance: 2.4, deadlock: 3.0, lock: 2.4, migration: 2.6,
  deployment: 2.6, deploy: 2.4, rollout: 2.4, canary: 2.4, rollback: 2.2, cpu: 2.8, throttled: 2.8,
  throttling: 2.8, saturation: 2.2, elasticsearch: 3.0, shard: 2.6, opensearch: 3.0, cdn: 2.6,
  cloudflare: 2.6, cache: 2.2, payment: 2.2, checkout: 2.0, gateway: 1.8, service: 0.5,
  error: 0.6, exception: 1.8, failed: 1.4, failure: 1.6, unable: 0.8, request: 0.6, server: 0.5,
  java: 0.8, com: 0.2, org: 0.2, at: 0.1, caused: 0.4, info: 0.2, warn: 0.3, debug: 0.2,
};

export const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'is', 'are', 'was',
  'were', 'be', 'been', 'it', 'this', 'that', 'as', 'by', 'from', 'than', 'then', 'so', 'if',
  'we', 'you', 'they', 'he', 'she', 'not', 'no', 'yes', 'can', 'will', 'would', 'should',
  'has', 'have', 'had', 'do', 'does', 'did', 'but', 'into', 'over', 'after', 'before', 'while',
]);
