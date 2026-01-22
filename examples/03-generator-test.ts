/**
 * DynamicMemoryGenerator 테스트
 *
 * 이 예제는 다음을 보여줍니다:
 * 1. DynamicMemoryGenerator 초기화
 * 2. collectAugmentation() 메서드 테스트
 * 3. Vector 검색 결과 수집
 * 4. Graph 탐색 결과 수집 (BFS)
 * 5. 기존 관계 수집
 */

// 환경 변수 로드
import { config } from 'dotenv';
config();

import { Memory, StorageType, OpenAIAdapter, DynamicMemoryGenerator, SearchMode } from '../src/index';

async function main() {
  console.log('🚀 DynamicMemoryGenerator 테스트 시작\n');

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
    const entityId = 'test-entity-generator';

    // 3. 테스트용 Memory 생성
    console.log('📝 테스트용 Memory 생성 중...');
    const memory1 = await storage.createMemory({
      entityId,
      content: '서울 강남구에 살고 있어',
      outgoingEdges: [],
    });
    console.log(`✅ Memory 생성: ${memory1.id} - ${memory1.content}`);

    const memory2 = await storage.createMemory({
      entityId,
      content: '네이버에서 소프트웨어 엔지니어로 일하고 있어',
      outgoingEdges: [],
    });
    console.log(`✅ Memory 생성: ${memory2.id} - ${memory2.content}`);

    const memory3 = await storage.createMemory({
      entityId,
      content: '강남에서 판교 네이버까지 출퇴근하는데 한 시간 걸려',
      outgoingEdges: [],
    });
    console.log(`✅ Memory 생성: ${memory3.id} - ${memory3.content}`);

    const memory4 = await storage.createMemory({
      entityId,
      content: '주말에는 강남에서 카페에서 코딩을 해',
      outgoingEdges: [],
    });
    console.log(`✅ Memory 생성: ${memory4.id} - ${memory4.content}\n`);

    // 4. Memory 연결 (Graph 구조 생성)
    console.log('🔗 Memory 연결 중...');
    await storage.updateOutgoingEdges(memory1.id, [memory2.id]);
    await storage.updateOutgoingEdges(memory2.id, [memory3.id]);
    await storage.updateOutgoingEdges(memory1.id, [memory4.id]);
    console.log('✅ Memory 연결 완료\n');

    // 5. DynamicMemoryGenerator 초기화
    console.log('🔧 DynamicMemoryGenerator 초기화 중...');
    const generator = new DynamicMemoryGenerator(storage);
    console.log('✅ DynamicMemoryGenerator 초기화 완료\n');

    // 6. collectAugmentation() 테스트
    console.log('🧪 collectAugmentation() 테스트 시작\n');

    // 테스트 1: Vector 검색 결과 수집
    console.log('📊 테스트 1: Vector 검색 결과 수집');
    const query1 = '출퇴근 어떻게 해?';
    // threshold가 높아서 결과가 없을 수 있으므로, 직접 검색해서 확인
    const directSearch1 = await storage.searchByQuery(query1, entityId, 10, SearchMode.NORMAL);
    console.log(`   쿼리: "${query1}"`);
    console.log(`   직접 검색 결과 (SearchMode.NORMAL): ${directSearch1.length}개`);
    const result1 = await generator.collectAugmentation(query1, entityId);
    console.log(`   Vector 메모리: ${result1.vectorMemories.length}개`);
    result1.vectorMemories.forEach((m, i) => {
      console.log(
        `     ${i + 1}. ${m.content} (similarity: ${m.similarity?.toFixed(3) || 'N/A'})`,
      );
    });
    console.log(`   Graph 메모리: ${result1.graphMemories.length}개`);
    result1.graphMemories.forEach((m, i) => {
      console.log(`     ${i + 1}. ${m.content}`);
    });
    console.log();

    // 테스트 2: Graph 탐색 결과 수집 (BFS)
    console.log('📊 테스트 2: Graph 탐색 결과 수집 (BFS)');
    const query2 = '강남';
    const result2 = await generator.collectAugmentation(query2, entityId, { maxDepth: 2 });
    console.log(`   쿼리: "${query2}"`);
    console.log(`   Vector 메모리: ${result2.vectorMemories.length}개`);
    result2.vectorMemories.forEach((m, i) => {
      console.log(
        `     ${i + 1}. ${m.content} (similarity: ${m.similarity?.toFixed(3) || 'N/A'})`,
      );
    });
    console.log(`   Graph 메모리: ${result2.graphMemories.length}개`);
    result2.graphMemories.forEach((m, i) => {
      console.log(`     ${i + 1}. ${m.content}`);
    });
    console.log();

    // 테스트 3: 기존 관계 수집
    console.log('📊 테스트 3: 기존 관계 수집');
    const query3 = '네이버';
    const result3 = await generator.collectAugmentation(query3, entityId);
    console.log(`   쿼리: "${query3}"`);
    console.log(`   Vector 메모리: ${result3.vectorMemories.length}개`);
    result3.vectorMemories.forEach((m, i) => {
      console.log(
        `     ${i + 1}. ${m.content} (similarity: ${m.similarity?.toFixed(3) || 'N/A'})`,
      );
      if (m.outgoingEdges.length > 0) {
        console.log(`        연결된 메모리: ${m.outgoingEdges.join(', ')}`);
      }
    });
    console.log(`   Graph 메모리: ${result3.graphMemories.length}개`);
    result3.graphMemories.forEach((m, i) => {
      console.log(`     ${i + 1}. ${m.content}`);
      if (m.outgoingEdges.length > 0) {
        console.log(`        연결된 메모리: ${m.outgoingEdges.join(', ')}`);
      }
    });
    console.log();

    // 테스트 4: Edge case - 관련 Memory가 없는 경우
    console.log('📊 테스트 4: Edge case - 관련 Memory가 없는 경우');
    const query4 = '완전히 다른 주제의 질문';
    const result4 = await generator.collectAugmentation(query4, entityId);
    console.log(`   쿼리: "${query4}"`);
    console.log(`   Vector 메모리: ${result4.vectorMemories.length}개`);
    console.log(`   Graph 메모리: ${result4.graphMemories.length}개`);
    console.log();

    // 테스트 5: limit 옵션 적용
    console.log('📊 테스트 5: limit 옵션 적용');
    const query5 = '강남';
    const result5 = await generator.collectAugmentation(query5, entityId, { limit: 2 });
    console.log(`   쿼리: "${query5}"`);
    console.log(`   limit: 2`);
    console.log(`   Vector 메모리: ${result5.vectorMemories.length}개 (limit 적용)`);
    console.log(
      `   Graph 메모리: ${result5.graphMemories.length}개 (limit - vectorMemories.length 적용)`,
    );
    console.log(
      `   총 메모리: ${result5.vectorMemories.length + result5.graphMemories.length}개`,
    );
    console.log();

    // 테스트 6: maxDepth 옵션 적용
    console.log('📊 테스트 6: maxDepth 옵션 적용');
    const query6 = '강남';
    const result6 = await generator.collectAugmentation(query6, entityId, { maxDepth: 1 });
    console.log(`   쿼리: "${query6}"`);
    console.log(`   maxDepth: 1`);
    console.log(`   Vector 메모리: ${result6.vectorMemories.length}개`);
    console.log(`   Graph 메모리: ${result6.graphMemories.length}개`);
    console.log();

    // 7. 정리
    console.log('🧹 테스트 데이터 정리 중...');
    await storage.deleteMemory(memory1.id);
    await storage.deleteMemory(memory2.id);
    await storage.deleteMemory(memory3.id);
    await storage.deleteMemory(memory4.id);
    console.log('✅ 정리 완료\n');

    console.log('✅ 모든 테스트 완료!');
  } catch (error) {
    console.error('❌ 오류 발생:', error);
    throw error;
  } finally {
    await memory.close();
    console.log('🔌 연결 종료');
  }
}

// 실행
main().catch(error => {
  console.error('프로그램 실행 중 오류:', error);
  process.exit(1);
});
