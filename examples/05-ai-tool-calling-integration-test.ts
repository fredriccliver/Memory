/**
 * AI Tool Calling 통합 테스트
 *
 * 이 예제는 다음을 테스트합니다:
 * 1. AI가 실제로 tool calling을 통해 Memory를 관리하는지 검증
 * 2. Tool Handler가 AI의 tool call을 제대로 처리하는지 검증
 * 3. 전체 플로우가 의도한 대로 작동하는지 검증
 *
 * 기존 seed data를 활용하되, 새로운 테스트용 entity ID를 사용하여
 * 기존 데이터에 영향을 주지 않습니다.
 *
 * 실행 방법:
 *   npx tsx examples/05-ai-tool-calling-integration-test.ts
 *
 * 사전 준비:
 *   1. Seed data 생성: npx tsx examples/00-seed-data.ts
 *   2. 환경 변수 설정: OPENAI_API_KEY, MEMORY_DATABASE_URL
 */

// 환경 변수 로드
import { config } from 'dotenv';
config();

import {
  Memory,
  StorageType,
  OpenAIAdapter,
  MemoryToolHandler,
  MemoryConnector,
  memoryToolDefinitions,
  memoryManagementGuide,
  MemoryStorage,
  type MemoryContext,
} from '../src/index';
import OpenAI from 'openai';
import type { Memory as MemoryType } from '../src/types';

/**
 * 테스트 시나리오 인터페이스
 */
interface TestScenario {
  name: string;
  entityId: string;
  userMessage: string;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>; // 대화 히스토리
  expectedToolCalls: string[] | string[][]; // 예상되는 tool 이름들 (단일 배열이면 모두 호출되어야 함, 배열의 배열이면 하나의 조합만 만족하면 됨)
  description: string;
  copyWithoutLinks?: boolean; // true면 seed data를 복사할 때 연결 정보를 제외 (updateMemoryLink 테스트용)
}

/**
 * 테스트 결과 인터페이스
 */
interface TestResult {
  scenario: string;
  passed: boolean;
  toolCalls: Array<{
    name: string;
    arguments: unknown;
    result: unknown;
  }>;
  error?: string;
  memoryState?: {
    before: number;
    after: number;
  };
}

/**
 * Seed data에서 특정 entity의 Memory를 복사하여 새로운 entity에 생성
 */
async function copySeedDataToTestEntity(
  storage: MemoryStorage,
  sourceEntityId: string,
  targetEntityId: string,
): Promise<MemoryType[]> {
  const sourceMemories = await storage.getMemoriesByEntity(sourceEntityId);
  const memoryMap = new Map<string, string>(); // old ID -> new ID

  // 1단계: 모든 Memory 생성 (outgoingEdges 없이)
  const newMemories: MemoryType[] = [];
  for (const sourceMemory of sourceMemories) {
    const newMemory = await storage.createMemory({
      entityId: targetEntityId,
      content: sourceMemory.content,
      outgoingEdges: [],
    });
    memoryMap.set(sourceMemory.id, newMemory.id);
    newMemories.push(newMemory);
  }

  // 2단계: outgoingEdges 연결
  for (let i = 0; i < sourceMemories.length; i++) {
    const sourceMemory = sourceMemories[i];
    if (sourceMemory.outgoingEdges && sourceMemory.outgoingEdges.length > 0) {
      const newOutgoingEdges = sourceMemory.outgoingEdges
        .map(oldId => memoryMap.get(oldId))
        .filter((id): id is string => id !== undefined);
      await storage.updateOutgoingEdges(newMemories[i].id, newOutgoingEdges);
    }
  }

  return newMemories;
}

/**
 * Seed data에서 특정 entity의 Memory를 연결 없이 복사 (updateMemoryLink 테스트용)
 */
async function copySeedDataWithoutLinks(
  storage: MemoryStorage,
  sourceEntityId: string,
  targetEntityId: string,
): Promise<MemoryType[]> {
  const sourceMemories = await storage.getMemoriesByEntity(sourceEntityId);

  // Memory만 생성 (연결 없이)
  const newMemories: MemoryType[] = [];
  for (const sourceMemory of sourceMemories) {
    const newMemory = await storage.createMemory({
      entityId: targetEntityId,
      content: sourceMemory.content,
      outgoingEdges: [], // 연결 없이 생성
    });
    newMemories.push(newMemory);
  }

  return newMemories;
}

/**
 * 테스트 시나리오 실행
 */
