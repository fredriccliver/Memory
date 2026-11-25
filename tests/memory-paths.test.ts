import assert from 'node:assert/strict';
import test from 'node:test';
import { runRankedRetrieval } from '../src/memory/ranked-retrieval';
import { traverseMemory } from '../src/memory/memory-paths';
import { issueMemoryUseReceipt, recordMemoryUse } from '../src/memory/memory-use';
import { normalizeMemoryTuning } from '../src/tuning';

const entityId = 'graph:workspace';
const nodes = ['a', 'b', 'c', 'hidden', 'behind'].map(id => ({ id, entityId, embedding: [1, 0], similarity: 1, status: id === 'hidden' ? 'demoted' : 'active' }));
const edges = [
  { id: 'ab', entityId, fromId: 'b', toId: 'a', strength: 0.8 },
  { id: 'bc', entityId, fromId: 'b', toId: 'c', strength: 0.75 },
  { id: 'hidden-link', entityId, fromId: 'a', toId: 'hidden', strength: 0.99 },
  { id: 'behind-link', entityId, fromId: 'hidden', toId: 'behind', strength: 0.99 },
  { id: 'foreign', entityId: 'another', fromId: 'a', toId: 'c', strength: 1 },
];
const requested: number[] = [];
const store = {
  async getMemoriesByIds(ids: string[]) { return nodes.filter(node => ids.includes(node.id)); },
  async getEdgesTouching(ids: string[]) { return edges.filter(edge => ids.includes(edge.fromId) || ids.includes(edge.toId)); },
  async findMostSimilarMemories(_query: string, _store: string, k: number) {
    requested.push(k);
    return { embedding: [1, 0], matches: nodes.slice(0, k) };
  },
} as unknown as Parameters<typeof runRankedRetrieval>[0];

test('topK is independent of output limit and traversal is undirected and store-scoped', async () => {
  const noHops = await runRankedRetrieval(store, entityId, 'a', normalizeMemoryTuning(), 3, { topK: 1, hops: 0 });
  assert.deepEqual(noHops.paths?.map(path => path.memoryId), ['a']);
  const expanded = await runRankedRetrieval(store, entityId, 'a', normalizeMemoryTuning(), 3, { topK: 1, hops: 2 });
  assert.deepEqual(requested, [1, 1]);
  assert.deepEqual(expanded.paths?.find(path => path.memoryId === 'c')?.edgeIds, ['ab', 'bc']);
  const traversal = await traverseMemory(store, entityId, 'a', { hops: 2, limit: 1 });
  assert.deepEqual(traversal.paths.map(path => path.edgeIds), [['ab']]);
  assert.equal(traversal.truncated, true);
  assert.deepEqual((await traverseMemory(store, entityId, 'a', { hops: 4 })).paths.map(path => path.memoryId), ['b','c']);
  const allSeeds = await runRankedRetrieval(store, entityId, 'a', normalizeMemoryTuning(), 5, {topK:5,hops:0});
  assert.ok(!allSeeds.memories.some(memory => memory.id === 'hidden'));
  assert.equal((await traverseMemory(store, 'another', 'a')).paths.length, 0);
});

test('confirmed use is actor-scoped, ignores a redundant path, and is idempotent per work', async () => {
  const writes: unknown[][] = [];
  let inserted = false;
  const db = {
    async query(sql: string, params: unknown[]) {
      writes.push(params);
      if (sql.startsWith('insert')) {
        if (inserted) return { rowCount: 0 };
        inserted = true;
        return { rowCount: 1 };
      }
      return { rowCount: (params[1] as string[]).length };
    },
  } as unknown as Parameters<typeof recordMemoryUse>[0];
  const scope = { entityId, actorId: 'reader', secret: 'disposable-fixture' };
  const direct = {memoryId: 'b', nodeIds: ['b'], edgeIds: [], strength: 1};
  const indirect = {memoryId: 'b', nodeIds: ['a', 'b'], edgeIds: ['ab'], strength: .8};
  const uses = [indirect, direct].map(path => ({
    receipt: issueMemoryUseReceipt(scope,path),
    output: 'Applied the deployment procedure in the runbook.',
  }));
  await assert.rejects(recordMemoryUse(db, {...scope,actorId:'another'}, 'task', uses), /Invalid memory use receipt/);
  assert.equal(writes.length,0);
  assert.deepEqual(await recordMemoryUse(db,scope,'task',uses), {alreadyRecorded:false,memories:1,reinforced:0});
  assert.deepEqual(await recordMemoryUse(db,scope,'task',uses), {alreadyRecorded:true,memories:0,reinforced:0});
  const linked = await traverseMemory(store, entityId, 'a', { hops: 2 });
  const linkedUse = [{receipt:issueMemoryUseReceipt(scope,linked.paths[1]),output:'Used the linked procedure.'}];
  inserted=false;
  assert.equal((await recordMemoryUse(db,scope,'task2',linkedUse)).reinforced,2);
});
