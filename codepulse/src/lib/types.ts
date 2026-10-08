/**
 * CodePulse — shared domain types
 * Single source of truth for incidents, analyses, post-mortems and AI telemetry.
 */

export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type IncidentStatus = 'resolved' | 'mitigated' | 'monitoring' | 'open';
export type Environment = 'production' | 'staging' | 'canary';
export type DbBackend = 'supabase-postgres' | 'local-file' | 'memory';
export type EngineKind = 'llm' | 'pulsereasoner';

export interface Engineer {
  name: string;
  role: string;
  team: string;
  handle: string;
  hue: number;
}

export interface FixRecord {
  commit: string;
  repo: string;
  branch: string;
  pr: string;
  message: string;
  files: string[];
  diffSummary: string;
  deployedAt: string;
}

export interface TimelineEvent {
  at: string;
  label: string;
  detail: string;
  kind: 'detect' | 'triage' | 'action' | 'resolve' | 'note';
}

export interface Telemetry {
  peakErrorRate: string;
  p99Latency: string;
  affectedUsers: number;
  errorBudgetBurn: string;
}

export interface Incident {
  id: string;
  title: string;
  service: string;
  environment: Environment;
  severity: Severity;
  status: IncidentStatus;
  detectedAt: string;
  resolvedAt: string | null;
  mttrMinutes: number;
  recurring: boolean;
  recurrenceCount: number;
  rootCauseCategory: string;
  rootCauseTitle: string;
  summary: string;
  errorType: string;
  errorMessage: string;
  signature: string;
  stackTrace: string;
  evidence: string[];
  impact: string;
  resolution: string;
  resolutionSteps: string[];
  preventiveActions: string[];
  lessonsLearned: string[];
  owner: Engineer;
  fix: FixRecord;
  relatedIncidentIds: string[];
  tags: string[];
  telemetry: Telemetry;
  timeline: TimelineEvent[];
  embedding?: number[];
  embeddingVersion?: string;
}

export interface ScoreBreakdown {
  cosine: number;
  rule: number;
  composite: number;
  breakdown: { label: string; weight: number; hit: number; note: string }[];
}

export interface MatchCandidate {
  incidentId: string;
  title: string;
  service: string;
  severity: Severity;
  similarity: number;
  scores: ScoreBreakdown;
  /** light projection so the UI can render the match card without a second fetch */
  summary?: string;
  rootCauseCategory?: string;
  rootCauseTitle?: string;
  ownerName?: string;
  commit?: string;
  detectedAt?: string;
  mttrMinutes?: number;
  recurring?: boolean;
}

export interface EvidenceItem {
  kind: 'trace' | 'history' | 'fix' | 'pattern' | 'ai';
  label: string;
  detail: string;
  weight: number;
}

export interface ParsedTrace {
  errorType: string;
  errorMessage: string;
  httpStatus: string | null;
  frames: { frame: string; file: string; line: number | null; service: string | null }[];
  serviceHint: string | null;
  keywords: string[];
  signalStrength: number;
}

export interface RootCauseVerdict {
  category: string;
  title: string;
  confidence: number;
  confidenceLabel: string;
  severity: Severity;
  affectedService: string;
  environment: Environment;
  narrative: string;
  contributingFactors: string[];
  alternatives: { title: string; probability: number; note: string }[];
}

export interface FixCorrelation {
  incidentId: string;
  rootCause: string;
  /** canonical one-line description of the historical fix, e.g. "Increase database connection pool from 50 to 150" */
  fixSummary: string;
  runbook: string;
  engineer: Engineer;
  commit: string;
  repo: string;
  commitMessage: string;
  files: string[];
  resolution: string;
  resolutionSteps: string[];
  deployedAt: string;
  verifiedAfter: string;
}

export interface PostMortem {
  id: string;
  incidentId: string | null;
  analysisId: string | null;
  title: string;
  severity: Severity;
  status: 'draft' | 'published';
  generatedBy: EngineKind;
  generatedAt: string;
  summary: string;
  impact: string;
  timeline: TimelineEvent[];
  rootCause: string;
  resolution: string;
  preventiveActions: string[];
  lessonsLearned: string[];
  actionItems: { task: string; owner: string; due: string; priority: 'P0' | 'P1' | 'P2' }[];
  metrics: { mttr: string; blastRadius: string; errorBudgetBurn: string; customerImpact: string };
}

export interface AnalysisResult {
  id: string;
  analysisId: string;
  createdAt: string;
  tookMs: number;
  engine: EngineKind;
  engineLabel: string;
  dbBackend: DbBackend;
  parsed: ParsedTrace;
  match: MatchCandidate | null;
  candidates: MatchCandidate[];
  rootCause: RootCauseVerdict;
  evidence: EvidenceItem[];
  fix: FixCorrelation | null;
  explanation: string;
  postMortem: PostMortem;
  stages: { name: string; ms: number; detail: string }[];
  persisted: boolean;
  warnings: string[];
}

export interface AnalysisRecord {
  id: string;
  createdAt: string;
  service: string;
  environment: string;
  stackTrace: string;
  notes?: string;
  engine: EngineKind;
  matchedIncidentId: string | null;
  similarity: number;
  confidence: number;
  predictedRootCause: string;
  predictedSeverity: Severity;
  postMortemId: string | null;
  tookMs: number;
}

export interface AiLog {
  id: string;
  at: string;
  kind: 'analysis' | 'embedding' | 'postmortem' | 'heartbeat' | 'seed' | 'reasoning';
  provider: string;
  model: string;
  fallback: boolean;
  latencyMs: number;
  tokensEst: number;
  promptHash: string;
  promptPreview: string;
  promptFull: string;
  outputPreview: string;
  analysisId?: string;
  metadata?: Record<string, string | number | boolean>;
}
