import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PoolClient } from 'pg';
import { MAX_MEMORY_HOPS, type MemoryPath } from './memory-paths';

type Scope = { entityId: string; actorId: string; secret: string; schema?: string; decayLambda?: number };
type Receipt = Pick<MemoryPath, 'memoryId' | 'nodeIds' | 'edgeIds'> & { expiresAt: number };
type Use = { receipt: string; output: string };
export type MemoryLinkChange =
  | { action: 'shortcut'; receipt: string }
  | { action: 'weaken'; receipt: string; edgeId: string; strength: number }
  | { action: 'unlink'; receipt: string; edgeId: string };
const edgeBump = 0.05;

function schemaIdentifier(schema: string) {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error('Invalid memory schema');
  return schema;
}

export function memoryWorkUsageSchemaFor(schema: string) {
  const table = schemaIdentifier(schema) + '.work_usage';
  return `
create table if not exists ${table} (
  entity_id text not null,
  actor_id text not null,
  work_id text not null,
  uses jsonb not null check (jsonb_typeof(uses) = 'array'),
  recorded_at timestamptz not null default now(),
  primary key (entity_id, actor_id, work_id)
);
alter table ${table} enable row level security;
revoke all on ${table} from public;
`;
}

export const memoryWorkUsageSchema = memoryWorkUsageSchemaFor('memory');

function sign(scope: Scope, payload: string) {
  return createHmac('sha256', scope.secret)
    .update(JSON.stringify(['oak-memory-use-v1', scope.entityId, scope.actorId, scope.schema ?? 'memory', payload]))
    .digest();
}

/** Returning a receipt does not mutate the graph. */
export function issueMemoryUseReceipt(scope: Scope, path: MemoryPath): string {
  const { memoryId, nodeIds, edgeIds } = path;
  const payload = Buffer.from(JSON.stringify({
    memoryId, nodeIds, edgeIds, expiresAt: Date.now() + 12 * 60 * 60 * 1000,
  })).toString('base64url');
  return payload + '.' + sign(scope, payload).toString('base64url');
}

function readReceipt(scope: Scope, receipt: string): Receipt {
  if (receipt.length > 1600) throw new Error('Invalid memory use receipt');
  const [payload, checksum, extra] = receipt.split('.');
  const given = Buffer.from(checksum ?? '', 'base64url');
  const expected = sign(scope, payload);
  if (extra !== undefined || given.length !== expected.length || !timingSafeEqual(given, expected))
    throw new Error('Invalid memory use receipt');
  const path: Receipt = JSON.parse(Buffer.from(payload, 'base64url').toString());
  if (path.expiresAt < Date.now() || path.edgeIds.length > MAX_MEMORY_HOPS ||
      path.nodeIds.length !== path.edgeIds.length + 1 || path.nodeIds[path.nodeIds.length - 1] !== path.memoryId)
    throw new Error('Expired or invalid memory use receipt');
  return path;
}

