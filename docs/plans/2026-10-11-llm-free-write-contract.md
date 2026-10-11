# LLM 없는 쓰기 계약 — Memory PR-1 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `@openaikits/memory`에 LLM 없는 쓰기 계약(작업 세트 · 지시문 빌더 · 파서 · `applyOperations`)과 벌크 `commitBulkPlan`을 추가하고, 기존 추출 LLM 경로가 같은 적용 입구를 쓰도록 리팩터한다. LLM 경로는 이 PR에서 지우지 않는다.

**Architecture:** 새 모듈 `src/memory/write-contract.ts`(순수 함수 3종)와 `src/memory/bulk-commit.ts`(저장)를 추가하고, `MemoryConnector`에 `applyOperations`를 공개 메서드로 꺼낸다. 스토리지에는 `createMemoriesBatch`(단일 multi-row INSERT) 하나만 더한다. 스키마 · 튜닝 상수 · origin 2종은 불변.

**Tech Stack:** TypeScript(ES2020, strict), `pg` + `pgvector`, 검증은 `tsx` 스크립트(로컬 Postgres `MEMORY_DATABASE_URL`, 임베딩은 `OPENAI_API_KEY`).

**Spec:** `packages/memory/docs/specs/2026-10-11-llm-free-write-contract.ko.md`

## Global Constraints

- 튜닝 상수 불변: 게이트 0.97 / 0.85, 시드 0.6 · K 5, 맥락 엣지 강도 `CONVERSATION_EDGE_STRENGTH = 0.7`, 회색 엣지 0.8, 노드 bump 0.1, 엣지 bump 0.05. 새 상수는 `maxOperations` 기본 10 하나.
- origin은 `conversation` · `knn_seed` 둘뿐. type은 `related` · `supersedes` 둘뿐.
- 스키마 변경 0. `schema_version` v3 그대로. `migrations/` 밑에 파일을 만들지 않는다.
- 이 PR에서 `handleAfterResponse` · `contextAdapter` · Consolidator · Optimizer · ToolHandler · `src/tools/`는 **삭제하지 않는다**(2차 PR).
- 테스트 코드를 저장소에 두지 않는다. 검증 스크립트는 `/Users/hbsps/projects/neume/scripts/memory-ops/verify/`(미추적)에 둔다.
- 커밋은 사용자 승인 뒤에만. 각 Task 끝의 "커밋 준비" 단계는 메시지를 적어 두고 멈춘다.
- 공개 함수 · 메서드 · 타입은 TSDoc(`@param` · `@returns` · `@throws`). 로그 접두어는 `[Memory]`.
- 검증 스크립트 실행 위치는 `packages/memory`(`tsx`가 그 패키지의 `node_modules`에 있다): `cd /Users/hbsps/projects/neume/packages/memory && npx tsx /Users/hbsps/projects/neume/scripts/memory-ops/verify/<file>.mts`.
- 로컬 DB는 `.env.local`의 `MEMORY_DATABASE_URL`(127.0.0.1:54332). 프로덕션 URL(`SUPABASE_REMOTE_DATABASE_URL`)은 이 계획의 어떤 스크립트도 읽지 않는다.
- `timeout` 명령은 이 맥에 없다. 타입체크는 `pnpm type-check`를 직접 실행한다.
- Node 타입(`crypto` 등)은 루트 `node_modules/@types/node`가 상위 디렉터리 탐색으로 잡힌다 — 2026-10-11 `import { randomUUID } from 'crypto'` 프로브로 type-check 통과 확인. 패키지 `package.json`에 의존성을 추가하지 않는다.

## Review Focus

- 모델이 별칭 대신 작업 세트 안의 **UUID를 그대로** 쓴 응답 → 유효 ID면 받아들여야 한다 (Task 3, 검사 13).
- content 문자열 안에 `]`나 `[/MEMORY_OPS]` 비슷한 텍스트가 들어간 블록 → 블록 경계는 첫 여는 태그와 첫 닫는 태그이고 JSON 파싱이 그 안에서 결정한다 (Task 3, 검사 14).
- 한 배치 안에 **같은 사실을 두 번 create** → 두 번째는 첫 번째를 상대로 게이트 스킵 + bump가 되어야 한다 (Task 4, 검사 E).
- plan과 commit 사이에 `toExistingId` 대상이 사라짐 → 그 엣지만 `droppedEdges`, 예외 없음 (Task 6, 검사 6).
- planned 노드가 0개인 plan → 0 결과, INSERT 자체를 보내지 않음 (Task 6, 검사 9).

---

### Task 1: 작업 세트 — `buildWorkingSet`

**Files:**
- Create: `src/memory/write-contract.ts`
- Modify: `src/index.ts` (export 추가, `runSleep` export 블록 아래)
- Verify: `/Users/hbsps/projects/neume/scripts/memory-ops/verify/write-contract.mts`

**Interfaces:**
- Produces:
  ```ts
  export interface WorkingSetEntry { alias: string; memoryId: string; content: string }
  export interface WorkingSet { entries: WorkingSetEntry[] }
  export function buildWorkingSet(
    memories: ReadonlyArray<{ id: string; content: string }>,
    options?: { aliasPrefix?: string },
  ): WorkingSet
  ```

- [ ] **Step 1: 검증 스크립트 작성 (실패해야 함)**

```ts
// /Users/hbsps/projects/neume/scripts/memory-ops/verify/write-contract.mts
// 순수 함수 검증 — DB · API 없음. 실행: cd packages/memory && npx tsx <this file>
import { buildWorkingSet } from '/Users/hbsps/projects/neume/packages/memory/src/memory/write-contract.ts';

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) pass++; else { fail++; console.log('FAIL', name, detail ?? ''); }
};

// WS-1 순서 유지 + 별칭 m1..mN
const ws = buildWorkingSet([
  { id: '11111111-1111-4111-8111-111111111111', content: 'A' },
  { id: '22222222-2222-4222-8222-222222222222', content: 'B' },
]);
check('WS-1 aliases', ws.entries.map(e => e.alias).join(',') === 'm1,m2');
check('WS-1 ids', ws.entries[1]!.memoryId === '22222222-2222-4222-8222-222222222222');

// WS-2 중복 UUID는 한 번만 (말투 + 동적 병합에서 같은 노드가 두 번 올 수 있음)
const dup = buildWorkingSet([
  { id: '11111111-1111-4111-8111-111111111111', content: 'A' },
  { id: '11111111-1111-4111-8111-111111111111', content: 'A' },
  { id: '33333333-3333-4333-8333-333333333333', content: 'C' },
]);
check('WS-2 dedupe', dup.entries.length === 2 && dup.entries[1]!.alias === 'm2');

// WS-3 빈 입력
check('WS-3 empty', buildWorkingSet([]).entries.length === 0);

// WS-4 접두어 옵션
check('WS-4 prefix', buildWorkingSet([{ id: 'x', content: 'x' }], { aliasPrefix: 'mem' }).entries[0]!.alias === 'mem1');

console.log(`write-contract: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: 실행해서 실패 확인**

Run: `cd /Users/hbsps/projects/neume/packages/memory && npx tsx /Users/hbsps/projects/neume/scripts/memory-ops/verify/write-contract.mts`
Expected: 모듈 없음 오류(`Cannot find module .../write-contract.ts`).

- [ ] **Step 3: 구현**

```ts
// src/memory/write-contract.ts
/**
 * LLM-free write contract — what the host shows the model (working set),
 * what the host appends to its prompt (instructions), and how the model's
 * reply is turned back into UUID-addressed operations (parser).
 *
 * Nothing in this module calls a model or touches storage. Design:
 * docs/specs/2026-10-11-llm-free-write-contract.ko.md §3.
 *
 * @public
 */
import type { MemoryOperation } from '../types';

/** One memory the host showed the model, addressed by a short alias. */
export interface WorkingSetEntry {
  /** Short alias used inside the prompt and the reply (e.g. `m3`). Request-scoped. */
  alias: string;
  /** The memory's UUID. */
  memoryId: string;
  /** Memory content as shown to the model. */
  content: string;
}

/** The set of memories a reply may reference. Operations may only address these. */
export interface WorkingSet {
  entries: WorkingSetEntry[];
}

/**
 * Builds a working set from the memories shown to the model this turn.
 *
 * Keeps retrieval order, drops repeated UUIDs (tone + dynamic retrieval can
 * overlap), and assigns aliases `<prefix>1..N` in that order.
 *
 * @param memories - Memories shown to the model (id + content)
 * @param options - `aliasPrefix` (default `m`)
 * @returns Working set with one entry per distinct UUID
 *
 * @public
 */
export function buildWorkingSet(
  memories: ReadonlyArray<{ id: string; content: string }>,
  options: { aliasPrefix?: string } = {},
): WorkingSet {
  const prefix = options.aliasPrefix ?? 'm';
  const seen = new Set<string>();
  const entries: WorkingSetEntry[] = [];
  for (const m of memories) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    entries.push({ alias: `${prefix}${entries.length + 1}`, memoryId: m.id, content: m.content });
  }
  return { entries };
}
```

