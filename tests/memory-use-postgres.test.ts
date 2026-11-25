import assert from 'node:assert/strict';
import test from 'node:test';
import { Client, Pool } from 'pg';
import { PostgresAdapter } from '../src/storage/adapters/postgres-adapter';
import { StorageType } from '../src/storage/storage-types';
import { ensureTablesExist } from '../src/storage/migrations/postgres-init';
import { issueMemoryUseReceipt, memoryWorkUsageSchemaFor, recordMemoryUse } from '../src/memory/memory-use';

test('work use reinforces a path and applies a shortcut, weakening and unlink in PostgreSQL', {
  skip: process.env.OAK_TEST_ISOLATED_PG !== '1',
}, async () => {
  const entityId = 'graph:fixture';
  const scope = { entityId, actorId: 'fixture-operator', secret: 'synthetic-test-secret', schema: 'custom_memory', decayLambda: 1 };
  const client = new Client();
  await client.connect();
  try {
    await client.query(`begin;
      create schema custom_memory;
      create table custom_memory.memories (
        id uuid primary key, entity_id text not null, outgoing_edges uuid[] not null default '{}',
        retrieval_count int not null default 0, last_retrieved_at timestamptz
      );
      create table custom_memory.edges (
        id uuid primary key default gen_random_uuid(), entity_id text not null,
        from_id uuid not null references custom_memory.memories(id), to_id uuid not null references custom_memory.memories(id),
        type text not null, origin text not null, strength float not null,
        strength_updated_at timestamptz default now(), unique(from_id,to_id,type)
      );`);
    await client.query(memoryWorkUsageSchemaFor(scope.schema));
    const nodes = Array.from({length:6}, (_, index) => `00000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`);
    const [a,b,c,d,e,f] = nodes;
    await client.query('insert into custom_memory.memories(id,entity_id) select unnest($1::uuid[]),$2',[nodes,entityId]);
    const ids: Record<string,string> = {};
    for (const [name,from,to] of [['ab',a,b],['bc',b,c],['ad',a,d],['ae',a,e],['af',a,f]]) {
      const { rows }=await client.query(
        "insert into custom_memory.edges(entity_id,from_id,to_id,type,origin,strength) values($1,$2,$3,'related','conversation',0.8) returning id",
        [entityId,from,to],
      );
      ids[name]=rows[0].id;
      await client.query('update custom_memory.memories set outgoing_edges=array_append(outgoing_edges,$2::uuid) where id=$1',[from,to]);
    }
    const receipt=(memoryId:string,nodeIds:string[],edgeIds:string[])=>issueMemoryUseReceipt(scope,{memoryId,nodeIds,edgeIds,strength:1});
    await client.query("update custom_memory.edges set strength_updated_at=now()-interval '800 days' where id=$1",[ids.af]);
    const supersedes = await client.query(
      "insert into custom_memory.edges(entity_id,from_id,to_id,type,origin,strength) values($1,$2,$3,'supersedes','sleep',0.8) returning id",
      [entityId,a,e],
    );
    const used=receipt(c,[a,b,c],[ids.ab,ids.bc]);
    const noise=receipt(d,[a,d],[ids.ad]);
    const obsolete=receipt(e,[a,e],[ids.ae]);
    const read=()=>client.query('select * from custom_memory.edges order by id');
    assert.equal((await read()).rows.every(row=>row.strength===0.8),true);
    const uses=[{receipt:used,output:'Used the deployment procedure in the response.'}];
    const changes=[
      {action:'shortcut' as const,receipt:used},
      {action:'weaken' as const,receipt:noise,edgeId:ids.ad,strength:0.35},
      {action:'unlink' as const,receipt:obsolete,edgeId:ids.ae},
      {action:'weaken' as const,receipt:receipt(f,[a,f],[ids.af]),edgeId:ids.af,strength:0.35},
    ];
    assert.deepEqual(await recordMemoryUse(client,scope,'run-1',uses,changes),
      {alreadyRecorded:false,memories:1,reinforced:2,shortcuts:1,weakened:1,unlinked:1});
    const after=await read();
    assert.equal(after.rows.find(row=>row.id===ids.ab).strength,0.81);
    assert.equal(after.rows.find(row=>row.id===ids.ad).strength,0.35);
    assert.ok(after.rows.some(row=>row.from_id===a&&row.to_id===c&&row.strength===0.6));
    assert.equal(after.rows.some(row=>row.id===ids.ae),false);
    assert.ok(after.rows.some(row=>row.id===supersedes.rows[0].id));
    assert.equal(after.rows.find(row=>row.id===ids.af).strength,0.8);
    const { rows: nodesAfter }=await client.query('select * from custom_memory.memories order by id');
    assert.deepEqual(nodesAfter[0].outgoing_edges,[b,d,f,c]);
    assert.equal(nodesAfter[2].retrieval_count,1);
    assert.equal((await recordMemoryUse(client,scope,'run-1',uses,changes)).alreadyRecorded,true);
    assert.deepEqual((await read()).rows,after.rows);
    assert.equal((await client.query('select count(*)::int n from custom_memory.work_usage')).rows[0].n,1);
  } finally {
    await client.query('rollback');
    await client.end();
  }
});


