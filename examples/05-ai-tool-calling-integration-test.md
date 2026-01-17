# AI Tool Calling 통합 테스트 계획

## 목표

AI가 실제로 tool calling을 통해 Memory를 관리하는지 검증합니다. 기존 seed data를 활용하여 현실적인 시나리오를 테스트합니다.

## 기존 Seed Data 분석

### Persona별 Memory 구조

1. **persona-001-software-engineer** (14개 메모리)
   - 거주지: 서울 강남구
   - 직장: 네이버 소프트웨어 엔지니어
   - 출퇴근: 강남 → 판교 (1시간)
   - 기술 스택: TypeScript, React, GraphQL
   - 프로젝트: 마이크로서비스 아키텍처
   - 취미: 주말 카페 코딩, 독서, 영화

2. **persona-002-student** (9개 메모리)
   - 학교: 서울대학교 컴퓨터공학부
   - 관심사: AI, 머신러닝
   - 활동: AI 동아리, 자연어 처리 연구
   - 기술: PyTorch
   - 목표: 대학원 진학
   - 경험: 네이버 인턴십 3개월

3. **persona-003-designer** (8개 메모리)
   - 거주지: 서울 마포구
   - 직장: 카카오 UX 디자이너
   - 도구: Figma
   - 스타일: 미니멀, 깔끔
   - 목표: 디자인 리더
   - 취미: 전시회 관람

4. **persona-004-entrepreneur** (9개 메모리)
   - 거주지: 서울 송파구
   - 직업: 스타트업 CEO
   - 제품: AI 기반 SaaS
   - 팀: 5명
   - 투자: 시드 투자 완료
   - 고객: 50개 기업
   - 목표: 시리즈 A 투자

## 테스트 시나리오

### 시나리오 1: 새로운 정보 저장 (persona-001-software-engineer)

**상황**: 기존 seed data에는 "어디서 일해?"에 대한 정보가 있지만, "어떤 프로젝트를 하고 있어?"에 대한 구체적인 정보가 없음

**대화 흐름**:
```
사용자: "어떤 프로젝트를 하고 있어?"
AI: (Memory 검색 → "현재 마이크로서비스 아키텍처 프로젝트를 진행 중이야" 발견)
    → 하지만 구체적인 프로젝트 이름이나 상세 정보 없음
    → createMemory({ 
        content: "현재 진행 중인 프로젝트는 '고객 관리 시스템' 마이크로서비스 아키텍처 프로젝트야",
        entityId: "persona-001-software-engineer",
        relatedMemoryIds: [마이크로서비스 프로젝트 메모리 ID]
      })
    → "고객 관리 시스템 마이크로서비스 아키텍처 프로젝트를 진행 중이에요."
```

**검증 항목**:
- [ ] AI가 createMemory tool을 호출했는지 확인
- [ ] Memory가 DB에 저장되었는지 확인
- [ ] 관련 Memory와 연결되었는지 확인
- [ ] AI의 응답이 일관된지 확인

### 시나리오 2: 기존 정보 수정 (persona-001-software-engineer)

**상황**: 기존 seed data에 "서울 강남구에 살고 있어"가 있지만, 사용자가 이사했다고 함

**대화 흐름**:
```
사용자: "부산으로 이사했어"
AI: (기존 Memory 검색 → "서울 강남구에 살고 있어" 발견)
    → updateMemory({ 
        memoryId: "강남구 거주지 메모리 ID",
        content: "부산에 살고 있어"
      })
    → "아, 부산으로 이사하셨군요!"
```

**검증 항목**:
- [ ] AI가 updateMemory tool을 호출했는지 확인
- [ ] Memory가 제대로 업데이트되었는지 확인
- [ ] Embedding이 재생성되었는지 확인
- [ ] 이후 대화에서 업데이트된 정보가 반영되는지 확인

### 시나리오 3: Memory 간 연결 (persona-002-student)

**상황**: 기존 seed data에 "인공지능과 머신러닝에 관심이 많아"와 "PyTorch를 사용해서 모델을 구현해봤어"가 있지만 연결되지 않음