`src/index.ts`의 `runSleep` export 블록 아래에 추가:

```ts
export { buildWorkingSet } from './memory/write-contract';
export type { WorkingSet, WorkingSetEntry } from './memory/write-contract';
```

- [ ] **Step 4: 실행해서 통과 확인**

Run: 같은 명령. Expected: `write-contract: 4 pass, 0 fail`.

- [ ] **Step 5: 타입체크**

Run: `cd /Users/hbsps/projects/neume/packages/memory && pnpm type-check`
Expected: 오류 0.

- [ ] **Step 6: 커밋 준비 (사용자 승인 후)**

```
feat(write-contract): working set — alias ↔ UUID mapping for host-side writes
```

---

### Task 2: 지시문 빌더 — `buildMemoryWriteInstructions`

**Files:**
- Modify: `src/memory/write-contract.ts` (Task 1 파일에 추가)
- Modify: `src/index.ts`
- Verify: `/Users/hbsps/projects/neume/scripts/memory-ops/verify/write-contract.mts` (검사 추가)

**Interfaces:**
- Consumes: `WorkingSet` (Task 1)
- Produces:
  ```ts
  export const DEFAULT_MEMORY_OPS_BLOCK_TAG = 'MEMORY_OPS';
  export const DEFAULT_MAX_OPERATIONS = 10;
  export interface WriteInstructionOptions {
    entityName?: string; partnerName?: string; contentLocale?: 'ko' | 'en';
    blockTag?: string; maxOperations?: number; includeWorkingSetList?: boolean;
  }
  export interface WriteInstructionParts { ownership: string; usage: string; idRule: string; format: string }
  export function writeInstructionParts(options?: WriteInstructionOptions): WriteInstructionParts
  export function buildMemoryWriteInstructions(workingSet: WorkingSet, options?: WriteInstructionOptions): string
  ```

- [ ] **Step 1: 검증 추가 (실패해야 함)** — `write-contract.mts`의 `console.log(...)` 위에 붙인다.

```ts
import {
  buildMemoryWriteInstructions,
  writeInstructionParts,
  DEFAULT_MEMORY_OPS_BLOCK_TAG,
} from '/Users/hbsps/projects/neume/packages/memory/src/memory/write-contract.ts';

const wsI = buildWorkingSet([
  { id: '11111111-1111-4111-8111-111111111111', content: '상대방은 서울에 산다' },
  { id: '22222222-2222-4222-8222-222222222222', content: '나는 커피를 좋아한다' },
]);
const plain = buildMemoryWriteInstructions(wsI);
check('IN-1 block tag', plain.includes(`[${DEFAULT_MEMORY_OPS_BLOCK_TAG}]`) && plain.includes(`[/${DEFAULT_MEMORY_OPS_BLOCK_TAG}]`));
check('IN-2 default max', plain.includes('10'));
check('IN-3 no ownership block without names', !plain.includes('Memory ownership'));
check('IN-4 ko rule', plain.includes('한국어'));
check('IN-5 list omitted by default', !plain.includes('11111111-1111-4111-8111-111111111111') && !plain.includes('상대방은 서울에 산다'));
check('IN-6 alias rule present', plain.includes('m1'));

const named = buildMemoryWriteInstructions(wsI, { entityName: '하나', partnerName: '민수', contentLocale: 'en', maxOperations: 4, blockTag: 'MEM' });
check('IN-7 ownership with names', named.includes('Memory ownership') && named.includes('하나') && named.includes('민수'));
check('IN-8 en rule', named.includes('English'));
check('IN-9 custom max', named.includes('4'));
check('IN-10 custom tag', named.includes('[MEM]') && named.includes('[/MEM]'));

const listed = buildMemoryWriteInstructions(wsI, { includeWorkingSetList: true });
check('IN-11 list included', listed.includes('m1') && listed.includes('상대방은 서울에 산다') && listed.includes('m2'));

const parts = writeInstructionParts({ entityName: '하나' });
check('IN-12 parts keys', ['ownership', 'usage', 'idRule', 'format'].every(k => typeof (parts as any)[k] === 'string'));
check('IN-13 no model names', !/gpt|claude|grok/i.test(plain));
```

- [ ] **Step 2: 실행해서 실패 확인** — Expected: import 오류(`buildMemoryWriteInstructions` 없음).

- [ ] **Step 3: 구현** — `write-contract.ts`에 추가. 문구는 오늘 `connector.ts`의 `buildAfterResponseSystemPrompt`에서 가져오되 "Existing memories 목록" 설명은 별칭 규칙으로 바꾼다.

```ts
/** Default tag of the operations block the model appends to its reply. */
export const DEFAULT_MEMORY_OPS_BLOCK_TAG = 'MEMORY_OPS';
/** Default cap on operations accepted from one reply. */
export const DEFAULT_MAX_OPERATIONS = 10;

/** Options shared by the instruction builder and its parts. */
export interface WriteInstructionOptions {
  /** This entity's display name (the assistant). Enables the ownership block. */
  entityName?: string;
  /** The conversation partner's display name (the user). Enables the ownership block. */
  partnerName?: string;
  /** Language of new/updated memory content (default `ko`). */
  contentLocale?: 'ko' | 'en';
  /** Block tag (default {@link DEFAULT_MEMORY_OPS_BLOCK_TAG}). */
  blockTag?: string;
  /** Max operations per reply (default {@link DEFAULT_MAX_OPERATIONS}). */
  maxOperations?: number;
  /** Also list the working set (alias + content). Default false: the host's memory block already shows it. */
  includeWorkingSetList?: boolean;
}

/** Instruction text split into reusable pieces (e.g. for tool descriptions). */
export interface WriteInstructionParts {
  /** Who a fact is about; empty string when no names were given. */
  ownership: string;
  /** When to create / update / link / delete. */
  usage: string;
  /** Aliases only, no invented IDs. */
  idRule: string;
  /** The block, the JSON schema, the cap, the language rule. */
  format: string;
}

/**
 * Returns the instruction text as separate parts.
 *
 * @param options - Names, locale, tag, cap
 * @returns Parts; `ownership` is empty when neither name is given
 *
 * @public
 */
export function writeInstructionParts(options: WriteInstructionOptions = {}): WriteInstructionParts {
  const {
    entityName,
    partnerName,
    contentLocale = 'ko',
    blockTag = DEFAULT_MEMORY_OPS_BLOCK_TAG,
    maxOperations = DEFAULT_MAX_OPERATIONS,
  } = options;
  const me = entityName || 'this entity';
  const you = partnerName || '상대방';

  const ownership =
    entityName || partnerName
      ? `**Memory ownership — CRITICAL:**
This entity is "${me}" (the assistant in the conversation). The conversation partner is "${you}" (the user).
When creating or updating memories, you MUST state WHO the fact is about in the content:
- Facts about this entity: start with "나는 ~" or "${me}는 ~" (e.g. "나는 커피를 좋아한다")
- Facts about the partner: start with "${you}은(는) ~" (e.g. "${you}은(는) 서울에 산다")
- NEVER store a partner's fact without attributing it to "${you}". "I live in Seoul" said by the user becomes "${you}은(는) 서울에 산다".
- NEVER confuse who said what. "user" is ${you}; "assistant" is ${me}.
- Store facts from BOTH sides — do not skip facts the assistant said about itself.`
      : '';

  const usage = `**When to use each operation:**
- create: a new fact about this entity OR its partner that is not already in the memories shown. If similar content already exists, use update instead.
- update: a shown memory's content has changed (e.g. "I live in NYC" → "I moved to Boston"). Do NOT create when the fact is an update.
- updateLink: two shown memories are related (add) or no longer related (remove).
- delete: a shown memory is clearly wrong or no longer needed. Prefer update over delete.
- Only output operations clearly implied by the conversation. If nothing to do, output an empty array.`;

  const idRule = `**IDs:** the memories shown to you carry aliases like m1, m2, …. Reference memories ONLY by those aliases, and only aliases that appear in the list. Do not invent aliases or IDs. For create, put related aliases in relatedMemoryIds (facts that this new one is a consequence of, explains, or belongs with — not merely similar wording).`;

  const languageRule =
    contentLocale === 'en'
      ? 'Write all new/updated memory **content** in **English**.'
      : '모든 memory **content**는 **한국어** 평서문으로 작성.';

  const format = `**Output format:** after your reply text, append exactly one block:
