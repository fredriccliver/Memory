/**
 * Bulk ingestion planning — the pure-computation half of bulk memory loading.
 *
 * `planBulkCreate` runs the full bulk pipeline (batch embedding, dedup gate
 * judgment, context-edge assembly, kNN seeding) WITHOUT writing anything.
 * The returned plan can be inspected, visualized, and discarded freely; a
 * future `commitBulkPlan` is the only step that would persist it.
 *
 * Design notes:
 * - LLM 0-call: relations arrive precomputed (`relatedIndexes`) from the
 *   application-side decomposer, which is where the source-text context lives.
 * - Judgments mirror the live dedup gate bands but produce NO side effects:
 *   no strength bumps, no sleep jobs — a skipped item is only marked as such.
 * - Gray-zone items are created (planned) and flagged; their nearest neighbor
 *   is reachable through normal seeding (similarity ≥ link threshold ≥ seed
 *   floor), so no special gray edge is planned and no review queue is filled.
 */
import type { MemoryStorage } from './storage';
import { CONVERSATION_EDGE_STRENGTH } from './connector';
import { normalizeMemoryTuning, type MemoryTuning } from '../tuning';

/** One decomposed sentence plus its decomposer-confirmed relations. */
export interface BulkPlanItem {
  content: string;
  /** Batch-internal indexes this item is contextually related to (decomposer judgment). */
  relatedIndexes?: number[];
}

export interface BulkPlanOptions {
  /** Apply the skip band against existing nodes and earlier batch items (default true). */
  dedupe?: boolean;
  /** Lay kNN seed hypotheses (default true). */
  seed?: boolean;
  /** Items per embedding API call (default 100). */
  chunkSize?: number;
}

export interface BulkPlanNode {
  index: number;
  content: string;
  /** Kept for a future commit step; strip before sending a plan to a client. */
  embedding: number[];
  status: 'planned' | 'skipped';
  /** When skipped: the duplicate it collapsed into (exactly one of the two). */
  matchedExistingId?: string;
  matchedBatchIndex?: number;
  /** Nearest-neighbor similarity at judgment time. */
  topSimilarity?: number;
  /** Top similarity fell between the link and skip thresholds. */
  inGrayZone?: boolean;
}

export interface BulkPlanEdge {
  fromIndex: number;
  /** Exactly one of the two targets: a batch item or an already-stored node. */
  toIndex?: number;
  toExistingId?: string;
  origin: 'conversation' | 'knn_seed';
  strength: number;
  similarity?: number;
}

export interface BulkPlanStats {
  totalItems: number;
  plannedNodes: number;
  skipped: number;
  grayZone: number;
  contextEdges: number;
  seedEdges: number;
}

