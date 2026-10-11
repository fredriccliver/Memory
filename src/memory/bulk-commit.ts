/**
 * Bulk ingestion — the storage half of bulk loading. `planBulkCreate` computes
 * without writing; `commitBulkPlan` persists a plan. Design:
 * docs/specs/2026-10-11-llm-free-write-contract.ko.md §4.
 *
 * - Nodes: one multi-row INSERT (atomic), embeddings reused from the plan.
 * - Context edges: conversation@0.7 into `edges` + the legacy array (dual write).
 * - Seed edges: knn_seed, strength = similarity, `edges` only.
 * - No gate side effects (no bumps, no sleep jobs). Not idempotent.
 */
import { randomUUID } from 'crypto';
import type { MemoryStorage } from './storage';
import type { BulkPlan, BulkPlanEdge } from './bulk-plan';
import type { MemoryBatchInsert, MemoryEdgeInsert } from '../types';
import { CONVERSATION_EDGE_STRENGTH } from './connector';

/** Upper bound of planned nodes per commit — one INSERT carries 5 params/row (65,535 Bind limit) and ~29 KB/row of embedding text. */
export const MAX_PLANNED_NODES_PER_COMMIT = 10_000;
/** Edge rows per INSERT (6 params/row → 12,000 params, well under the Bind limit). */
const EDGE_INSERT_CHUNK = 2_000;

export interface CommitBulkPlanOptions {
  /** Mirror context edges into `outgoing_edges` (default true, until the array is retired). */
  dualWriteArray?: boolean;
}

export interface CommitBulkPlanResult {
  createdIds: string[];
  /** plan index → new UUID (planned nodes only). */
  indexToId: Record<number, string>;
  contextEdges: number;
  seedEdges: number;
  /** Items the plan had already judged as duplicates (not created). */
  skipped: number;
  /** Edges whose existing target no longer exists, or whose insert failed. */
  droppedEdges: number;
}

/**
 * Persists a bulk plan: planned nodes, then context edges, then seed edges.
 *
 * Node insert is all-or-nothing (single statement). Edges are best-effort after
 * the nodes exist: a missing existing target or an insert failure is counted in
 * `droppedEdges` and never throws. Calling twice with the same plan creates the
 * nodes twice — the host must call once per plan.
 *
 * @param storage - Memory storage (batch insert, edge insert, lookups)
 * @param plan - Output of `planBulkCreate`
 * @param options - `dualWriteArray`
 * @returns Created ids, index map, edge counts, skipped and dropped counts
 * @throws Error when the plan has more than {@link MAX_PLANNED_NODES_PER_COMMIT} planned
 *   nodes (before any write) or when the node insert fails (then nothing was written)
 *
 * @public
 */
export async function commitBulkPlan(
  storage: MemoryStorage,
  plan: BulkPlan,
  options: CommitBulkPlanOptions = {},
): Promise<CommitBulkPlanResult> {
  const dualWriteArray = options.dualWriteArray ?? true;
  const planned = plan.nodes.filter(n => n.status === 'planned');
  const skipped = plan.nodes.length - planned.length;
  const result: CommitBulkPlanResult = {
    createdIds: [],
    indexToId: {},
    contextEdges: 0,
    seedEdges: 0,
    skipped,
    droppedEdges: 0,
  };
  if (planned.length === 0) return result;
  if (planned.length > MAX_PLANNED_NODES_PER_COMMIT) {
    throw new Error(
      `commitBulkPlan: too many planned nodes (${planned.length} > ${MAX_PLANNED_NODES_PER_COMMIT}); split the plan`,
    );
  }

  // 1) ids first so edges can be assembled; then one INSERT
  const indexToId: Record<number, string> = {};
  for (const n of planned) indexToId[n.index] = randomUUID();

  const existingIds = [
    ...new Set(
      [...plan.contextEdges, ...plan.seedEdges]
        .map(e => e.toExistingId)
        .filter((id): id is string => !!id),
    ),
  ];
  const existingOk = new Set(
    (existingIds.length ? await storage.getMemoriesByIds(existingIds) : []).map(m => m.id),
  );
  const resolveTarget = (e: BulkPlanEdge): string | null =>
    e.toIndex !== undefined
      ? (indexToId[e.toIndex] ?? null)
      : e.toExistingId && existingOk.has(e.toExistingId)
        ? e.toExistingId
        : null;

  const contextTargets = new Map<number, string[]>(); // fromIndex → toIds (for the array)
  const contextInserts: MemoryEdgeInsert[] = [];
  for (const e of plan.contextEdges) {
    const toId = resolveTarget(e);
    if (!toId) {
      result.droppedEdges++;
      continue;
    }
    contextInserts.push({
      entityId: plan.entityId,
      fromId: indexToId[e.fromIndex]!,
      toId,
      origin: 'conversation',
      strength: CONVERSATION_EDGE_STRENGTH,
    });
    const list = contextTargets.get(e.fromIndex) ?? [];
    list.push(toId);
    contextTargets.set(e.fromIndex, list);
  }
  const seedInserts: MemoryEdgeInsert[] = [];
  for (const e of plan.seedEdges) {
    const toId = resolveTarget(e);
    if (!toId) {
      result.droppedEdges++;
      continue;
    }
    seedInserts.push({
      entityId: plan.entityId,
      fromId: indexToId[e.fromIndex]!,
      toId,
      origin: 'knn_seed',
      strength: Math.min(1, Math.max(0, e.strength)),
    });
  }

  const rows: MemoryBatchInsert[] = planned.map(n => ({
    id: indexToId[n.index]!,
    entityId: plan.entityId,
    content: n.content,
    embedding: n.embedding,
    outgoingEdges: dualWriteArray ? (contextTargets.get(n.index) ?? []) : [],
  }));
  const created = await storage.createMemoriesBatch(rows); // throws → nothing written
  result.createdIds = created.map(m => m.id);
  result.indexToId = indexToId;

  // 2) edges, best-effort, chunked (a failed chunk drops only its own rows)
  const ctx = await insertEdgesChunked(storage, contextInserts, 'context');
  result.contextEdges = ctx.inserted;
  result.droppedEdges += ctx.dropped;
  const seed = await insertEdgesChunked(storage, seedInserts, 'seed');
  result.seedEdges = seed.inserted;
  result.droppedEdges += seed.dropped;
  return result;
}

async function insertEdgesChunked(
  storage: MemoryStorage,
  rows: MemoryEdgeInsert[],
  label: string,
): Promise<{ inserted: number; dropped: number }> {
  let inserted = 0;
  let dropped = 0;
  for (let i = 0; i < rows.length; i += EDGE_INSERT_CHUNK) {
    const chunk = rows.slice(i, i + EDGE_INSERT_CHUNK);
    try {
      inserted += await storage.insertEdges(chunk);
    } catch (err) {
      console.error(`[Memory] bulk commit: ${label} edge insert failed (chunk ${i / EDGE_INSERT_CHUNK}):`, err);
      dropped += chunk.length;
    }
  }
  return { inserted, dropped };
}
