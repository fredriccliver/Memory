/**
 * Memory Tool Definitions
 *
 * OpenAI Function Calling 형식의 Tool Definitions를 정의합니다.
 * AI가 tool calling으로 Memory를 관리할 수 있도록 합니다.
 *
 * @public
 */

/**
 * OpenAI Function Calling Tool Definition 타입
 *
 * @public
 */
export interface OpenAIToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required: string[];
    };
  };
}

/**
 * createMemory Tool Definition
 *
 * 새로운 Memory를 생성합니다. 대화 중 새롭게 알게 된 정보나 생성된 정보를 저장할 때 사용합니다.
 *
 * @public
 */
export const createMemoryTool: OpenAIToolDefinition = {
  type: 'function',
  function: {
    name: 'createMemory',
    description: `새로운 Memory를 저장합니다.

**🔴 Memory의 본질**:
Memory는 "이 존재(Entity)의 개인적인 정보, 경험, 관점, 사실"을 저장하는 것입니다.
- ✅ 저장해야 할 것: 이 존재의 개인적인 정보, 경험, 선호도, 말투, 사실 등
- ❌ 저장하지 말아야 할 것: 일반적인 지식, 요약 답변, 외부 정보

**언제 사용하나요?**
- 대화 중 이 존재의 개인적인 정보, 경험, 관점을 처음 알게 된 경우
- 사용자가 자신의 개인적인 정보를 제공한 경우
- 기존 Memory에 없는 이 존재의 개인적인 사실을 발견한 경우

**판단 기준**:
- 사용자가 "어디서 일해?"라고 물었는데 Memory에 직장 정보가 없고, 사용자가 "네이버에서 일해"라고 답한 경우 → createMemory({ content: "네이버에서 소프트웨어 엔지니어로 일하고 있어" })
- 사용자가 "스타트업 운영하면서 가장 어려운 점이 뭐야?"라고 물었고, 사용자가 "자금 조달이 가장 어려워"라고 개인적인 경험을 말한 경우 → createMemory({ content: "스타트업 운영하면서 자금 조달이 가장 어려워" })
- ❌ 사용자가 "스타트업 운영하면서 가장 어려운 점이 뭐야?"라고 물었는데 이 존재의 메모리에는 없고, 저장할 가치도 없는 일반적인 지식 → Memory 저장하지 않음 (일반적인 지식이므로)

**주의사항**:
- 기존 Memory와 중복되지 않도록 확인하세요. 비슷한 내용이 이미 있다면 updateMemory를 고려하세요.
- 관련된 기존 Memory가 있다면 relatedMemoryIds로 연결하세요.
- **중요**: 질문에 대한 답변을 생성하는 것이 아니라, 이 존재의 개인적인 정보/경험/관점을 저장하는 것입니다.

**예시**:
- ✅ 좋은 예 (Persona/User): createMemory({ content: "스타트업 운영하면서 자금 조달이 가장 어려워", entityId: "persona-001" })
- ✅ 좋은 예 (Persona/User): createMemory({ content: "현재 마이크로서비스 아키텍처 프로젝트를 진행 중이야", entityId: "user-123" })
- ✅ 좋은 예 (Organization/Company): createMemory({ content: "이 조직의 작년 매출은 50억 원이며 이중에 인건비는 20억 원이야", entityId: "org-001" })
- ✅ 좋은 예 (Organization/Company): createMemory({ content: "우리 회사는 2020년에 설립되었고 현재 직원 수는 30명이야", entityId: "company-abc" })
- ❌ 나쁜 예: createMemory({ content: "스타트업 운영에서 가장 큰 어려움은 자금 흐름 관리와 현금 확보, 팀 구성의 안정성 확보...", entityId: "..." }) - 이것은 일반적인 지식/요약 답변`,
    parameters: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description:
            'Memory 내용 (비정형 자연어 텍스트). 이 존재의 개인적인 정보, 경험, 관점, 사실을 저장하세요. 일반적인 지식이나 요약 답변은 저장하지 마세요. 예: "강남에서 판교까지 지하철로 1시간 걸려" (이 존재의 개인적인 경험)',
        },
        entityId: {
          type: 'string',
          description:
            '이 Memory가 속한 Entity ID (예: Persona ID, User ID). TEXT 형식입니다.',
        },
        relatedMemoryIds: {
          type: 'array',
          items: { type: 'string' },
          description:
            '연결할 기존 Memory UUID 목록 (선택사항). 관련된 Memory와 자동으로 연결됩니다. Memory 컨텍스트에서 제공된 Memory의 UUID를 사용하세요. 예: ["abc-123-def-456", "xyz-789-uvw-012"]. "mem-1" 같은 형식은 사용하지 마세요.',
        },
      },
      required: ['content', 'entityId'],
    },
  },
};

