/**
 * Memory Tuning
 *
 * Runtime-adjustable parameters consumed by memory components. The package
 * owns the contract, defaults, and validation; the application layer supplies
 * values from its own configuration source (env, database, admin UI, etc.).
 *
 * Invalid or missing fields fall back to defaults so a bad value degrades to
 * default behavior instead of breaking the memory pipeline.
 */

/**
 * Operating mode of the creation dedup gate.
 *
 * - `off`: gate disabled — no nearest-neighbor lookup is performed
 * - `shadow`: lookup and decision logging only, creation always proceeds
 * - `active`: near-duplicate creations are skipped per thresholds
 *
 * @public
 */
export type MemoryDedupGateMode = 'off' | 'shadow' | 'active';

/**
 * Operating mode of the retrieval path.
 *
 * - `legacy`: original retrieval (vector threshold + array graph traversal)
 * - `shadow`: legacy result is served; ranked retrieval runs side-effect-free
 *   in parallel and the comparison is logged for calibration
 * - `ranked`: ranked retrieval (vector top-k seeds + edge-weighted expansion
 *   + scored ranking) is served
 *
 * @public
 */
export type MemoryRetrievalMode = 'legacy' | 'shadow' | 'ranked';

/**
 * Runtime tuning values consumed by memory components.
 *
 * @public
 */
export interface MemoryTuning {
  /** Dedup gate operating mode (default: 'off') */
  dedupGateMode: MemoryDedupGateMode;
  /**
   * Cosine similarity at or above which a new memory is treated as a
   * duplicate of an existing one. Range (0, 1] (default: 0.97)
   */
  dedupSkipThreshold: number;
  /**
   * Lower bound of the gray zone: at or above this (and below
   * dedupSkipThreshold) the memory is created, linked to its nearest
   * neighbor, and queued for merge review. Range (0, 1) (default: 0.85)
   */
  dedupLinkThreshold: number;
  /**
   * Similarity floor for kNN edge seeding of newly created memories.
   * Neighbors at or above this become 'knn_seed' edge hypotheses.
   * Range (0, 1) (default: 0.6)
   */
  seedSimilarityFloor: number;
  /** Max number of kNN seed edges per created memory. Range 1-20 (default: 5) */
  seedK: number;
  /** Retrieval path mode (default: 'legacy') */
  retrievalMode: MemoryRetrievalMode;
  /** Ranked score weight for query similarity. Range 0-10 (default: 1) */
  rankWeightSimilarity: number;
  /** Ranked score weight for edge activation. Range 0-10 (default: 0.3) */
  rankWeightEdge: number;
  /** Ranked score weight for recency. Range 0-10 (default: 0.15) */
  rankWeightRecency: number;
  /** Ranked score weight for node strength. Range 0-10 (default: 0.15) */
  rankWeightStrength: number;
  /**
   * Strength decay constant per day (lazy decay). 0 disables decay —
   * effective strength = stored strength × exp(-λ × days since update).
   * Range 0-1 (default: 0)
   */
  decayLambda: number;
}

/**
 * Default tuning values. Applied for any field the application layer omits
 * or provides an invalid value for.
 *
 * @public
 */
export const DEFAULT_MEMORY_TUNING: Readonly<MemoryTuning> = Object.freeze({
  dedupGateMode: 'off' as MemoryDedupGateMode,
  dedupSkipThreshold: 0.97,
  dedupLinkThreshold: 0.85,
  seedSimilarityFloor: 0.6,
  seedK: 5,
  retrievalMode: 'legacy' as MemoryRetrievalMode,
  rankWeightSimilarity: 1,
  rankWeightEdge: 0.3,
  rankWeightRecency: 0.15,
  rankWeightStrength: 0.15,
  decayLambda: 0,
});

const DEDUP_GATE_MODES: readonly MemoryDedupGateMode[] = ['off', 'shadow', 'active'];
const RETRIEVAL_MODES: readonly MemoryRetrievalMode[] = ['legacy', 'shadow', 'ranked'];

/**
 * Normalizes partial tuning input into a complete, validated MemoryTuning.
 *
 * Each invalid field falls back to its default with a warning log.
 *
 * @param partial - Partial tuning values from the application layer
 * @returns Complete tuning with every field validated
 *
 * @public
 */
export function normalizeMemoryTuning(partial?: Partial<MemoryTuning>): MemoryTuning {
  const tuning: MemoryTuning = { ...DEFAULT_MEMORY_TUNING };
  if (!partial) return tuning;

  if (partial.dedupGateMode !== undefined) {
    if (DEDUP_GATE_MODES.includes(partial.dedupGateMode)) {
      tuning.dedupGateMode = partial.dedupGateMode;
    } else {
      console.warn(
        '[Memory] invalid tuning.dedupGateMode, using default:',
        partial.dedupGateMode,
      );
    }
  }

  if (partial.dedupSkipThreshold !== undefined) {
    const value = partial.dedupSkipThreshold;
    if (typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1) {
      tuning.dedupSkipThreshold = value;
    } else {
      console.warn('[Memory] invalid tuning.dedupSkipThreshold, using default:', value);
    }
  }

  if (partial.dedupLinkThreshold !== undefined) {
    const value = partial.dedupLinkThreshold;
    if (typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 1) {
      tuning.dedupLinkThreshold = value;
    } else {
      console.warn('[Memory] invalid tuning.dedupLinkThreshold, using default:', value);
    }
  }

  if (partial.seedSimilarityFloor !== undefined) {
    const value = partial.seedSimilarityFloor;
    if (typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 1) {
      tuning.seedSimilarityFloor = value;
    } else {
      console.warn('[Memory] invalid tuning.seedSimilarityFloor, using default:', value);
    }
  }

  if (partial.seedK !== undefined) {
    const value = partial.seedK;
    if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 20) {
      tuning.seedK = value;
    } else {
      console.warn('[Memory] invalid tuning.seedK, using default:', value);
    }
  }

  if (partial.retrievalMode !== undefined) {
    if (RETRIEVAL_MODES.includes(partial.retrievalMode)) {
      tuning.retrievalMode = partial.retrievalMode;
    } else {
      console.warn('[Memory] invalid tuning.retrievalMode, using default:', partial.retrievalMode);
    }
  }

  const weightFields = [
    'rankWeightSimilarity',
    'rankWeightEdge',
    'rankWeightRecency',
    'rankWeightStrength',
  ] as const;
  for (const field of weightFields) {
    const value = partial[field];
    if (value !== undefined) {
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 10) {
        tuning[field] = value;
      } else {
        console.warn(`[Memory] invalid tuning.${field}, using default:`, value);
      }
    }
  }

  if (partial.decayLambda !== undefined) {
    const value = partial.decayLambda;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1) {
      tuning.decayLambda = value;
    } else {
      console.warn('[Memory] invalid tuning.decayLambda, using default:', value);
    }
  }

  // Band ordering must hold: link threshold (gray-zone floor) below skip
  // threshold. A violated ordering falls back to defaults for both.
  if (tuning.dedupLinkThreshold >= tuning.dedupSkipThreshold) {
    console.warn(
      '[Memory] tuning band order violated (link >= skip), using defaults:',
      tuning.dedupLinkThreshold,
      tuning.dedupSkipThreshold,
    );
    tuning.dedupSkipThreshold = DEFAULT_MEMORY_TUNING.dedupSkipThreshold;
    tuning.dedupLinkThreshold = DEFAULT_MEMORY_TUNING.dedupLinkThreshold;
  }

  return tuning;
}
