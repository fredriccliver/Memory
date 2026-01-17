/**
 * MemoryToolHandler 테스트
 *
 * 이 예제는 다음을 보여줍니다:
 * 1. MemoryToolHandler 초기화
 * 2. handleCreateMemory() 테스트
 * 3. handleUpdateMemory() 테스트
 * 4. handleUpdateMemoryLink() 테스트
 * 5. handleDeleteMemory() 테스트
 * 6. 에러 케이스 테스트
 */

// 환경 변수 로드
import { config } from 'dotenv';
config();

import { Memory, StorageType, OpenAIAdapter, MemoryToolHandler } from '../src/index';

async function main() {
  console.log('🚀 MemoryToolHandler 테스트 시작\n');

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
    const entityId = 'test-entity-tool-handler';

    // 3. MemoryToolHandler 초기화
    console.log('🔧 MemoryToolHandler 초기화 중...');
    const toolHandler = new MemoryToolHandler(storage);
    console.log('✅ MemoryToolHandler 초기화 완료\n');

    // 4. handleCreateMemory() 테스트
    console.log('📝 테스트 1: handleCreateMemory() - 기본 생성');
    const createResult1 = await toolHandler.handleCreateMemory({
      content: '나는 서울에 살고 있어요.',
      entityId,
    });

    if (!createResult1.success || !createResult1.data) {
      console.error('❌ Memory 생성 실패:', createResult1.error);
      return;
    }

    const memory1 = createResult1.data;
    console.log('✅ Memory 생성 성공:');
    console.log(`   ID: ${memory1.id}`);
    console.log(`   Content: ${memory1.content}`);
    console.log(`   Entity ID: ${memory1.entityId}`);
    console.log(`   Embedding 생성됨: ${memory1.embedding ? 'Yes' : 'No'}`);
    console.log(`   Outgoing Edges: ${memory1.outgoingEdges.length}\n`);

    // 5. handleCreateMemory() 테스트 - 관련 Memory와 연결
    console.log('📝 테스트 2: handleCreateMemory() - 관련 Memory와 연결');
    const createResult2 = await toolHandler.handleCreateMemory({
      content: '서울에서 판교까지 지하철로 1시간 걸려요.',
      entityId,
      relatedMemoryIds: [memory1.id],
    });

    if (!createResult2.success || !createResult2.data) {
      console.error('❌ Memory 생성 실패:', createResult2.error);
      return;
    }

    const memory2 = createResult2.data;
    console.log('✅ Memory 생성 및 연결 성공:');
    console.log(`   ID: ${memory2.id}`);
    console.log(`   Content: ${memory2.content}`);
    console.log(`   Outgoing Edges: ${memory2.outgoingEdges.join(', ')}`);

    // 연결 확인 (bidirectional)
    const updatedMemory1 = await storage.getMemory(memory1.id);
    if (updatedMemory1) {
      console.log(`   Memory1의 Outgoing Edges (bidirectional): ${updatedMemory1.outgoingEdges.join(', ')}`);
    }
    console.log();

    // 6. handleUpdateMemory() 테스트
    console.log('📝 테스트 3: handleUpdateMemory()');
    const updateResult = await toolHandler.handleUpdateMemory({
      memoryId: memory1.id,
      content: '나는 서울 강남구에 살고 있어요.',
    });

    if (!updateResult.success || !updateResult.data) {
      console.error('❌ Memory 업데이트 실패:', updateResult.error);
      return;
    }

    const updatedMemory = updateResult.data;
    console.log('✅ Memory 업데이트 성공:');
    console.log(`   ID: ${updatedMemory.id}`);
    console.log(`   Content: ${updatedMemory.content}`);
    console.log(`   Embedding 재생성됨: ${updatedMemory.embedding ? 'Yes' : 'No'}`);
    console.log();

    // 7. handleUpdateMemoryLink() 테스트 - 추가
    console.log('📝 테스트 4: handleUpdateMemoryLink() - 연결 추가');
    const createResult3 = await toolHandler.handleCreateMemory({
      content: '나는 주로 지하철을 이용해요.',
      entityId,
    });

    if (!createResult3.success || !createResult3.data) {
      console.error('❌ Memory 생성 실패:', createResult3.error);
      return;
    }

    const memory3 = createResult3.data;
    const linkAddResult = await toolHandler.handleUpdateMemoryLink({
      fromMemoryId: memory2.id,
      toMemoryId: memory3.id,
      action: 'add',
    });

    if (!linkAddResult.success || !linkAddResult.data) {
      console.error('❌ Memory 연결 추가 실패:', linkAddResult.error);
      return;
    }

    console.log('✅ Memory 연결 추가 성공:');
    console.log(`   From: ${memory2.id}`);
    console.log(`   To: ${memory3.id}`);
    console.log(`   Outgoing Edges: ${linkAddResult.data.outgoingEdges.join(', ')}`);
    console.log();

    // 8. handleUpdateMemoryLink() 테스트 - 제거
    console.log('📝 테스트 5: handleUpdateMemoryLink() - 연결 제거');
    const linkRemoveResult = await toolHandler.handleUpdateMemoryLink({
      fromMemoryId: memory2.id,
      toMemoryId: memory3.id,
      action: 'remove',
    });

    if (!linkRemoveResult.success || !linkRemoveResult.data) {
      console.error('❌ Memory 연결 제거 실패:', linkRemoveResult.error);
      return;
    }

    console.log('✅ Memory 연결 제거 성공:');
    console.log(`   From: ${memory2.id}`);
    console.log(`   To: ${memory3.id}`);
    console.log(`   Outgoing Edges: ${linkRemoveResult.data.outgoingEdges.join(', ')}`);
    console.log();

    // 9. 에러 케이스 테스트
    console.log('📝 테스트 6: 에러 케이스 테스트');

    // 존재하지 않는 Memory 업데이트
    const errorResult1 = await toolHandler.handleUpdateMemory({
      memoryId: 'non-existent-id',
      content: '테스트',
    });
    console.log(`   존재하지 않는 Memory 업데이트: ${errorResult1.success ? '❌' : '✅'} (예상: 실패)`);
    if (!errorResult1.success) {
      console.log(`   에러 메시지: ${errorResult1.error}`);
    }

    // 빈 content로 생성 시도
    const errorResult2 = await toolHandler.handleCreateMemory({
      content: '',
      entityId,
    });
    console.log(`   빈 content로 생성: ${errorResult2.success ? '❌' : '✅'} (예상: 실패)`);
    if (!errorResult2.success) {
      console.log(`   에러 메시지: ${errorResult2.error}`);
    }

    // 자기 자신과 연결 시도
    const errorResult3 = await toolHandler.handleUpdateMemoryLink({
      fromMemoryId: memory1.id,
      toMemoryId: memory1.id,
      action: 'add',
    });
    console.log(`   자기 자신과 연결: ${errorResult3.success ? '❌' : '✅'} (예상: 실패)`);
    if (!errorResult3.success) {
      console.log(`   에러 메시지: ${errorResult3.error}`);
    }

    // 존재하지 않는 Memory 연결 시도
    const errorResult4 = await toolHandler.handleUpdateMemoryLink({
      fromMemoryId: 'non-existent-id-1',
      toMemoryId: 'non-existent-id-2',
      action: 'add',
    });
    console.log(`   존재하지 않는 Memory 연결: ${errorResult4.success ? '❌' : '✅'} (예상: 실패)`);
    if (!errorResult4.success) {
      console.log(`   에러 메시지: ${errorResult4.error}`);
    }

    // 빈 relatedMemoryIds 배열 테스트 (Edge case)
    console.log('📝 테스트 6-1: handleCreateMemory() - 빈 relatedMemoryIds 배열');
    const createResult4 = await toolHandler.handleCreateMemory({
      content: '빈 배열 테스트용 Memory입니다.',
      entityId,
      relatedMemoryIds: [],
    });
    if (!createResult4.success || !createResult4.data) {
      console.error('❌ Memory 생성 실패:', createResult4.error);
    } else {
      console.log('✅ 빈 relatedMemoryIds 배열로 생성 성공');
      console.log(`   ID: ${createResult4.data.id}`);
      console.log(`   Outgoing Edges: ${createResult4.data.outgoingEdges.length}`);
      // 정리
      await storage.deleteMemory(createResult4.data.id);
    }
    console.log();

    // 순환 참조 생성 시도 (Edge case)
    console.log('📝 테스트 6-2: handleUpdateMemoryLink() - 순환 참조 생성 시도');
    // memory1 -> memory2 연결이 이미 있으므로, memory2 -> memory1 연결을 추가하면 순환 참조
    // 하지만 현재 구현은 순환 참조를 허용하므로, 이것은 정상 동작으로 처리됨
    const circularLinkResult = await toolHandler.handleUpdateMemoryLink({
      fromMemoryId: memory2.id,
      toMemoryId: memory1.id,
      action: 'add',
    });
    if (circularLinkResult.success && circularLinkResult.data) {
      console.log('✅ 순환 참조 생성 성공 (현재 구현은 순환 참조 허용):');
      console.log(`   From: ${memory2.id} -> To: ${memory1.id}`);
      console.log(`   Outgoing Edges: ${circularLinkResult.data.outgoingEdges.join(', ')}`);
      // 순환 참조 제거 (테스트 정리를 위해)
      await toolHandler.handleUpdateMemoryLink({
        fromMemoryId: memory2.id,
        toMemoryId: memory1.id,
        action: 'remove',
      });
    } else {
      console.log(`   순환 참조 생성: ${circularLinkResult.success ? '✅' : '❌'}`);
      if (!circularLinkResult.success) {
        console.log(`   에러 메시지: ${circularLinkResult.error}`);
      }
    }
    console.log();

    // 10. handleDeleteMemory() 테스트 - 연결된 Memory가 있는 경우
    console.log('📝 테스트 7: handleDeleteMemory() - 연결된 Memory가 있는 경우');
    
    // memory3를 다시 생성하고 memory2와 연결
    const createResult5 = await toolHandler.handleCreateMemory({
      content: '삭제 테스트용 Memory입니다.',
      entityId,
    });
    if (!createResult5.success || !createResult5.data) {
      console.error('❌ Memory 생성 실패:', createResult5.error);
      return;
    }
    const memory3ForDelete = createResult5.data;
    
    // memory2와 memory3ForDelete 연결
    await toolHandler.handleUpdateMemoryLink({
      fromMemoryId: memory2.id,
      toMemoryId: memory3ForDelete.id,
      action: 'add',
    });
    
    // memory1과도 연결 (여러 연결 테스트)
    await toolHandler.handleUpdateMemoryLink({
      fromMemoryId: memory1.id,
      toMemoryId: memory3ForDelete.id,
      action: 'add',
    });

    console.log(`   삭제 전 연결 상태:`);
    const memory2BeforeDelete = await storage.getMemory(memory2.id);
    const memory1BeforeDelete = await storage.getMemory(memory1.id);
    if (memory2BeforeDelete) {
      console.log(`   Memory2의 Outgoing Edges: ${memory2BeforeDelete.outgoingEdges.join(', ')}`);
    }
    if (memory1BeforeDelete) {
      console.log(`   Memory1의 Outgoing Edges: ${memory1BeforeDelete.outgoingEdges.join(', ')}`);
    }

    const deleteResult = await toolHandler.handleDeleteMemory({
      memoryId: memory3ForDelete.id,
    });

    if (!deleteResult.success) {
      console.error('❌ Memory 삭제 실패:', deleteResult.error);
      return;
    }

    console.log('✅ Memory 삭제 성공:');
    console.log(`   삭제된 Memory ID: ${memory3ForDelete.id}`);

    // 삭제 확인
    const deletedMemory = await storage.getMemory(memory3ForDelete.id);
    console.log(`   삭제 확인: ${deletedMemory ? '❌ (여전히 존재)' : '✅ (삭제됨)'}`);

    // 연결 정리 확인 (memory2와 memory1의 outgoingEdges에서 memory3ForDelete 제거되었는지)
    const memory2AfterDelete = await storage.getMemory(memory2.id);
    const memory1AfterDelete = await storage.getMemory(memory1.id);
    if (memory2AfterDelete) {
      const hasLink2 = memory2AfterDelete.outgoingEdges.includes(memory3ForDelete.id);
      console.log(`   Memory2 연결 정리 확인: ${hasLink2 ? '❌ (연결이 남아있음)' : '✅ (연결이 정리됨)'}`);
      console.log(`   Memory2의 Outgoing Edges: ${memory2AfterDelete.outgoingEdges.join(', ')}`);
    }
    if (memory1AfterDelete) {
      const hasLink1 = memory1AfterDelete.outgoingEdges.includes(memory3ForDelete.id);
      console.log(`   Memory1 연결 정리 확인: ${hasLink1 ? '❌ (연결이 남아있음)' : '✅ (연결이 정리됨)'}`);
      console.log(`   Memory1의 Outgoing Edges: ${memory1AfterDelete.outgoingEdges.join(', ')}`);
    }
    console.log();

    console.log('🎉 모든 테스트 완료!\n');

    // 정리: 테스트 데이터 삭제
    console.log('🧹 테스트 데이터 정리 중...');
    await storage.deleteMemory(memory1.id);
    await storage.deleteMemory(memory2.id);
    console.log('✅ 테스트 데이터 정리 완료');
  } catch (error) {
    console.error('❌ 테스트 중 오류 발생:', error);
    if (error instanceof Error) {
      console.error('   메시지:', error.message);
      console.error('   스택:', error.stack);
    }
    process.exit(1);
  } finally {
    // 데이터베이스 연결 종료
    await memory.close();
    console.log('🔌 데이터베이스 연결 종료');
  }
}

main();
