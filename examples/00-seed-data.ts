/**
 * Seed Data for Memory Package Testing
 *
 * 이 파일은 테스트에 사용할 seed 메모리 데이터를 생성합니다.
 * 다양한 시나리오와 Graph 구조를 포함하여 다음을 테스트할 수 있습니다:
 * 1. Vector 검색 (다양한 주제와 컨텍스트)
 * 2. Graph 탐색 (다양한 depth와 연결 구조)
 * 3. DynamicMemoryGenerator의 collectAugmentation
 * 4. 다양한 entity_id별 데이터 분리
 *
 * 실행 방법:
 *   npx tsx examples/00-seed-data.ts
 */

// 환경 변수 로드
import { config } from 'dotenv';
config();

import { Memory, StorageType, OpenAIAdapter } from '../src/index';

/**
 * Seed 데이터 구조 정의
 */
interface SeedMemory {
  content: string;
  outgoingEdges?: number[]; // content를 기준으로 연결할 메모리들의 인덱스
}

interface SeedEntity {
  entityId: string;
  description: string;
  memories: SeedMemory[];
}

/**
 * Seed 데이터 정의
 */
const seedData: SeedEntity[] = [
  {
    entityId: 'persona-001-software-engineer',
    description: '소프트웨어 엔지니어 페르소나',
    memories: [
      // 기본 정보
      {
        content: '서울 강남구에 살고 있어',
        outgoingEdges: [1, 2], // 직장, 취미와 연결
      },
      {
        content: '네이버에서 소프트웨어 엔지니어로 일하고 있어',
        outgoingEdges: [2, 3], // 출퇴근, 프로젝트와 연결
      },
      {
        content: '강남에서 판교 네이버까지 출퇴근하는데 한 시간 걸려',
        outgoingEdges: [3, 4], // 프로젝트, 주말 활동과 연결
      },
      {
        content: '주말에는 강남에서 카페에서 코딩을 해',
        outgoingEdges: [5, 6], // 취미, 기술 스택과 연결
      },
      {
        content: 'TypeScript와 React를 주로 사용해',
        outgoingEdges: [6, 7], // 프로젝트, 학습과 연결
      },
      {
        content: '현재 마이크로서비스 아키텍처 프로젝트를 진행 중이야',
        outgoingEdges: [7, 8], // 학습, 동료와 연결
      },
      {
        content: '최근에 GraphQL을 학습하고 있어',
        outgoingEdges: [8, 9], // 동료, 회사 문화와 연결
      },
      {
        content: '팀 동료들과 코드 리뷰를 자주 해',
        outgoingEdges: [9, 10], // 회사 문화, 성장과 연결
      },
      {
        content: '네이버는 수평적 조직 문화를 가지고 있어',
        outgoingEdges: [10, 11], // 성장, 목표와 연결
      },
      {
        content: '개발자로서 지속적인 성장을 추구해',
        outgoingEdges: [11, 12], // 목표, 기술 커뮤니티와 연결
      },
      {
        content: '내년에는 시니어 엔지니어로 성장하는 것이 목표야',
        outgoingEdges: [12, 13], // 기술 커뮤니티, 개인 프로젝트와 연결
      },
      {
        content: '개발자 커뮤니티에서 활동하고 있어',
        outgoingEdges: [13, 14], // 개인 프로젝트, 여가와 연결
      },
      {
        content: '사이드 프로젝트로 오픈소스 라이브러리를 만들고 있어',
        outgoingEdges: [14], // 여가와 연결
      },
      {
        content: '여가 시간에는 독서와 영화 감상을 좋아해',
        outgoingEdges: [], // 종단 노드
      },
    ],
  },
  {
    entityId: 'persona-002-student',
    description: '대학생 페르소나',
    memories: [
      // 기본 정보
      {
        content: '서울대학교 컴퓨터공학부에 재학 중이야',
        outgoingEdges: [1, 2], // 전공, 동아리와 연결
      },
      {
        content: '인공지능과 머신러닝에 관심이 많아',
        outgoingEdges: [2, 3], // 동아리, 연구와 연결
      },
      {
        content: 'AI 동아리에서 활동하고 있어',
        outgoingEdges: [3, 4], // 연구, 프로젝트와 연결
      },
      {
        content: '교수님과 함께 자연어 처리 연구를 하고 있어',
        outgoingEdges: [4, 5], // 프로젝트, 학습과 연결
      },
      {
        content: 'PyTorch를 사용해서 모델을 구현해봤어',
        outgoingEdges: [5, 6], // 학습, 목표와 연결
      },
      {
        content: '졸업 후에는 대학원에 진학하고 싶어',
        outgoingEdges: [6, 7], // 목표, 취업과 연결
      },
      {
        content: '인턴십으로 네이버에서 3개월 일했어',
        outgoingEdges: [7, 8], // 취업, 경험과 연결
      },
      {
        content: '실무 경험을 통해 이론과 실전의 차이를 느꼈어',
        outgoingEdges: [8, 9], // 경험, 취미와 연결
      },
      {
        content: '주말에는 친구들과 함께 운동을 해',
        outgoingEdges: [9], // 취미와 연결
      },
    ],
  },
  {
    entityId: 'persona-003-designer',
    description: '디자이너 페르소나',
    memories: [
      // 기본 정보
      {
        content: '서울 마포구에 살고 있어',
        outgoingEdges: [1, 2], // 직장, 취미와 연결
      },
      {
        content: '카카오에서 UX 디자이너로 일하고 있어',
        outgoingEdges: [2, 3], // 취미, 프로젝트와 연결
      },
      {
        content: '사용자 경험 개선에 관심이 많아',
        outgoingEdges: [3, 4], // 프로젝트, 도구와 연결
      },
      {
        content: 'Figma를 주로 사용해서 디자인해',
        outgoingEdges: [4, 5], // 도구, 스타일과 연결
      },
      {
        content: '미니멀하고 깔끔한 디자인을 선호해',
        outgoingEdges: [5, 6], // 스타일, 학습과 연결
      },
      {
        content: '최근에 프로토타이핑 도구를 학습 중이야',
        outgoingEdges: [6, 7], // 학습, 목표와 연결
      },
      {
        content: '내년에는 디자인 리더로 성장하고 싶어',
        outgoingEdges: [7, 8], // 목표, 취미와 연결
      },
      {
        content: '여가 시간에는 전시회를 보러 다녀',
        outgoingEdges: [], // 종단 노드
      },
    ],
  },
  {
    entityId: 'persona-004-entrepreneur',
    description: '창업가 페르소나',
    memories: [
      // 기본 정보
      {
        content: '서울 송파구에 살고 있어',
        outgoingEdges: [1, 2], // 회사, 팀과 연결
      },
      {
        content: '스타트업을 창업해서 CEO로 일하고 있어',
        outgoingEdges: [2, 3], // 팀, 제품과 연결
      },
      {
        content: '5명의 팀원들과 함께 일하고 있어',
        outgoingEdges: [3, 4], // 제품, 투자와 연결
      },
      {
        content: 'AI 기반 SaaS 제품을 개발하고 있어',
        outgoingEdges: [4, 5], // 투자, 고객과 연결
      },
      {
        content: '시드 투자를 받아서 운영 중이야',
        outgoingEdges: [5, 6], // 고객, 목표와 연결
      },
      {
        content: '현재 50개 기업 고객을 확보했어',
        outgoingEdges: [6, 7], // 목표, 도전과 연결
      },
      {
        content: '내년에는 시리즈 A 투자를 목표로 하고 있어',
        outgoingEdges: [7, 8], // 도전, 취미와 연결
      },
      {
        content: '창업의 어려움을 겪고 있지만 보람을 느껴',
        outgoingEdges: [8], // 취미와 연결
      },
      {
        content: '스트레스 해소를 위해 요가를 해',
        outgoingEdges: [], // 종단 노드
      },
    ],
  },
  {
    entityId: 'test-entity-generator',
    description: 'DynamicMemoryGenerator 테스트용 엔티티',
    memories: [
      // 기본 정보 (기존 테스트와 호환성 유지)
      {
        content: '서울 강남구에 살고 있어',
        outgoingEdges: [1, 3], // 직장, 주말 활동과 연결
      },
      {
        content: '네이버에서 소프트웨어 엔지니어로 일하고 있어',
        outgoingEdges: [2, 3], // 출퇴근, 주말 활동과 연결
      },
      {
        content: '강남에서 판교 네이버까지 출퇴근하는데 한 시간 걸려',
        outgoingEdges: [3], // 주말 활동과 연결
      },
      {
        content: '주말에는 강남에서 카페에서 코딩을 해',
        outgoingEdges: [], // 종단 노드
      },
      // 추가 테스트 데이터
      {
        content: 'Python과 Django를 사용해서 백엔드를 개발해',
        outgoingEdges: [5, 6], // 프로젝트, 학습과 연결
      },
      {
        content: '최근에 FastAPI를 학습하고 있어',
        outgoingEdges: [6, 7], // 학습, 동료와 연결
      },
      {
        content: '팀 동료들과 스프린트 회의를 매주 해',
        outgoingEdges: [7, 8], // 동료, 회사 문화와 연결
      },
      {
        content: '네이버는 자율 출퇴근제를 운영해',
        outgoingEdges: [8], // 회사 문화와 연결
      },
    ],
  },
];