**대화 흐름**:
```
사용자: "PyTorch로 어떤 모델을 만들어봤어?"
AI: (Memory 검색 → 두 Memory 발견하지만 연결 안 됨)
    → updateMemoryLink({ 
        fromMemoryId: "AI 관심사 메모리 ID",
        toMemoryId: "PyTorch 메모리 ID",
        action: "add"
      })
    → "인공지능과 머신러닝에 관심이 많아서 PyTorch로 모델을 구현해봤어요."
```

**검증 항목**:
- [ ] AI가 관련 Memory를 인지했는지 확인
- [ ] updateMemoryLink tool을 호출했는지 확인
- [ ] 연결이 제대로 생성되었는지 확인
- [ ] Graph 탐색 시 연결이 작동하는지 확인

### 시나리오 4: 잘못된 정보 삭제 (persona-003-designer)

**상황**: 기존 seed data에 잘못된 정보가 있다고 가정 (실제로는 없지만 테스트용)

**대화 흐름**:
```
사용자: "아니야, 그건 틀렸어. 카카오가 아니라 네이버야"
AI: (잘못된 Memory 확인)
    → deleteMemory({ memoryId: "카카오 직장 메모리 ID" })
    → createMemory({ 
        content: "네이버에서 UX 디자이너로 일하고 있어",
        entityId: "persona-003-designer"
      })
    → "죄송해요. 네이버에서 일하고 계시는군요."
```

**검증 항목**:
- [ ] AI가 잘못된 정보를 인지했는지 확인
- [ ] deleteMemory tool을 신중하게 호출했는지 확인
- [ ] Memory가 제대로 삭제되었는지 확인
- [ ] 관련 연결이 정리되었는지 확인

### 시나리오 5: 복합 시나리오 (persona-004-entrepreneur)

**상황**: 여러 정보를 종합하여 새로운 Memory 생성 및 연결

**대화 흐름**:
```
사용자: "스타트업 운영하면서 가장 어려운 점이 뭐야?"
AI: (Memory 검색 → 여러 관련 Memory 발견)
    → createMemory({ 
        content: "스타트업 운영하면서 가장 어려운 점은 팀 관리와 투자 유치야",
        entityId: "persona-004-entrepreneur",
        relatedMemoryIds: [팀 메모리 ID, 투자 메모리 ID, 고객 메모리 ID]
      })
    → "팀 관리와 투자 유치가 가장 어려워요."
```

**검증 항목**:
- [ ] AI가 여러 Memory를 관련지어 인지했는지 확인
- [ ] createMemory에 relatedMemoryIds를 포함했는지 확인
- [ ] 연결이 양방향으로 생성되었는지 확인
- [ ] 전체 플로우가 일관되게 작동하는지 확인

## 테스트 실행 계획

### 1단계: 기존 테스트 영향 분석
- [ ] 기존 테스트 파일 확인 (04-tool-handler-test.ts, 03-generator-test.ts)
- [ ] 사용하는 entity ID 확인
- [ ] 충돌 가능성 분석

### 2단계: 테스트 환경 설정
- [ ] Seed data 로드 확인
- [ ] 새로운 테스트용 entity ID 사용 (기존과 충돌 방지)
- [ ] 또는 기존 seed data 활용

### 3단계: 통합 테스트 코드 작성
- [ ] OpenAI API 통합
- [ ] Tool definitions 로드
- [ ] System Prompt 구성
- [ ] 각 시나리오별 테스트 함수 작성

### 4단계: 테스트 실행 및 검증
- [ ] 각 시나리오 실행
- [ ] Tool call 로깅
- [ ] Memory 상태 확인
- [ ] 결과 검증

### 5단계: 정리
- [ ] 테스트 데이터 정리
- [ ] 기존 seed data 복원 (필요시)

## 테스트 결과 기록

### 2026-01-17 테스트 실행 결과

#### 테스트 환경
- Model: `gpt-5-nano`
- Query Expansion: 활성화 (최대 3개 쿼리)
- Decision Logging: 활성화 (`enableDecisionLogging: true`)
- Parallel Tool Calls: 활성화 (`parallel_tool_calls: true`)

#### 시나리오별 결과

