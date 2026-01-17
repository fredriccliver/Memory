# @openaikits/memory

Memory Infrastructure Layer - Vector/Graph based memory search and generation system.

## Overview

`@openaikits/memory` is a reusable package that provides memory infrastructure capabilities for AI applications. It provides:

- **Hybrid Memory Search**: Unified memory structure combining vector embeddings and graph relationships. Each memory node contains both semantic embeddings for similarity search and graph edges for relationship traversal, enabling a two-phase search strategy: vector search for initial discovery, followed by graph traversal to find connected memories.
- **Dynamic Memory Generation**: AI-powered memory creation with consistency validation
- **Adapter Pattern**: Pluggable database and AI model adapters

## Architecture

This package is designed to be:

- **Independent**: No dependencies on application-specific code
- **Extensible**: Easy to add new memory sources or search methods
- **Reusable**: Can be used across different projects
- **Framework-agnostic**: Works with any LLM framework (LangChain, etc.)

### Core Principles

1. **Separation of Concerns**: Memory infrastructure is completely independent from application logic
2. **Adapter Pattern**: Database and AI model interactions are abstracted through interfaces
3. **Graph-First Design**: Memories form a graph structure using `outgoingEdges` on each node
4. **Hybrid Search**: Combines vector similarity search with graph traversal for comprehensive memory retrieval

## Installation

### Development (Submodule)

If using as a git submodule:

```bash
git submodule update --init --recursive
cd packages/memory
pnpm install
```

### Production

```bash
pnpm install @openaikits/memory
```

## Usage

### Basic Setup

```typescript
import { MemoryStorageAdapter, AIModelAdapter, Memory } from '@openaikits/memory';

// Implement adapters for your specific database and AI provider
const dbAdapter: MemoryStorageAdapter = new YourDatabaseAdapter();
const aiAdapter: AIModelAdapter = new YourAIAdapter();

// Use the adapters with memory components
// (Components will be exported as they are implemented)
```

### Adapter Pattern

The package uses the **Adapter Pattern** to abstract database and AI model operations:

- **`MemoryStorageAdapter`**: Interface for database operations (create, read, update, delete, search)
- **`AIModelAdapter`**: Interface for AI operations (embeddings, memory generation, validation)

This allows you to:

- Use any database (PostgreSQL, Supabase, MongoDB, etc.)
- Use any AI provider (OpenAI, Anthropic, etc.)
- Switch implementations without changing application code

### Memory Structure

Each memory is a **node** in a graph structure:

```typescript
interface Memory {
  id: string;
  content: string; // Natural language text
  entityId: string; // Entity this memory belongs to
  embedding?: number[]; // Vector for similarity search
  outgoingEdges: string[]; // Connected memory IDs (graph structure)
  createdAt: Date;
  updatedAt: Date;
}
```

**Key Design Decisions**:

- **No separate Relationship entity**: Graph connections are stored directly in `outgoingEdges`
- **Generic entityId**: Works with any entity type (e.g., `user`, `persona`, `workspace`, `agent`)
- **Hybrid structure**: Each node contains both vector embeddings and graph edges

**Entity Examples**:

- `user` - Individual user memories
- `persona` - AI character/persona memories
- `workspace` - Team or workspace shared memories
- `agent` - AI agent memories

### Examples

실제 사용 예제는 [`examples/`](./examples/) 디렉토리에서 확인할 수 있습니다.

**예제 목록**:

1. **`01-basic-usage.ts`** - 가장 간단한 사용 예제
   - Memory Storage 초기화
   - Memory 생성 및 검색
   - Embedding 자동 생성

2. **`02-langchain-sample.ts`** - LangChain 통합 샘플
   - LangChain chain과 Memory Connector 연결
   - 자동 Memory 검색 및 컨텍스트 구성
   - 대화 시뮬레이션

3. **`03-generator-test.ts`** - DynamicMemoryGenerator 테스트
   - DynamicMemoryGenerator 초기화
   - collectAugmentation() 메서드 테스트
   - Vector 검색 결과 수집
   - Graph 탐색 결과 수집 (BFS)
   - 기존 관계 수집

자세한 실행 방법과 환경 설정은 [examples/README.md](./examples/README.md)를 참고하세요.

## Package Structure

```
packages/memory/
├── src/
│   ├── index.ts              # Public API exports
│   ├── types.ts              # Common type definitions (Memory, AugmentationData, etc.)
│   ├── adapters/             # Adapter interfaces
│   │   ├── database-adapter.ts  # MemoryStorageAdapter interface
│   │   └── ai-adapter.ts        # AIModelAdapter interface
│   ├── vector/               # Vector search components (to be implemented)
│   ├── graph/                # Graph traversal components (to be implemented)
│   ├── memory/               # Memory management components (to be implemented)
│   └── tools/                # AI tool definitions (to be implemented)
├── examples/                 # Usage examples
│   ├── README.md             # Examples documentation
│   ├── 01-basic-usage.ts     # Basic usage example
│   ├── 02-langchain-sample.ts # LangChain integration example
│   └── 03-generator-test.ts  # DynamicMemoryGenerator test
└── README.md
```

### Current Status

**Implemented**:

- ✅ Type definitions (`Memory`, `AugmentationData`, `ValidationResult`, `ConversationContext`)
- ✅ Database adapter interface (`MemoryStorageAdapter`)
- ✅ AI model adapter interface (`AIModelAdapter`)

**To be implemented**:

- ⏳ Vector search engine
- ⏳ Graph traversal algorithms
- ⏳ Dynamic memory generator
- ⏳ Memory storage implementation
- ⏳ AI tool definitions

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Watch mode
pnpm dev

# Type check
pnpm type-check

# Lint
pnpm lint
```

## Type Definitions

### Memory

The core `Memory` interface represents a single memory node:

- **`id`**: Unique identifier
- **`content`**: Natural language text content
- **`entityId`**: Generic entity identifier (e.g., `user`, `persona`, `workspace`, `agent`)
- **`embedding`**: Optional vector embedding for similarity search
- **`outgoingEdges`**: Array of connected memory IDs (graph structure)
- **`createdAt`** / **`updatedAt`**: Timestamps

### Graph Structure

Memories form a **graph** where:

- Each memory is a **node**
- Connections are stored in `outgoingEdges` (array of memory IDs)
  - **TypeScript**: `outgoingEdges: string[]` (camelCase)
  - **SQL/Database**: `outgoing_edges UUID[]` (snake_case)
  - Use `MemoryStorageAdapter.updateOutgoingEdges()` to manage connections
- No separate relationship entity needed
- Graph traversal follows `outgoingEdges` to find connected memories

### Hybrid Search Strategy

1. **Vector Search**: Find similar memories using embeddings
2. **Graph Traversal**: Follow `outgoingEdges` to find related memories
3. **Combined Results**: Merge both for comprehensive context

## Contributing

This package is designed as a reusable, framework-agnostic library. When contributing:

- ✅ Keep it independent from application-specific code
- ✅ Use adapter interfaces for external dependencies
- ✅ Maintain backward compatibility
- ❌ Don't add application layer dependencies
- ❌ Don't hardcode specific database or AI provider logic

## License

MIT