/**
 * updateMemory Tool Definition
 *
 * 기존 Memory의 내용을 수정합니다. 정보가 변경되었거나 더 정확한 정보로 업데이트할 때 사용합니다.
 *
 * @public
 */
export const updateMemoryTool: OpenAIToolDefinition = {
  type: 'function',
  function: {
    name: 'updateMemory',
    description: `기존 Memory의 내용을 수정합니다.

**🔴 Memory의 본질**:
Memory는 "이 존재(Entity)의 개인적인 정보, 경험, 관점, 사실"을 저장하는 것입니다.
- ✅ 수정해야 할 것: 이 존재의 개인적인 정보가 변경된 경우
- ❌ 수정하지 말아야 할 것: 일반적인 지식, 요약 답변, 외부 정보

**언제 사용하나요?**
- Memory 컨텍스트에 이 존재의 개인적인 정보가 있고, 최근 대화에서 그 정보가 변경되었다고 언급된 경우
- 이 존재의 개인적인 정보가 업데이트되거나 수정되었을 때
- 더 정확하거나 구체적인 이 존재의 개인적인 정보를 얻었을 때

**판단 기준**:
- Memory에 "서울에 살고 있어"가 있고, 사용자가 "부산으로 이사했어"라고 말한 경우 → updateMemory 사용 (createMemory 아님!)
- Memory에 "네이버에서 일하고 있어"가 있고, 사용자가 "카카오로 이직했어"라고 말한 경우 → updateMemory 사용 (createMemory 아님!)
- **중요**: 기존 Memory 컨텍스트에 관련 정보가 있고, 그 정보가 변경되었다면 반드시 updateMemory를 사용하세요. createMemory를 사용하면 안 됩니다.

**주의사항**:
- memoryId는 반드시 기존 Memory의 UUID를 사용하세요. Memory 컨텍스트에서 해당 Memory의 UUID를 찾아 사용하세요.
- 삭제 후 다시 저장하는 것보다는 업데이트를 우선 고려하세요.

**예시**:
- 이전 대화: 사용자 "어디 살아?" → AI "서울 강남구에 살고 있어요."
- 현재 대화: 사용자 "부산으로 이사했어"
- Memory 컨텍스트에 "서울 강남구에 살고 있어" Memory가 있음 (UUID: "abc-123")
- → updateMemory({ memoryId: "abc-123", content: "부산에 살고 있어" })`,
    parameters: {
      type: 'object',
      properties: {
        memoryId: {
          type: 'string',
          description: '수정할 Memory의 UUID (테이블 인덱스가 아닌 Memory UUID). Memory 컨텍스트에서 해당 Memory의 UUID를 찾아 사용하세요.',
        },
        content: {
          type: 'string',
          description: '수정된 Memory 내용 (비정형 자연어 텍스트). 이 존재의 개인적인 정보가 변경된 내용을 저장하세요. 일반적인 지식이나 요약 답변은 저장하지 마세요.',
        },
      },
      required: ['memoryId', 'content'],
    },
  },
};

/**
 * updateMemoryLink Tool Definition
 *
 * Memory 간 연결을 추가하거나 제거합니다. 두 Memory가 관련되어 있거나 더 이상 관련이 없을 때 사용합니다.
 *
 * @public
 */
