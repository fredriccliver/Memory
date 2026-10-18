# LLM 없는 쓰기 계약 — v2 패키지에서 추출 LLM 제거 설계

> 2026-10-11 · `@openaikits/memory`. 「사용이 조각하는 메모리」 재설계의 후속 설계.
> 이 문서는 **패키지 안의 변경만** 다룬다. 호스트(뉴미) 호출부 변경은 뉴미 저장소의
> `docs/superpowers/specs/2026-10-11-memory-host-write-pivot-design.md`에 있다.
> 기존 문서(`usage-carved-memory.ko.md`, 유지보수 가이드, 기술 보고서, README)는
> 두 릴리스가 모두 끝난 뒤 일괄 수정한다. 이 문서는 그때까지의 설계 기준이다.

---

## 0. 한 줄 요약

패키지는 "무엇을 기억할지"를 판단하지 않는다. 호스트 세션이 연산(create · update ·
updateLink · delete)을 내고, 패키지는 그 연산을 규칙(중복 게이트 · kNN 시딩 · 잠자기
큐)으로 저장한다. 패키지 안의 대규모 언어 모델(LLM) 호출은 임베딩 한 종류만 남긴다.
벌크 commit도 같은 저장 코드를 쓴다.

**판단자에 대한 결론(2026-10-11 측정 뒤 확정)**: 메모리에는 "무엇을 기억할지"를 정하는
판단자가 필요하지만, **별도의** 판단자가 필요한 것은 아니다. 판단자는 호스트가 붙이는
커스텀이다. 호스트의 메인 세션이 직접 연산을 내도 되고(플러그인처럼), 호스트가 소유한
보조 LLM이 내도 된다. 어느 쪽이든 패키지는 같은 계약(지시문 조각 · 파서 · 적용 입구)을
주고 같은 규칙으로 저장 · 조각 · 인출한다. 판단자의 유무와 종류는 패키지의 동작을 바꾸지
않는다. 판단자가 적게 쓰면 적게 조각될 뿐이다.

---

## 1. 배경과 근거

v2의 원칙은 "후보는 벡터가 고르고, 확정만 LLM이 한다"였다. 그 "확정"이 응답 뒤 추출
호출로 패키지 안에 남아 있었다. `MemoryConnector.runAfterResponseWithContext`가 최근 8개
메시지와 인출 1회분을 자체 프롬프트에 실어 호스트가 넘긴 어댑터로 LLM을 부르고,
돌아온 연산 JSON을 파싱해 실행한다. 이것이 패키지가 가진 유일한 "판단" LLM이다.

2026-09-01부터 2026-10-11까지의 프로덕션 데이터(읽기 전용)는 이 호출의 가치가 어디에
있는지 보여 준다.

| 측정 | 값 |
|---|---|
| 게이트를 거쳐 생성된 노드 | 1,805 |
| 추출 LLM이 지목한 맥락 엣지 | 2,414 (노드당 1.34) |
| 그중 양 끝 유사도 0.6 미만 (규칙 시딩이 만들 수 없음) | 1,697 (70.3%) |
| kNN top-5 시딩이 대체할 수 있었을 엣지 | 566 (23.4%) |
| 엣지 사용률: LLM 지목 / kNN 시드 / 복제·백필 | 34.4% / 25.0% / 6.4% |
| 생성 노드 중 뒤에 update된 비율 | 5.0% |
| delete → 강등 | 1건 |

해석은 셋이다.

1. 추출 LLM의 가치는 "사실 선별"보다 **"관련 지목"**에 있다. 임베딩이 멀어 규칙이 못
   잇는 링크를 노드당 1.3개 만들고, 그 링크가 가장 많이 쓰인다.
2. 따라서 피벗은 **지목을 없애는 것이 아니라 지목의 주체를 옮기는 것**이다. 호스트
   세션이 연산 안에 관련 ID를 계속 내야 한다. 계약이 그것을 강제한다.
3. update · delete는 양이 작아 호스트가 덜 내더라도 손실이 작다.

