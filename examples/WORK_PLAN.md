# Memory 패키지 작업 계획

## 목표

1. ✅ DB 세팅 확인 (PostgreSQL + pgvector)
2. ✅ Memory 패키지 가장 간단한 사용 예제 작성
3. 🔄 LangChain 기반 간단한 샘플 구현
4. ⏳ 샘플 실행 및 검증

## 완료된 작업

### 1. DB 세팅 확인

- ✅ PostgreSQL + pgvector 확장 자동 설치 확인
- ✅ `ensureTablesExist` 함수가 자동으로 테이블 생성
- ✅ 환경 변수: `MEMORY_DATABASE_URL` 사용

### 2. 기본 사용 예제 작성

- ✅ `examples/01-basic-usage.ts` 작성
  - Memory Storage 초기화
  - Memory 생성 (embedding 자동 생성)
  - Vector 검색
  - Graph 연결 및 탐색

### 3. LangChain 샘플 작성

- ✅ `examples/02-langchain-sample.ts` 작성
  - 실제 LangChain 라이브러리 사용 (`@langchain/core`, `@langchain/openai`)
  - `ChatOpenAI` 모델을 사용하여 실제 LLM 호출
  - Memory Connector 연결
  - 자동 Memory 검색 및 컨텍스트 구성
  - System Prompt에 Memory 컨텍스트 자동 추가
  - 대화 시뮬레이션

## 다음 단계

### 1. 예제 실행 환경 설정

```bash
# packages/memory 디렉토리에서
pnpm add -D tsx
```

### 2. LangChain 의존성 설치 (02-langchain-sample.ts 실행 시 필요)

```bash
# packages/memory 디렉토리에서
pnpm add @langchain/core @langchain/openai
```

또는 프로젝트 루트에서:

```bash
pnpm add -w @langchain/core @langchain/openai
```

### 3. 환경 변수 설정

`.env.local` 파일에 다음 추가:

```bash
MEMORY_DATABASE_URL=postgresql://postgres:postgres@localhost:54332/postgres
OPENAI_API_KEY=your_openai_api_key
```

### 4. Supabase 로컬 실행

```bash
# 프로젝트 루트에서
pnpm supabase:start
```

### 5. 예제 실행

```bash
# packages/memory 디렉토리에서
npx tsx examples/01-basic-usage.ts
npx tsx examples/02-langchain-sample.ts
```

## 참고사항

- LangChain 샘플은 실제 LangChain 라이브러리(`@langchain/core`, `@langchain/openai`)를 사용
- `ChatOpenAI` 모델을 사용하여 실제 LLM 호출
- Memory Connector는 LangChain chain을 자동으로 감지하고 연결
- Memory 컨텍스트가 자동으로 System Prompt에 추가됨
