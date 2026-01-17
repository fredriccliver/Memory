# Memory Tool Definitions 사용 가이드

이 문서는 Memory Tool Definitions를 사용하는 방법을 설명합니다.

## 개요

Memory Tool Definitions는 OpenAI Function Calling 형식으로 정의되어 있으며, AI가 tool calling으로 Memory를 관리할 수 있도록 합니다.

## Tool Definitions

### 1. createMemory

새로운 Memory를 생성합니다.

**Tool Definition**:
```typescript
import { createMemoryTool } from '@openaikits/memory';

// OpenAI API에 tool로 등록
const tools = [createMemoryTool];
```

**사용 예시**:
```typescript
// AI가 tool calling으로 호출
{
  name: "createMemory",
  arguments: {
    content: "강남에서 판교까지 지하철로 1시간 걸려",
    entityId: "persona-123",
    relatedMemoryIds: ["uuid-1", "uuid-2"] // 선택사항
  }
}
```

### 2. updateMemory

기존 Memory의 내용을 수정합니다.

**Tool Definition**:
```typescript
import { updateMemoryTool } from '@openaikits/memory';

const tools = [updateMemoryTool];
```

**사용 예시**:
```typescript
{
  name: "updateMemory",
  arguments: {
    memoryId: "uuid-123",
    content: "부산에 살고 있어"
  }
}
```

### 3. updateMemoryLink

Memory 간 연결을 추가하거나 제거합니다.

**Tool Definition**:
```typescript
import { updateMemoryLinkTool } from '@openaikits/memory';

const tools = [updateMemoryLinkTool];
```

**사용 예시**:
```typescript
{
  name: "updateMemoryLink",
  arguments: {
    fromMemoryId: "uuid-1",
    toMemoryId: "uuid-2",
    action: "add" // 또는 "remove"
  }
}
```

### 4. deleteMemory

Memory를 삭제합니다.

**Tool Definition**:
```typescript
import { deleteMemoryTool } from '@openaikits/memory';

const tools = [deleteMemoryTool];
```

**사용 예시**:
```typescript
{
  name: "deleteMemory",
  arguments: {
    memoryId: "uuid-123"
  }
}
```

## 모든 Tool Definitions 가져오기

```typescript
import { memoryToolDefinitions } from '@openaikits/memory';

// OpenAI API에 모든 tool 등록
const tools = memoryToolDefinitions;
```

## Tool Handler와 함께 사용

```typescript
import { MemoryToolHandler, memoryToolDefinitions } from '@openaikits/memory';
import { MemoryStorage } from '@openaikits/memory';

// Tool Handler 초기화
const storage = new MemoryStorage(/* ... */);
const toolHandler = new MemoryToolHandler(storage);

// OpenAI API에 tool 등록
const tools = memoryToolDefinitions;

// AI가 tool calling으로 호출하면, Tool Handler로 처리
async function handleToolCall(toolName: string, args: unknown) {
  switch (toolName) {
    case 'createMemory':
      return await toolHandler.handleCreateMemory(args);
    case 'updateMemory':
      return await toolHandler.handleUpdateMemory(args);
    case 'updateMemoryLink':
      return await toolHandler.handleUpdateMemoryLink(args);
    case 'deleteMemory':
      return await toolHandler.handleDeleteMemory(args);
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
```

## System Prompt 가이드 포함

```typescript
import { memoryManagementGuide } from '@openaikits/memory';

const systemPrompt = `
${memoryManagementGuide}

# 기타 시스템 지시사항
...
`;
```

## 전체 예시

```typescript
import {
  MemoryToolHandler,
  MemoryStorage,
  memoryToolDefinitions,
  memoryManagementGuide,
} from '@openaikits/memory';
import OpenAI from 'openai';

// 초기화
const storage = new MemoryStorage(/* ... */);
const toolHandler = new MemoryToolHandler(storage);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// System Prompt 구성
const systemPrompt = `
${memoryManagementGuide}

당신은 Persona와 대화하는 AI입니다.
Memory를 적절히 관리하여 일관된 대화를 유지하세요.
`;

// 대화 처리
async function handleConversation(userMessage: string, entityId: string) {
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];

  const response = await openai.chat.completions.create({
    model: 'gpt-4',
    messages,
    tools: memoryToolDefinitions,
    tool_choice: 'auto',
  });

  // Tool calling 처리
  for (const toolCall of response.choices[0].message.tool_calls || []) {
    const result = await handleToolCall(toolCall.function.name, JSON.parse(toolCall.function.arguments));
    // 결과를 AI에 반환
  }

  return response.choices[0].message.content;
}
```

## 참고사항

1. **entityId**: Memory가 속한 Entity ID (예: Persona ID, User ID). TEXT 형식입니다.
2. **memoryId**: Memory UUID입니다. 테이블 인덱스가 아닌 Memory UUID를 사용해야 합니다.
3. **관련 Memory 연결**: `createMemory`의 `relatedMemoryIds`를 사용하면 자동으로 양방향 연결이 생성됩니다.
4. **신중한 삭제**: `deleteMemory`는 최후의 수단으로만 사용하고, 가능하면 `updateMemory`를 사용하세요.