비용 철학(LLM 비용이 보유량 N이 아니라 증분 ΔN에 비례)은 유지된다. 호스트가 보는 작업
세트도 인출 1회분이고, 그래프 크기와 무관하다. 턴당 LLM 호출은 오히려 2회(대화 +
추출)에서 1회로 준다.

측정(같은 운영 80턴 리플레이, 2026-10-11)이 덧붙이는 사실: 판단자의 **형태와 모델**이
쓰기 양을 정한다. 패키지 추출(전용 프롬프트, gpt-5-mini)이 턴당 2.51개를 만들 때, 같은
모델이 대사와 함께 내면 1.11개(−34%), 26B 대화 모델이 대사와 함께 내면 0.65개(그 위에
−41%), 같은 모델의 추출 전용 호출은 1.68개(관련 지목은 패키지 이상)였다. 지시문 문구와
작업 세트 확장은 이 격차를 메우지 못했다. 그래서 호스트는 자기 모델 사정에 맞춰 판단자를
고른다. 이 패키지는 그 선택을 강제하지 않는다.

---

## 2. 범위와 불변

**포함**
- 쓰기 계약 3요소(작업 세트 · 지시문 빌더 · 파서)와 적용 입구 (§3)
- 기존 LLM 경로를 적용 입구 위로 옮기는 리팩터 — 동작 동치 (§3-5)
- 벌크 commit (§4)
- 2차 릴리스의 제거 인벤토리 (§5)
- 검증 (§6)

**불변 — 이 설계가 건드리지 않는 것**
- 튜닝 상수 전부: 게이트 밴드 0.97 / 0.85, 시드 하한 0.6 · K 5, 랭킹 가중 α β γ δ,
  망각 λ, 노드 bump 0.1, 점감 엣지 bump 0.05, 맥락 엣지 출생 강도 0.7, 잠자기 다이얼
- 엣지 origin 2종(`conversation` · `knn_seed`)과 type 2종(`related` · `supersedes`)
- 스키마(`schema_version` v3). 마이그레이션 0.
- 게이트 · 랭킹 인출 · 감쇠 · 잠자기 로직

**비목표**
- 인출 경로 변경
- MCP(Model Context Protocol) 서버 구현 — 계약이 그 형태를 허용하는지만 §8에서 다룬다
- 분해(원문 → 문장 + 관계)는 호스트 몫이다. 패키지는 분해 결과만 받는다.

---

## 3. 쓰기 계약

계약은 "호스트가 모델에게 무엇을 보여 주고, 모델이 무엇을 돌려주고, 패키지가 그것을
어떻게 저장하는가"의 세 조각이다. 셋 다 LLM을 부르지 않는다.

### 3-1. 작업 세트 (WorkingSet)

한 턴에 호스트가 모델에게 보여 준 메모리 집합. 별칭과 UUID의 매핑이다.

```ts
export interface WorkingSetEntry {
  alias: string;      // m1, m2, …
  memoryId: string;   // UUID
  content: string;
}
export interface WorkingSet {
  entries: WorkingSetEntry[];
}
/** 인출 순서를 지키고, 같은 UUID는 한 번만 넣는다. */
export function buildWorkingSet(
  memories: Pick<Memory, 'id' | 'content'>[],
  options?: { aliasPrefix?: string }, // 기본 'm'
): WorkingSet;
```

불변 조건
- 연산이 가리킬 수 있는 ID는 **작업 세트 안의 것뿐**이다. 오늘의 "인출 1회분 ID만"
  규칙을 그대로 잇는다.
- 별칭은 요청 범위에서만 뜻이 있다. 저장되지 않고, 로그에는 UUID로 남긴다.
- 별칭을 쓰는 이유는 비용이다. UUID 36자는 메모리당 20토큰 남짓이고 매 턴 대화 모델
  입력에 실린다. 별칭이면 거의 0이다.

### 3-2. 지시문 빌더 — 프로토콜만

