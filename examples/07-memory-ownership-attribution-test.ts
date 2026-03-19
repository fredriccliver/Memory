/**
 * Memory Ownership Attribution 통합 테스트
 *
 * #377: 메모리 저장 시 Replica 본인 vs 대화 상대방(User) 사실 혼동 방지
 *
 * handleAfterResponse 경로를 통해 자동 메모리 생성 시,
 * entityName/partnerName이 있을 때 주체를 구분해서 저장하는지 검증합니다.
 *
 * 테스트 시나리오:
 * 1. entityName + partnerName 있을 때: 상대방 사실이 상대방으로 귀속되는지
 * 2. entityName + partnerName 있을 때: 본인 사실이 본인으로 귀속되는지
 * 3. entityName + partnerName 없을 때 (기존 동작): 주체 혼동 가능성 확인
 * 4. 혼합 대화에서 양쪽 사실을 각각 올바르게 귀속하는지
 *
 * 실행 방법:
 *   npx tsx examples/07-memory-ownership-attribution-test.ts
 *
 * 사전 준비:
 *   1. 환경 변수 설정: OPENAI_API_KEY, MEMORY_DATABASE_URL (또는 ../../.env.local)
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
// fallback to root project .env.local
config({ path: '../../.env.local' });

import {
  Memory,
  StorageType,
  OpenAIAdapter,
  MemoryConnector,
  MemoryStorage,
  SearchMode,
} from '../src/index';
import type { AfterResponseContextAdapter, ConversationContext } from '../src/types';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';

interface TestScenario {
  name: string;
  description: string;
  entityId: string;
  entityName?: string;
  partnerName?: string;
  conversation: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Patterns expected IN created memory content (regex). At least one must match a created memory. */
  expectedPatterns: RegExp[];
  /** Patterns that should NOT appear in any created memory content (regex). */
  forbiddenPatterns?: RegExp[];
}

interface TestResult {
  scenario: string;
  passed: boolean;
  createdMemories: string[];
  matchedPatterns: string[];
  failedPatterns: string[];
  forbiddenMatches: string[];
  error?: string;
}

function createContextAdapter(): AfterResponseContextAdapter {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is required');

  const model = new ChatOpenAI({ model: 'o4-mini', apiKey });

  return {
    async generate(messages: Array<{ role: string; content: string }>): Promise<string> {
      const langchainMessages = messages.map(m => {
        if (m.role === 'system') return new SystemMessage(m.content);
        if (m.role === 'assistant') return new AIMessage(m.content);
        return new HumanMessage(m.content);
      });
      const response = await model.invoke(langchainMessages);
      return typeof response.content === 'string'
        ? response.content
        : String(response.content ?? '');
    },
  };
}