async function runScenario(
  scenario: TestScenario,
  storage: MemoryStorage,
  toolHandler: MemoryToolHandler,
  openai: OpenAI,
): Promise<TestResult> {
  console.log(`\n📋 시나리오: ${scenario.name}`);
  console.log(`   설명: ${scenario.description}`);
  console.log(`   사용자 메시지: "${scenario.userMessage}"`);

  // 테스트 전 Memory 상태 확인
  const memoriesBefore = await storage.getMemoriesByEntity(scenario.entityId);
  const memoryCountBefore = memoriesBefore.length;

  // Memory Connector를 사용하여 컨텍스트 준비
  // 검색 품질 향상을 위해 similarityThreshold를 낮춤 (0.2로 설정)
  // Decision logging 활성화 (테스트용)
  const memoryConnector = new MemoryConnector(storage, {
    entityId: scenario.entityId,
    mode: 'read-write',
    autoGenerate: true,
    similarityThreshold: 0.2, // 기본값 0.7보다 낮게 설정하여 더 많은 결과 검색
    maxMemoryCount: 20, // 검색 결과 수 제한
    enableDecisionLogging: true, // Decision logging 활성화 (테스트용)
  });

  // 대화 히스토리 구성 (최근 발화 포함)
  const conversationHistory = scenario.conversationHistory || [];
  
  // AI를 사용하여 검색 쿼리 생성/확장
  // RAG 검색과 유사하게, 사용자 메시지를 기반으로 Memory 검색에 적합한 쿼리를 생성
  const conversationContext = conversationHistory.length > 0
    ? conversationHistory.map(msg => `${msg.role === 'user' ? '사용자' : 'AI'}: ${msg.content}`).join('\n') + `\n사용자: ${scenario.userMessage}`
    : scenario.userMessage;
  
  // AI로 query 확장 (Memory 검색에 적합한 형태로 변환)
  const queryExpansionPrompt = `사용자가 다음과 같이 말했습니다: "${scenario.userMessage}"
${conversationHistory.length > 0 ? `\n이전 대화:\n${conversationHistory.map(msg => `${msg.role === 'user' ? '사용자' : 'AI'}: ${msg.content}`).join('\n')}` : ''}

이 사용자 메시지와 대화 맥락을 기반으로, 관련된 기억(Memory)을 검색하기 위한 검색 쿼리를 생성하세요.
검색 쿼리는 사용자가 찾고 있는 정보나 언급하고 있는 주제를 잘 표현해야 합니다.

JSON 형식으로 응답하세요:
{
  "search_queries": ["쿼리1", "쿼리2", "쿼리3"]
}

검색 쿼리는 1-3개 정도 생성하되, 다양한 관점에서 관련 정보를 찾을 수 있도록 하세요.`;

  let searchQueries: string[] = [scenario.userMessage]; // 기본값으로 원본 메시지 사용
  
  try {
    const expansionResponse = await openai.chat.completions.create({
      model: 'gpt-5-nano',
      messages: [{ role: 'user', content: queryExpansionPrompt }],
      response_format: { type: 'json_object' },
    });
    
    const expansionResult = JSON.parse(expansionResponse.choices[0]?.message?.content || '{}');
    if (expansionResult.search_queries && Array.isArray(expansionResult.search_queries)) {
      searchQueries = expansionResult.search_queries.slice(0, 3); // 최대 3개
      console.log(`   🔍 AI가 생성한 검색 쿼리: ${searchQueries.length}개`);
      searchQueries.forEach((q, i) => {
        console.log(`      [${i + 1}] ${q}`);
      });
    }
  } catch (error) {
    console.log(`   ⚠️  Query 확장 실패, 원본 메시지 사용: ${error instanceof Error ? error.message : String(error)}`);
    // 실패 시 원본 메시지만 사용
  }

  // 여러 쿼리로 병렬 검색 수행
  const searchPromises = searchQueries.map(query => 
    memoryConnector.getContext(query)
  );
  const searchResults = await Promise.all(searchPromises);
  
  // 모든 검색 결과에서 Memory 병합 (중복 제거)
  const allMemoriesMap = new Map<string, MemoryType>();
  for (const result of searchResults) {
    for (const memory of result.memories) {
      // 유사도가 높은 것을 우선 (이미 있으면 유사도 비교)
      const existing = allMemoriesMap.get(memory.id);
      const memorySimilarity = (memory as MemoryType).similarity;
      const existingSimilarity = existing?.similarity;
      
      if (!existing || 
          (memorySimilarity !== undefined && 
           (existingSimilarity === undefined || memorySimilarity > existingSimilarity))) {
        allMemoriesMap.set(memory.id, memory as MemoryType);
      }
    }
  }
  
  const mergedMemories = Array.from(allMemoriesMap.values())
    .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
    .slice(0, 20); // 상위 20개만 사용
  
  // Memory Context 재구성 (template 생성)
  // 각 Memory의 연결 상태(outgoingEdges)와 similarity 정보를 포함
  let memoryTemplate: string;
  if (mergedMemories.length === 0) {
    memoryTemplate = '# 기억\n(아직 저장된 기억이 없습니다)';
  } else {
    const memoryLines = mergedMemories.map((memory: MemoryType, index: number) => {
      const parts: string[] = [];
      
      // Memory ID
      parts.push(`[기억 #${index + 1} (UUID: ${memory.id})]`);
      
      // Similarity (if available)
      if (memory.similarity !== undefined) {
        parts.push(`유사도: ${(memory.similarity * 100).toFixed(1)}%`);
      }
      
      // Edge connections
      if (memory.outgoingEdges && memory.outgoingEdges.length > 0) {
        parts.push(`연결된 Memory: ${memory.outgoingEdges.length}개`);
      } else {
        parts.push(`연결된 Memory: 0개`);
      }
      
      // Content
      parts.push(memory.content);
      
      return parts.join(' | ');
    });
    
    const queryInfo = searchQueries.length > 1 
      ? `\n검색 쿼리: ${searchQueries.length}개 (query expansion 사용)`
      : `\n검색 쿼리: "${searchQueries[0]}"`;
    
    memoryTemplate = `# 기억\n총 ${mergedMemories.length}개의 관련 기억이 검색되었습니다.${queryInfo}\n\n${memoryLines.join('\n')}`;
  }
  
  const memoryContext: MemoryContext = {
    memories: mergedMemories,
    template: memoryTemplate,
  };
  
  console.log(`   📚 검색된 Memory: ${memoryContext.memories.length}개`);
  if (memoryContext.memories.length > 0) {
    memoryContext.memories.slice(0, 3).forEach((memory, index) => {
      console.log(`      [${index + 1}] ${memory.content.substring(0, 50)}...`);
    });
  }

  // 최근 대화 맥락 구성
  const recentConversationContext = conversationHistory.length > 0
    ? `\n# 최근 대화 맥락\n${conversationHistory.map(msg => `- ${msg.role === 'user' ? '사용자' : 'AI'}: ${msg.content}`).join('\n')}\n`
    : '';

  // System Prompt 구성 (Memory 컨텍스트 + 최근 대화 맥락 포함)
  // entityId는 Memory Connector 초기화 시 이미 설정되어 있으므로 System Prompt에 명시할 필요 없음
  // Tool call 처리 시 자동으로 주입됨
  
  // Decision logging 활성화 여부 확인
  const enableDecisionLogging = memoryConnector.getConfig().enableDecisionLogging ?? false;
  
  // Decision logging 활성화 여부에 따라 Tool Definitions 조정
  const toolsToUse = enableDecisionLogging
    ? memoryToolDefinitions // 모든 tool 포함 (logMemoryDecision 포함)
    : memoryToolDefinitions.filter(tool => tool.function.name !== 'logMemoryDecision'); // logMemoryDecision 제외
  
  // Decision logging 활성화 여부에 따라 System Prompt 조정
  const systemPromptBase = enableDecisionLogging
    ? memoryManagementGuide // logMemoryDecision 포함된 가이드
    : memoryManagementGuide.replace(
        /\*\*필수 Tool\*\*:[\s\S]*?\(하지만 logMemoryDecision은 항상 호출해야 합니다\)/,
        ''
      ).replace(/\n\n+/g, '\n\n'); // logMemoryDecision 관련 내용 제거
  
  // 시나리오별 간단한 가이드 (상세한 설명은 tool definitions에 있음)
  let scenarioSpecificGuide = '';
  if (memoryContext.memories.length > 0) {
    scenarioSpecificGuide = `
**📋 Memory 검색 결과**: 현재 ${memoryContext.memories.length}개의 관련 Memory가 검색되었습니다.

**🔴 Memory 저장 원칙**:
- Memory는 "이 존재의 개인적인 정보, 경험, 관점, 사실"을 저장하는 것입니다.
- 일반적인 지식, 요약 답변, 외부 정보는 저장하지 마세요.
- 질문에 대한 답변을 생성하는 것이 아니라, 이 존재의 개인적인 정보를 저장하는 것입니다.

**Tool 사용 조건** (각 tool의 description을 참고하여 판단하세요):
- 이 존재의 개인적인 정보가 변경됨 → updateMemory (tool description의 "언제 사용하나요?" 참조)
- 이 존재의 개인적인 정보 간 연결 필요 → updateMemoryLink (tool description의 "언제 사용하나요?" 참조)
- 이 존재의 새로운 개인적인 정보를 알게 됨 → createMemory (tool description의 "언제 사용하나요?" 참조)

**중요**: 단순히 질문에 답변만 하면 되는 경우라면 tool을 호출할 필요가 없습니다. 
하지만 이 존재의 개인적인 정보를 저장하거나 수정하거나 연결해야 한다면 각 tool의 description에 따라 tool을 사용하세요.`;
  } else {
    scenarioSpecificGuide = `
**📋 Memory 검색 결과**: 현재 관련 Memory가 검색되지 않았습니다.

**🔴 Memory 저장 원칙**:
- Memory는 "이 존재의 개인적인 정보, 경험, 관점, 사실"을 저장하는 것입니다.
- 일반적인 지식, 요약 답변, 외부 정보는 저장하지 마세요.

**Tool 사용 조건**: 사용자가 자신의 개인적인 정보를 제공했다면 createMemory를 사용하세요 (tool description 참조).`;
  }
  
  const systemPrompt = `${systemPromptBase}

# 현재 Memory 컨텍스트
${memoryContext.template}${recentConversationContext}

${scenarioSpecificGuide}

**🔴 필수 판단 프로세스**:
1. 먼저 검색된 Memory 목록을 확인하세요
2. 최근 대화 맥락을 확인하여 정보 변경이나 새로운 정보를 파악하세요
3. 위의 Tool 사용 조건 중 하나라도 해당되면 적절한 Memory tool(createMemory, updateMemory, updateMemoryLink 등)을 호출하세요
4. 단순히 질문에 답변만 하면 되는 경우라면 Memory tool을 호출할 필요가 없습니다${enableDecisionLogging ? '\n5. **🔴 필수**: logMemoryDecision tool은 반드시 호출해야 합니다. 다른 Memory tool을 사용했다면 그 tool과 함께 **동시에(parallel)** 호출하고, 사용하지 않았다면 logMemoryDecision만 호출하세요. 여러 tool을 한 번의 API 호출에서 동시에 호출할 수 있습니다 (parallel tool calling). logMemoryDecision을 호출하지 않으면 오류입니다.' : ''}`;

  try {
    // OpenAI API 호출 (대화 히스토리 포함)
    const messages = [
      { role: 'system' as const, content: systemPrompt },
      ...conversationHistory.map(msg => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      })),
      { role: 'user' as const, content: scenario.userMessage },
    ];

    // Decision logging 활성화 시 tool_choice를 'required'로 설정하여 여러 tool을 동시에 호출 가능하도록 함
    // 'required'로 설정하면 최소 하나의 tool을 호출해야 하며, 여러 tool을 동시에 호출할 수 있음
    const toolChoice = enableDecisionLogging
      ? 'required' // 여러 tool을 동시에 호출 가능 (logMemoryDecision + 다른 Memory tool들)
      : 'auto'; // Decision logging 비활성화 시 auto
    
    // OpenAI API는 한 번의 호출에서 여러 tool을 동시에 호출할 수 있음
    // parallel_tool_calls: true (기본값)로 설정하여 parallel tool calling을 명시적으로 허용
    // GPT-5는 sequential calls를 선호하는 경향이 있지만, parallel_tool_calls: true로 설정하면 parallel calls가 가능함
    const response = await openai.chat.completions.create({
      model: 'gpt-5-nano', // 비용 절감을 위해 nano 모델 사용
      messages,
      tools: toolsToUse, // Decision logging 활성화 여부에 따라 tool 목록 조정
      tool_choice: toolChoice,
      parallel_tool_calls: true, // 여러 tool을 동시에 호출할 수 있도록 명시적으로 허용
      // gpt-5-nano는 temperature 파라미터를 지원하지 않음 (기본값 1만 지원)
    });

    const assistantMessage = response.choices[0].message;
    const toolCalls = assistantMessage.tool_calls || [];

    console.log(`   🔧 Tool Calls: ${toolCalls.length}개`);
    
    // Decision logging 활성화 시 logMemoryDecision tool이 호출되었는지 확인
    if (enableDecisionLogging) {
      const hasLogDecision = toolCalls.some(tc => {
        const typed = tc as { function?: { name?: string } };
        return typed.function?.name === 'logMemoryDecision';
      });
      
      if (!hasLogDecision) {
        console.log(`   ⚠️  logMemoryDecision tool이 호출되지 않았습니다. (필수 tool)`);
      }
    }
    
    if (toolCalls.length === 0) {
      console.log(`   ⚠️  예상된 tool call이 없습니다.`);
    }

    // Tool calls 처리
    const toolCallResults: Array<{
      name: string;
      arguments: unknown;
      result: unknown;
    }> = [];

    // Tool call 결과를 담을 배열 (AI에 다시 전달하기 위해)
    const toolCallMessages: Array<{
      role: 'tool';
      tool_call_id: string;
      content: string;
    }> = [];

    for (const toolCall of toolCalls) {
      // OpenAI SDK v6 타입 처리
      // toolCall은 ChatCompletionMessageToolCall 타입
      // 타입 단언을 사용하여 안전하게 처리
      const toolCallTyped = toolCall as {
        id: string;
        type: 'function';
        function: {
          name: string;
          arguments: string;
        };
      };

      if (!toolCallTyped.function) {
        console.log(`   ⚠️  Tool call에 function이 없습니다.`);
        continue;
      }

      const toolName = toolCallTyped.function.name;
      const toolArgs = JSON.parse(toolCallTyped.function.arguments);

      console.log(`   📞 Tool: ${toolName}`);
      console.log(`      Arguments: ${JSON.stringify(toolArgs, null, 2)}`);

      // entityId 자동 주입 (Memory Connector의 entityId 사용)
      // AI가 entityId를 제공하지 않거나 잘못된 경우 자동으로 설정
      if (toolName === 'createMemory') {
        if (!toolArgs.entityId || toolArgs.entityId !== scenario.entityId) {
          if (toolArgs.entityId && toolArgs.entityId !== scenario.entityId) {
            console.log(`   ⚠️  entityId 수정: ${toolArgs.entityId} → ${scenario.entityId}`);
          }
          toolArgs.entityId = scenario.entityId;
        }
      }

      // Tool Handler로 처리
      let result;
      switch (toolName) {
        case 'createMemory':
          result = await toolHandler.handleCreateMemory(toolArgs);
          break;
        case 'updateMemory':
          result = await toolHandler.handleUpdateMemory(toolArgs);
          break;
        case 'updateMemoryLink':
          result = await toolHandler.handleUpdateMemoryLink(toolArgs);
          break;
        case 'deleteMemory':
          result = await toolHandler.handleDeleteMemory(toolArgs);
          break;
        case 'logMemoryDecision':
          // logMemoryDecision은 로깅만 수행 (실제 Memory 조작 없음)
          result = { success: true, data: { logged: true, decision: toolArgs.decision, usedTools: toolArgs.usedTools } };
          console.log(`   📝 Memory Decision Log:`);
          console.log(`      ${toolArgs.decision}`);
          console.log(`      사용한 tools: ${(toolArgs.usedTools as string[]).length > 0 ? (toolArgs.usedTools as string[]).join(', ') : '없음'}`);
          break;
        default:
          result = { success: false, error: `Unknown tool: ${toolName}` };
      }

      toolCallResults.push({
        name: toolName,
        arguments: toolArgs,
        result,
      });

      // Tool call 결과를 AI에 전달할 형식으로 변환
      const toolResultContent = result.success
        ? JSON.stringify({ success: true, data: result.data })
        : JSON.stringify({ success: false, error: result.error });

      toolCallMessages.push({
        role: 'tool',
        tool_call_id: toolCallTyped.id,
        content: toolResultContent,
      });

      if (result.success) {
        console.log(`      ✅ 성공`);
        if (result.data) {
          console.log(`         Memory ID: ${(result.data as MemoryType).id}`);
        }
      } else {
        console.log(`      ❌ 실패: ${result.error}`);
      }
    }

    // Tool call 결과를 AI에 전달하여 최종 응답 생성 (선택사항)
    if (toolCallMessages.length > 0) {
      const finalMessages = [
        ...messages,
        {
          role: 'assistant' as const,
          content: assistantMessage.content || null,
          tool_calls: toolCalls,
        },
        ...toolCallMessages,
      ];

      const finalResponse = await openai.chat.completions.create({
        model: 'gpt-5-nano',
        messages: finalMessages,
        tools: toolsToUse, // Decision logging 활성화 여부에 따라 tool 목록 조정
        tool_choice: enableDecisionLogging ? 'required' : 'auto',
        // gpt-5-nano는 temperature 파라미터를 지원하지 않음 (기본값 1만 지원)
      });

      const finalContent = finalResponse.choices[0].message.content;
      if (finalContent) {
        console.log(`   💬 AI 최종 응답: ${finalContent.substring(0, 100)}...`);
      }
    }

    // 테스트 후 Memory 상태 확인
    const memoriesAfter = await storage.getMemoriesByEntity(scenario.entityId);
    const memoryCountAfter = memoriesAfter.length;

    // 검증: expectedToolCalls가 배열의 배열이면 OR 조건, 단일 배열이면 AND 조건
    let expectedToolsCalled: boolean;
    
    // 배열의 배열인지 확인 (첫 번째 요소가 배열인지 체크)
    const isNestedArray = Array.isArray(scenario.expectedToolCalls) && 
                          scenario.expectedToolCalls.length > 0 && 
                          Array.isArray(scenario.expectedToolCalls[0]);
    
    if (isNestedArray) {
      // 배열의 배열: 여러 가능한 조합 중 하나라도 만족하면 됨
      const possibleCombinations = scenario.expectedToolCalls as string[][];
      expectedToolsCalled = possibleCombinations.some(combination =>
        combination.every(expectedTool =>
          toolCalls.some(tc => {
            const toolCallTyped = tc as {
              id: string;
              type: 'function';
              function: {
                name: string;
                arguments: string;
              };
            };
            return toolCallTyped.function?.name === expectedTool;
          }),
        ),
      );
    } else {
      // 단일 배열: 모든 tool이 호출되어야 함
      const expectedTools = scenario.expectedToolCalls as string[];
      expectedToolsCalled = expectedTools.every(expectedTool =>
        toolCalls.some(tc => {
          const toolCallTyped = tc as {
            id: string;
            type: 'function';
            function: {
              name: string;
              arguments: string;
            };
          };
          return toolCallTyped.function?.name === expectedTool;
        }),
      );
    }

    const passed = expectedToolsCalled && toolCalls.length > 0;

    return {
      scenario: scenario.name,
      passed,
      toolCalls: toolCallResults,
      memoryState: {
        before: memoryCountBefore,
        after: memoryCountAfter,
      },
    };
  } catch (error) {
    console.error(`   ❌ 오류 발생:`, error);
    return {
      scenario: scenario.name,
      passed: false,
      toolCalls: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 테스트 시나리오 정의
 */
function getTestScenarios(): TestScenario[] {
  return [
    {
      name: '시나리오 1: 새로운 정보 저장',
      entityId: 'test-ai-tool-calling-001',
      userMessage: '내가 지금 마이크로서비스 아키텍처 프로젝트를 진행 중이야. GraphQL을 도입했고, 서비스 간 통신은 경량 이벤트 버스를 사용해.',
      expectedToolCalls: [['createMemory'], ['updateMemory']], // 기존 Memory가 없으면 createMemory, 있으면 updateMemory
      description:
        'User가 자신의 프로젝트에 대한 새로운 구체적인 정보를 제공할 때, 기존 Memory가 없으면 createMemory를, 있으면 updateMemory를 호출해야 함',
    },
    {
      name: '시나리오 2: 기존 정보 수정',
      entityId: 'test-ai-tool-calling-002',
      conversationHistory: [
        {
          role: 'user',
          content: '어디 살아?',
        },
        {
          role: 'assistant',
          content: '서울 강남구에 살고 있어요.',
        },
      ],
      userMessage: '부산으로 이사했어',
      expectedToolCalls: ['updateMemory'],
      description:
        '이전 대화에서 "서울 강남구에 살고 있어"라는 정보가 있었고, 현재 "부산으로 이사했어"라는 메시지가 왔을 때 AI가 updateMemory를 호출해야 함',
    },
    {
      name: '시나리오 3: Memory 간 연결',
      entityId: 'test-ai-tool-calling-003',
      userMessage: 'PyTorch로 CNN 모델을 만들어봤어. 인공지능에 관심이 많아서 시작했어.',
      expectedToolCalls: [['updateMemoryLink'], ['createMemory']], // 기존 Memory들만 연결하거나, 새로운 정보로 createMemory + relatedMemoryIds로 연결
      description:
        'User가 자신의 경험을 말할 때, 기존 seed data에 "인공지능과 머신러닝에 관심이 많아"와 "PyTorch를 사용해서 모델을 구현해봤어"가 이미 존재하고, 이 둘이 관련되어 있으므로 AI가 updateMemoryLink를 호출하여 연결하거나, 새로운 정보로 createMemory를 호출하면서 relatedMemoryIds로 연결해야 함',
    },
    {
      name: '시나리오 4: 복합 시나리오',
      entityId: 'test-ai-tool-calling-004',
      userMessage: '스타트업 운영하면서 자금 조달이 가장 어려워. 현금 흐름 관리도 힘들고.',
      expectedToolCalls: ['createMemory'],
      description:
        'User가 자신의 스타트업 운영 경험에 대한 개인적인 정보를 제공할 때, AI가 createMemory를 호출하여 저장하고, 기존 스타트업 관련 Memory들과 연결해야 함',
    },
    {
      name: '시나리오 5: Memory 간 연결 (서로 다른 query로 검색된 경우)',
      entityId: 'test-ai-tool-calling-005',
      userMessage: '강남에서 네이버까지 출퇴근하는데 시간이 오래 걸려서 힘들어.',
      expectedToolCalls: ['updateMemoryLink'],
      description:
        'User가 자신의 경험을 말할 때, 서로 다른 query로 검색된 Memory들("서울 강남구에 살고 있어", "네이버에서 소프트웨어 엔지니어로 일하고 있어", "강남에서 판교 네이버까지 출퇴근하는데 한 시간 걸려")이 함께 사용되어야 하므로, 이미 연결되어 있지 않다면 updateMemoryLink를 호출하여 연결해야 함',
      copyWithoutLinks: true, // 연결 없이 복사하여 updateMemoryLink 테스트
    },
    {
      name: '시나리오 6: Memory 간 연결 (관련성 언급)',
      entityId: 'test-ai-tool-calling-006',
      userMessage: 'TypeScript와 React를 사용해서 마이크로서비스 프로젝트를 하고 있어.',
      expectedToolCalls: ['updateMemoryLink'],
      description:
        'User가 자신의 경험을 말할 때, 기존 Memory들("TypeScript와 React를 주로 사용해", "현재 마이크로서비스 아키텍처 프로젝트를 진행 중이야")이 관련되어 있음을 언급하므로, 이미 연결되어 있지 않다면 updateMemoryLink를 호출하여 연결해야 함',
      copyWithoutLinks: true, // 연결 없이 복사하여 updateMemoryLink 테스트
    },
    {
      name: '시나리오 7: Memory 간 연결 (Graph chain과 직접 검색)',
      entityId: 'test-ai-tool-calling-007',
      userMessage: '주말에 카페에서 코딩할 때 TypeScript로 사이드 프로젝트를 해.',
      expectedToolCalls: ['updateMemoryLink'],
      description:
        'User가 자신의 경험을 말할 때, 많은 edge chain을 통해 검색된 Memory("주말에는 강남에서 카페에서 코딩을 해")와 직접 검색된 Memory("TypeScript와 React를 주로 사용해", "사이드 프로젝트로 오픈소스 라이브러리를 만들고 있어")가 함께 사용되어야 하므로, 이미 연결되어 있지 않다면 updateMemoryLink를 호출하여 연결해야 함',
      copyWithoutLinks: true, // 연결 없이 복사하여 updateMemoryLink 테스트
    },
  ];
}

/**
 * 메인 테스트 함수
 */
async function main() {
  console.log('🚀 AI Tool Calling 통합 테스트 시작\n');

  const memory = new Memory();

  try {
    // 1. AI Adapter 설정
    const aiAdapter = new OpenAIAdapter({
      apiKey: process.env.OPENAI_API_KEY!,
    });

    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY 환경 변수가 설정되지 않았습니다.');
    }

    // 2. Memory Storage 초기화
    console.log('📦 Memory Storage 초기화 중...');
    await memory.initialize(
      {
        type: StorageType.POSTGRES,
        connectionString:
          process.env.MEMORY_DATABASE_URL ||
          'postgresql://postgres:postgres@localhost:54332/postgres',
        schema: 'memory',
      },
      {
        aiAdapter,
      },
    );
    console.log('✅ Memory Storage 초기화 완료\n');

    const storage = memory.getStorage();
    const toolHandler = new MemoryToolHandler(storage);
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // 3. Seed data 확인
    console.log('🔍 Seed data 확인 중...');
    const seedEntities = [
      'persona-001-software-engineer',
      'persona-002-student',
      'persona-003-designer',
      'persona-004-entrepreneur',
    ];

    for (const entityId of seedEntities) {
      const memories = await storage.getMemoriesByEntity(entityId);
      console.log(`   ${entityId}: ${memories.length}개 Memory`);
    }
    console.log();

    // 4. 테스트 시나리오별 Seed data 복사
    console.log('📋 테스트 시나리오 준비 중...\n');
    const scenarios = getTestScenarios();

    // 시나리오별로 필요한 seed data 복사
    const seedDataMapping: Record<string, string> = {
      'test-ai-tool-calling-001': 'persona-001-software-engineer',
      'test-ai-tool-calling-002': 'persona-001-software-engineer',
      'test-ai-tool-calling-003': 'persona-002-student',
      'test-ai-tool-calling-004': 'persona-004-entrepreneur',
      'test-ai-tool-calling-005': 'persona-001-software-engineer',
      'test-ai-tool-calling-006': 'persona-001-software-engineer',
      'test-ai-tool-calling-007': 'persona-001-software-engineer',
    };

    for (const scenario of scenarios) {
      const sourceEntityId = seedDataMapping[scenario.entityId];
      if (sourceEntityId) {
        // 기존 테스트 데이터가 있는지 확인하고 삭제 (중복 방지)
        const existingMemories = await storage.getMemoriesByEntity(scenario.entityId);
        if (existingMemories.length > 0) {
          console.log(`🧹 ${scenario.entityId}의 기존 데이터 정리 중... (${existingMemories.length}개)`);
          for (const memory of existingMemories) {
            await storage.deleteMemory(memory.id);
          }
        }

        console.log(`📦 ${scenario.entityId}에 seed data 복사 중...`);
        if (scenario.copyWithoutLinks) {
          // 연결 없이 복사 (updateMemoryLink 테스트용)
          await copySeedDataWithoutLinks(storage, sourceEntityId, scenario.entityId);
          console.log(`   (연결 정보 제외)`);
        } else {
          // 연결 정보 포함하여 복사
          await copySeedDataToTestEntity(storage, sourceEntityId, scenario.entityId);
        }
        const copiedMemories = await storage.getMemoriesByEntity(scenario.entityId);
        console.log(`   ✅ ${copiedMemories.length}개 Memory 복사 완료\n`);
      }
    }

    // 5. 각 시나리오 실행
    const results: TestResult[] = [];
    for (const scenario of scenarios) {
      const result = await runScenario(scenario, storage, toolHandler, openai);
      results.push(result);
    }

    // 6. 결과 요약
    console.log('\n' + '='.repeat(80));
    console.log('📊 테스트 결과 요약');
    console.log('='.repeat(80));

    let passedCount = 0;
    for (const result of results) {
      const status = result.passed ? '✅ PASS' : '❌ FAIL';
      console.log(`\n${status} - ${result.scenario}`);
      if (result.memoryState) {
        console.log(`   Memory: ${result.memoryState.before} → ${result.memoryState.after}`);
      }
      if (result.toolCalls.length > 0) {
        console.log(`   Tool Calls: ${result.toolCalls.map(tc => tc.name).join(', ')}`);
      }
      if (result.error) {
        console.log(`   Error: ${result.error}`);
      }
      if (result.passed) {
        passedCount++;
      }
    }

    console.log(`\n📈 통과: ${passedCount}/${results.length}`);

    // 7. 테스트 데이터 정리
    console.log('\n🧹 테스트 데이터 정리 중...');
    for (const scenario of scenarios) {
      const memories = await storage.getMemoriesByEntity(scenario.entityId);
      for (const m of memories) {
        await storage.deleteMemory(m.id);
      }
      console.log(`   ✅ ${scenario.entityId} 정리 완료`);
    }

    console.log('\n✅ 모든 테스트 완료!');
  } catch (error) {
    console.error('❌ 테스트 중 오류 발생:', error);
    if (error instanceof Error) {
      console.error('   메시지:', error.message);
      console.error('   스택:', error.stack);
    }
  } finally {
    try {
      if (memory) {
        await memory.close();
        console.log('🔌 데이터베이스 연결 종료');
      }
    } catch (closeError) {
      console.error('⚠️  연결 종료 중 오류:', closeError);
    }
  }
}

// 실행
main()
  .then(() => {
    // 정상 종료
    process.exit(0);
  })
  .catch(error => {
    console.error('프로그램 실행 중 오류:', error);
    process.exit(1);
  });
