/**
 * Sleep Executor
 *
 * Consumes the sleep queue (`sleep_jobs`) for one entity: deferred judgements
 * the write-time gate could not make with vectors alone. It is a stateless
 * function, not a resident worker — the host calls it after a conversation
 * turn (usage piggyback) or from a manual operator action. There is no cron.
 *
 * One call processes at most one batch. Quiet entities cost nothing: the
 * wake-up check is a single indexed count and returns early below threshold.
 *
 * All verdicts are soft. A merge demotes the losing node (ranking penalty) and
 * records a `supersedes` edge; nothing is physically deleted. A dry run
 * computes the same verdicts and writes nothing at all.
 *
 * The v1 rules judge on embedding similarity only, so everything they record is
 * a hypothesis: merge edges carry origin `knn_seed` with strength = similarity,
 * exactly like gate seeds. Origin has two values (rule vs. context) and the
 * executor adds none.
 *
 * Caps (per design): once per pair (verdict is terminal), batch size, entity
 * cooldown, and a global daily budget — all derived from the queue table.
 */

import type { MemoryStorage } from './storage';
import type { Memory, SleepJob } from '../types';

/**
 * Sleep executor configuration. Values are supplied by the host; missing or
 * invalid fields fall back to defaults via {@link normalizeSleepConfig}.
 *
 * @public
 */
export interface SleepConfig {
  /** Master switch for piggyback runs (manual `force`/`dryRun` runs ignore it). Default false */
  enabled: boolean;
  /** Wake when this many jobs are pending for the entity. Default 10 */
  minQueueDepth: number;
  /** Wake when the oldest pending job is at least this old (days). Default 1 */
  maxOldestAgeDays: number;
  /** Jobs processed per run. Default 10 */
  batchSize: number;
  /** Minimum minutes between two runs for the same entity. Default 360 (6 hours) */
  entityCooldownMinutes: number;
  /** Max jobs finished in the trailing 24 hours across all entities. Default 200 */
  dailyBudget: number;
  /** Pairs at/above this similarity merge by rule; below → coexist. Default 0.93 */
  mergeSimilarityBand: number;
  /** A `processing` claim older than this (minutes) is reclaimable. Default 10 */
  staleClaimMinutes: number;
}

/**
 * Default sleep configuration (executor disabled for piggyback runs).
 *
 * @public
 */
export const DEFAULT_SLEEP_CONFIG: Readonly<SleepConfig> = Object.freeze({
  enabled: false,
  minQueueDepth: 10,
  maxOldestAgeDays: 1,
  batchSize: 10,
  entityCooldownMinutes: 360,
  dailyBudget: 200,
  mergeSimilarityBand: 0.93,
  staleClaimMinutes: 10,
});

/**
 * Normalizes partial config into a complete, validated {@link SleepConfig}.
 * Each invalid field falls back to its default.
 *
 * @param partial - Partial config from the host
 * @returns Complete config
 *
 * @public
 */
export function normalizeSleepConfig(partial?: Partial<SleepConfig>): SleepConfig {
  const cfg: SleepConfig = { ...DEFAULT_SLEEP_CONFIG };
  if (!partial) return cfg;
  if (typeof partial.enabled === 'boolean') cfg.enabled = partial.enabled;
  const int = (v: unknown, min: number, max: number): number | undefined =>
    typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : undefined;
  const num = (v: unknown, min: number, max: number): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : undefined;
  cfg.minQueueDepth = int(partial.minQueueDepth, 1, 10_000) ?? cfg.minQueueDepth;
  cfg.maxOldestAgeDays = num(partial.maxOldestAgeDays, 0, 3650) ?? cfg.maxOldestAgeDays;
  cfg.batchSize = int(partial.batchSize, 1, 200) ?? cfg.batchSize;
  cfg.entityCooldownMinutes =
    num(partial.entityCooldownMinutes, 0, 100_000) ?? cfg.entityCooldownMinutes;
  cfg.dailyBudget = int(partial.dailyBudget, 0, 1_000_000) ?? cfg.dailyBudget;
  cfg.mergeSimilarityBand = num(partial.mergeSimilarityBand, 0, 1) ?? cfg.mergeSimilarityBand;
  cfg.staleClaimMinutes = num(partial.staleClaimMinutes, 1, 100_000) ?? cfg.staleClaimMinutes;
  return cfg;
}

/**
 * Per-run options.
 *
 * @public
 */
export interface SleepRunOptions {
  /** Manual run: ignore `enabled`, wake thresholds, cooldown and budget. Batch size still applies */
  force?: boolean;
  /**
   * Preview: compute the verdicts of the jobs a run would claim and return them
   * **without any write** — no claim, no status change, no edges, no completion.
   * Implies `force`. The operator reviews the verdict list before a real run.
   */
  dryRun?: boolean;
  /** Log each verdict */
  verbose?: boolean;
}

/**
 * One job's verdict as reported by a run (real or dry-run).
 *
 * @public
 */