function getTestScenarios(): TestScenario[] {
  return [
    {
      name: '시나리오 1: 상대방 사실을 상대방으로 귀속 (entityName + partnerName)',
      description:
        'entityName="하늘이", partnerName="민수" 설정. 사용자(민수)가 "나 서울에 살아"라고 말했을 때, 메모리에 "민수" 또는 "상대방"이 주체로 명시되는지 확인.',
      entityId: 'test-ownership-001',
      entityName: '하늘이',
      partnerName: '민수',
      conversation: [
        { role: 'user', content: '나 서울 강남에 살고 있어' },
        { role: 'assistant', content: '오 강남? 나도 서울인데 ㅋㅋ 어디 쪽이야?' },
        { role: 'user', content: '역삼역 근처! 그리고 나 개발자야 백엔드' },
        { role: 'assistant', content: '오 백엔드 개발자구나! 뭐 주로 써?' },
      ],
      expectedPatterns: [/민수|상대방/],
      forbiddenPatterns: [/^(?!.*(?:민수|상대방)).*(?:서울|강남|개발자|백엔드)/],
    },
    {
      name: '시나리오 2: 본인(entity) 사실을 본인으로 귀속 (entityName + partnerName)',
      description:
        'entityName="하늘이", partnerName="민수" 설정. assistant(하늘이)가 "나는 부산 출신이야"라고 말했을 때, 메모리에 "나" 또는 "하늘이"가 주체로 명시되는지 확인.',
      entityId: 'test-ownership-002',
      entityName: '하늘이',
      partnerName: '민수',
      conversation: [
        { role: 'user', content: '너 어디 출신이야?' },
        { role: 'assistant', content: '나? 부산 출신이야 ㅎㅎ 해운대 근처에서 자랐어' },
        { role: 'user', content: '오 부산! 좋다 나도 가보고 싶어' },
        { role: 'assistant', content: '와봐 진짜 좋아 특히 여름에' },
      ],
      expectedPatterns: [/나는|나\b|하늘이|본인/],
      forbiddenPatterns: [/민수.*부산|상대방.*부산/],
    },
    {
      name: '시나리오 3: 혼합 대화 — 양쪽 사실을 각각 올바르게 귀속',
      description:
        'entityName="하늘이", partnerName="지은" 설정. 양쪽이 각자 정보를 공유하는 대화에서, 각 사실이 올바른 주체에 귀속되는지 확인.',
      entityId: 'test-ownership-003',
      entityName: '하늘이',
      partnerName: '지은',
      conversation: [
        { role: 'user', content: '나 커피 진짜 좋아해 하루에 세 잔은 마셔' },
        { role: 'assistant', content: '헐 세 잔? ㅋㅋ 나는 차를 더 좋아해 녹차 특히' },
        { role: 'user', content: '녹차도 좋지 ㅎㅎ 그리고 나 고양이 키우는데 이름이 뭉치야' },
        { role: 'assistant', content: '귀여워!! 나는 강아지 키워 이름이 콩이야' },
      ],
      expectedPatterns: [
        /지은.*커피|상대방.*커피/,
        /나.*차|하늘이.*차|나.*녹차|하늘이.*녹차/,
      ],
    },
    {
      name: '시나리오 4: entityName/partnerName 없을 때 — 기존 동작 (baseline)',
      description:
        'entityName, partnerName 미설정. 주체 구분 없이 메모리가 생성되는 기존 동작 확인. (이 시나리오는 "pass" 기준이 다름 — 메모리가 생성되기만 하면 OK)',
      entityId: 'test-ownership-004',
      entityName: undefined,
      partnerName: undefined,
      conversation: [
        { role: 'user', content: '나 일본어 공부하고 있어 JLPT N2 준비 중' },
        { role: 'assistant', content: '오 대단하다! 나도 일본 여행 좋아하는데' },
        { role: 'user', content: '진짜? 어디 가봤어?' },
        { role: 'assistant', content: '도쿄랑 오사카 가봤어 다음엔 교토 가고 싶어' },
      ],
      expectedPatterns: [/일본|JLPT|도쿄|오사카|교토/],
    },
  ];
}

