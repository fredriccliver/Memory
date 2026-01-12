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

## 실행 방법

### 사전 준비

1. 환경 변수 설정

패키지 루트 디렉토리(`packages/memory/`)에 `.env.local` 파일을 생성하세요:

```bash
# packages/memory/.env.local
MEMORY_DATABASE_URL=postgresql://postgres:postgres@localhost:54332/postgres
OPENAI_API_KEY=your_openai_api_key
```

또는 `.env.example` 파일을 복사하여 사용할 수 있습니다:

```bash
cd packages/memory
cp .env.example .env.local
# .env.local 파일을 편집하여 실제 값으로 업데이트
```

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