export interface BulkPlan {
  entityId: string;
  nodes: BulkPlanNode[];
  contextEdges: BulkPlanEdge[];
  seedEdges: BulkPlanEdge[];
  stats: BulkPlanStats;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

function pairKey(edge: BulkPlanEdge): string {
  const to = edge.toIndex !== undefined ? `i${edge.toIndex}` : `e${edge.toExistingId}`;
  return `${edge.fromIndex}|${to}`;
}

/**
 * Computes a full bulk ingestion plan for an entity without writing anything.
 *
 * @param storage - Memory storage (used read-only: batch embedding + vector search)
 * @param entityId - Target entity the plan is computed against
 * @param items - Decomposed sentences with optional batch-internal relations
 * @param tuning - Tuning values (thresholds, seed floor/K); invalid fields fall back to defaults
 * @param options - Dedupe/seed switches and embedding chunk size
 * @returns The plan: per-item judgments, context edges, seed edges, and stats
 * @throws Error if any item content is empty, or embedding is unavailable
 *
 * @public
 */
export async function planBulkCreate(
  storage: MemoryStorage,
  entityId: string,
  items: BulkPlanItem[],
  tuning?: Partial<MemoryTuning>,
  options: BulkPlanOptions = {},
): Promise<BulkPlan> {
  const { dedupe = true, seed = true, chunkSize = 100 } = options;
  const t = normalizeMemoryTuning(tuning);

  const contents = items.map(item => item.content?.trim() ?? '');
  if (contents.some(c => c.length === 0)) {
    throw new Error('planBulkCreate: every item must have non-empty content');
  }

  // 1) Batch embedding (chunked; no DB access)
  const embeddings: number[][] = [];
  for (let start = 0; start < contents.length; start += Math.max(1, chunkSize)) {
    const chunk = contents.slice(start, start + Math.max(1, chunkSize));
    embeddings.push(...(await storage.embedContents(chunk)));
  }

  // 2) Per-item judgment against existing nodes + earlier planned batch items
  const nodes: BulkPlanNode[] = [];
  const existingCandidates: Array<Array<{ id: string; similarity: number }>> = [];

  for (let i = 0; i < contents.length; i++) {
    const matches = await storage.searchByEmbedding(embeddings[i]!, entityId, Math.max(t.seedK, 1));
    const existing = matches
      .filter(m => m.similarity !== undefined)
      .map(m => ({ id: m.id, similarity: m.similarity as number }));
    existingCandidates.push(existing);

    let topSim = existing[0]?.similarity ?? 0;
    let matchedExistingId: string | undefined = existing[0]?.id;
    let matchedBatchIndex: number | undefined;

    for (let j = 0; j < i; j++) {
      if (nodes[j]!.status !== 'planned') continue;
      const sim = cosine(embeddings[i]!, embeddings[j]!);
      if (sim > topSim) {
        topSim = sim;
        matchedExistingId = undefined;
        matchedBatchIndex = j;
      }
    }

    const skipped = dedupe && topSim >= t.dedupSkipThreshold;
    nodes.push({
      index: i,
      content: contents[i]!,
      embedding: embeddings[i]!,
      status: skipped ? 'skipped' : 'planned',
      ...(skipped && matchedExistingId !== undefined ? { matchedExistingId } : {}),
      ...(skipped && matchedBatchIndex !== undefined ? { matchedBatchIndex } : {}),
      ...(topSim > 0 ? { topSimilarity: topSim } : {}),
      ...(!skipped && topSim >= t.dedupLinkThreshold ? { inGrayZone: true } : {}),
    });
  }

  // 3) Context edges from decomposer relations (skipped targets remap to their duplicate)
  const contextEdges: BulkPlanEdge[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    if (node.status !== 'planned') continue;
    for (const r of items[node.index]!.relatedIndexes ?? []) {
      if (!Number.isInteger(r) || r < 0 || r >= nodes.length || r === node.index) continue;
      const target = nodes[r]!;
      let edge: BulkPlanEdge | null = null;
      if (target.status === 'planned') {
        edge = {
          fromIndex: node.index,
          toIndex: r,
          origin: 'conversation',
          strength: CONVERSATION_EDGE_STRENGTH,
        };
      } else if (target.matchedExistingId) {
        edge = {
          fromIndex: node.index,
          toExistingId: target.matchedExistingId,
          origin: 'conversation',
          strength: CONVERSATION_EDGE_STRENGTH,
        };
      } else if (target.matchedBatchIndex !== undefined) {
        const hop = nodes[target.matchedBatchIndex]!;
        if (hop.status === 'planned' && hop.index !== node.index) {
          edge = {
            fromIndex: node.index,
            toIndex: hop.index,
            origin: 'conversation',
            strength: CONVERSATION_EDGE_STRENGTH,
          };
        }
      }
      if (edge) {
        const key = pairKey(edge);
        if (!seen.has(key)) {
          seen.add(key);
          contextEdges.push(edge);
        }
      }
    }
  }

  // 4) kNN seeds: existing neighbors + earlier planned batchmates, context pairs excluded
  const seedEdges: BulkPlanEdge[] = [];
  if (seed) {
    const contextKeys = new Set(contextEdges.map(pairKey));
    for (const node of nodes) {
      if (node.status !== 'planned') continue;
      const i = node.index;
      const candidates: BulkPlanEdge[] = [];

      for (const ex of existingCandidates[i]!) {
        if (ex.similarity >= t.seedSimilarityFloor) {
          candidates.push({
            fromIndex: i,
            toExistingId: ex.id,
            origin: 'knn_seed',
            strength: Math.min(1, Math.max(0, ex.similarity)),
            similarity: ex.similarity,
          });
        }
      }
      for (let j = 0; j < i; j++) {
        if (nodes[j]!.status !== 'planned') continue;
        const sim = cosine(node.embedding, nodes[j]!.embedding);
        if (sim >= t.seedSimilarityFloor) {
          candidates.push({
            fromIndex: i,
            toIndex: j,
            origin: 'knn_seed',
            strength: Math.min(1, Math.max(0, sim)),
            similarity: sim,
          });
        }
      }

      candidates.sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0));
      let taken = 0;
      for (const cand of candidates) {
        if (taken >= t.seedK) break;
        const key = pairKey(cand);
        if (contextKeys.has(key) || seen.has(key)) continue;
        seen.add(key);
        seedEdges.push(cand);
        taken++;
      }
    }
  }

  const planned = nodes.filter(n => n.status === 'planned');
  return {
    entityId,
    nodes,
    contextEdges,
    seedEdges,
    stats: {
      totalItems: items.length,
      plannedNodes: planned.length,
      skipped: nodes.length - planned.length,
      grayZone: planned.filter(n => n.inGrayZone).length,
      contextEdges: contextEdges.length,
      seedEdges: seedEdges.length,
    },
  };
}