##### 시나리오 1: 새로운 정보 저장
- **User 메시지**: "내가 지금 마이크로서비스 아키텍처 프로젝트를 진행 중이야. GraphQL을 도입했고, 서비스 간 통신은 경량 이벤트 버스를 사용해."
- **기대 동작**: `createMemory` 또는 `updateMemory` (기존 Memory 존재 여부에 따라)
- **실제 동작**: `updateMemory` 호출
- **결과**: ✅ PASS (기존 Memory가 있어서 updateMemory 호출이 적절함)
- **분석**: 
  - 기존 Memory에 "현재 마이크로서비스 아키텍처 프로젝트를 진행 중이야"가 이미 존재
  - User가 GraphQL, 경량 이벤트 버스 등 구체적인 정보를 제공
  - AI가 기존 Memory를 업데이트하는 것이 적절한 판단
- **Tool Calls**: `updateMemory`, `logMemoryDecision`

##### 시나리오 2: 기존 정보 수정
- **User 메시지**: "부산으로 이사했어"
- **기대 동작**: `updateMemory` 호출
- **실제 동작**: `updateMemory` 호출
- **결과**: ✅ PASS
- **분석**:
  - 기존 Memory에 "서울 강남구에 살고 있어"가 존재
  - User가 거주지 변경 정보를 제공
  - AI가 정확히 `updateMemory`를 호출하여 정보 업데이트
- **Tool Calls**: `updateMemory`, `logMemoryDecision`

##### 시나리오 3: Memory 간 연결
- **User 메시지**: "PyTorch로 CNN 모델을 만들어봤어. 인공지능에 관심이 많아서 시작했어."
- **기대 동작**: `updateMemoryLink` 또는 `createMemory` (새 정보 포함 시)
- **실제 동작**: `createMemory` 호출 (relatedMemoryIds 포함)
- **결과**: ⚠️ 부분 통과 (새 정보가 포함되어 createMemory가 적절할 수 있음)
- **분석**:
  - 기존 Memory에 "인공지능과 머신러닝에 관심이 많아"와 "PyTorch를 사용해서 모델을 구현해봤어"가 존재
  - User가 "CNN 모델"이라는 새로운 구체적인 정보를 제공
  - AI가 `createMemory`를 호출하고 `relatedMemoryIds`로 기존 Memory들과 연결
  - `updateMemoryLink`만 호출하는 것보다 더 적절한 판단일 수 있음
- **Tool Calls**: `createMemory`, `logMemoryDecision`

##### 시나리오 4: 복합 시나리오
- **User 메시지**: "스타트업 운영하면서 자금 조달이 가장 어려워. 현금 흐름 관리도 힘들고."
- **기대 동작**: `createMemory` 호출
- **실제 동작**: `createMemory` 호출
- **결과**: ✅ PASS
- **분석**:
  - User가 자신의 개인적인 경험을 제공
  - AI가 `createMemory`를 호출하여 저장
  - 기존 스타트업 관련 Memory와 연결 (`relatedMemoryIds` 사용)
- **Tool Calls**: `createMemory`, `logMemoryDecision`

#### 전체 결과 (시나리오 1-4)
- **통과**: 2/4 (시나리오 2, 4)
- **부분 통과**: 1/4 (시나리오 1, 3 - 기대 동작이 여러 개인 경우)
- **실패**: 0/4

#### 추가 시나리오 결과 (시나리오 5-7: updateMemoryLink 테스트)

##### 시나리오 5: Memory 간 연결 (서로 다른 query로 검색된 경우)
- **User 메시지**: "강남에서 네이버까지 출퇴근하는데 시간이 오래 걸려서 힘들어."
- **기대 동작**: `updateMemoryLink` 호출
- **실제 동작**: `updateMemory` 호출
- **결과**: ❌ FAIL (updateMemoryLink가 호출되지 않음)
- **분석**:
  - AI가 기존 Memory("강남에서 판교 네이버까지 출퇴근하는데 한 시간 걸려")를 발견
  - User의 메시지가 기존 Memory의 내용을 업데이트하는 것으로 해석됨 ("시간이 오래 걸려서 힘들어" → 피로감 추가)
  - `updateMemory`를 호출하여 기존 Memory를 업데이트
  - `updateMemoryLink`는 호출되지 않음 (새로운 정보가 아니라 기존 정보 업데이트로 판단)
