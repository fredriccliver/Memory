/**
 * Memory Optimizer 테스트 예제
 *
 * 이 예제는 다음을 보여줍니다:
 * 1. MemoryOptimizer 인스턴스 생성
 * 2. compress: 관련 메모리 그룹을 압축 노드로 병합
 * 3. createShortcuts: 자주 탐색되는 경로에 직접 엣지 추가
 * 4. cleanupLinks: 의미적으로 약한 엣지 제거
 * 5. runOptimization: 3가지 전략 순차 실행
 * 6. Edge traversal 통계 기록/조회
 */

import { config } from 'dotenv';
config();

import { Memory, StorageType, OpenAIAdapter } from '../src/index';
import type { AfterResponseContextAdapter } from '../src/types';

// ============================================================================
// Mock LLM adapter - 실제 테스트에서는 OpenAI 등을 사용
// ============================================================================

/**
 * 테스트용 mock LLM adapter
 *
 * 실제 환경에서는 OpenAI GPT 등의 LLM을 사용합니다.
 * 이 mock은 미리 정의된 응답을 반환하여 optimizer의 동작을 검증합니다.
 */
function createMockAdapter(response: object): AfterResponseContextAdapter {
  return {
    async generate(_messages: Array<{ role: string; content: string }>): Promise<string> {
      return JSON.stringify(response);
    },
  };
}