[${blockTag}]
{ "operations": [ ... ] }
[/${blockTag}]
Operation schema (use these field names only):
- { "action": "create", "content": string, "relatedMemoryIds"?: string[] }
- { "action": "update", "memoryId": string, "content": string }
- { "action": "updateLink", "fromMemoryId": string, "toMemoryId": string, "linkAction": "add" | "remove" }
- { "action": "delete", "memoryId": string }
At most ${maxOperations} operations. If there is nothing to store, still append the block with { "operations": [] }.
${languageRule}
The block must be valid JSON. No markdown code fences inside the block. Never put the block anywhere but the very end.`;

  return { ownership, usage, idRule, format };
}

/**
 * Builds the memory-write instruction text the host appends to its own prompt.
 *
 * Contains no model-specific wording. By default it does not repeat the working
 * set (the host's memory block already shows it); `includeWorkingSetList`
 * adds an alias + content list for hosts without such a block.
 *
 * @param workingSet - Aliases the reply may reference
 * @param options - Names, locale, block tag, cap, list toggle
 * @returns Instruction text (plain, prompt-ready)
 *
 * @public
 */
export function buildMemoryWriteInstructions(
  workingSet: WorkingSet,
  options: WriteInstructionOptions = {},
): string {
  const parts = writeInstructionParts(options);
  const list =
    options.includeWorkingSetList && workingSet.entries.length > 0
      ? `\n\n**Memories you may reference:**\n${workingSet.entries.map(e => `- ${e.alias}: ${e.content}`).join('\n')}`
      : '';
  return [
    '## Memory operations',
    'You manage long-term memory for this entity. Decide what to remember from this turn and emit it as operations in the block described below.',
    parts.ownership,
    parts.usage,
    parts.idRule,
    parts.format,
  ]
    .filter(s => s.length > 0)
    .join('\n\n') + list;
}
```

`src/index.ts` export에 추가: `buildMemoryWriteInstructions, writeInstructionParts, DEFAULT_MEMORY_OPS_BLOCK_TAG, DEFAULT_MAX_OPERATIONS` 와 타입 `WriteInstructionOptions, WriteInstructionParts`.

- [ ] **Step 4: 실행해서 통과 확인** — Expected: `write-contract: 17 pass, 0 fail`.

- [ ] **Step 5: 타입체크** — `pnpm type-check` 오류 0.

- [ ] **Step 6: 커밋 준비 (사용자 승인 후)**

```
feat(write-contract): instruction builder — ownership/usage/id/format parts, no model calls
```

---

### Task 3: 파서 — `parseMemoryOperations`

**Files:**
- Modify: `src/memory/write-contract.ts`
- Modify: `src/index.ts`
- Verify: `/Users/hbsps/projects/neume/scripts/memory-ops/verify/write-contract.mts` (검사 추가)

**Interfaces:**
- Consumes: `WorkingSet`, `MemoryOperation`(`src/types.ts`)
- Produces:
  ```ts
  export type ParseDropReason = 'unknown_alias' | 'empty_content' | 'invalid_shape' | 'over_limit';
  export interface ParseMemoryOperationsResult {
    operations: MemoryOperation[];
    dropped: Array<{ reason: ParseDropReason; raw: unknown }>;
    blockFound: boolean;
    jsonValid: boolean;
    textWithoutBlock: string;
  }
  export function parseMemoryOperations(text: string, workingSet: WorkingSet, options?: { blockTag?: string; maxOperations?: number }): ParseMemoryOperationsResult
  export function stripMemoryOpsBlock(text: string, blockTag?: string): string
  ```

- [ ] **Step 1: 검증 추가 (실패해야 함)**

```ts
import { parseMemoryOperations, stripMemoryOpsBlock } from '/Users/hbsps/projects/neume/packages/memory/src/memory/write-contract.ts';

const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
const wsP = buildWorkingSet([{ id: A, content: 'A' }, { id: B, content: 'B' }]);
const block = (json: string, tag = 'MEMORY_OPS') => `안녕, 잘 지냈어?\n\n[${tag}]\n${json}\n[/${tag}]`;

// P-1 블록 없음
let r = parseMemoryOperations('그냥 대사만.', wsP);
check('P-1 no block', !r.blockFound && r.operations.length === 0 && r.textWithoutBlock === '그냥 대사만.');
// P-2 JSON 깨짐 → 0개, 블록은 제거
r = parseMemoryOperations(block('{ operations: [ '), wsP);
check('P-2 bad json', r.blockFound && !r.jsonValid && r.operations.length === 0 && r.textWithoutBlock === '안녕, 잘 지냈어?');
// P-3 코드펜스 허용
r = parseMemoryOperations(block('```json\n{"operations":[{"action":"create","content":"새 사실"}]}\n```'), wsP);
check('P-3 fence', r.operations.length === 1);
// P-4 별칭 → UUID
r = parseMemoryOperations(block('{"operations":[{"action":"update","memoryId":"m2","content":"B2"}]}'), wsP);
check('P-4 alias→uuid', r.operations[0]?.action === 'update' && (r.operations[0] as any).memoryId === B);
// P-5 모르는 별칭 → 그 연산 폐기
r = parseMemoryOperations(block('{"operations":[{"action":"delete","memoryId":"m9"}]}'), wsP);
check('P-5 unknown alias', r.operations.length === 0 && r.dropped[0]?.reason === 'unknown_alias');
// P-6 create의 related 부분 제거
r = parseMemoryOperations(block('{"operations":[{"action":"create","content":"C","relatedMemoryIds":["m1","m7"]}]}'), wsP);
check('P-6 related filtered', (r.operations[0] as any).relatedMemoryIds.join() === A && r.dropped.length === 0);
// P-7 빈 content
r = parseMemoryOperations(block('{"operations":[{"action":"create","content":"   "}]}'), wsP);
check('P-7 empty content', r.operations.length === 0 && r.dropped[0]?.reason === 'empty_content');
// P-8 상한
const many = JSON.stringify({ operations: Array.from({ length: 12 }, (_, i) => ({ action: 'create', content: `c${i}` })) });
r = parseMemoryOperations(block(many), wsP);
check('P-8 over limit', r.operations.length === 10 && r.dropped.filter(d => d.reason === 'over_limit').length === 2);
// P-9 블록 중복 → 첫 블록, 둘 다 제거
r = parseMemoryOperations(block('{"operations":[{"action":"create","content":"first"}]}') + '\n[MEMORY_OPS]{"operations":[{"action":"create","content":"second"}]}[/MEMORY_OPS]', wsP);
check('P-9 first block wins', r.operations.length === 1 && (r.operations[0] as any).content === 'first' && !r.textWithoutBlock.includes('MEMORY_OPS'));
// P-10 본문 분리 (앞뒤 공백 정리)
r = parseMemoryOperations(block('{"operations":[]}'), wsP);
check('P-10 text', r.textWithoutBlock === '안녕, 잘 지냈어?');
// P-11 updateLink 양쪽 별칭 + linkAction 검증
r = parseMemoryOperations(block('{"operations":[{"action":"updateLink","fromMemoryId":"m1","toMemoryId":"m2","linkAction":"add"},{"action":"updateLink","fromMemoryId":"m1","toMemoryId":"m2","linkAction":"merge"}]}'), wsP);
check('P-11 link', r.operations.length === 1 && (r.operations[0] as any).toMemoryId === B && r.dropped[0]?.reason === 'invalid_shape');
// P-12 delete
r = parseMemoryOperations(block('{"operations":[{"action":"delete","memoryId":"m1"}]}'), wsP);
check('P-12 delete', (r.operations[0] as any).memoryId === A);
// P-13 (Review Focus) 작업 세트 안의 UUID를 그대로 써도 받는다
r = parseMemoryOperations(block(`{"operations":[{"action":"update","memoryId":"${B}","content":"B3"}]}`), wsP);
check('P-13 raw uuid in set', (r.operations[0] as any)?.memoryId === B);
// P-14 (Review Focus) content 안의 대괄호
r = parseMemoryOperations(block('{"operations":[{"action":"create","content":"그는 [서울] 출신이다 [/x]"}]}'), wsP);
check('P-14 brackets in content', (r.operations[0] as any)?.content === '그는 [서울] 출신이다 [/x]' && r.textWithoutBlock === '안녕, 잘 지냈어?');
// P-15 커스텀 태그 + strip 헬퍼
r = parseMemoryOperations(block('{"operations":[]}', 'MEM'), wsP, { blockTag: 'MEM' });
check('P-15 custom tag', r.blockFound && r.textWithoutBlock === '안녕, 잘 지냈어?');
check('P-16 strip helper', stripMemoryOpsBlock(block('{"operations":[]}')) === '안녕, 잘 지냈어?' && stripMemoryOpsBlock('no block') === 'no block');
```

- [ ] **Step 2: 실행해서 실패 확인** — Expected: import 오류(`parseMemoryOperations` 없음).

- [ ] **Step 3: 구현**

