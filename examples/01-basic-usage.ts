/**
 * 가장 간단한 Memory 패키지 사용 예제
 *
 * 이 예제는 다음을 보여줍니다:
 * 1. Memory Storage 초기화
 * 2. Memory 생성 (embedding 자동 생성)
 * 3. Vector 검색
 * 4. Graph 연결 및 탐색
 */

// 환경 변수 로드 (dotenv 사용)
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// ESM에서 __dirname 대체
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 패키지 내부의 .env.local 파일만 로드 (독립적인 패키지이므로)
config({ path: resolve(__dirname, '../.env.local') });

import { Memory, StorageType, OpenAIAdapter } from '../src/index';

async function main() {
  console.log('🚀 Memory 패키지 기본 사용 예제 시작\n');

  // 1. Memory 인스턴스 생성
  const memory = new Memory();

  try {
    // 2. AI Adapter 설정 (embedding 자동 생성을 위해 필요)
    const aiAdapter = new OpenAIAdapter({
      apiKey: process.env.OPENAI_API_KEY!,
    });

    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY 환경 변수가 설정되지 않았습니다.');
    }

    // 3. Memory Storage 초기화
    console.log('📦 Memory Storage 초기화 중...');
    await memory.initialize(
      {
        type: StorageType.POSTGRES,
        connectionString:
          process.env.MEMORY_DATABASE_URL ||
          'postgresql://postgres:postgres@localhost:54332/postgres',
        schema: 'memory', // 별도 스키마 사용 (Application Layer와 분리)
      },
      {
        aiAdapter, // Embedding 자동 생성을 위해 제공
      },
    );
    console.log('✅ Memory Storage 초기화 완료\n');

    const storage = memory.getStorage();
    // UUID 형식의 entityId 생성 (테스트용)
    const entityId = '00000000-0000-0000-0000-000000000001';

    // 4. Memory 생성 (embedding은 자동으로 생성됨)
    console.log('📝 Memory 생성 중...');
    const memory1 = await storage.createMemory({
      entityId,
      content: '서울 강남구에 살고 있어',
      outgoingEdges: [],
    });
    console.log(`✅ Memory 생성 완료: ${memory1.id}`);
    console.log(`   Content: ${memory1.content}`);
    console.log(`   Embedding 차원: ${memory1.embedding?.length || 0}\n`);

    const memory2 = await storage.createMemory({
      entityId,
      content: '네이버에서 소프트웨어 엔지니어로 일하고 있어',
      outgoingEdges: [],
    });
    console.log(`✅ Memory 생성 완료: ${memory2.id}`);
    console.log(`   Content: ${memory2.content}\n`);

    const memory3 = await storage.createMemory({
      entityId,
      content: '강남에서 판교 네이버까지 출퇴근하는데 한 시간 걸려',
      outgoingEdges: [],
    });
    console.log(`✅ Memory 생성 완료: ${memory3.id}`);
    console.log(`   Content: ${memory3.content}\n`);

    // 5. Memory 연결 (Graph 구조 생성)
    console.log('🔗 Memory 연결 중...');
    await storage.updateOutgoingEdges(memory1.id, [memory2.id]);
    await storage.updateOutgoingEdges(memory2.id, [memory3.id]);
    console.log('✅ Memory 연결 완료\n');

    // 6. Vector 검색
    console.log('🔍 Vector 검색 테스트...');
    const searchResults = await storage.searchByQuery('출퇴근 어떻게 해?', entityId, 10, 0.7);
    console.log(`✅ 검색 결과: ${searchResults.length}개 발견\n`);
    searchResults.forEach((result, index) => {
      console.log(
        `   ${index + 1}. ${result.content} (similarity: ${result.similarity?.toFixed(3)})`,
      );
    });
    console.log();

    // 7. Graph 탐색 (연결된 Memory 찾기)
    console.log('🌐 Graph 탐색 테스트...');
    const connectedMemories = await storage.getConnectedMemories(memory1.id, 2);
    console.log(`✅ 연결된 Memory: ${connectedMemories.length}개 발견\n`);
    connectedMemories.forEach((m, index) => {
      console.log(`   ${index + 1}. ${m.content}`);
    });
    console.log();

    // 8. 정리
    console.log('🧹 테스트 데이터 정리 중...');
    await storage.deleteMemory(memory1.id);
    await storage.deleteMemory(memory2.id);
    await storage.deleteMemory(memory3.id);
    console.log('✅ 정리 완료\n');

    console.log('✅ 모든 테스트 완료!');
  } catch (error) {
    console.error('❌ 오류 발생:', error);
    throw error;
  } finally {
    // 9. 연결 종료
    await memory.close();
    console.log('🔌 연결 종료');
  }
}

// 실행
main().catch(error => {
  console.error('프로그램 실행 중 오류:', error);
  process.exit(1);
});
