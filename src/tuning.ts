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
});

const DEDUP_GATE_MODES: readonly MemoryDedupGateMode[] = ['off', 'shadow', 'active'];

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

  return tuning;
}