```ts
/** Why an operation in the reply was not accepted. */
export type ParseDropReason = 'unknown_alias' | 'empty_content' | 'invalid_shape' | 'over_limit';

/** Result of parsing a reply that may carry an operations block. */
export interface ParseMemoryOperationsResult {
  /** Accepted operations, aliases resolved to UUIDs. */
  operations: MemoryOperation[];
  /** Rejected items with the reason. */
  dropped: Array<{ reason: ParseDropReason; raw: unknown }>;
  /** A block was present (even if its JSON was invalid). */
  blockFound: boolean;
  /** The first block's JSON parsed. False when no block or broken JSON. */
  jsonValid: boolean;
  /** Reply text with every block removed, trimmed. */
  textWithoutBlock: string;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function blockRegex(tag: string, flags: string): RegExp {
  const t = escapeRegExp(tag);
  // Lazy inner match: the block ends at the FIRST closing tag after the opening tag.
  return new RegExp(`\\s*\\[${t}\\]([\\s\\S]*?)\\[\\/${t}\\][^\\S\\n]*`, flags);
}

/**
 * Removes every `[TAG]…[/TAG]` block from a reply (host display / storage safety).
 *
 * @param text - Reply text
 * @param blockTag - Tag (default {@link DEFAULT_MEMORY_OPS_BLOCK_TAG})
 * @returns Text without blocks, runs of 3+ newlines collapsed, trimmed
 *
 * @public
 */
export function stripMemoryOpsBlock(text: string, blockTag: string = DEFAULT_MEMORY_OPS_BLOCK_TAG): string {
  if (!text) return text;
  return text.replace(blockRegex(blockTag, 'gi'), '').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Parses the operations block out of a reply and resolves aliases to UUIDs.
 *
 * Rules: no block → no operations; broken JSON → no operations (block still
 * stripped); unknown alias → that operation dropped (for create, only the
 * unknown related entries are dropped); blank content → dropped; beyond
 * `maxOperations` → dropped; first block wins when several exist. A raw UUID
 * that belongs to the working set is accepted as if it were an alias.
 * Storage is never consulted.
 *
 * @param text - Full reply text
 * @param workingSet - Aliases the reply may reference
 * @param options - `blockTag`, `maxOperations`
 * @returns Operations, drops, flags, and the reply without blocks
 *
 * @public
 */
export function parseMemoryOperations(
  text: string,
  workingSet: WorkingSet,
  options: { blockTag?: string; maxOperations?: number } = {},
): ParseMemoryOperationsResult {
  const blockTag = options.blockTag ?? DEFAULT_MEMORY_OPS_BLOCK_TAG;
  const maxOperations = options.maxOperations ?? DEFAULT_MAX_OPERATIONS;
  const textWithoutBlock = stripMemoryOpsBlock(text ?? '', blockTag);
  const match = (text ?? '').match(blockRegex(blockTag, 'i'));
  if (!match) {
    return { operations: [], dropped: [], blockFound: false, jsonValid: false, textWithoutBlock };
  }

  const inner = match[1]!.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  let parsed: { operations?: unknown } | null = null;
  try {
    parsed = JSON.parse(inner) as { operations?: unknown };
  } catch {
    return { operations: [], dropped: [], blockFound: true, jsonValid: false, textWithoutBlock };
  }
  const rawOps = Array.isArray(parsed?.operations) ? (parsed!.operations as unknown[]) : [];

  const byAlias = new Map<string, string>();
  const idsInSet = new Set<string>();
  for (const e of workingSet.entries) {
    byAlias.set(e.alias, e.memoryId);
    idsInSet.add(e.memoryId);
  }
  const resolve = (ref: unknown): string | null => {
    if (typeof ref !== 'string') return null;
    const v = ref.trim();
    return byAlias.get(v) ?? (idsInSet.has(v) ? v : null);
  };

  const operations: MemoryOperation[] = [];
  const dropped: ParseMemoryOperationsResult['dropped'] = [];
  for (const raw of rawOps) {
    if (operations.length >= maxOperations) {
      dropped.push({ reason: 'over_limit', raw });
      continue;
    }
    if (!raw || typeof raw !== 'object' || !('action' in raw)) {
      dropped.push({ reason: 'invalid_shape', raw });
      continue;
    }
    const o = raw as Record<string, unknown>;
    switch (o.action) {
      case 'create': {
        const content = typeof o.content === 'string' ? o.content.trim() : '';
        if (!content) { dropped.push({ reason: 'empty_content', raw }); break; }
        const related = Array.isArray(o.relatedMemoryIds)
          ? (o.relatedMemoryIds as unknown[]).map(resolve).filter((id): id is string => id !== null)
          : [];
        operations.push({ action: 'create', content, relatedMemoryIds: related });
        break;
      }
      case 'update': {
        const memoryId = resolve(o.memoryId);
        const content = typeof o.content === 'string' ? o.content.trim() : '';
        if (!memoryId) { dropped.push({ reason: 'unknown_alias', raw }); break; }
        if (!content) { dropped.push({ reason: 'empty_content', raw }); break; }
        operations.push({ action: 'update', memoryId, content });
        break;
      }
      case 'updateLink': {
        const fromMemoryId = resolve(o.fromMemoryId);
        const toMemoryId = resolve(o.toMemoryId);
        if (o.linkAction !== 'add' && o.linkAction !== 'remove') { dropped.push({ reason: 'invalid_shape', raw }); break; }
        if (!fromMemoryId || !toMemoryId) { dropped.push({ reason: 'unknown_alias', raw }); break; }
        operations.push({ action: 'updateLink', fromMemoryId, toMemoryId, linkAction: o.linkAction });
        break;
      }
      case 'delete': {
        const memoryId = resolve(o.memoryId);
        if (!memoryId) { dropped.push({ reason: 'unknown_alias', raw }); break; }
        operations.push({ action: 'delete', memoryId });
        break;
      }
      default:
        dropped.push({ reason: 'invalid_shape', raw });
    }
  }
  return { operations, dropped, blockFound: true, jsonValid: true, textWithoutBlock };
}
```

`src/index.ts`에 `parseMemoryOperations, stripMemoryOpsBlock`와 타입 `ParseDropReason, ParseMemoryOperationsResult` export 추가.

- [ ] **Step 4: 실행해서 통과 확인** — Expected: `write-contract: 33 pass, 0 fail`.

- [ ] **Step 5: 타입체크 + lint** — `pnpm type-check && pnpm lint` 오류 0.

- [ ] **Step 6: 커밋 준비 (사용자 승인 후)**

```
feat(write-contract): parser — alias→UUID, working-set-only IDs, block strip
```

---

### Task 4: `applyOperations` — 실행부 공개 + 기존 LLM 경로 리팩터 (동작 동치)

**Files:**
- Modify: `src/memory/connector.ts` (`runAfterResponseWithContext`의 `for (const op of operations)` 루프를 메서드로 추출; 현재 562~720행 근방)
- Modify: `src/index.ts` (타입 export)
- Verify: `/Users/hbsps/projects/neume/scripts/memory-ops/verify/apply-equivalence.mts` (로컬 DB + 임베딩 API)

**Interfaces:**
- Consumes: `MemoryOperation`, 기존 private `judgeDedupGate` · `applyPostCreateGateActions` · `recordGateDecision` · `createMemory` · `updateMemory` · `updateMemoryLink` · `storage.setMemoryStatus` · `storage.bumpMemoryStrength`
- Produces:
  ```ts
  export interface ApplyOperationOutcome { action: MemoryOperation['action']; ok: boolean; memoryId?: string; skippedByGate?: boolean; error?: string }
  export interface ApplyOperationsResult { applied: number; failed: number; createdIds: string[]; skippedByGate: number; outcomes: ApplyOperationOutcome[] }
  // MemoryConnector
  async applyOperations(operations: MemoryOperation[], options?: { source?: string }): Promise<ApplyOperationsResult>
  ```

- [ ] **Step 1: 기준선 스크립트 작성 — 리팩터 전 코드로 실행해 스냅샷을 저장**