```ts
export interface WriteInstructionOptions {
  blockTag?: string;                // 기본 'MEMORY_OPS'
  maxOperations?: number;           // 기본 10
  includeWorkingSetList?: boolean;  // 기본 false
}
export function buildMemoryWriteInstructions(workingSet: WorkingSet, options?: WriteInstructionOptions): string;
export function writeInstructionParts(options?: WriteInstructionOptions): { operations: string; idRule: string; format: string };
```

**원칙(2026-10-18 확정)**: 메모리는 플랫폼 독립적이며 "저장할 만한가"를 판단하지 않는다.
호출자가 "저장할 것인가"를 정해 메모리를 부른다. 잘못된 노드가 들어오면 메모리는 가려낼 수
없고, 디버깅은 부르는 쪽에서 한다. 따라서 지시문은 **파서가 읽을 출력을 정의하는 프로토콜만**
담는다.
- 연산 의미: create · update · updateLink · delete가 실행기에서 무엇을 하는지(delete = 강등).
- ID 규칙: 작업 세트의 별칭만 쓴다. 모르는 별칭을 참조한 연산은 파서가 버린다.
- 출력 형식: 응답 끝에 `[MEMORY_OPS] { "operations": [ … ] } [/MEMORY_OPS]`, 스키마, 상한,
  쓸 것이 없으면 `{ "operations": [] }`, 코드펜스 금지.
- 작업 세트 목록(선택, `includeWorkingSetList`): 메모리 블록이 따로 없는 2차 호출이나 MCP용.

지시문에 **없는 것**: 무엇을 저장할지, 얼마나 후하게 쓸지, 어느 쪽의 사실인지 주어를 어떻게 쓸지,
어떤 언어로 쓸지, 대화의 어느 줄이 새 것인지, 지시와 대화를 어떻게 구분할지. 전부 호스트의
판단자 프롬프트(또는 메인 세션의 판단) 몫이다. 피벗 초기에는 구 추출 프롬프트의 판단 규율을
"동작 유지" 명목으로 이 빌더에 옮겨 두었는데, 그것은 월권이었고 2026-10-18에 걷어 냈다(호스트
뉴미는 같은 문장을 자기 프롬프트로 가져갔다). 호스트별 옵션(이름 · 언어 · 도메인 지침 ·
입력 구조 헬퍼)도 두지 않는다 — 사용처마다 그 구조로 바꾸는 어댑터를 요구하게 된다.

모델 이름이나 호스트 고유 문구는 넣지 않는다. 조각(`writeInstructionParts`)은 §8의 도구
설명이 쓴다.

### 3-3. 파서

```ts
export interface ParseMemoryOperationsResult {
  operations: MemoryOperation[];   // UUID로 복원된 연산
  dropped: Array<{ reason: ParseDropReason; raw: unknown }>;
  blockFound: boolean;
  jsonValid: boolean;              // 첫 블록의 JSON이 파싱됨
  textWithoutBlock: string;        // 블록을 떼어낸 본문
}
export type ParseDropReason =
  | 'unknown_alias' | 'empty_content' | 'invalid_shape' | 'over_limit';
export function parseMemoryOperations(
  text: string,
  workingSet: WorkingSet,
  options?: { blockTag?: string; maxOperations?: number },
): ParseMemoryOperationsResult;
```

규칙
- 블록이 없으면 연산 0, `blockFound: false`, 본문은 입력 그대로(공백도 손대지 않는다).
- 블록 범위는 첫 여는 태그부터 **마지막** 닫는 태그까지(태그를 감싼 코드펜스 줄 포함). 닫는 태그가
  없으면(출력 절단) 여는 태그부터 끝까지 떼고 연산 0 · `jsonValid: false`. content 안에 닫는 태그
  문자열이 있으면 첫 닫는 태그 기준 JSON이 깨지므로 마지막 닫는 태그 기준으로 다시 파싱한다.
- JSON이 깨지면 연산 0. 블록은 떼어낸다(본문에 남기지 않는다).
- 스키마는 오늘의 `MemoryOperation`과 **같다**. `memoryId` · `relatedMemoryIds` ·
  `fromMemoryId` · `toMemoryId` 자리의 값이 별칭이고, 파서가 UUID로 바꾼다.
