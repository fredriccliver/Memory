/**
 * Ranked Retrieval
 *
 * Usage-carved retrieval path: vector top-k seeds + edge-weighted 1-hop
 * expansion + scored ranking. Replaces the legacy fixed-threshold search and
 * unbounded array-graph traversal.
 *
 * score(node) = α·similarity + β·edgeActivation + γ·recency + δ·nodeStrength
 *
 * - similarity: cosine similarity to the query (seeds from the vector search;
 *   hop neighbors computed in-process against the reused query embedding)
 * - edgeActivation: max over incident edges of
 *   effectiveEdgeStrength × seedSimilarity(seed side of the edge)
 * - recency: exp(-daysSinceLastRetrieval / 30)
 * - nodeStrength: stored strength with lazy exponential decay (decayLambda)
 *
 * This module is side-effect free — usage recording (node retrievals, edge
 * bumps) is the caller's responsibility so the shadow path can reuse it
 * without polluting usage signals.
 */

import type { MemoryStorage } from './storage';
import type { Memory, MemoryEdge } from '../types';
import type { MemoryTuning } from '../tuning';

/** Recency scale: score halves roughly every RECENCY_SCALE_DAYS days */
const RECENCY_SCALE_DAYS = 30;

/**
 * Result of a ranked retrieval run
 *
 * @public
 */
export interface RankedRetrievalResult {
  /** Ranked memories, best first */
  memories: Memory[];
  /** Edges whose activation contributed to a returned memory (usage-bump targets) */
  contributingEdgeIds: string[];
}

function daysSince(date: Date | string | null | undefined): number {
  if (!date) return Number.POSITIVE_INFINITY;
  const t = typeof date === 'string' ? new Date(date).getTime() : date.getTime();
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (Date.now() - t) / 86_400_000);
}

/**
 * Effective strength with lazy exponential decay.
 *
 * Decay is computed at read time from the stored strength and its update
 * timestamp — no batch decay job exists anywhere. lambda = 0 disables decay.
 *
 * @public
 */
export function effectiveStrength(
  strength: number | undefined,
  updatedAt: Date | string | null | undefined,
  lambda: number,
): number {
  const base = strength ?? 0.5;
  if (lambda <= 0) return base;
  const age = daysSince(updatedAt);
  if (!Number.isFinite(age)) return base;
  return base * Math.exp(-lambda * age);
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/**
 * Runs ranked retrieval for a query within an entity. Side-effect free.
 *
 * @param storage - Memory storage
 * @param entityId - Entity to search within
 * @param query - Query text
 * @param tuning - Normalized tuning (weights, decayLambda)
 * @param limit - Maximum memories to return
 *
 * @public
 */
export async function runRankedRetrieval(
  storage: MemoryStorage,
  entityId: string,
  query: string,
  tuning: MemoryTuning,
  limit: number,
): Promise<RankedRetrievalResult> {
  // 1. Vector top-k seeds — rank-based, no similarity threshold
  const { embedding: queryEmbedding, matches } = await storage.findMostSimilarMemories(
    query,
    entityId,
    limit,
  );
  const isActive = (m: Memory) => (m.status ?? 'active') === 'active';
  const seeds = matches.filter(isActive);
  if (seeds.length === 0) {
    return { memories: [], contributingEdgeIds: [] };
  }

  const seedSim = new Map<string, number>(seeds.map(s => [s.id, clamp01(s.similarity ?? 0)]));

  // 2. One-hop expansion over first-class edges (undirected: either end)
  const edges = await storage.getEdgesTouching(seeds.map(s => s.id));
  const neighborIds = new Set<string>();
  for (const edge of edges) {
    if (edge.entityId !== entityId) continue;
    for (const nodeId of [edge.fromId, edge.toId]) {
      if (!seedSim.has(nodeId)) neighborIds.add(nodeId);
    }
  }
  const neighbors =
    neighborIds.size > 0
      ? (await storage.getMemoriesByIds([...neighborIds])).filter(isActive)
      : [];

  // 3. Edge activation per candidate: max over incident edges of
  //    effectiveEdgeStrength × similarity of the seed on the other end
  const bestEdgeForNode = new Map<string, { edgeId: string; term: number }>();
  const considerEdge = (edge: MemoryEdge, seedId: string, nodeId: string) => {
    const sim = seedSim.get(seedId);
    if (sim === undefined) return;
    const term = effectiveStrength(edge.strength, edge.strengthUpdatedAt, tuning.decayLambda) * sim;
    const current = bestEdgeForNode.get(nodeId);
    if (!current || term > current.term) {
      bestEdgeForNode.set(nodeId, { edgeId: edge.id, term });
    }
  };
  for (const edge of edges) {
    if (edge.entityId !== entityId) continue;
    considerEdge(edge, edge.fromId, edge.toId);
    considerEdge(edge, edge.toId, edge.fromId);
  }

  // 4. Score all candidates
  const candidates = [...seeds, ...neighbors];
  const scored = candidates.map(memory => {
    const similarity =
      seedSim.get(memory.id) ??
      (memory.embedding && memory.embedding.length > 0
        ? clamp01(cosine(queryEmbedding, memory.embedding))
        : 0);
    const edgeTerm = bestEdgeForNode.get(memory.id)?.term ?? 0;
    const recencyAnchor = memory.lastRetrievedAt ?? memory.createdAt;
    const recency = Number.isFinite(daysSince(recencyAnchor))
      ? Math.exp(-daysSince(recencyAnchor) / RECENCY_SCALE_DAYS)
      : 0;
    const nodeStrength = effectiveStrength(
      memory.strength,
      memory.strengthUpdatedAt,
      tuning.decayLambda,
    );
    const score =
      tuning.rankWeightSimilarity * similarity +
      tuning.rankWeightEdge * edgeTerm +
      tuning.rankWeightRecency * recency +
      tuning.rankWeightStrength * nodeStrength;
    return { memory: { ...memory, similarity }, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, limit);

  const returnedIds = new Set(top.map(s => s.memory.id));
  const contributingEdgeIds: string[] = [];
  for (const [nodeId, best] of bestEdgeForNode) {
    if (returnedIds.has(nodeId)) contributingEdgeIds.push(best.edgeId);
  }

  return { memories: top.map(s => s.memory), contributingEdgeIds };
}