```ts
// /Users/hbsps/projects/neume/scripts/memory-ops/verify/apply-equivalence.mts
// 사용: npx tsx apply-equivalence.mts baseline   → verify/apply-baseline.json 저장 (리팩터 전 HEAD에서 실행)
//       npx tsx apply-equivalence.mts compare    → 리팩터 후: (a) 가짜 어댑터 경로 (b) applyOperations 직접 — 둘 다 기준선과 비교
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as MemoryMod from '/Users/hbsps/projects/neume/packages/memory/src/memory.ts';
import * as ST from '/Users/hbsps/projects/neume/packages/memory/src/storage/storage-types.ts';
import { OpenAIAdapter } from '/Users/hbsps/projects/neume/packages/memory/src/vector/openai-adapter.ts';
const require = createRequire('/Users/hbsps/projects/neume/packages/memory/');
const { Client } = require('pg');

const env = fs.readFileSync('/Users/hbsps/projects/neume/.env.local', 'utf8');
const pick = (k: string) => env.match(new RegExp(`^${k}=(.*)$`, 'm'))![1].trim().replace(/^["']|["']$/g, '');
const dbUrl = pick('MEMORY_DATABASE_URL');           // 로컬 전용
const openaiKey = pick('OPENAI_API_KEY');
if (/supabase\.co|pooler/.test(dbUrl)) throw new Error('refusing non-local DB');

const mode = process.argv[2];
const BASE = '/Users/hbsps/projects/neume/scripts/memory-ops/verify/apply-baseline.json';

const mem = new MemoryMod.Memory();
await mem.initialize(
  { type: ST.StorageType.POSTGRES, connectionString: dbUrl, schema: 'memory' },
  { aiAdapter: new OpenAIAdapter({ apiKey: openaiKey, embeddingModel: 'text-embedding-3-small' }) },
);
const storage = mem.getStorage();
const pg = new Client({ connectionString: dbUrl }); await pg.connect();

const SEED = ['상대방은 서울에 산다', '나는 커피를 좋아한다', '상대방은 개발자이다'];
async function seed(entityId: string): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  for (const content of SEED) {
    const m = await storage.createMemory({ entityId, content, outgoingEdges: [] });
    ids[content] = m.id;
  }
  return ids;
}
// 고정 연산 — A: 서울, B: 커피, C: 개발자
const ops = (id: Record<string, string>) => [
  { action: 'create', content: '상대방은 부산으로 이사했다', relatedMemoryIds: [id['상대방은 서울에 산다']!] },
  { action: 'update', memoryId: id['나는 커피를 좋아한다']!, content: '나는 녹차를 좋아한다' },
  { action: 'updateLink', fromMemoryId: id['상대방은 서울에 산다']!, toMemoryId: id['상대방은 개발자이다']!, linkAction: 'add' },
  { action: 'delete', memoryId: id['상대방은 개발자이다']! },
  { action: 'create', content: '상대방은 서울에 산다.' },            // 거의 동일 → 게이트 스킵 + bump
  { action: 'create', content: '상대방은 고양이를 키운다' },
  { action: 'create', content: '상대방은 고양이를 키운다' },          // (Review Focus E) 같은 배치 내 중복 → 두 번째 스킵
] as const;

async function snapshot(entityId: string) {
  const mems = (await pg.query(`select id, content, status, round(strength::numeric,2) strength, cardinality(outgoing_edges) arr from memory.memories where entity_id=$1 order by content`, [entityId])).rows;
  const byId = Object.fromEntries(mems.map((m: any) => [m.id, m.content]));
  const edges = (await pg.query(`select from_id, to_id, origin, type, round(strength::numeric,2) strength from memory.edges where entity_id=$1`, [entityId])).rows
    .map((e: any) => `${byId[e.from_id]}→${byId[e.to_id]}|${e.origin}|${e.type}|${e.strength}`).sort();
  const gates = (await pg.query(`select decision, count(*)::int n from memory.gate_decisions where entity_id=$1 group by 1 order by 1`, [entityId])).rows;
  const jobs = (await pg.query(`select count(*)::int n from memory.sleep_jobs where entity_id=$1`, [entityId])).rows[0].n;
  return { memories: mems.map((m: any) => ({ content: m.content, status: m.status, strength: m.strength, arr: m.arr })), edges, gates, jobs };
}

function connectorFor(entityId: string, generate?: () => Promise<string>) {
  return mem.createConnector({
    entityId, entityName: '하나', partnerName: '민수', contentLocale: 'ko', mode: 'read-write',
    maxMemoryCount: 10, tuning: { dedupGateMode: 'active' },
    ...(generate ? { contextAdapter: { generate } } : {}),
  });
}

async function runOldPath(entityId: string) {
  const id = await seed(entityId);
  const connector = connectorFor(entityId, async () => JSON.stringify({ operations: ops(id) }));
  await connector.connect(async () => {}); // isConnected 없이는 handleAfterResponse가 바로 반환한다
  await connector.handleAfterResponse({ entityId, messages: [{ role: 'user', content: '서울 얘기' }, { role: 'assistant', content: '응' }] });
  return snapshot(entityId);
}
async function runApplyPath(entityId: string) {
  const id = await seed(entityId);
  const connector: any = connectorFor(entityId);
  const result = await connector.applyOperations(ops(id) as any, { source: 'verify' });
  return { snap: await snapshot(entityId), result };
}

const stamp = Date.now();
if (mode === 'baseline') {
  const snap = await runOldPath(`verify-apply-base-${stamp}`);
  fs.writeFileSync(BASE, JSON.stringify(snap, null, 2));
  console.log('baseline saved', JSON.stringify(snap.gates), 'jobs', snap.jobs, 'edges', snap.edges.length);
} else if (mode === 'compare') {
  const base = JSON.parse(fs.readFileSync(BASE, 'utf8'));
  const a = await runOldPath(`verify-apply-old-${stamp}`);
  const { snap: b, result } = await runApplyPath(`verify-apply-new-${stamp}`);
  const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
  let fail = 0;
  const check = (n: string, ok: boolean, d?: unknown) => { if (!ok) { fail++; console.log('FAIL', n, d ?? ''); } };
  check('A old path == baseline', same(a, base), { a, base });
  check('B applyOperations == baseline', same(b, base), { b, base });
  check('C result counts', result.applied === 7 && result.failed === 0 && result.skippedByGate === 2, result); // applied = 예외 없이 끝난 연산 수(게이트 스킵 포함)
  check('D createdIds', result.createdIds.length === 2);
  check('E in-batch duplicate skipped', b.memories.filter((m: any) => m.content === '상대방은 고양이를 키운다').length === 1);
  check('F delete is demotion', b.memories.find((m: any) => m.content === '상대방은 개발자이다')?.status === 'demoted');
  console.log(fail ? `apply-equivalence: ${fail} FAIL` : 'apply-equivalence: all pass');
  process.exit(fail ? 1 : 0);
}
await pg.end();
```

- [ ] **Step 2: 리팩터 전 코드로 기준선 저장**

Run: `cd /Users/hbsps/projects/neume/packages/memory && npx tsx /Users/hbsps/projects/neume/scripts/memory-ops/verify/apply-equivalence.mts baseline`
Expected: `baseline saved … jobs 0 edges N`. (게이트 스킵 2건이 gates에 `skip`으로 보여야 한다. 임베딩이 미세하게 흔들려 0.97 경계를 넘나들면 `상대방은 서울에 산다.`를 더 가깝게 바꾼다. 예: 마침표 대신 공백 하나.)

- [ ] **Step 3: `compare`를 실행해 실패 확인** — Expected: `applyOperations is not a function`.

- [ ] **Step 4: 구현 — 루프 추출**

`connector.ts`에서 `runAfterResponseWithContext`의 `for (const op of operations) { … }` 전체를 아래 메서드로 옮기고, 원래 자리에는 `await this.applyOperations(operations, { source: 'package' });` 한 줄만 남긴다. 로그 문자열 `[Memory] after-response: N operations …`은 그 앞에 그대로 둔다.