/** This runs inside the host's transaction and current authorization check. */
export async function recordMemoryUse(
  db: Pick<PoolClient, 'query'>,
  scope: Scope,
  workId: string,
  uses: Use[],
  linkChanges: MemoryLinkChange[] = [],
) {
  if (!workId || workId.length > 160 || !uses.length || uses.length > 20 || linkChanges.length > 8)
    throw new Error('Invalid memory use report');
  const schema = schemaIdentifier(scope.schema ?? 'memory');
  const decayLambda = scope.decayLambda ?? 0;
  if (!Number.isFinite(decayLambda) || decayLambda < 0) throw new Error('Invalid memory decay');
  const selected = new Map<string, Receipt & { output: string; receipt: string }>();
  for (const { receipt, output } of uses) {
    if (typeof receipt !== 'string' || typeof output !== 'string') throw new Error('Invalid memory use report');
    const path = readReceipt(scope, receipt);
    if (!output.trim() || output.length > 300) throw new Error('Identify the work output that used this memory');
    const previous = selected.get(path.memoryId);
    if (!previous || path.edgeIds.length < previous.edgeIds.length)
      selected.set(path.memoryId, { ...path, output: output.trim(), receipt });
  }
  const records = [...selected.values()].map(({ memoryId, nodeIds, edgeIds, output }) =>
    ({ memoryId, nodeIds, edgeIds, output }));
  const memoryIds = [...selected.keys()];
  const edgeIds = [...new Set(records.flatMap(record => record.edgeIds))];
  const protectedEdges = new Set(edgeIds);
  const plan = linkChanges.map(change => {
    if (change?.action !== 'shortcut' && change?.action !== 'weaken' && change?.action !== 'unlink')
      throw new Error('Invalid memory link action');
    const path = readReceipt(scope, change.receipt);
    if (change.action === 'shortcut') {
      if (path.edgeIds.length < 2 || selected.get(path.memoryId)?.receipt !== change.receipt)
        throw new Error('A shortcut requires a contributing multi-hop path from this work');
    } else if (!path.edgeIds.includes(change.edgeId) || protectedEdges.has(change.edgeId) ||
               (change.action === 'weaken' && (!Number.isFinite(change.strength) || change.strength < 0 || change.strength > 1))) {
      throw new Error('Link adjustment requires an inspected, unused edge of this store');
    }
    return { path, change };
  });
  const inserted = await db.query(
    `insert into ${schema}.work_usage(entity_id,actor_id,work_id,uses) values($1,$2,$3,$4::jsonb) on conflict do nothing returning work_id`,
    [scope.entityId, scope.actorId, workId, JSON.stringify(records)],
  );
  if (!inserted.rowCount) return { alreadyRecorded: true, memories: 0, reinforced: 0, shortcuts: 0, weakened: 0, unlinked: 0 };

  const memories = await db.query(
    `update ${schema}.memories set retrieval_count=retrieval_count+1,last_retrieved_at=now() where entity_id=$1 and id=any($2::uuid[])`,
    [scope.entityId, memoryIds],
  );
  if (memories.rowCount !== memoryIds.length) throw new Error('A used memory is no longer in the store');
  const edges = await db.query(
    `update ${schema}.edges set strength=least(1,strength+$3*(1-strength)),strength_updated_at=now() where entity_id=$1 and id=any($2::uuid[])`,
    [scope.entityId, edgeIds, edgeBump],
  );
  if (edges.rowCount !== edgeIds.length) throw new Error('A used path has changed. Inspect the graph again.');
  if (!plan.length) return { alreadyRecorded: false, memories: memoryIds.length, reinforced: edgeIds.length };
  const changes = { shortcuts: 0, weakened: 0, unlinked: 0 };
  for (const { path, change } of plan) {
    if (change.action === 'shortcut') {
      const [from] = path.nodeIds;
      const to = path.memoryId;
      const result = await db.query(
        `with added as (
          insert into ${schema}.edges(entity_id,from_id,to_id,type,origin,strength)
          select $1,$2::uuid,$3::uuid,'related','conversation',0.6
          where not exists (
            select 1 from ${schema}.edges where entity_id=$1 and
              ((from_id=$2 and to_id=$3) or (from_id=$3 and to_id=$2))
          )
          on conflict(from_id,to_id,type) do nothing returning id
        )
        update ${schema}.memories set outgoing_edges=case when $3::uuid=any(outgoing_edges) then outgoing_edges else array_append(outgoing_edges,$3::uuid) end
        where entity_id=$1 and id=$2 and exists(select 1 from added)
        returning id`,
        [scope.entityId, from, to],
      );
      changes.shortcuts += result.rowCount ?? 0;
    } else if (change.action === 'weaken') {
      const result = await db.query(
        `update ${schema}.edges set strength=$3,strength_updated_at=now()
         where entity_id=$1 and id=$2 and type='related'
           and case
             when $3::double precision = 0 then strength > 0
             when strength > $3 then ln(strength) - ln($3::double precision) >
               $4::double precision * greatest(0, extract(epoch from (now() - strength_updated_at)) / 86400)
             else false
           end returning id`,
        [scope.entityId, change.edgeId, change.strength, decayLambda],
      );
      changes.weakened += result.rowCount ?? 0;
    } else if (change.action === 'unlink') {
      const removed = await db.query<{ from_id: string; to_id: string }>(
        `delete from ${schema}.edges where entity_id=$1 and id=$2 and type='related' returning from_id,to_id`,
        [scope.entityId, change.edgeId],
      );
      if (!removed.rowCount) continue;
      const { from_id, to_id } = removed.rows[0];
      await db.query(
        `update ${schema}.memories set outgoing_edges=array_remove(outgoing_edges,$3::uuid)
         where entity_id=$1 and id=$2 and not exists(
           select 1 from ${schema}.edges where entity_id=$1 and from_id=$2 and to_id=$3 and type='related'
         )`,
        [scope.entityId, from_id, to_id],
      );
      changes.unlinked++;
    }
  }
  return { alreadyRecorded: false, memories: memoryIds.length, reinforced: edgeIds.length, ...changes };
}