- **Tool Calls**: `updateMemory`, `logMemoryDecision`

##### 시나리오 6: Memory 간 연결 (관련성 언급)
- **User 메시지**: "TypeScript와 React를 사용해서 마이크로서비스 프로젝트를 하고 있어."
- **기대 동작**: `updateMemoryLink` 호출
- **실제 동작**: `updateMemory` 호출
- **결과**: ❌ FAIL (updateMemoryLink가 호출되지 않음)
- **분석**:
  - AI가 기존 Memory들("TypeScript와 React를 주로 사용해", "현재 마이크로서비스 아키텍처 프로젝트를 진행 중이야")을 발견
  - User의 메시지가 두 Memory의 정보를 통합한 것으로 해석됨
  - `updateMemory`를 호출하여 "현재 마이크로서비스 아키텍처 프로젝트를 진행 중이야" Memory를 업데이트 (기술 스택 정보 추가)
  - `updateMemoryLink`는 호출되지 않음 (새로운 정보 통합으로 판단)
- **Tool Calls**: `updateMemory`, `logMemoryDecision`

##### 시나리오 7: Memory 간 연결 (Graph chain과 직접 검색)
- **User 메시지**: "주말에 카페에서 코딩할 때 TypeScript로 사이드 프로젝트를 해."
- **기대 동작**: `updateMemoryLink` 호출
- **실제 동작**: `createMemory` 호출 (relatedMemoryIds 포함)
- **결과**: ❌ FAIL (updateMemoryLink가 호출되지 않음)
- **분석**:
  - AI가 기존 Memory들("주말에는 강남에서 카페에서 코딩을 해", "TypeScript와 React를 주로 사용해", "사이드 프로젝트로 오픈소스 라이브러리를 만들고 있어")을 발견
  - User의 메시지가 새로운 정보를 제공하는 것으로 해석됨 ("TypeScript로 사이드 프로젝트를 해"는 기존 Memory들의 조합이지만 새로운 구체적인 정보)
  - `createMemory`를 호출하고 `relatedMemoryIds`로 기존 Memory들과 연결
  - `updateMemoryLink`는 호출되지 않음 (새로운 Memory 생성이 더 적절하다고 판단)
- **Tool Calls**: `createMemory` (relatedMemoryIds 포함), `logMemoryDecision` 미호출

#### updateMemoryLink 호출 성공 사례

##### 시나리오 3: Memory 간 연결
- **User 메시지**: "PyTorch로 CNN 모델을 만들어봤어. 인공지능에 관심이 많아서 시작했어."
- **실제 동작**: `updateMemory`, `updateMemoryLink` (양방향) 호출
- **결과**: ✅ 부분 통과 (updateMemoryLink 호출됨!)
- **분석**:
  - AI가 기존 Memory("PyTorch를 사용해서 모델을 구현해봤어")를 발견
  - User의 메시지가 기존 Memory를 업데이트하고, 다른 Memory("인공지능과 머신러닝에 관심이 많아")와 연결하는 것으로 해석됨
  - `updateMemory`로 기존 Memory 업데이트 후, `updateMemoryLink`를 양방향으로 호출하여 연결 생성
  - **이것이 유일하게 `updateMemoryLink`가 호출된 사례입니다!**
- **Tool Calls**: `updateMemory`, `updateMemoryLink` (2회, 양방향), `logMemoryDecision` 미호출

#### updateMemoryLink 호출 패턴 분석

1. **호출된 경우 (시나리오 3)**:
   - 기존 Memory를 업데이트하면서 동시에 다른 Memory와의 연결이 필요한 경우
   - User가 명시적으로 관련성을 언급한 경우 ("인공지능에 관심이 많아서 시작했어")

2. **호출되지 않은 경우 (시나리오 5, 6, 7)**:
   - 기존 Memory를 단순히 업데이트하는 것으로 해석된 경우 (시나리오 5, 6)
   - 새로운 Memory를 생성하는 것이 더 적절하다고 판단된 경우 (시나리오 7)
   - AI가 `createMemory`의 `relatedMemoryIds`를 사용하여 연결을 생성하는 것을 선호

#### 개선 방향