```ts
/** Outcome of one operation inside {@link MemoryConnector.applyOperations}. */
export interface ApplyOperationOutcome {
  action: MemoryOperation['action'];
  ok: boolean;
  /** Created / updated / linked-from / demoted memory id when known. */
  memoryId?: string;
  /** create only: the dedup gate treated it as a duplicate (existing node bumped instead). */
  skippedByGate?: boolean;
  error?: string;
}

/** Summary returned by {@link MemoryConnector.applyOperations}. */
export interface ApplyOperationsResult {
  applied: number;
  failed: number;
  createdIds: string[];
  skippedByGate: number;
  outcomes: ApplyOperationOutcome[];
}

  /**
   * Applies memory operations decided by the host (or by the package's own
   * extraction path) using the rule engine only: dedup gate, kNN seeding,
   * conversation-edge dual write, demotion. No model call happens here.
   *
   * Each operation is isolated: a failure is recorded in `outcomes` and the
   * rest proceed. Operation ids are trusted as given — hosts should resolve
   * aliases through {@link parseMemoryOperations} first.
   *
   * @param operations - UUID-addressed operations
   * @param options - `source`: log tag (default `host`)
   * @returns Counts and per-operation outcomes
   * @throws Error when the connector is in read-only mode
   *
   * @public
   */
  async applyOperations(
    operations: MemoryOperation[],
    options: { source?: string } = {},
  ): Promise<ApplyOperationsResult> {
    if (this.config.mode === 'read-only') {
      throw new Error('Cannot apply memory operations in read-only mode');
    }
    const source = options.source ?? 'host';
    const runScope =
      this.config.runWithEmbeddingScope ?? (<T>(_scope: 'search' | 'write', fn: () => T) => fn());
    const result: ApplyOperationsResult = { applied: 0, failed: 0, createdIds: [], skippedByGate: 0, outcomes: [] };

    for (const op of operations) {
      try {
        const outcome = await runScope('write', async (): Promise<ApplyOperationOutcome> => {
          if (op.action === 'create') {
            const gateMode = this.tuning.dedupGateMode;
            const judgement = gateMode === 'off' ? null : await this.judgeDedupGate(op.content);
            const skip = gateMode === 'active' && judgement?.wouldSkip === true;

            let createdId: string | null = null;
            if (skip) {
              console.log('[Memory] dedup gate: skipped create', {
                similarity: judgement?.top?.similarity,
                matchedMemoryId: judgement?.top?.id,
              });
              // Duplicate mention = reinforcement signal for the existing memory
              if (judgement?.top) {
                try {
                  await this.storage.bumpMemoryStrength(judgement.top.id, NODE_STRENGTH_BUMP);
                } catch (err) {
                  console.error('[Memory] strength bump failed:', err);
                }
              }
            } else {
              const created = await this.createMemory(op.content, {
                relatedMemoryIds: op.relatedMemoryIds ?? [],
                ...(judgement?.embedding ? { embedding: judgement.embedding } : {}),
              });
              createdId = created.id;
              if (gateMode === 'active' && judgement) {
                await this.applyPostCreateGateActions(created.id, judgement);
              }
              if (this.config.verbose) {
                console.log('[Memory] verbose create:', {
                  id: created.id,
                  content: created.content,
                  relatedMemoryIds: op.relatedMemoryIds ?? [],
                });
              }
            }

            if (judgement && (gateMode === 'shadow' || gateMode === 'active')) {
              this.recordGateDecision(gateMode, op.content, judgement, skip, createdId);
            }
            return skip
              ? { action: 'create', ok: true, skippedByGate: true, ...(judgement?.top ? { memoryId: judgement.top.id } : {}) }
              : { action: 'create', ok: true, ...(createdId ? { memoryId: createdId } : {}) };
          } else if (op.action === 'update') {
            const updated = await this.updateMemory(op.memoryId, op.content);
            if (this.config.verbose) {
              console.log('[Memory] verbose update:', { memoryId: op.memoryId, newContent: updated.content });
            }
            return { action: 'update', ok: true, memoryId: op.memoryId };
          } else if (op.action === 'updateLink') {
            const linked = await this.updateMemoryLink(op.fromMemoryId, op.toMemoryId, op.linkAction);
            if (this.config.verbose) {
              console.log('[Memory] verbose updateLink:', {
                linkAction: op.linkAction,
                fromMemoryId: op.fromMemoryId,
                toMemoryId: op.toMemoryId,
                outgoingEdges: linked.outgoingEdges,
              });
            }
            return { action: 'updateLink', ok: true, memoryId: op.fromMemoryId };
          } else {
            // Soft delete: the extraction LLM's "no longer needed" verdict is a
            // demotion (ranking penalty), never a physical delete. A later
            // re-mention bump restores the node. Physical deletion stays a
            // host-only explicit operation (deleteMemory()).
            await this.storage.setMemoryStatus(op.memoryId, 'demoted');
            if (this.config.verbose) {
              console.log('[Memory] verbose delete → demoted:', { memoryId: op.memoryId });
            }
            return { action: 'delete', ok: true, memoryId: op.memoryId };
          }
        });
        result.outcomes.push(outcome);
        result.applied++;
        if (outcome.action === 'create') {
          if (outcome.skippedByGate) result.skippedByGate++;
          else if (outcome.memoryId) result.createdIds.push(outcome.memoryId);
        }
      } catch (err) {
        console.error(`[Memory] operation error (${source}):`, op.action, err);
        result.failed++;
        result.outcomes.push({ action: op.action, ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
    if (this.config.verbose) {
      console.log(`[Memory] applyOperations (${source}):`, { applied: result.applied, failed: result.failed, skippedByGate: result.skippedByGate });
    }
    return result;
  }
```

이 본문은 오늘 `runAfterResponseWithContext` 루프의 분기 네 개를 **글자 그대로** 옮기고 끝에 `return`만 더한 것이다(`NODE_STRENGTH_BUMP`는 이 파일의 기존 상수). 주의: `applied`는 "예외 없이 끝난 연산 수"다. 게이트 스킵도 applied에 들어가고 `skippedByGate`로 따로 센다. 기존 분기의 `console.log` · verbose 로그 · 주석은 글자 그대로 옮긴다. `src/index.ts`에 `ApplyOperationOutcome, ApplyOperationsResult` 타입 export 추가.

- [ ] **Step 5: `compare` 실행해 통과 확인**

Run: `npx tsx …/apply-equivalence.mts compare`
Expected: `apply-equivalence: all pass`. A가 실패하면 리팩터가 동작을 바꾼 것이다 — 원인을 고친다(스냅샷은 지우지 않는다).

- [ ] **Step 6: 타입체크 + lint** — 오류 0.

- [ ] **Step 7: 커밋 준비 (사용자 승인 후)**

```
refactor(connector): applyOperations — public rule-only executor; extraction path now delegates to it
```

---

### Task 5: 스토리지 — `createMemoriesBatch`

**Files:**
- Modify: `src/adapters/database-adapter.ts` (`createMemory` 선언 아래)
- Modify: `src/storage/adapters/postgres-adapter.ts` (`createMemory` 아래)
- Modify: `src/memory/storage.ts` (`createMemory` 아래)
- Verify: `/Users/hbsps/projects/neume/scripts/memory-ops/verify/batch-create.mts`

**Interfaces:**
- Produces:
  ```ts
  export interface MemoryBatchInsert { id: string; entityId: string; content: string; embedding: number[]; outgoingEdges?: string[] }
  // MemoryStorageAdapter + MemoryStorage
  createMemoriesBatch(items: MemoryBatchInsert[]): Promise<Memory[]>   // 입력 순서 그대로, 단일 INSERT 문
  ```

- [ ] **Step 1: 검증 스크립트 작성 (실패해야 함)**

```ts
// /Users/hbsps/projects/neume/scripts/memory-ops/verify/batch-create.mts
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as MemoryMod from '/Users/hbsps/projects/neume/packages/memory/src/memory.ts';
import * as ST from '/Users/hbsps/projects/neume/packages/memory/src/storage/storage-types.ts';
const require = createRequire('/Users/hbsps/projects/neume/packages/memory/');
const { Client } = require('pg');
const env = fs.readFileSync('/Users/hbsps/projects/neume/.env.local', 'utf8');
const dbUrl = env.match(/^MEMORY_DATABASE_URL=(.*)$/m)![1].trim().replace(/^["']|["']$/g, '');
if (/supabase\.co|pooler/.test(dbUrl)) throw new Error('refusing non-local DB');

const mem = new MemoryMod.Memory();
await mem.initialize({ type: ST.StorageType.POSTGRES, connectionString: dbUrl, schema: 'memory' }, {});
const storage: any = mem.getStorage();
const pg = new Client({ connectionString: dbUrl }); await pg.connect();
const entityId = `verify-batch-${Date.now()}`;
const dim = 1536;
const vec = (seed: number) => Array.from({ length: dim }, (_, i) => (i === seed ? 1 : 0));
let fail = 0; const check = (n: string, ok: boolean, d?: unknown) => { if (!ok) { fail++; console.log('FAIL', n, d ?? ''); } };

const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
const out = await storage.createMemoriesBatch([
  { id: ids[0], entityId, content: 'one', embedding: vec(1) },
  { id: ids[1], entityId, content: 'two', embedding: vec(2), outgoingEdges: [ids[0]] },
  { id: ids[2], entityId, content: 'three', embedding: vec(3) },
]);
check('B-1 count', out.length === 3);
check('B-2 order+ids', out.map((m: any) => m.id).join() === ids.join());
const rows = (await pg.query(`select id, content, embedding is not null emb, cardinality(outgoing_edges) arr, created_at from memory.memories where entity_id=$1 order by content`, [entityId])).rows;
check('B-3 rows', rows.length === 3 && rows.every((r: any) => r.emb));
check('B-4 array kept', rows.find((r: any) => r.content === 'two').arr === 1);
check('B-5 empty input', (await storage.createMemoriesBatch([])).length === 0);
// B-6 원자성: 한 행의 임베딩 차원이 틀리면 문장 전체가 실패하고 아무 행도 남지 않는다
let threw = false;
try { await storage.createMemoriesBatch([{ id: crypto.randomUUID(), entityId: entityId + '-x', content: 'bad', embedding: [1, 2, 3] }, { id: crypto.randomUUID(), entityId: entityId + '-x', content: 'good', embedding: vec(4) }]); } catch { threw = true; }
const leftover = (await pg.query(`select count(*)::int n from memory.memories where entity_id=$1`, [entityId + '-x'])).rows[0].n;
check('B-6 atomic', threw && leftover === 0, { threw, leftover });
console.log(fail ? `batch-create: ${fail} FAIL` : 'batch-create: all pass');
await pg.end(); process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: 실행해서 실패 확인** — Expected: `storage.createMemoriesBatch is not a function`.

- [ ] **Step 3: 구현**

`src/types.ts`(MemoryEdgeInsert 근처)에:

```ts
/**
 * One row for {@link MemoryStorageAdapter.createMemoriesBatch}. The id is
 * generated by the caller so that edges can be built before the insert.
 *
 * @public
 */
