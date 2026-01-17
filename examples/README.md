# Memory Package Examples

이 디렉토리에는 `@openaikits/memory` 패키지의 사용 예제가 포함되어 있습니다.

## 예제 목록

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
# 기본 사용 예제
npx tsx examples/01-basic-usage.ts

# LangChain 샘플
npx tsx examples/02-langchain-sample.ts

# DynamicMemoryGenerator 테스트
npx tsx examples/03-generator-test.ts
```

## 의존성

예제 실행을 위해 다음 패키지가 필요합니다:

```bash
# 개발 의존성
pnpm add -D tsx

# LangChain 라이브러리 (02-langchain-sample.ts에 필요)
pnpm add @langchain/core @langchain/openai
```

**참고**: `01-basic-usage.ts`는 LangChain 없이도 실행 가능합니다.
