/**
 * LangChain과 Memory Connector 통합 샘플
 *
 * 이 예제는 다음을 보여줍니다:
 * 1. 실제 LangChain chain 생성 (ChatOpenAI + RunnableSequence)
 * 2. Memory Connector 연결
 * 3. 자동 Memory 검색 및 컨텍스트 구성
 * 4. 대화 시뮬레이션
 *
 * 참고: LangChain 라이브러리가 설치되어 있어야 합니다.
 * 설치: pnpm add @langchain/core @langchain/openai
 */

import { Memory, StorageType, OpenAIAdapter, MemoryConnector } from '../src/index';

// LangChain 라이브러리 import (선택적 - 런타임에 확인)
let ChatOpenAI: any;
let HumanMessage: any;
let SystemMessage: any;
let RunnableSequence: any;

try {
  // LangChain 라이브러리 동적 import
  const langchainOpenAI = require('@langchain/openai');
  const langchainCore = require('@langchain/core');
  ChatOpenAI = langchainOpenAI.ChatOpenAI;
  HumanMessage = langchainCore.messages.HumanMessage;
  SystemMessage = langchainCore.messages.SystemMessage;
  RunnableSequence = langchainCore.runnables.RunnableSequence;
} catch (error) {
  console.error(
    '❌ LangChain 라이브러리가 설치되지 않았습니다.\n' +
      '설치: pnpm add @langchain/core @langchain/openai\n',
  );
  throw error;
}

/**
 * LangChain chain을 래핑하여 Memory Connector와 통합
 *
 * Memory Connector가 자동으로 컨텍스트를 준비하고,
 * LangChain chain의 invoke() 호출 전에 system prompt에 메모리 컨텍스트를 추가합니다.
 */
class MemoryAwareLangChainChain {
  private chain: any;
  private connector: MemoryConnector | null = null;

  constructor(chain: any) {
    this.chain = chain;
  }

  setConnector(connector: MemoryConnector) {
    this.connector = connector;
  }

  async invoke(input: { messages?: Array<{ content: string }>; [key: string]: unknown }) {
    if (!this.connector) {
      throw new Error('Memory Connector가 연결되지 않았습니다.');
    }

    // 마지막 메시지 추출
    const lastMessage = input.messages?.[input.messages.length - 1]?.content || '';
    if (!lastMessage) {
      return { content: '메시지가 없습니다.' };
    }

    // Memory Connector를 통해 컨텍스트 가져오기
    const context = await this.connector.getContext(lastMessage);

    // System prompt에 메모리 컨텍스트 추가
    const systemPrompt = `당신은 친절한 AI 어시스턴트입니다.\n\n${context.template}`;

    // LangChain 메시지 구성
    const messages = [new SystemMessage(systemPrompt), new HumanMessage(lastMessage)];

    // LangChain chain 호출
    const response = await this.chain.invoke({
      messages,
    });

    const responseContent =
      typeof response === 'string' ? response : response.content || JSON.stringify(response);

    // 응답 후 처리 (Memory 생성 등)
    await this.connector.handleAfterResponse({
      messages: [
        { role: 'user', content: lastMessage },
        { role: 'assistant', content: responseContent },
      ],
      entityId: this.connector.getConfig().entityId,
      metadata: {
        memories: context.memories,
      },
    });

    return { content: responseContent };
  }
}

async function main() {
  console.log('🚀 LangChain + Memory Connector 샘플 시작\n');

  // 1. Memory 인스턴스 생성 및 초기화
  const memory = new Memory();
  const aiAdapter = new OpenAIAdapter({
    apiKey: process.env.OPENAI_API_KEY!,
  });

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY 환경 변수가 설정되지 않았습니다.');
  }

  console.log('📦 Memory Storage 초기화 중...');
  await memory.initialize(
    {
      type: StorageType.POSTGRES,
      connectionString:
        process.env.MEMORY_DATABASE_URL ||
        'postgresql://postgres:postgres@localhost:54332/postgres',
      schema: 'public',
    },
    {
      aiAdapter,
    },
  );
  console.log('✅ Memory Storage 초기화 완료\n');

  const storage = memory.getStorage();
  const entityId = 'test-persona-002';

  // 2. 테스트 Memory 생성
  console.log('📝 테스트 Memory 생성 중...');
  const memory1 = await storage.createMemory({
    entityId,
    content: '서울 강남구에 살고 있어',
    outgoingEdges: [],
  });

  const memory2 = await storage.createMemory({
    entityId,
    content: '네이버에서 소프트웨어 엔지니어로 일하고 있어',
    outgoingEdges: [],
  });

  const memory3 = await storage.createMemory({
    entityId,
    content: '강남에서 판교 네이버까지 출퇴근하는데 한 시간 걸려',
    outgoingEdges: [],
  });

  // Memory 연결
  await storage.updateOutgoingEdges(memory1.id, [memory2.id]);
  await storage.updateOutgoingEdges(memory2.id, [memory3.id]);
  console.log('✅ 테스트 Memory 생성 완료\n');

  // 3. Memory Connector 생성 및 설정
  console.log('🔌 Memory Connector 설정 중...');
  const connector = new MemoryConnector(storage, {
    entityId,
    maxMemoryCount: 10,
    similarityThreshold: 0.7,
    chainDepth: 2,
    mode: 'read-write',
  });
  console.log('✅ Memory Connector 설정 완료\n');

  // 4. 실제 LangChain Chain 생성
  console.log('🔗 LangChain Chain 생성 중...');
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY 환경 변수가 설정되지 않았습니다.');
  }

  // ChatOpenAI 모델 생성
  const model = new ChatOpenAI({
    modelName: 'gpt-3.5-turbo',
    temperature: 0.7,
    openAIApiKey: process.env.OPENAI_API_KEY,
  });

  // Memory Connector와 통합된 Chain 래퍼 생성
  const chainWrapper = new MemoryAwareLangChainChain(model);
  chainWrapper.setConnector(connector);

  // 5. Memory Connector를 Chain에 연결
  console.log('🔌 Memory Connector를 Chain에 연결 중...');
  // Memory Connector는 LangChain chain을 자동으로 감지하고 연결합니다
  // 실제 LangChain 모델 객체를 전달하면 자동으로 감지됩니다
  await connector.connect(model);
  console.log('✅ 연결 완료\n');

  // 6. 대화 시뮬레이션
  console.log('💬 대화 시뮬레이션 시작\n');
  console.log('='.repeat(60));

  const conversations = ['안녕하세요!', '어디서 일하세요?', '출퇴근은 어떻게 하세요?'];

  for (const userMessage of conversations) {
    console.log(`\n👤 사용자: ${userMessage}`);
    const response = await chainWrapper.invoke({
      messages: [{ content: userMessage }],
    });
    console.log(`\n🤖 응답:\n${(response as { content: string }).content}`);
    console.log('\n' + '-'.repeat(60));
  }

  console.log('\n' + '='.repeat(60));
  console.log('\n✅ 대화 시뮬레이션 완료\n');

  // 7. 정리
  console.log('🧹 테스트 데이터 정리 중...');
  await storage.deleteMemory(memory1.id);
  await storage.deleteMemory(memory2.id);
  await storage.deleteMemory(memory3.id);
  await connector.disconnect();
  await memory.close();
  console.log('✅ 정리 완료');
}

// 실행
main().catch(error => {
  console.error('프로그램 실행 중 오류:', error);
  process.exit(1);
});
