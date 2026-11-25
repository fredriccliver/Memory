import type { MemoryStorage } from './storage';
import type { Memory, MemoryEdge } from '../types';

export interface MemoryPath {
  memoryId: string;
  nodeIds: string[];
  edgeIds: string[];
  strength: number;
}

export type MemoryPathStorage = Pick<MemoryStorage, 'getEdgesTouching' | 'getMemoriesByIds'>;
export const MAX_MEMORY_HOPS = 4;
export const MAX_EXPANDED_MEMORIES = 200;
const MAX_EDGES_PER_HOP = 2_000;

export const rankedMemoryStatuses = ['active', 'demoted'];

export function canReadMemory(memory: Memory, entityId: string) {
  return memory.entityId === entityId && rankedMemoryStatuses.includes(memory.status ?? 'active');
}

function daysSince(date: Date | string | null | undefined): number {
  if (!date) return Number.POSITIVE_INFINITY;
  const time = typeof date === 'string' ? Date.parse(date) : date.getTime();
  return Number.isFinite(time) ? Math.max(0, (Date.now() - time) / 86_400_000) : Number.POSITIVE_INFINITY;
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

function byStrength(a: MemoryPath, b: MemoryPath) {
  return b.strength - a.strength || a.edgeIds.length - b.edgeIds.length ||
    a.nodeIds[0].localeCompare(b.nodeIds[0]) || a.memoryId.localeCompare(b.memoryId);
}

/** Read a bounded neighborhood. Each path retains the actual directed edge IDs used in an undirected walk. */
export async function expandMemoryPaths(
  storage: MemoryPathStorage,
  entityId: string,
  seeds: ReadonlyMap<string, number>,
  { hops, decayLambda }: { hops: number; decayLambda: number },
) {
  const depth = Math.max(0, Math.min(MAX_MEMORY_HOPS, Math.floor(hops) || 0));
  let frontier = Array.from(seeds, ([memoryId, strength]): MemoryPath =>
    ({ memoryId, nodeIds: [memoryId], edgeIds: [], strength }));
  const paths = new Map(frontier.map(path => [path.memoryId, path]));
  const expandedStrength = new Map(seeds);
  // Keep the ranker's existing edge activation, even when the target is also a direct seed.
  const activations = new Map<string, MemoryPath>();
  const encountered = new Map<string, MemoryEdge>();
  const memoriesById = new Map<string, Memory>();
  let truncated = false;
  for (let hop = 0; hop < depth && frontier.length; hop++) {
    const byId = new Map(frontier.map(path => [path.memoryId, path]));
    const edges = await storage.getEdgesTouching([...byId.keys()], MAX_EDGES_PER_HOP + 1, entityId);
    truncated ||= edges.length > MAX_EDGES_PER_HOP;
    const next = new Map<string, MemoryPath>();
    for (const edge of edges.slice(0, MAX_EDGES_PER_HOP)) {
      if (edge.entityId !== entityId) continue;
      encountered.set(edge.id, edge);
      for (const [from, to] of [[edge.fromId, edge.toId], [edge.toId, edge.fromId]]) {
        const parent = byId.get(from);
        if (!parent || parent.nodeIds.includes(to)) continue;
        const path = {
          memoryId: to,
          nodeIds: [...parent.nodeIds, to],
          edgeIds: [...parent.edgeIds, edge.id],
          strength: parent.strength * effectiveStrength(edge.strength, edge.strengthUpdatedAt, decayLambda),
        };
        const previous = next.get(to);
        if (!previous || byStrength(path, previous) < 0) next.set(to, path);
      }
    }
    const ranked = [...next.values()].sort(byStrength);
    const candidates: MemoryPath[] = [];
    const capacity = MAX_EXPANDED_MEMORIES + seeds.size;
    const scanLimit = Math.min(ranked.length, capacity * 4);
    for (let offset = 0; offset < scanLimit && candidates.length <= capacity; offset += capacity) {
      const batch = ranked.slice(offset, offset + capacity);
      const unknownIds = batch.map(path => path.memoryId).filter(id => !memoriesById.has(id));
      if (unknownIds.length) {
        for (const memory of await storage.getMemoriesByIds(unknownIds))
          if (canReadMemory(memory, entityId)) memoriesById.set(memory.id, memory);
      }
      candidates.push(...batch.filter(path => memoriesById.has(path.memoryId)));
    }
    truncated ||= candidates.length > capacity || scanLimit < ranked.length;
    frontier = [];
    for (const path of candidates.slice(0, capacity)) {
      const previous = paths.get(path.memoryId);
      if (!previous && paths.size >= MAX_EXPANDED_MEMORIES + seeds.size) {
        truncated = true;
        continue;
      }
      const activation = activations.get(path.memoryId);
      if (!activation || byStrength(path, activation) < 0) activations.set(path.memoryId, path);
      if (!seeds.has(path.memoryId) && (!previous || byStrength(path, previous) < 0))
        paths.set(path.memoryId, path);
      if (path.strength > (expandedStrength.get(path.memoryId) ?? -Infinity)) {
        expandedStrength.set(path.memoryId, path.strength);
        frontier.push(path);
      }
    }
  }
  return { paths: [...paths.values()], activations, encountered, memoriesById, truncated };
}

/** Inspect an existing memory's neighborhood without recording retrieval or changing strength. */
export async function traverseMemory(
  storage: MemoryPathStorage,
  entityId: string,
  memoryId: string,
  { hops = 1, limit = 20, decayLambda = 0 }: { hops?: number; limit?: number; decayLambda?: number } = {},
): Promise<{ memories: Memory[]; paths: MemoryPath[]; edges: MemoryEdge[]; truncated: boolean }> {
  const [anchor] = await storage.getMemoriesByIds([memoryId]);
  if (!anchor || !canReadMemory(anchor, entityId)) return { memories: [], paths: [], edges: [], truncated: false };
  const expanded = await expandMemoryPaths(storage, entityId, new Map([[memoryId, 1]]), { hops, decayLambda });
  const paths = expanded.paths.filter(path => path.edgeIds.length).sort(byStrength);
  const returned = paths.slice(0, Math.max(1, Math.min(50, Math.floor(limit) || 1)));
  return {
    memories: returned.map(path => expanded.memoriesById.get(path.memoryId)!),
    paths: returned,
    edges: [...new Set(returned.flatMap(path => path.edgeIds))].map(id => expanded.encountered.get(id)!),
    truncated: expanded.truncated || paths.length > returned.length,
  };
}