test('normal setup provisions usage on fresh and v3 PostgreSQL schemas', {
  skip: process.env.OAK_TEST_ISOLATED_PG !== '1',
}, async () => {
  const pool = new Pool();
  try {
    await ensureTablesExist(pool, 'Fresh_Usage');
    assert.equal((await pool.query("select to_regclass('fresh_usage.work_usage') as name")).rows[0].name, 'fresh_usage.work_usage');
    await pool.query('drop table fresh_usage.work_usage; update fresh_usage.schema_version set version = 3');
    await ensureTablesExist(pool, 'Fresh_Usage');
    assert.equal((await pool.query('select version from fresh_usage.schema_version')).rows[0].version, 4);
    assert.equal((await pool.query("select to_regclass('fresh_usage.work_usage') as name")).rows[0].name, 'fresh_usage.work_usage');
  } finally {
    await pool.query('drop schema if exists fresh_usage cascade');
    await pool.end();
  }
});


test('bounded PostgreSQL scans rank readable edges using decay before the cutoff', {
  skip: process.env.OAK_TEST_ISOLATED_PG !== '1',
}, async () => {
  const schema = 'path_scan';
  const entityId = 'graph:fixture';
  const pool = new Pool();
  const adapter = new PostgresAdapter({ type: StorageType.POSTGRES, connectionString: '', schema });
  try {
    await adapter.initialize();
    const { rows } = await pool.query<{ id: string }>(`
      insert into path_scan.memories(entity_id,content,status) values
        ($1,'anchor','active'),($1,'old','active'),($1,'hidden','archived'),($1,'fresh','active')
      returning id
    `, [entityId]);
    const [anchor, old, hidden, fresh] = rows.map(row => row.id);
    await pool.query(`
      insert into path_scan.edges(entity_id,from_id,to_id,origin,strength,strength_updated_at)
      values ($1,$2,$3,'conversation',0.99,now()-interval '800 days'),($1,$2,$4,'conversation',0.98,now()),($1,$2,$5,'conversation',0.6,now())
    `, [entityId,anchor,old,hidden,fresh]);
    const edges = await adapter.getEdgesTouching([anchor], {
      entityId,
      frontier: [{ node_id: anchor, strength: 1, visited: [anchor] }],
      statuses: ['active'],
      decayLambda: 1,
      limit: 1,
    });
    assert.deepEqual(edges.map(edge => edge.toId), [fresh]);
  } finally {
    await adapter.close();
    await pool.query('drop schema if exists path_scan cascade');
    await pool.end();
  }
});
