# @openaikits/memory

Memory Infrastructure Layer - Vector/Graph based memory search and generation system.

## Overview

`@openaikits/memory` is a reusable package that provides memory infrastructure capabilities for AI applications. It supports:

- **Vector Search**: Semantic similarity search using embeddings
- **Graph RAG**: Relationship-based memory traversal
- **Dynamic Memory Generation**: AI-powered memory creation with consistency validation
- **Adapter Pattern**: Pluggable database and AI model adapters

## Architecture

This package is designed to be:

- **Independent**: No dependencies on application-specific code
- **Extensible**: Easy to add new memory sources or search methods
- **Reusable**: Can be used across different projects
- **Framework-agnostic**: Works with any LLM framework (LangChain, etc.)

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

```typescript
import { MemoryStorageAdapter, AIModelAdapter } from '@openaikits/memory';

// Implement adapters for your specific database and AI provider
const dbAdapter: MemoryStorageAdapter = new YourDatabaseAdapter();
const aiAdapter: AIModelAdapter = new YourAIAdapter();

// Use the adapters with memory components
// (Components will be exported as they are implemented)
```

## Package Structure

```
packages/memory/
├── src/
│   ├── index.ts              # Public API exports
│   ├── types.ts              # Common type definitions
│   ├── adapters/             # Adapter interfaces
│   │   ├── database-adapter.ts
│   │   └── ai-adapter.ts
│   ├── vector/               # Vector search components
│   ├── graph/                # Graph traversal components
│   ├── memory/                # Memory management components
│   └── tools/                # AI tool definitions
└── README.md
```

## Development

```bash
# Build
pnpm build

# Watch mode
pnpm dev

# Type check
pnpm type-check
```

## License

MIT