export const updateMemoryLinkTool: OpenAIToolDefinition = {
  type: 'function',
  function: {
    name: 'updateMemoryLink',
    description: `Memory 간 연결을 추가하거나 제거합니다.

**🔴 updateMemoryLink의 목적**:
Query expansion에서 빠질 수 있는 미검색 문제를 해결하기 위한 것입니다. 서로 다른 query로 검색된 Memory들, 또는 많은 edge chain으로 검색된 Memory들은 서로 함께 사용될 확률이 높지 않을 수 있습니다. 하지만 실제로는 함께 사용되어야 할 Memory들이 함께 사용될 확률을 높이기 위해 linking을 수행합니다.

**언제 사용하나요?**
- Memory 컨텍스트에 두 개 이상의 관련 Memory가 검색되었고, 그들 간의 관계를 명시적으로 연결해야 할 때
- 서로 다른 query로 검색된 Memory들이 실제로는 관련되어 있고, 함께 사용될 가능성이 높을 때
- 많은 edge chain을 통해 검색된 Memory와 직접 검색된 Memory가 함께 사용되어야 할 때
- 두 Memory가 서로 관련되어 있음을 인지했을 때 (action: "add")
- 두 Memory 간의 관계가 더 이상 유효하지 않을 때 (action: "remove")

**판단 기준**:
- Memory 컨텍스트를 확인하여 각 Memory의 연결 상태(outgoingEdges)를 파악하세요
- 이미 연결되어 있지 않은 두 Memory가 함께 사용되어야 한다고 판단되면 연결하세요
- "PyTorch를 사용해서 모델을 구현해봤어"와 "인공지능과 머신러닝에 관심이 많아"가 모두 검색되었고, 사용자가 PyTorch 관련 질문을 한 경우 → updateMemoryLink 사용 (두 Memory를 연결)
- "커피를 좋아해"와 "아침에 일어나기 힘들어해"가 모두 검색되었고, 사용자가 두 가지를 함께 언급한 경우 → updateMemoryLink 사용 (두 Memory를 연결)
- **중요**: Memory 컨텍스트에 두 개 이상의 관련 Memory가 검색되었고, 사용자가 그들의 관련성을 언급했다면 반드시 updateMemoryLink를 사용하세요. createMemory를 사용하면 안 됩니다.

**주의사항**:
- Memory 컨텍스트에서 각 Memory의 UUID와 연결 상태(outgoingEdges)를 정확히 확인하세요
- 이미 연결되어 있는 Memory들은 다시 연결할 필요가 없습니다
- 양방향 연결이 필요한 경우 양쪽 모두 연결하세요 (fromMemoryId ↔ toMemoryId 각각 호출)
- 관련성이 명확할 때만 연결 추가하세요
- 두 개 이상의 Memory가 검색되었고 서로 관련되어 있다고 판단되면 반드시 updateMemoryLink를 호출하세요

**예시**:
- Memory 컨텍스트에 다음 Memory들이 검색됨:
  - Memory #1 (UUID: "mem-1", 연결된 Memory: 0개): "PyTorch를 사용해서 모델을 구현해봤어"
  - Memory #2 (UUID: "mem-2", 연결된 Memory: 0개): "인공지능과 머신러닝에 관심이 많아"
- 사용자: "PyTorch로 어떤 모델을 만들어봤어?"
- → updateMemoryLink({ fromMemoryId: "mem-1", toMemoryId: "mem-2", action: "add" })`,
    parameters: {
      type: 'object',
      properties: {
        fromMemoryId: {
          type: 'string',
          description: '연결의 출발점이 되는 Memory UUID. Memory 컨텍스트에서 해당 Memory의 UUID를 찾아 사용하세요.',
        },
        toMemoryId: {
          type: 'string',
          description: '연결의 도착점이 되는 Memory UUID. Memory 컨텍스트에서 해당 Memory의 UUID를 찾아 사용하세요.',
        },
        action: {
          type: 'string',
          enum: ['add', 'remove'],
          description: '연결 추가 ("add") 또는 제거 ("remove")',
        },
      },
      required: ['fromMemoryId', 'toMemoryId', 'action'],
    },
  },
};