export interface SleepJobVerdict {
  /** Job UUID */
  jobId: string;
  /** Job kind */
  kind: string;
  /** Terminal status the job got (or would get) */
  status: 'done' | 'skipped' | 'failed';
  /** Kind-specific verdict record */
  verdict: Record<string, unknown>;
  /** false in dry-run: nothing was written */
  applied: boolean;
  /** Merge only: representative content (first 160 chars) */
  keepContent?: string;
  /** Merge only: demoted content (first 160 chars) */
  demoteContent?: string;
}

/**
 * Why a run did or did not process jobs.
 *
 * @public
 */
export type SleepRunReason =
  | 'disabled'
  | 'empty'
  | 'below_threshold'
  | 'cooldown'
  | 'budget'
  | 'ran';

/**
 * Summary of one executor call.
 *
 * @public
 */
export interface SleepRunResult {
  /** Whether a batch was claimed (or, in dry-run, previewed) and judged */
  ran: boolean;
  /** Decision outcome */
  reason: SleepRunReason;
  /** Pending jobs before the run (-1 when the run returned before counting) */
  pendingBefore: number;
  /** Jobs claimed (or previewed) in this run */
  claimed: number;
  /** Merge verdicts (loser demoted, supersedes edge recorded) */
  merged: number;
  /** Coexist verdicts (no change) */
  coexisted: number;
  /** Skipped (missing node, invalid payload, unknown kind) */
  skipped: number;
  /** Jobs that threw */
  failed: number;
  /** Pending jobs after the run */
  pendingAfter: number;
  /** true when nothing was written (dry-run) */
  dryRun: boolean;
  /** Per-job verdicts of this run (audit / operator review) */
  verdicts: SleepJobVerdict[];
}

const isUuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

const snippet = (content: string): string =>
  content.length > 160 ? `${content.slice(0, 160)}…` : content;

/**
 * Picks the representative of a near-duplicate pair: active beats demoted,
 * then more retrievals (usage evidence), then the longer content (no
 * information is lost by demoting the shorter restatement), then the older
 * node (the matched, pre-existing one).
 */
function pickRepresentative(a: Memory, b: Memory): { keep: Memory; demote: Memory } {
  const rank = (m: Memory): [number, number, number, number] => [
    (m.status ?? 'active') === 'active' ? 1 : 0,
    m.retrievalCount ?? 0,
    m.content.length,
    -new Date(m.createdAt).getTime(),
  ];
  const ra = rank(a);
  const rb = rank(b);
  for (let i = 0; i < ra.length; i++) {
    if (ra[i] !== rb[i]) return ra[i] > rb[i] ? { keep: a, demote: b } : { keep: b, demote: a };
  }
  return { keep: b, demote: a };
}

/**
 * Runs the sleep executor for one entity: wake-up check, claim one batch,
 * judge each job by rule, record verdicts. Side effects are limited to the
 * claimed jobs' rows, node status of merge losers, and `supersedes` edges.
 * With `dryRun` there are no side effects at all.
 *
 * @param storage - Memory storage
 * @param entityId - Entity whose queue to consume
 * @param config - Executor configuration (see {@link normalizeSleepConfig})
 * @param options - `force` for manual runs, `dryRun` for a write-free preview, `verbose` for logs
 * @returns Run summary including per-job verdicts
 *
 * @example
 * ```ts
 * // Host, right after the conversation-turn memory write:
 * const result = await runSleep(storage, entityId, { enabled: true });
 * // Operator preview (nothing written):
 * const preview = await runSleep(storage, entityId, undefined, { dryRun: true });
 * ```
 *
 * @public
 */