- 모르는 별칭을 가리키는 연산은 그 연산만 버린다. create의 `relatedMemoryIds`는 모르는
  항목만 걸러내고 연산은 살린다. 작업 세트 안의 UUID를 별칭 대신 그대로 쓴 경우는 받는다.
- content가 공백이면 버린다. `maxOperations`를 넘는 뒤쪽은 버린다.
- 코드펜스로 감싸 와도 받는다. 블록이 둘 이상이면 첫 번째만 쓴다.
- 파서는 DB를 보지 않는다. 존재 여부는 적용 단계에서 연산 단위로 실패한다.

### 3-4. 적용 입구

```ts
// MemoryConnector
async applyOperations(
  operations: MemoryOperation[],
  options?: { source?: string },    // 로그 태그. 기본 'host'
): Promise<ApplyOperationsResult>;

export interface ApplyOperationsResult {
  applied: number;
  failed: number;
  createdIds: string[];
  skippedByGate: number;
  outcomes: Array<{ action: MemoryOperation['action']; ok: boolean; memoryId?: string; skippedByGate?: boolean; error?: string }>;
}
```

의미는 오늘 `runAfterResponseWithContext`의 실행부와 **같다**. 그 코드를 꺼내 공개
메서드로 만드는 것이다.
- create: 게이트 판정(모드 off · shadow · active 그대로). 스킵이면 기존 노드 bump,
  회색이면 최근접 이웃에 `knn_seed@0.8` 엣지 + 병합 심사 잡, 그 외 kNN 시딩. 생성 시
  `relatedMemoryIds`는 `conversation@0.7`로 배열과 `edges` 테이블에 이중기록.
  `gate_decisions` 기록도 동일.
- update: 내용과 임베딩 갱신.
- updateLink: add는 배열 + `edges`(conversation@0.7), remove는 둘 다 제거.
- delete: `status = 'demoted'`. 물리 삭제 없음.
- 연산 단위 try/catch 격리. 하나가 실패해도 나머지는 진행한다(오늘과 같다).
- `read-only` 모드면 거부. `runWithEmbeddingScope('write')` 적용.
- 반환값이 생긴다(오늘은 void). 호스트 로깅과 리플레이 비교용이다.

### 3-5. 리팩터 (1차 릴리스, 동작 동치)

1차에서는 LLM 경로를 지우지 않는다. 다음처럼 적용부만 공유한다.

```
runAfterResponseWithContext
  = 인출 → 프롬프트 → contextAdapter.generate → parseOperationsFromResponse
    → applyOperations(ops, { source: 'package' })
```

기존 파서는 UUID를 직접 쓰므로 작업 세트 없이 그대로 둔다. 로그 문자열도 유지한다.
이 리팩터 덕에 호스트가 넘기는 연산과 패키지가 내던 연산이 **같은 실행기**를 타고,
전환 시점에 적용 의미가 달라질 여지가 없다.

---

## 4. 벌크 commit

`planBulkCreate`가 계산만 하고 비워 둔 저장 단계다.

```ts
export interface CommitBulkPlanOptions {
  /** 맥락 엣지를 outgoing_edges 배열에도 쓴다. 기본 true (Step 8 청산까지). */
  dualWriteArray?: boolean;
}
export interface CommitBulkPlanResult {
  createdIds: string[];
  indexToId: Record<number, string>;   // plan 인덱스 → 새 UUID
  contextEdges: number;
  seedEdges: number;
  skipped: number;                     // plan에서 스킵된 항목 수 (생성 안 함)
  droppedEdges: number;                // 대상이 사라져 버린 엣지 수
}
export async function commitBulkPlan(
  storage: MemoryStorage,
  plan: BulkPlan,
  options?: CommitBulkPlanOptions,
): Promise<CommitBulkPlanResult>;
```

