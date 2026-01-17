/**
 * System Prompt 가이드
 *
 * AI가 Memory를 관리할 때 사용할 System Prompt 가이드를 제공합니다.
 *
 * @public
 */

/**
 * Memory 관리 가이드 텍스트
 *
 * System Prompt에 포함할 Memory 관리 가이드입니다.
 *
 * @public
 */
export const memoryManagementGuide = `# Memory 관리 가이드

**🔴 Memory의 본질**:
Memory는 "이 존재(Entity)의 개인적인 정보, 경험, 관점, 사실"을 저장하는 것입니다.
- ✅ 저장해야 할 것: 이 존재의 개인적인 정보, 경험, 선호도, 말투, 사실 등
- ❌ 저장하지 말아야 할 것: 일반적인 지식, 요약 답변, 외부 정보, 당연하게 추론 가능한 것

**예시**:
- ✅ 좋은 Memory (Persona/User): "스타트업 운영하면서 자금 조달이 가장 어려워" (이 존재의 개인적인 경험)
- ✅ 좋은 Memory (Persona/User): "네이버에서 소프트웨어 엔지니어로 일하고 있어" (이 존재의 개인적인 정보)
- ✅ 좋은 Memory (Organization/Company): "이 조직의 작년 매출은 50억 원이며 이중에 인건비는 20억 원이야" (이 존재의 조직 정보)
- ✅ 좋은 Memory (Organization/Company): "우리 회사는 2020년에 설립되었고 현재 직원 수는 30명이야" (이 존재의 회사 정보)
- ❌ 나쁜 Memory: "스타트업 운영에서 가장 큰 어려움은 자금 흐름 관리와 현금 확보..." (일반적인 지식/요약 답변)

**중요**: 대화 중 이 존재의 개인적인 정보를 저장하거나 수정하거나 연결할 때는 반드시 제공된 tool을 사용해야 합니다. 
Memory는 대화의 일관성과 맥락을 유지하는 핵심입니다.

**🔴 필수 Tool 호출 규칙**
- **logMemoryDecision은 반드시 호출해야 합니다**. 다른 tool을 사용했든 안 했든 상관없이 항상 호출하세요.
- **여러 tool을 동시에 호출할 수 있습니다 (parallel tool calling)**. 예를 들어, updateMemory와 logMemoryDecision을 동시에 호출할 수 있습니다.
- **호출 방식**: 
  - **권장**: 여러 tool을 한 번의 API 호출에서 동시에 호출하세요 (parallel tool calling)
  - 예: updateMemory와 logMemoryDecision을 동시에 호출
  - 예: createMemory와 logMemoryDecision을 동시에 호출
- **호출 순서**: 
  1. 먼저 필요한 Memory tool(createMemory, updateMemory, updateMemoryLink 등)을 호출하세요
  2. 그 다음 반드시 logMemoryDecision을 호출하세요
  3. logMemoryDecision의 usedTools에는 이전에 호출한 tool 이름들을 포함하세요

**Memory Tool 사용 가이드** (필요할 때 사용): 
- 새로운 정보를 저장할 때 → createMemory (각 tool의 description을 참조하세요)
- 기존 정보를 수정할 때 → updateMemory (각 tool의 description을 참조하세요)
- Memory 간 연결을 생성할 때 → updateMemoryLink (각 tool의 description을 참조하세요)
  - **중요**: Memory 컨텍스트에서 각 Memory의 연결 상태(outgoingEdges)를 확인하여, 함께 사용되어야 할 Memory들이 이미 연결되어 있는지 확인하세요. 연결되어 있지 않다면 updateMemoryLink를 사용하여 연결하세요.
- 단순히 질문에 답변만 하면 되는 경우라면 Memory tool을 호출할 필요가 없습니다 (하지만 logMemoryDecision은 항상 호출해야 합니다)

## 판단 프로세스

**다음 순서로 진행하세요**:

1. **정보 확인**: 먼저 현재 Memory 컨텍스트를 확인하세요
2. **대화 맥락 분석**: 최근 대화에서 언급된 정보와 검색된 Memory를 비교하세요
3. **판단**: 각 tool의 description에 명시된 "언제 사용하나요?"와 "판단 기준"을 참고하여 적절한 tool을 선택하세요
4. **실행**: 선택한 tool을 호출하여 Memory를 업데이트하세요
5. **일관성**: 기존 Memory와의 일관성을 유지하세요

**중요**: Memory 컨텍스트가 제공되었더라도, 정보를 저장/수정/연결해야 할 때만 tool을 사용하세요.
단순히 질문에 답변만 하면 되는 경우라면 tool을 호출할 필요가 없습니다.

## 중요 원칙

- Memory 관리는 반드시 tool calling으로 수행
- 각 tool의 description에 명시된 가이드를 따르세요
- 기존 Memory와의 일관성 유지
- 관련 Memory는 적절히 연결하여 맥락 보존
- 삭제는 최후의 수단으로만 사용`;

/**
 * Tool 사용 가이드 문서
 *
 * @public
 */
export const toolUsageGuide = {
  createMemory: {
    description: '새로운 Memory를 저장합니다.',
    whenToUse: [
      '대화 중 새롭게 알게 된 정보를 저장할 때',
      '사용자가 질문했는데 Memory에 없는 정보일 때',
      '대화 중 발견한 새로운 정보를 저장할 때',
    ],
    example: {
      scenario: '사용자가 "어디서 일해?"라고 물었는데 Memory에 없음',
      steps: [
        '1. 관련 Memory 검색',
        '2. 정보 없음 확인',
        '3. createMemory({ content: "네이버에서 소프트웨어 엔지니어로 일하고 있어", entityId: "persona-123" }) 호출',
      ],
    },
  },
  updateMemory: {
    description: '기존 Memory의 내용을 수정합니다.',
    whenToUse: [
      '기존 정보가 변경되었을 때',
      '더 정확한 정보로 업데이트할 때',
      '정보가 부정확할 때',
    ],
    example: {
      scenario: '사용자가 "부산으로 이사했어"라고 말함',
      steps: [
        '1. 기존 Memory 검색 (예: "서울에 살고 있어")',
        '2. updateMemory({ memoryId: "uuid-123", content: "부산에 살고 있어" }) 호출',
      ],
    },
  },
  updateMemoryLink: {
    description: 'Memory 간 연결을 추가하거나 제거합니다.',
    whenToUse: [
      '두 Memory가 관련되어 있을 때 연결 추가',
      '두 Memory가 더 이상 관련이 없을 때 연결 제거',
    ],
    example: {
      scenario: '"커피를 좋아해"와 "아침에 일어나기 힘들어해"가 관련됨',
      steps: [
        '1. 두 Memory의 관련성 확인',
        '2. updateMemoryLink({ fromMemoryId: "uuid-1", toMemoryId: "uuid-2", action: "add" }) 호출',
      ],
    },
  },
  deleteMemory: {
    description: 'Memory를 삭제합니다. (신중하게 사용)',
    whenToUse: [
      '잘못된 정보일 때',
      '더 이상 필요 없는 정보일 때',
    ],
    warning: '삭제는 신중하게 수행하세요. 대부분의 경우 updateMemory로 수정하는 것이 더 안전합니다.',
    example: {
      scenario: '잘못된 정보 확인',
      steps: [
        '1. 잘못된 Memory 확인',
        '2. deleteMemory({ memoryId: "uuid-123" }) 호출',
      ],
    },
  },
} as const;