export interface MemoryBatchInsert {
  id: string;
  entityId: string;
  content: string;
  embedding: number[];
  outgoingEdges?: string[];
}
```

`database-adapter.ts`:

```ts
  /**
   * Inserts many memories in ONE statement (atomic without an explicit
   * transaction — the adapter shares a single client across requests, so
   * BEGIN/COMMIT would capture unrelated queries). Rows come back in input order.
   *
   * @param items - Rows with caller-generated ids and precomputed embeddings
   * @returns Created memories in input order; empty input → empty array
   * @throws Error when any row is rejected (then no row was inserted)
   */
  createMemoriesBatch(items: MemoryBatchInsert[]): Promise<Memory[]>;
```

`postgres-adapter.ts`:

```ts
  async createMemoriesBatch(items: MemoryBatchInsert[]): Promise<Memory[]> {
    if (items.length === 0) return [];
    const schema = this.config.schema || 'memory';
    const pgvector = await import('pgvector/pg');
    const values: unknown[] = [];
    const placeholders: string[] = [];
    let i = 1;
    for (const it of items) {
      placeholders.push(`($${i++}, $${i++}, $${i++}, $${i++}, $${i++}, NOW(), NOW())`);
      values.push(it.id, it.entityId, it.content, pgvector.toSql(it.embedding), it.outgoingEdges ?? []);
    }
    const result = await this.client.query(
      `INSERT INTO ${schema}.memories (id, entity_id, content, embedding, outgoing_edges, created_at, updated_at)
       VALUES ${placeholders.join(', ')}
       RETURNING id, created_at, updated_at`,
      values,
    );
    const byId = new Map<string, { created_at: Date; updated_at: Date }>(
      result.rows.map((r: any) => [r.id, r]),
    );
    return items.map(it => {
      const row = byId.get(it.id)!;
      return {
        id: it.id, entityId: it.entityId, content: it.content, embedding: it.embedding,
        outgoingEdges: it.outgoingEdges ?? [], createdAt: row.created_at, updatedAt: row.updated_at,
      };
    });
  }
```

`storage.ts`:

```ts
  /**
   * Inserts many memories at once. Embeddings must be precomputed (bulk plans
   * carry them); nothing is generated here.
   *
   * @param items - Rows with ids and embeddings
   * @returns Created memories in input order
   *
   * @public
   */
  async createMemoriesBatch(items: MemoryBatchInsert[]): Promise<Memory[]> {
    return this.adapter.createMemoriesBatch(items);
  }