1. **System Prompt 강화**: `updateMemoryLink`가 언제 호출되어야 하는지 더 명확하게 지시
   - 기존 Memory들이 이미 존재하고, 새로운 정보가 아닌 경우
   - Memory들이 함께 사용되었지만 연결이 없는 경우
   - `createMemory`보다 `updateMemoryLink`가 더 적절한 경우를 명확히 구분

2. **Tool Description 강화**: `updateMemoryLink`의 사용 시점을 더 구체적으로 설명
   - "새로운 정보를 저장하는 것이 아니라, 기존 Memory들 간의 연결만 필요한 경우"
   - "User가 명시적으로 관련성을 언급하지 않아도, 함께 사용된 Memory들은 연결해야 함"

3. **Memory Context 개선**: 연결 상태를 더 명확하게 표시
   - `outgoingEdges`가 0인 Memory들을 강조
   - 함께 검색되었지만 연결되지 않은 Memory들을 그룹화하여 표시

#### 개선 사항
1. ✅ 시나리오 관점 수정: 모든 시나리오를 "User가 자신의 정보/경험을 말하는 상황"으로 통일
2. ✅ 기대 동작 다중화: `expectedToolCalls`를 배열의 배열로 지원하여 여러 가능한 조합 허용
3. ✅ Memory Context 개선: UUID, similarity, edge 연결 정보, query 정보 포함
4. ✅ `updateMemoryLink` 시나리오 추가: 연결 없이 seed data를 복사하여 `updateMemoryLink` 테스트 가능하도록 개선

### 추가된 시나리오 (updateMemoryLink 테스트용)

#### 시나리오 5: Memory 간 연결 (서로 다른 query로 검색된 경우)
- **User 메시지**: "강남에서 네이버까지 출퇴근하는데 시간이 오래 걸려서 힘들어."
- **기대 동작**: `updateMemoryLink` 호출
- **설명**: 
  - 서로 다른 query로 검색된 Memory들("서울 강남구에 살고 있어", "네이버에서 소프트웨어 엔지니어로 일하고 있어", "강남에서 판교 네이버까지 출퇴근하는데 한 시간 걸려")이 함께 사용되어야 함
  - `copyWithoutLinks: true`로 설정하여 연결 없이 seed data 복사
  - AI가 이 Memory들이 관련되어 있음을 인지하고 `updateMemoryLink`를 호출해야 함

#### 시나리오 6: Memory 간 연결 (관련성 언급)
- **User 메시지**: "TypeScript와 React를 사용해서 마이크로서비스 프로젝트를 하고 있어."
- **기대 동작**: `updateMemoryLink` 호출
- **설명**:
  - User가 기존 Memory들("TypeScript와 React를 주로 사용해", "현재 마이크로서비스 아키텍처 프로젝트를 진행 중이야")의 관련성을 언급
  - `copyWithoutLinks: true`로 설정하여 연결 없이 seed data 복사
  - AI가 이 Memory들이 관련되어 있음을 인지하고 `updateMemoryLink`를 호출해야 함

#### 시나리오 7: Memory 간 연결 (Graph chain과 직접 검색)
- **User 메시지**: "주말에 카페에서 코딩할 때 TypeScript로 사이드 프로젝트를 해."
- **기대 동작**: `updateMemoryLink` 호출
- **설명**:
  - 많은 edge chain을 통해 검색된 Memory("주말에는 강남에서 카페에서 코딩을 해")와 직접 검색된 Memory("TypeScript와 React를 주로 사용해", "사이드 프로젝트로 오픈소스 라이브러리를 만들고 있어")가 함께 사용되어야 함
  - `copyWithoutLinks: true`로 설정하여 연결 없이 seed data 복사
  - AI가 이 Memory들이 관련되어 있음을 인지하고 `updateMemoryLink`를 호출해야 함

## 주의사항

1. **기존 테스트 보호**: 기존 테스트가 사용하는 entity ID와 충돌하지 않도록 주의
2. **Seed data 보존**: 테스트 후 기존 seed data를 삭제하지 않도록 주의
3. **비용 관리**: OpenAI API 호출 비용 고려
4. **테스트 격리**: 각 시나리오는 독립적으로 실행 가능해야 함
