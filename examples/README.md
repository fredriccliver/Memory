# Memory Package Examples

이 디렉토리에는 `@openaikits/memory` 패키지의 사용 예제가 포함되어 있습니다.

## 예제 목록

### 0. `00-seed-data.ts` - Seed 데이터 생성

테스트에 사용할 seed 메모리 데이터를 생성합니다. 다양한 시나리오와 Graph 구조를 포함하여 다음을 테스트할 수 있습니다:

- Vector 검색 (다양한 주제와 컨텍스트)
- Graph 탐색 (다양한 depth와 연결 구조)
- DynamicMemoryGenerator의 collectAugmentation
- 다양한 entity_id별 데이터 분리

**포함된 페르소나:**
- `persona-001-software-engineer`: 소프트웨어 엔지니어 (14개 메모리)
- `persona-002-student`: 대학생 (9개 메모리)
- `persona-003-designer`: 디자이너 (8개 메모리)
- `persona-004-entrepreneur`: 창업가 (9개 메모리)
- `test-entity-generator`: DynamicMemoryGenerator 테스트용 (8개 메모리)

### 1. `01-basic-usage.ts` - 가장 간단한 사용 예제

- Memory Storage 초기화
- Memory 생성 및 검색
- Embedding 자동 생성

### 2. `02-langchain-sample.ts` - LangChain 통합 샘플

- LangChain chain과 Memory Connector 연결
- 자동 Memory 검색 및 컨텍스트 구성
- 대화 시뮬레이션

### 3. `03-generator-test.ts` - DynamicMemoryGenerator 테스트

- DynamicMemoryGenerator 초기화
- collectAugmentation() 메서드 테스트
- Vector 검색 결과 수집
- Graph 탐색 결과 수집 (BFS)
- 기존 관계 수집
- Edge case 테스트

### 4. `04-tool-handler-test.ts` - MemoryToolHandler 테스트

- MemoryToolHandler 초기화
- handleCreateMemory() 테스트 (기본 생성, 관련 Memory 연결)
- handleUpdateMemory() 테스트 (내용 업데이트, embedding 재생성)
- handleUpdateMemoryLink() 테스트 (연결 추가/제거)
- handleDeleteMemory() 테스트 (Memory 삭제, 관련 연결 정리)
- 에러 케이스 테스트

### 5. `05-ai-tool-calling-integration-test.ts` - AI Tool Calling 통합 테스트

- AI가 실제로 tool calling을 통해 Memory를 관리하는지 검증
- 기존 seed data를 활용한 현실적인 시나리오 테스트
- Tool Handler가 AI의 tool call을 제대로 처리하는지 검증
- 전체 플로우가 의도한 대로 작동하는지 검증

**테스트 시나리오**:
- 시나리오 1: 새로운 정보 저장 (createMemory)
- 시나리오 2: 기존 정보 수정 (updateMemory)
- 시나리오 3: Memory 간 연결 (updateMemoryLink)
- 시나리오 4: 복합 시나리오 (여러 tool 사용)

**주의사항**:
- 기존 seed data를 보호하기 위해 새로운 테스트용 entity ID 사용
- 테스트 후 자동으로 테스트 데이터 정리

### 6. `00-clear-seed-data.ts` - Seed 데이터 삭제

Seed 데이터를 삭제하는 유틸리티 스크립트입니다.

## 실행 방법

### 사전 준비

1. 환경 변수 설정

패키지 루트 디렉토리(`packages/memory/`)에 `.env` 파일을 생성하세요:

```bash
# 패키지 루트 디렉토리로 이동
cd packages/memory

# 예제 디렉토리의 .env.example을 복사
cp examples/.env.example .env

# .env 파일을 편집하여 실제 값으로 업데이트
# OPENAI_API_KEY=your_actual_api_key
# MEMORY_DATABASE_URL=your_actual_database_url
```

또는 환경 변수를 직접 전달할 수 있습니다:

```bash
cd packages/memory
OPENAI_API_KEY=your_key MEMORY_DATABASE_URL=your_url npx tsx examples/01-basic-usage.ts
```

**참고**: 예제는 패키지 독립성을 위해 현재 작업 디렉토리(`packages/memory/`) 기준으로 `.env` 파일을 찾습니다. 프로젝트 루트의 `.env.local`을 직접 참조하지 않습니다.

2. Supabase 로컬 실행 (또는 프로덕션 DB 사용)

```bash
pnpm supabase:start
```

3. 패키지 빌드

```bash
cd packages/memory
pnpm build
```

### 예제 실행

```bash
# Seed 데이터 생성 (테스트 전에 먼저 실행 권장)
npx tsx examples/00-seed-data.ts

# 기본 사용 예제
npx tsx examples/01-basic-usage.ts

# LangChain 샘플
npx tsx examples/02-langchain-sample.ts

# DynamicMemoryGenerator 테스트
npx tsx examples/03-generator-test.ts

# MemoryToolHandler 테스트
npx tsx examples/04-tool-handler-test.ts

# AI Tool Calling 통합 테스트 (seed data 필요)
npx tsx examples/05-ai-tool-calling-integration-test.ts

# Seed 데이터 삭제
npx tsx examples/00-clear-seed-data.ts
```

**참고**: 
- `03-generator-test.ts`는 `test-entity-generator` entity를 사용하므로, seed 데이터를 생성한 후 실행하면 더 풍부한 테스트 결과를 얻을 수 있습니다.
- `05-ai-tool-calling-integration-test.ts`는 기존 seed data를 복사하여 사용하므로, seed 데이터를 먼저 생성해야 합니다. 테스트는 기존 seed data에 영향을 주지 않습니다.

## 의존성

예제 실행을 위해 다음 패키지가 필요합니다:

```bash
# 개발 의존성
pnpm add -D tsx

# LangChain 라이브러리 (02-langchain-sample.ts에 필요)
pnpm add @langchain/core @langchain/openai
```

**참고**: `01-basic-usage.ts`는 LangChain 없이도 실행 가능합니다.