동작
1. `status === 'planned'` 노드만 생성한다. `plan.nodes[].embedding`을 재사용하므로
   임베딩 API 호출은 0이다. UUID는 commit이 먼저 만들고(엣지를 같은 단계에서 조립하기
   위해), `MemoryStorage.createMemoriesBatch`(신규)가 **단일 multi-row INSERT 문**으로
   넣는다. 어댑터의 `client`는 pg **Pool**이라 `query()`마다 다른 연결을 탈 수 있어 BEGIN/COMMIT을
   그대로 보내면 트랜잭션이 성립하지 않는다(전용 연결을 꺼내 쓰는 길은 있으나 이 단계에서는
   쓰지 않는다). 단일 문의 원자성이 "전부 아니면 전무"를 보장한다. 노드 상한 10,000(초과 시
   삽입 전에 거부), 엣지 INSERT는 2,000행 단위로 나눈다(Bind 파라미터 65,535 한계).
2. 맥락 엣지: `toIndex`는 새 UUID로, `toExistingId`는 `getMemoriesByIds`로 존재를
   확인한 뒤 넣는다. 사라진 대상은 `droppedEdges`로 센다. `insertEdges`(conversation,
   0.7)와 배열 이중기록. plan 구조상 `fromIndex`는 항상 배치 내부이므로 기존 노드의
   배열을 고칠 일은 없다.
3. 시드 엣지: `knn_seed`, 강도 = 유사도. `edges` 전용(시드는 오늘도 배열에 쓰지 않는다).
4. 통계를 돌려준다.

원자성과 멱등
- 노드 삽입은 단일 INSERT 문이다. 전부 아니면 전무.
- 엣지는 노드 다음에 best-effort다. 실패하면 로그와 `droppedEdges`에 남기고 노드는
  둔다. 엣지는 가설이고 사용이 보완한다.
- **멱등이 아니다.** 같은 plan을 두 번 commit하면 노드가 두 번 생긴다. 호스트가 1회를
  보장한다(프리뷰 → 적용 UI는 plan을 소비하고 버린다).
- 게이트 부수효과는 없다. bump 0, 잠자기 잡 0. plan 단계의 판정을 그대로 믿는다.
  회색 노드는 생성만 하고 통계에 센다.

plan 신선도: plan과 commit 사이에 다른 턴이 노드를 더했어도 무해하다. 생길 수 있는
중복은 게이트 밴드 폭만큼이고 잠자기가 흡수한다.

---

## 5. 2차 릴리스 — 제거 인벤토리

**2026-10-12**: 호스트(뉴미)가 판단자를 자기 쪽에 두기로 확정하면서 이 인벤토리는 PR-1에
**접어 넣었다**. 아래 목록 중 추출 경로 · Consolidator · ToolHandler · generator · tools는 같은 PR에서
삭제됐다(`getStorage()` 공개 getter 추가 포함). **예외: `optimizer.ts`와 `AfterResponseContextAdapter`
타입은 호스트의 사용자 기능 「회상」이 쓰므로 남긴다.** 쓰기 경로는 어느 모델도 부르지 않는다. 이 둘은
회상 기능의 처리와 함께 v1 제거 단계에서 지운다.

**삭제**
- `src/memory/connector.ts`: `contextAdapter` 설정, `handleAfterResponse`,
  `runAfterResponseWithContext`, `buildAfterResponseSystemPrompt`,
  `formatExistingMemoriesForPrompt`, `parseOperationsFromResponse`,
  `chattingManager.onAfterResponse` 경로(뉴미 어댑터는 이 콜백을 제공하지 않는다).
- `src/types.ts`: `AfterResponseContextAdapter`, `OptimizerOperation`과 Optimizer ·
  Consolidator 전용 타입.
- `src/memory/consolidator.ts`, `src/memory/optimizer.ts` 전부.
- `src/memory/tool-handler.ts`, `src/memory/generator.ts` — 도구 호출 호스트는
  `applyOperations`로 같은 일을 한다. `DynamicMemoryGenerator`는 ToolHandler 전용이다.
- `src/tools/definitions.ts`, `src/tools/system-prompt-guide.ts` — 텍스트는 §3-2 빌더의
  조각으로 흡수한 뒤 삭제.
- `src/index.ts`의 해당 export.

