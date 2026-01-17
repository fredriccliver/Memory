/**
 * Clear Seed Data
 *
 * Seed 데이터를 삭제하는 유틸리티 스크립트
 *
 * 실행 방법:
 *   npx tsx examples/01-clear-seed-data.ts
 */

// 환경 변수 로드
import { config } from 'dotenv';
config();

import { Memory, StorageType } from '../src/index';

/**
 * Seed 데이터 삭제
 */
async function clearSeedData() {
  console.log('🧹 Seed 데이터 삭제 시작\n');

  const memory = new Memory();

  try {
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
    );
    console.log('✅ Memory Storage 초기화 완료\n');

    const storage = memory.getStorage();

    // 삭제할 entity ID 목록
    const entityIds = [
      'persona-001-software-engineer',
      'persona-002-student',
      'persona-003-designer',
      'persona-004-entrepreneur',
      'test-entity-generator',
    ];

    // 각 엔티티별로 메모리 삭제
    for (const entityId of entityIds) {
      console.log(`🗑️  ${entityId} 메모리 삭제 중...`);
      const memories = await storage.getMemoriesByEntity(entityId);
      
      for (const m of memories) {
        await storage.deleteMemory(m.id);
      }
      
      console.log(`   ✓ ${memories.length}개 메모리 삭제 완료`);
    }

    console.log('\n✅ Seed 데이터 삭제 완료!');
  } catch (error) {
    console.error('❌ 오류 발생:', error);
    throw error;
  } finally {
    await memory.close();
    console.log('🔌 연결 종료');
  }
}

// 실행
clearSeedData().catch(error => {
  console.error('프로그램 실행 중 오류:', error);
  process.exit(1);
});