```

- [ ] **Step 4: 실행해서 통과 확인** — Expected: `batch-create: all pass`.

- [ ] **Step 5: 타입체크 + lint** — 오류 0. 다른 `MemoryStorageAdapter` 구현체가 있으면(`src/storage/adapters/` 확인) 같은 메서드를 추가해야 컴파일된다.

- [ ] **Step 6: 커밋 준비 (사용자 승인 후)**

```
feat(storage): createMemoriesBatch — single multi-row INSERT with caller ids
```

---

### Task 6: 벌크 commit — `commitBulkPlan`

**Files:**
- Create: `src/memory/bulk-commit.ts`
- Modify: `src/index.ts` (`planBulkCreate` export 옆)
- Verify: `/Users/hbsps/projects/neume/scripts/memory-ops/verify/bulk-commit.mts`

**Interfaces:**
- Consumes: `BulkPlan`(`bulk-plan.ts`), `MemoryStorage.createMemoriesBatch`(Task 5), `getMemoriesByIds`, `insertEdges`, `updateOutgoingEdges`, `CONVERSATION_EDGE_STRENGTH`
- Produces:
  ```ts
  export interface CommitBulkPlanOptions { dualWriteArray?: boolean }
  export interface CommitBulkPlanResult { createdIds: string[]; indexToId: Record<number, string>; contextEdges: number; seedEdges: number; skipped: number; droppedEdges: number }
  export async function commitBulkPlan(storage: MemoryStorage, plan: BulkPlan, options?: CommitBulkPlanOptions): Promise<CommitBulkPlanResult>
  ```

- [ ] **Step 1: 검증 스크립트 작성 (실패해야 함)**

```ts
// /Users/hbsps/projects/neume/scripts/memory-ops/verify/bulk-commit.mts
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as MemoryMod from '/Users/hbsps/projects/neume/packages/memory/src/memory.ts';
import * as ST from '/Users/hbsps/projects/neume/packages/memory/src/storage/storage-types.ts';
import { OpenAIAdapter } from '/Users/hbsps/projects/neume/packages/memory/src/vector/openai-adapter.ts';
import { planBulkCreate } from '/Users/hbsps/projects/neume/packages/memory/src/memory/bulk-plan.ts';
import { commitBulkPlan } from '/Users/hbsps/projects/neume/packages/memory/src/memory/bulk-commit.ts';
const require = createRequire('/Users/hbsps/projects/neume/packages/memory/');
const { Client } = require('pg');
const env = fs.readFileSync('/Users/hbsps/projects/neume/.env.local', 'utf8');
const pick = (k: string) => env.match(new RegExp(`^${k}=(.*)$`, 'm'))![1].trim().replace(/^["']|["']$/g, '');
const dbUrl = pick('MEMORY_DATABASE_URL'); if (/supabase\.co|pooler/.test(dbUrl)) throw new Error('refusing non-local DB');

const mem = new MemoryMod.Memory();
await mem.initialize({ type: ST.StorageType.POSTGRES, connectionString: dbUrl, schema: 'memory' },
  { aiAdapter: new OpenAIAdapter({ apiKey: pick('OPENAI_API_KEY'), embeddingModel: 'text-embedding-3-small' }) });
const storage: any = mem.getStorage();
const pg = new Client({ connectionString: dbUrl }); await pg.connect();
let fail = 0; const check = (n: string, ok: boolean, d?: unknown) => { if (!ok) { fail++; console.log('FAIL', n, d ?? ''); } };
const entityId = `verify-commit-${Date.now()}`;

// 기존 노드 1개 (배치 항목 하나가 이것의 중복이 되게)
const existing = await storage.createMemory({ entityId, content: '민수는 부산에서 태어났다', outgoingEdges: [] });
const items = [
  { content: '민수는 부산에서 태어났다', relatedIndexes: [] },                 // 0: 기존과 중복 → skipped
  { content: '민수는 열 살에 서울로 이사했다', relatedIndexes: [0, 2] },       // 1: 0은 스킵 → 기존 노드로 리맵
  { content: '서울에서 민수는 처음 피아노를 배웠다', relatedIndexes: [1] },    // 2
  { content: '민수는 지금도 매주 피아노를 친다', relatedIndexes: [2] },        // 3
];
const plan = await planBulkCreate(storage, entityId, items, { dedupGateMode: 'active' });
check('C-0 plan shape', plan.stats.plannedNodes === 3 && plan.stats.skipped === 1, plan.stats);

// 임베딩 API 호출 0 — commit 동안 embedContents가 불리면 실패
let embedCalls = 0; const origEmbed = storage.embedContents.bind(storage);
storage.embedContents = async (...a: any[]) => { embedCalls++; return origEmbed(...a); };

const r = await commitBulkPlan(storage, plan);
check('C-1 nodes = planned', r.createdIds.length === plan.stats.plannedNodes, r);
check('C-2 embed calls 0', embedCalls === 0);
const rows = (await pg.query(`select id, content, cardinality(outgoing_edges) arr from memory.memories where entity_id=$1`, [entityId])).rows;
check('C-3 row count', rows.length === 1 + plan.stats.plannedNodes);
const edges = (await pg.query(`select from_id, to_id, origin, type, round(strength::numeric,2) s from memory.edges where entity_id=$1`, [entityId])).rows;
const ctx = edges.filter((e: any) => e.origin === 'conversation');
check('C-4 context edges', ctx.length === plan.stats.contextEdges && ctx.every((e: any) => Number(e.s) === 0.7), { ctx, planned: plan.stats.contextEdges });
check('C-4b remapped to existing', ctx.some((e: any) => e.to_id === existing.id));
check('C-4c array dual-write', rows.filter((x: any) => x.arr > 0).length === new Set(ctx.map((e: any) => e.from_id)).size);
const seeds = edges.filter((e: any) => e.origin === 'knn_seed');
check('C-5 seed edges', seeds.length === plan.stats.seedEdges && seeds.every((e: any) => Number(e.s) > 0 && Number(e.s) <= 1));
const ctxFrom = new Set(ctx.map((e: any) => e.from_id));
check('C-5b seeds not in array', rows.filter((x: any) => !ctxFrom.has(x.id)).every((x: any) => x.arr === 0)); // 시드만 가진 노드의 배열은 비어 있어야 한다
check('C-7 no bumps/jobs', (await pg.query(`select count(*)::int n from memory.sleep_jobs where entity_id=$1`, [entityId])).rows[0].n === 0
  && (await pg.query(`select count(*)::int n from memory.memories where entity_id=$1 and strength > 0.5`, [entityId])).rows[0].n === 0);
check('C-8 indexToId', Object.keys(r.indexToId).length === 3 && r.indexToId[1] !== undefined && r.indexToId[0] === undefined);

// C-6 (Review Focus) 대상이 사라진 toExistingId → droppedEdges, 예외 없음
const plan2 = await planBulkCreate(storage, entityId + '-2', [{ content: '민수는 고양이를 키운다' }], { dedupGateMode: 'active' });
plan2.contextEdges.push({ fromIndex: 0, toExistingId: crypto.randomUUID(), origin: 'conversation', strength: 0.7 });
const r2 = await commitBulkPlan(storage, plan2);
check('C-6 dropped edge', r2.droppedEdges === 1 && r2.createdIds.length === 1, r2);

// C-9 (Review Focus) planned 0 → 0 결과, INSERT 없음
const plan3 = await planBulkCreate(storage, entityId, [{ content: '민수는 부산에서 태어났다' }], { dedupGateMode: 'active' });
const before = (await pg.query(`select count(*)::int n from memory.memories where entity_id=$1`, [entityId])).rows[0].n;
const r3 = await commitBulkPlan(storage, plan3);
const after = (await pg.query(`select count(*)::int n from memory.memories where entity_id=$1`, [entityId])).rows[0].n;
check('C-9 zero planned', r3.createdIds.length === 0 && r3.skipped === 1 && before === after, r3);

// C-10 노드 실패 시 전무 (임베딩 차원 오류 주입)
const plan4 = await planBulkCreate(storage, entityId + '-4', [{ content: 'x1' }, { content: 'x2' }], { dedupGateMode: 'active' });
plan4.nodes[0]!.embedding = [1, 2, 3];
let threw = false; try { await commitBulkPlan(storage, plan4); } catch { threw = true; }
check('C-10 atomic nodes', threw && (await pg.query(`select count(*)::int n from memory.memories where entity_id=$1`, [entityId + '-4'])).rows[0].n === 0);

console.log(fail ? `bulk-commit: ${fail} FAIL` : 'bulk-commit: all pass');
await pg.end(); process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: 실행해서 실패 확인** — Expected: `bulk-commit.ts` 모듈 없음.

- [ ] **Step 3: 구현**

```ts
// src/memory/bulk-commit.ts
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
import type { MemoryStorage } from './storage';
import type { BulkPlan, BulkPlanEdge } from './bulk-plan';
import { randomUUID } from 'crypto';
import type { MemoryBatchInsert, MemoryEdgeInsert } from '../types';
import { CONVERSATION_EDGE_STRENGTH } from './connector';

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
 * @throws Error when the node insert fails (then nothing was written)
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
  const result: CommitBulkPlanResult = { createdIds: [], indexToId: {}, contextEdges: 0, seedEdges: 0, skipped, droppedEdges: 0 };
  if (planned.length === 0) return result;

  // 1) ids first so edges can be assembled; then one INSERT
  const indexToId: Record<number, string> = {};
  for (const n of planned) indexToId[n.index] = randomUUID();
  const contextTargets = new Map<number, string[]>(); // fromIndex → toIds (for the array)
  const resolveTarget = (e: BulkPlanEdge, existingOk: Set<string>): string | null =>
    e.toIndex !== undefined ? (indexToId[e.toIndex] ?? null)
      : e.toExistingId && existingOk.has(e.toExistingId) ? e.toExistingId : null;

  const existingIds = [...new Set([...plan.contextEdges, ...plan.seedEdges].map(e => e.toExistingId).filter((id): id is string => !!id))];
  const existingOk = new Set((existingIds.length ? await storage.getMemoriesByIds(existingIds) : []).map(m => m.id));

  const contextInserts: MemoryEdgeInsert[] = [];
  for (const e of plan.contextEdges) {
    const toId = resolveTarget(e, existingOk);
    if (!toId) { result.droppedEdges++; continue; }
    contextInserts.push({ entityId: plan.entityId, fromId: indexToId[e.fromIndex]!, toId, origin: 'conversation', strength: CONVERSATION_EDGE_STRENGTH });
    const list = contextTargets.get(e.fromIndex) ?? [];
    list.push(toId);
    contextTargets.set(e.fromIndex, list);
  }
  const seedInserts: MemoryEdgeInsert[] = [];
  for (const e of plan.seedEdges) {
    const toId = resolveTarget(e, existingOk);
    if (!toId) { result.droppedEdges++; continue; }
    seedInserts.push({ entityId: plan.entityId, fromId: indexToId[e.fromIndex]!, toId, origin: 'knn_seed', strength: Math.min(1, Math.max(0, e.strength)) });
  }

  const rows: MemoryBatchInsert[] = planned.map(n => ({
    id: indexToId[n.index]!, entityId: plan.entityId, content: n.content, embedding: n.embedding,
    outgoingEdges: dualWriteArray ? (contextTargets.get(n.index) ?? []) : [],
  }));
  const created = await storage.createMemoriesBatch(rows);   // throws → nothing written
  result.createdIds = created.map(m => m.id);
  result.indexToId = indexToId;

  // 2) edges, best-effort
  try { result.contextEdges = contextInserts.length ? await storage.insertEdges(contextInserts) : 0; }
  catch (err) { console.error('[Memory] bulk commit: context edge insert failed:', err); result.droppedEdges += contextInserts.length; }
  try { result.seedEdges = seedInserts.length ? await storage.insertEdges(seedInserts) : 0; }
  catch (err) { console.error('[Memory] bulk commit: seed edge insert failed:', err); result.droppedEdges += seedInserts.length; }
  return result;
}
```

`src/index.ts`: `export { commitBulkPlan } from './memory/bulk-commit'; export type { CommitBulkPlanOptions, CommitBulkPlanResult } from './memory/bulk-commit';` 그리고 `MemoryBatchInsert`는 `export * from './types'`로 이미 나간다.

주의: `insertEdges`는 `ON CONFLICT … WHERE EXCLUDED.strength > strength`라 rowCount가 입력 수보다 작을 수 있다(기존 엣지와 충돌). 검사 C-4 · C-5는 새 엔티티라 충돌이 없다.

- [ ] **Step 4: 실행해서 통과 확인** — Expected: `bulk-commit: all pass`.

- [ ] **Step 5: 타입체크 + lint + 빌드** — `pnpm type-check && pnpm lint && pnpm build` 오류 0 (dist는 뉴미가 쓰지 않지만 선언 파일 생성이 되는지 확인).

- [ ] **Step 6: 커밋 준비 (사용자 승인 후)**

```
feat(bulk): commitBulkPlan — persist a bulk plan (nodes atomic, edges best-effort, no gate side effects)
```

---

### Task 7: 마무리 — 변경 범위 확인, PR

**Files:**
- 읽기만: `src/memory/connector.ts`, `src/index.ts`

- [ ] **Step 1: 삭제 금지 항목이 그대로인지 확인**

Run: `cd /Users/hbsps/projects/neume/packages/memory && git diff --stat && grep -c "handleAfterResponse\|contextAdapter" src/memory/connector.ts && ls src/memory/consolidator.ts src/memory/optimizer.ts src/memory/tool-handler.ts src/tools/definitions.ts`
Expected: 변경 파일은 `write-contract.ts`(신규) · `bulk-commit.ts`(신규) · `connector.ts` · `storage.ts` · `postgres-adapter.ts` · `database-adapter.ts` · `types.ts` · `index.ts` · `docs/specs/*` · `docs/plans/*`뿐. 네 파일 모두 존재.

- [ ] **Step 2: 네 검증 스크립트를 한 번에 재실행**

Run: `for f in write-contract batch-create bulk-commit; do npx tsx /Users/hbsps/projects/neume/scripts/memory-ops/verify/$f.mts || exit 1; done && npx tsx /Users/hbsps/projects/neume/scripts/memory-ops/verify/apply-equivalence.mts compare`
Expected: 전부 pass.

- [ ] **Step 3: 로컬 검증 엔티티 정리 (로컬 DB만)**

Run: `psql "$MEMORY_DATABASE_URL" -c "delete from memory.memories where entity_id like 'verify-%'"` (edges · sleep_jobs는 FK CASCADE; gate_decisions는 `delete from memory.gate_decisions where entity_id like 'verify-%'` 추가 실행)

- [ ] **Step 4: 브랜치 · 커밋 · PR (사용자 승인 후)** — 브랜치 `feat/llm-free-write-contract`, Task별 커밋 6개, PR 제목 `feat: LLM-free write contract + bulk commit (PR-1 of the extraction pivot)`. PR 본문에 스펙 경로, 검증 결과(검사 수), "LLM 경로 무수정 — 2차에서 제거" 한 줄, 뉴미 포인터 PR이 뒤따른다는 한 줄.