/**
 * Seed 데이터를 데이터베이스에 삽입
 */
async function seedMemories() {
  console.log('🌱 Seed 데이터 생성 시작\n');

  const memory = new Memory();

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
      {
        aiAdapter,
      },
    );
    console.log('✅ Memory Storage 초기화 완료\n');

    const storage = memory.getStorage();

    // 각 엔티티별로 메모리 생성
    for (const entity of seedData) {
      console.log(`📝 ${entity.description} (${entity.entityId}) 메모리 생성 중...`);

      // 먼저 모든 메모리를 생성 (outgoingEdges 없이)
      const createdMemories: string[] = [];
      for (const seedMemory of entity.memories) {
        const memory = await storage.createMemory({
          entityId: entity.entityId,
          content: seedMemory.content,
          outgoingEdges: [],
        });
        createdMemories.push(memory.id);
        console.log(`   ✓ ${seedMemory.content}`);
      }

      // 그 다음 outgoingEdges 연결
      console.log(`   🔗 메모리 연결 중...`);
      for (let i = 0; i < entity.memories.length; i++) {
        const seedMemory = entity.memories[i];
        if (seedMemory.outgoingEdges && seedMemory.outgoingEdges.length > 0) {
          const outgoingEdgeIds = seedMemory.outgoingEdges.map(
            (idx: number) => createdMemories[idx],
          );
          await storage.updateOutgoingEdges(createdMemories[i], outgoingEdgeIds);
          console.log(
            `   ✓ 메모리 ${i + 1} -> [${seedMemory.outgoingEdges.map((idx: number) => idx + 1).join(', ')}]`,
          );
        }
      }

      console.log(`✅ ${entity.entityId} 완료 (${createdMemories.length}개 메모리)\n`);
    }

    // 통계 출력
    console.log('📊 Seed 데이터 통계:');
    for (const entity of seedData) {
      const memories = await storage.getMemoriesByEntity(entity.entityId);
      const totalEdges = memories.reduce((sum, m) => sum + m.outgoingEdges.length, 0);
      console.log(
        `   ${entity.entityId}: ${memories.length}개 메모리, ${totalEdges}개 연결`,
      );
    }
    console.log();

    console.log('✅ Seed 데이터 생성 완료!');
    console.log('\n💡 팁:');
    console.log('   - 테스트를 실행하기 전에 이 seed 데이터를 사용할 수 있습니다.');
    console.log('   - seed 데이터를 삭제하려면 examples/00-clear-seed-data.ts를 실행하세요.');
  } catch (error) {
    console.error('❌ 오류 발생:', error);
    throw error;
  } finally {
    await memory.close();
    console.log('🔌 연결 종료');
  }
}

// 실행
seedMemories().catch(error => {
  console.error('프로그램 실행 중 오류:', error);
  process.exit(1);
});