/**
 * deleteMemory Tool Definition
 *
 * Memory를 삭제합니다. 잘못된 정보이거나 더 이상 필요 없는 정보일 때 사용합니다.
 * 주의: 삭제는 신중하게 수행해야 합니다.
 *
 * @public
 */
export const deleteMemoryTool: OpenAIToolDefinition = {
  type: 'function',
  function: {
    name: 'deleteMemory',
    description: `Memory를 삭제합니다.

**⚠️ 경고**: 삭제는 신중하게 수행해야 합니다. 대부분의 경우 updateMemory로 수정하는 것이 더 안전합니다.

**언제 사용하나요?**
- 명백히 잘못된 정보일 때
- 완전히 불필요한 정보일 때
- 삭제가 반드시 필요한 경우에만 사용

**주의사항**:
- 삭제는 되돌릴 수 없으므로 신중하게 판단하세요.
- 대부분의 경우 updateMemory로 수정하는 것이 더 안전합니다.
- 삭제는 최후의 수단으로만 사용하세요.`,
    parameters: {
      type: 'object',
      properties: {
        memoryId: {
          type: 'string',
          description: '삭제할 Memory의 UUID (테이블 인덱스가 아닌 Memory UUID). Memory 컨텍스트에서 해당 Memory의 UUID를 찾아 사용하세요.',
        },
      },
      required: ['memoryId'],
    },
  },
};

/**
 * logMemoryDecision Tool Definition
 *
 * Memory tool 사용 결정에 대한 설명을 로깅합니다. 항상 호출되어야 합니다.
 *
 * @public
 */
export const logMemoryDecisionTool: OpenAIToolDefinition = {
  type: 'function',
  function: {
    name: 'logMemoryDecision',
    description: `Memory tool 사용 결정에 대한 설명을 로깅합니다. 이 tool은 항상 호출되어야 합니다.

**언제 사용하나요?**
- 다른 Memory tool을 사용했을 때: 왜 그 tool을 사용했는지 설명
- 다른 Memory tool을 사용하지 않았을 때: 왜 사용하지 않았는지 설명

**주의사항**:
- 이 tool은 항상 호출되어야 합니다 (required)
- 다른 tool을 사용했든 안 했든 상관없이 항상 호출하세요
- 설명은 구체적이고 명확하게 작성하세요

**예시**:
- 다른 tool 사용 시: "updateMemory를 사용했습니다. Memory에 '서울에 살고 있어'가 있었고, 사용자가 '부산으로 이사했어'라고 말했기 때문에 기존 Memory를 업데이트했습니다."
- 다른 tool 미사용 시: "Memory tool을 사용하지 않았습니다. 사용자가 단순히 질문만 했고, 검색된 Memory에 이미 답변이 포함되어 있어 추가적인 정보 저장이나 수정이 필요하지 않았습니다."`,
    parameters: {
      type: 'object',
      properties: {
        decision: {
          type: 'string',
          description: 'Memory tool 사용 결정에 대한 설명. 왜 tool을 사용했는지 또는 왜 사용하지 않았는지 구체적으로 설명하세요.',
        },
        usedTools: {
          type: 'array',
          items: { type: 'string' },
          description: '사용한 tool 이름 목록 (없으면 빈 배열). 예: ["updateMemory"] 또는 []',
        },
      },
      required: ['decision', 'usedTools'],
    },
  },
};

/**
 * 모든 Memory Tool Definitions 배열
 *
 * @public
 */
export const memoryToolDefinitions: OpenAIToolDefinition[] = [
  createMemoryTool,
  updateMemoryTool,
  updateMemoryLinkTool,
  deleteMemoryTool,
  logMemoryDecisionTool,
];