**유지**: `src/adapters/ai-adapter.ts`(`AIModelAdapter` — 임베딩 어댑터 인터페이스.
`OpenAIAdapter`와 `embedding-service`가 구현 · 사용한다), `src/vector/*`. 패키지의 외부
모델 호출은 임베딩 한 종류가 된다. OpenAI 키는 임베딩 전용이다.

스키마 버전은 v3 그대로. 마이그레이션 0.

---

## 6. 검증 (로컬, 결정론)

호스트 저장소 규칙(테스트 코드를 두지 않음)에 맞춰 스크립트로 검증하고 커밋하지
않는다.

**파서 — 12항목**: 블록 없음 / JSON 깨짐 / 코드펜스 / 별칭 복원 / 모르는 별칭 폐기 /
related 부분 제거 / 빈 content / 상한 초과 / 블록 중복 / 본문 분리 / create · update ·
updateLink · delete 각 1.

**적용 입구 동치**: 고정 연산 배열을 리팩터 전 코드(패키지 경로)와 후 코드
(`applyOperations`)에 각각 적용해 `memories` · `edges` · `gate_decisions` ·
`sleep_jobs` 행을 비교한다. 로컬 DB 스냅샷 diff.

**commit — 8항목**: 노드 수 = planned / 임베딩 API 호출 0 / 맥락 엣지 수 · 강도 0.7 ·
배열 이중기록 일치 / 시드 수 · 강도 = 유사도 / 스킵 제외 / 사라진 `toExistingId` 드롭
카운트 / 노드 트랜잭션 롤백(강제 실패) / bump · 잡 0.

---

## 7. 릴리스 단위

| | 내용 | 되돌림 |
|---|---|---|
| Memory PR-1 | §3 계약 · §3-5 리팩터 · §4 commit. LLM 경로 무수정. 뉴미 포인터 갱신 동반. | 포인터 revert (호스트 플래그가 `package`면 영향 0) |
| Memory PR-2 | §5 제거. 뉴미 2차와 동시 배포. | 포인터 · 뉴미 동시 revert — 2주 관측 통과 뒤에만 |

문서 일괄 수정(철학 · 유지보수 가이드 · 기술 보고서 · README · en)은 PR-2 뒤 별도
PR이다.

---

## 8. 다른 호스트 형태 — MCP를 포함해

지시문 빌더가 조각을 내보내므로 호스트 형태에 따라 다르게 조립한다.

| 조각 | 라이브러리 호스트(뉴미) | MCP 서버 |
|---|---|---|
| 소유 · 사용 기준 · ID 규칙 | 시스템 프롬프트 한 덩어리 | `prompts` 자원(시스템 지시문 템플릿) |
| 연산별 설명 | 같은 덩어리 안 | `remember` · `update` · `link` · `forget` 도구 설명 |
| "이 ID들을 지목에 쓰라" | 메모리 블록 머리말 | `recall` 결과 머리말 |

MCP에서는 도구 설명이 곧 프롬프트다. 도입자는 프롬프트를 손으로 쓰지 않는다. 엔티티
이름 · 상대 이름 · 로케일은 서버 설정 또는 도구 인자다. 이 문서는 MCP 서버를 만들지
않는다. 계약이 그 형태를 막지 않는다는 것만 확인한다.

판단자를 패키지 **밖**에 참조 구현으로 제공하는 것은 가능하다(호스트가 가져다 쓰는 선택적
부품). 패키지 **안**에는 두지 않는다. 안에 두면 이 설계가 지운 추출 LLM이 되돌아온다.

---

## 9. 미결 · 후속

- 분해기(원문 → 문장 + `relatedIndexes`)는 호스트 몫이다. 뉴미 벌크 프리뷰의 분해
  프롬프트가 참조 구현이다.
- ToolHandler가 사라지면 "도구 호출 호스트" 예제도 사라진다. 유지보수 가이드에
  `applyOperations` 예제로 대체한다(문서 단계).
- `handleContextChange` · `ChattingManager` 인터페이스는 이 설계와 무관하다. 그대로 둔다.