export async function runSleep(
  storage: MemoryStorage,
  entityId: string,
  config?: Partial<SleepConfig>,
  options: SleepRunOptions = {},
): Promise<SleepRunResult> {
  const cfg = normalizeSleepConfig(config);
  const dryRun = options.dryRun === true;
  const force = options.force === true || dryRun;
  const staleSeconds = cfg.staleClaimMinutes * 60;
  const base = (reason: SleepRunReason, pending: number): SleepRunResult => ({
    ran: false,
    reason,
    pendingBefore: pending,
    claimed: 0,
    merged: 0,
    coexisted: 0,
    skipped: 0,
    failed: 0,
    pendingAfter: pending,
    dryRun,
    verdicts: [],
  });

  if (!force && !cfg.enabled) return base('disabled', -1);

  const stats = await storage.getSleepQueueStats(entityId, staleSeconds);
  if (stats.pending === 0) return base('empty', 0);

  if (!force) {
    const now = Date.now();
    const oldestAgeDays = stats.oldestPendingAt
      ? (now - new Date(stats.oldestPendingAt).getTime()) / 86_400_000
      : 0;
    const depthOk = stats.pending >= cfg.minQueueDepth;
    const ageOk = oldestAgeDays >= cfg.maxOldestAgeDays;
    if (!depthOk && !ageOk) return base('below_threshold', stats.pending);

    if (
      stats.lastProcessedAt &&
      now - new Date(stats.lastProcessedAt).getTime() < cfg.entityCooldownMinutes * 60_000
    ) {
      return base('cooldown', stats.pending);
    }

    const windowStart = new Date(now - 86_400_000);
    const processedInWindow = await storage.countSleepJobsProcessedSince(windowStart);
    if (processedInWindow >= cfg.dailyBudget) return base('budget', stats.pending);
  }

  const jobs = dryRun
    ? await storage.listClaimableSleepJobs(entityId, cfg.batchSize, staleSeconds)
    : await storage.claimSleepJobs(entityId, cfg.batchSize, staleSeconds);
  const result: SleepRunResult = {
    ran: true,
    reason: 'ran',
    pendingBefore: stats.pending,
    claimed: jobs.length,
    merged: 0,
    coexisted: 0,
    skipped: 0,
    failed: 0,
    pendingAfter: stats.pending,
    dryRun,
    verdicts: [],
  };

  for (const job of jobs) {
    try {
      const outcome = await judgeJob(storage, job, cfg, { apply: !dryRun });
      if (!dryRun) await storage.completeSleepJob(job.id, outcome.status, outcome.verdict);
      if (outcome.status === 'skipped') result.skipped++;
      else if (outcome.verdict.kind === 'merge') result.merged++;
      else result.coexisted++;
      result.verdicts.push({
        jobId: job.id,
        kind: job.kind,
        status: outcome.status,
        verdict: outcome.verdict,
        applied: !dryRun,
        ...(outcome.keepContent !== undefined ? { keepContent: outcome.keepContent } : {}),
        ...(outcome.demoteContent !== undefined ? { demoteContent: outcome.demoteContent } : {}),
      });
      if (options.verbose) {
        console.log('[Memory] sleep verdict:', { jobId: job.id, dryRun, ...outcome.verdict });
      }
    } catch (err) {
      result.failed++;
      const message = err instanceof Error ? err.message : String(err);
      console.error('[Memory] sleep job failed:', { jobId: job.id, kind: job.kind, message });
      result.verdicts.push({
        jobId: job.id,
        kind: job.kind,
        status: 'failed',
        verdict: { kind: job.kind, error: message },
        applied: !dryRun,
      });
      if (!dryRun) {
        try {
          await storage.completeSleepJob(job.id, 'failed', { kind: job.kind, error: message });
        } catch (inner) {
          console.error('[Memory] sleep job failure record failed:', inner);
        }
      }
    }
  }

  result.pendingAfter = dryRun
    ? stats.pending
    : (await storage.getSleepQueueStats(entityId, staleSeconds)).pending;
  return result;
}

interface JobOutcome {
  status: 'done' | 'skipped';
  verdict: Record<string, unknown>;
  keepContent?: string;
  demoteContent?: string;
}

/**
 * Rule-based judgement for one job. Only `merge_review` is known; other kinds
 * are skipped with a terminal verdict so they are never re-claimed. With
 * `apply: false` the verdict is computed but nothing is written.
 */
async function judgeJob(
  storage: MemoryStorage,
  job: SleepJob,
  cfg: SleepConfig,
  options: { apply: boolean },
): Promise<JobOutcome> {
  if (job.kind !== 'merge_review') {
    return {
      status: 'skipped',
      verdict: { kind: 'skip', reason: 'unknown_kind', jobKind: job.kind },
    };
  }
  const newId = job.payload.newMemoryId;
  const matchedId = job.payload.matchedMemoryId;
  const rawSim = job.payload.similarity;
  const similarity = typeof rawSim === 'number' && Number.isFinite(rawSim) ? rawSim : null;
  if (!isUuid(newId) || !isUuid(matchedId) || newId === matchedId) {
    return { status: 'skipped', verdict: { kind: 'skip', reason: 'invalid_payload' } };
  }

  const nodes = await storage.getMemoriesByIds([newId, matchedId]);
  const byId = new Map(nodes.map(n => [n.id, n]));
  const a = byId.get(newId);
  const b = byId.get(matchedId);
  if (!a || !b || a.entityId !== job.entityId || b.entityId !== job.entityId) {
    const missing = [!a ? newId : null, !b ? matchedId : null].filter(Boolean);
    return {
      status: 'skipped',
      verdict: { kind: 'skip', reason: 'missing_node', missing, similarity },
    };
  }

  if (similarity === null || similarity < cfg.mergeSimilarityBand) {
    return {
      status: 'done',
      verdict: { kind: 'coexist', similarity, band: cfg.mergeSimilarityBand },
    };
  }

  const { keep, demote } = pickRepresentative(a, b);
  if (options.apply) {
    await storage.setMemoryStatus(demote.id, 'demoted');
    await storage.insertEdges([
      {
        entityId: job.entityId,
        fromId: keep.id,
        toId: demote.id,
        type: 'supersedes',
        // Rule-based verdict → hypothesis grade, like any kNN seed
        origin: 'knn_seed',
        strength: similarity,
      },
    ]);
  }
  return {
    status: 'done',
    verdict: {
      kind: 'merge',
      keep: keep.id,
      demote: demote.id,
      similarity,
      band: cfg.mergeSimilarityBand,
    },
    keepContent: snippet(keep.content),
    demoteContent: snippet(demote.content),
  };
}