async function runScenario(
  scenario: TestScenario,
  storage: MemoryStorage,
  contextAdapter: AfterResponseContextAdapter,
): Promise<TestResult> {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`📋 ${scenario.name}`);
  console.log(`   ${scenario.description}`);
  console.log(`   entityName: ${scenario.entityName ?? '(없음)'}`);
  console.log(`   partnerName: ${scenario.partnerName ?? '(없음)'}`);

    const connector = new MemoryConnector(storage, {
      entityId: scenario.entityId,
      entityName: scenario.entityName,
      partnerName: scenario.partnerName,
      mode: 'read-write',
      maxMemoryCount: 20,
      similarityThreshold: SearchMode.AGGRESSIVE,
      contextAdapter,
      verbose: true,
    });

    // connect() is required to set isConnected=true for handleAfterResponse
    await connector.connect({
      async prepareContext(ctx: string) {
        return connector.getContext(ctx);
      },
    });

  try {
    const context: ConversationContext = {
      messages: scenario.conversation,
      entityId: scenario.entityId,
    };

    console.log(`\n   💬 대화 내용:`);
    for (const msg of scenario.conversation) {
      const label = msg.role === 'user' ? '사용자' : 'AI';
      console.log(`      [${label}] ${msg.content}`);
    }

    console.log(`\n   🔄 handleAfterResponse 실행 중...`);
    await connector.handleAfterResponse(context);

    const createdMemories = await storage.getMemoriesByEntity(scenario.entityId);
    console.log(`\n   📝 생성된 메모리: ${createdMemories.length}개`);
    for (const mem of createdMemories) {
      console.log(`      • ${mem.content}`);
    }

    if (createdMemories.length === 0) {
      console.log(`   ⚠️  메모리가 생성되지 않았습니다.`);
      return {
        scenario: scenario.name,
        passed: false,
        createdMemories: [],
        matchedPatterns: [],
        failedPatterns: scenario.expectedPatterns.map(p => p.source),
        forbiddenMatches: [],
        error: 'No memories created',
      };
    }

    const allContent = createdMemories.map(m => m.content);
    const matchedPatterns: string[] = [];
    const failedPatterns: string[] = [];

    for (const pattern of scenario.expectedPatterns) {
      const matched = allContent.some(c => pattern.test(c));
      if (matched) {
        matchedPatterns.push(pattern.source);
        console.log(`   ✅ 패턴 매칭 성공: /${pattern.source}/`);
      } else {
        failedPatterns.push(pattern.source);
        console.log(`   ❌ 패턴 매칭 실패: /${pattern.source}/`);
      }
    }

    const forbiddenMatches: string[] = [];
    if (scenario.forbiddenPatterns) {
      for (const pattern of scenario.forbiddenPatterns) {
        const matched = allContent.some(c => pattern.test(c));
        if (matched) {
          forbiddenMatches.push(pattern.source);
          const offending = allContent.filter(c => pattern.test(c));
          console.log(
            `   ❌ 금지 패턴 탐지: /${pattern.source}/ → ${offending.join(' | ')}`,
          );
        }
      }
    }

    const passed = failedPatterns.length === 0 && forbiddenMatches.length === 0;
    return {
      scenario: scenario.name,
      passed,
      createdMemories: allContent,
      matchedPatterns,
      failedPatterns,
      forbiddenMatches,
    };
  } catch (error) {
    console.error(`   ❌ 오류:`, error);
    return {
      scenario: scenario.name,
      passed: false,
      createdMemories: [],
      matchedPatterns: [],
      failedPatterns: [],
      forbiddenMatches: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main() {
  console.log('🚀 Memory Ownership Attribution 통합 테스트');
  console.log('   #377: Replica 본인 vs 대화 상대방(User) 사실 구분\n');

  const memoryInstance = new Memory();

  try {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY 환경 변수가 필요합니다.');
    }

    const aiAdapter = new OpenAIAdapter({ apiKey: process.env.OPENAI_API_KEY });

    console.log('📦 Memory Storage 초기화 중...');
    await memoryInstance.initialize(
      {
        type: StorageType.POSTGRES,
        connectionString:
          process.env.MEMORY_DATABASE_URL ||
          'postgresql://postgres:postgres@localhost:54332/postgres',
        schema: 'memory',
      },
      { aiAdapter },
    );
    console.log('✅ 초기화 완료\n');

    const storage = memoryInstance.getStorage();
    const contextAdapter = createContextAdapter();
    const scenarios = getTestScenarios();

    // 기존 테스트 데이터 정리
    for (const scenario of scenarios) {
      const existing = await storage.getMemoriesByEntity(scenario.entityId);
      if (existing.length > 0) {
        console.log(`🧹 ${scenario.entityId} 기존 데이터 정리 (${existing.length}개)`);
        for (const m of existing) {
          await storage.deleteMemory(m.id);
        }
      }
    }

    const results: TestResult[] = [];
    for (const scenario of scenarios) {
      const result = await runScenario(scenario, storage, contextAdapter);
      results.push(result);
    }

    // 결과 요약
    console.log(`\n${'='.repeat(70)}`);
    console.log('📊 테스트 결과 요약');
    console.log('='.repeat(70));

    let passedCount = 0;
    for (const result of results) {
      const status = result.passed ? '✅ PASS' : '❌ FAIL';
      console.log(`\n${status} — ${result.scenario}`);
      if (result.createdMemories.length > 0) {
        console.log(`   생성된 메모리: ${result.createdMemories.length}개`);
        for (const mem of result.createdMemories) {
          console.log(`     • ${mem}`);
        }
      }
      if (result.failedPatterns.length > 0) {
        console.log(`   매칭 실패 패턴: ${result.failedPatterns.join(', ')}`);
      }
      if (result.forbiddenMatches.length > 0) {
        console.log(`   금지 패턴 위반: ${result.forbiddenMatches.join(', ')}`);
      }
      if (result.error) {
        console.log(`   오류: ${result.error}`);
      }
      if (result.passed) passedCount++;
    }

    console.log(`\n📈 통과: ${passedCount}/${results.length}`);

    // 정리
    console.log('\n🧹 테스트 데이터 정리 중...');
    for (const scenario of scenarios) {
      const memories = await storage.getMemoriesByEntity(scenario.entityId);
      for (const m of memories) {
        await storage.deleteMemory(m.id);
      }
      console.log(`   ✅ ${scenario.entityId} 정리 완료`);
    }

    console.log('\n✅ 모든 테스트 완료!');
    process.exit(passedCount === results.length ? 0 : 1);
  } catch (error) {
    console.error('❌ 테스트 중 오류:', error);
    process.exit(1);
  } finally {
    try {
      await memoryInstance.close();
      console.log('🔌 DB 연결 종료');
    } catch {
      // ignore
    }
  }
}

main();