async function main() {
  console.log('🚀 Memory Optimizer 테스트 시작\n');

  const memory = new Memory();
  const entityId = 'optimizer-test-entity';

  try {
    // AI Adapter 설정
    const aiAdapter = new OpenAIAdapter({
      apiKey: process.env.OPENAI_API_KEY!,
    });

    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY 환경 변수가 설정되지 않았습니다.');
    }

    // Memory Storage 초기화
    console.log('📦 Memory Storage 초기화 중...');
    await memory.initialize(
      {
        type: StorageType.POSTGRES,
        connectionString:
          process.env.MEMORY_DATABASE_URL ||
          'postgresql://postgres:postgres@localhost:54332/postgres',
        schema: 'memory',
      },
      { aiAdapter },
    );
    console.log('✅ Memory Storage 초기화 완료\n');

    const storage = memory.getStorage();

    // ========================================================================
    // 시나리오 1: Compress 테스트
    // ========================================================================
    console.log('━'.repeat(60));
    console.log('📦 시나리오 1: Compress 테스트');
    console.log('━'.repeat(60));

    // 테스트 메모리 생성
    const m1 = await storage.createMemory({
      entityId,
      content: '서울 강남구에 살고 있어',
      outgoingEdges: [],
    });
    const m2 = await storage.createMemory({
      entityId,
      content: '네이버에서 소프트웨어 엔지니어로 일하고 있어',
      outgoingEdges: [],
    });
    const m3 = await storage.createMemory({
      entityId,
      content: '주말에 등산을 즐겨',
      outgoingEdges: [],
    });

    // 엣지 연결
    await storage.updateOutgoingEdges(m1.id, [m2.id]);
    await storage.updateOutgoingEdges(m2.id, [m3.id]);

    console.log(`생성된 메모리: ${m1.id}, ${m2.id}, ${m3.id}`);

    // Optimizer 생성
    const optimizer = memory.createOptimizer();

    // Mock: m1, m2를 압축하라는 응답
    const compressAdapter = createMockAdapter({
      operations: [
        {
          action: 'compress',
          sourceMemoryIds: [m1.id, m2.id],
          compressedContent: '서울 강남구에 살고 있으며 네이버에서 소프트웨어 엔지니어로 일하고 있다',
          linkTo: [m3.id],
        },
      ],
    });

    const compressResult = await optimizer.compress(entityId, {
      contextAdapter: compressAdapter,
      verbose: true,
    });

    console.log('\n📊 Compress 결과:');
    console.log(`  성공: ${compressResult.success}`);
    console.log(`  생성된 압축 노드: ${compressResult.compressedNodesCreated}`);
    console.log(`  소요 시간: ${compressResult.durationMs}ms`);

    if (compressResult.createdMemories.length > 0) {
      const compressed = compressResult.createdMemories[0];
      console.log(`  압축 노드 ID: ${compressed.id}`);
      console.log(`  압축 내용: ${compressed.content}`);

      // 압축 노드의 엣지 확인
      const refreshed = await storage.getMemory(compressed.id);
      console.log(`  압축 노드 outgoingEdges: [${refreshed?.outgoingEdges.join(', ')}]`);
    }

    // 원본 보존 확인
    const original1 = await storage.getMemory(m1.id);
    const original2 = await storage.getMemory(m2.id);
    console.log(`  원본 보존: m1=${!!original1}, m2=${!!original2}`);

    // ========================================================================
    // 시나리오 2: CreateShortcuts 테스트
    // ========================================================================
    console.log('\n' + '━'.repeat(60));
    console.log('🔗 시나리오 2: CreateShortcuts 테스트');
    console.log('━'.repeat(60));

    // Edge traversal 통계 기록 (m1 → m2 → m3 경로가 자주 탐색됨을 시뮬레이션)
    await storage.recordEdgeTraversals(entityId, [
      { from: m1.id, to: m2.id },
      { from: m2.id, to: m3.id },
    ]);
    // 여러 번 기록하여 높은 traversal count 생성
    await storage.recordEdgeTraversals(entityId, [
      { from: m1.id, to: m2.id },
      { from: m2.id, to: m3.id },
    ]);
    await storage.recordEdgeTraversals(entityId, [
      { from: m1.id, to: m2.id },
      { from: m2.id, to: m3.id },
    ]);

    // 통계 확인
    const stats = await storage.getEdgeTraversalStats(entityId);
    console.log('\n📈 Edge Traversal 통계:');
    for (const stat of stats) {
      console.log(
        `  ${stat.fromMemoryId} → ${stat.toMemoryId}: ${stat.traversalCount}회`,
      );
    }

    // Mock: m1 → m3 직접 연결 추가 (자주 탐색되는 m1→m2→m3 경로에 shortcut)
    const shortcutAdapter = createMockAdapter({
      operations: [{ action: 'addEdge', fromMemoryId: m1.id, toMemoryId: m3.id }],
    });

    const shortcutResult = await optimizer.createShortcuts(entityId, {
      contextAdapter: shortcutAdapter,
      verbose: true,
    });

    console.log('\n📊 Shortcut 결과:');
    console.log(`  성공: ${shortcutResult.success}`);
    console.log(`  추가된 shortcut: ${shortcutResult.shortcutsCreated}`);
    console.log(`  소요 시간: ${shortcutResult.durationMs}ms`);

    // Shortcut 확인
    const m1After = await storage.getMemory(m1.id);
    console.log(`  m1 outgoingEdges: [${m1After?.outgoingEdges.join(', ')}]`);
    console.log(`  m3 포함 여부: ${m1After?.outgoingEdges.includes(m3.id)}`);

    // ========================================================================
    // 시나리오 3: CleanupLinks 테스트
    // ========================================================================
    console.log('\n' + '━'.repeat(60));
    console.log('🧹 시나리오 3: CleanupLinks 테스트');
    console.log('━'.repeat(60));

    // Mock: m2 → m3 엣지를 제거하라는 응답 (m1→m3 shortcut이 있으므로 불필요)
    const cleanupAdapter = createMockAdapter({
      operations: [{ action: 'removeEdge', fromMemoryId: m2.id, toMemoryId: m3.id }],
    });

    const cleanupResult = await optimizer.cleanupLinks(entityId, {
      contextAdapter: cleanupAdapter,
      verbose: true,
    });

    console.log('\n📊 Cleanup 결과:');
    console.log(`  성공: ${cleanupResult.success}`);
    console.log(`  제거된 엣지: ${cleanupResult.linksRemoved}`);
    console.log(`  추가된 대체 엣지: ${cleanupResult.linksAdded}`);
    console.log(`  소요 시간: ${cleanupResult.durationMs}ms`);

    // 정리 결과 확인
    const m2After = await storage.getMemory(m2.id);
    console.log(`  m2 outgoingEdges: [${m2After?.outgoingEdges.join(', ')}]`);
    console.log(`  m3 포함 여부: ${m2After?.outgoingEdges.includes(m3.id)}`);

    // ========================================================================
    // 시나리오 4: runOptimization 통합 테스트
    // ========================================================================
    console.log('\n' + '━'.repeat(60));
    console.log('⚡ 시나리오 4: runOptimization 통합 테스트');
    console.log('━'.repeat(60));

    // 전체 최적화 실행 (cleanup → compress → shortcut 순서)
    // 아무 작업도 하지 않는 mock (이미 위에서 최적화 수행)
    const noopAdapter = createMockAdapter({ operations: [] });

    const fullResult = await optimizer.runOptimization(entityId, {
      scope: 'all',
      contextAdapter: noopAdapter,
      verbose: true,
    });

    console.log('\n📊 runOptimization 결과:');
    console.log(`  압축 노드 생성: ${fullResult.compressedNodesCreated}`);
    console.log(`  Shortcut 추가: ${fullResult.shortcutsCreated}`);
    console.log(`  엣지 제거: ${fullResult.linksRemoved}`);
    console.log(`  소요 시간: ${fullResult.durationMs}ms`);

    // ========================================================================
    // 정리
    // ========================================================================
    console.log('\n' + '━'.repeat(60));
    console.log('🧹 테스트 데이터 정리 중...');
    console.log('━'.repeat(60));

    // 생성된 모든 메모리 삭제
    const allMemories = await storage.getMemoriesByEntity(entityId);
    for (const mem of allMemories) {
      await storage.deleteMemory(mem.id);
    }
    console.log(`✅ ${allMemories.length}개 메모리 삭제 완료\n`);

    console.log('✅ 모든 Optimizer 테스트 완료!');
  } catch (error) {
    console.error('❌ 오류 발생:', error);
    throw error;
  } finally {
    await memory.close();
    console.log('🔌 연결 종료');
  }
}

main().catch(error => {
  console.error('프로그램 실행 중 오류:', error);
  process.exit(1);
});
