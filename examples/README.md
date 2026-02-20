# Memory Package Examples

This directory contains usage examples for the `@openaikits/memory` package.

## Example list

### 0. `00-seed-data.ts` - Seed data generation

Generates seed memory data for testing. Covers various scenarios and graph structures so you can test:

- Vector search (various topics and contexts)
- Graph traversal (various depths and connection structures)
- DynamicMemoryGenerator's collectAugmentation
- Data isolation by entity_id

**Included personas:**

- `persona-001-software-engineer`: Software engineer (14 memories)
- `persona-002-student`: Student (9 memories)
- `persona-003-designer`: Designer (8 memories)
- `persona-004-entrepreneur`: Entrepreneur (9 memories)
- `test-entity-generator`: For DynamicMemoryGenerator testing (8 memories)

### 1. `01-basic-usage.ts` - Basic usage

- Memory Storage initialization
- Memory creation and search
- Automatic embedding generation

### 2. `02-langchain-sample.ts` - LangChain integration sample

- Connect LangChain chain with Memory Connector
- Automatic memory search and context assembly
- Conversation simulation

### 3. `03-generator-test.ts` - DynamicMemoryGenerator test

- DynamicMemoryGenerator initialization
- collectAugmentation() method test
- Vector search result collection
- Graph traversal result collection (BFS)
- Existing relationship collection
- Edge case tests

### 4. `04-tool-handler-test.ts` - MemoryToolHandler test

- MemoryToolHandler initialization
- handleCreateMemory() test (basic create, related memory linking)
- handleUpdateMemory() test (content update, embedding regeneration)
- handleUpdateMemoryLink() test (link add/remove)
- handleDeleteMemory() test (memory delete, related link cleanup)
- Error case tests

### 5. `05-ai-tool-calling-integration-test.ts` - AI tool calling integration test

- Verifies that the AI manages memory via tool calling
- Realistic scenarios using existing seed data
- Verifies Tool Handler correctly processes AI tool calls
- Verifies end-to-end flow behaves as intended

**Test scenarios:**

- Scenario 1: Store new information (createMemory)
- Scenario 2: Update existing information (updateMemory)
- Scenario 3: Link memories (updateMemoryLink)
- Scenario 4: Combined scenario (multiple tools)

**Notes:**

- Uses a dedicated test entity ID to avoid touching existing seed data
- Test data is cleaned up automatically after the run

### 6. `00-clear-seed-data.ts` - Seed data cleanup

Utility script to delete seed data.

## How to run

### Prerequisites

1. **Environment variables**

Create a `.env` file in the package root (`packages/memory/`):

```bash
# Go to package root
cd packages/memory

# Copy .env.example
cp .env.example .env

# Edit .env with your values
# OPENAI_API_KEY=your_actual_api_key
# MEMORY_DATABASE_URL=your_actual_database_url
```

Or pass variables inline:

```bash
cd packages/memory
OPENAI_API_KEY=your_key MEMORY_DATABASE_URL=your_url npx tsx examples/01-basic-usage.ts
```

**Note:** Examples resolve `.env` from the current working directory (`packages/memory/`) for package independence. They do not use the project root's `.env.local`.

2. **Supabase local (or production DB)**

```bash
pnpm supabase:start
```

3. **Build the package**

```bash
cd packages/memory
pnpm build
```

### Running examples

```bash
# Generate seed data (recommended before running tests)
npx tsx examples/00-seed-data.ts

# Basic usage
npx tsx examples/01-basic-usage.ts

# LangChain sample
npx tsx examples/02-langchain-sample.ts

# DynamicMemoryGenerator test
npx tsx examples/03-generator-test.ts

# MemoryToolHandler test
npx tsx examples/04-tool-handler-test.ts

# AI tool calling integration test (requires seed data)
npx tsx examples/05-ai-tool-calling-integration-test.ts

# Clear seed data
npx tsx examples/00-clear-seed-data.ts
```

**Note:**

- `03-generator-test.ts` uses the `test-entity-generator` entity; run seed data first for richer output.
- `05-ai-tool-calling-integration-test.ts` uses a copy of existing seed data; generate seed data first. The test does not modify the original seed data.

## Dependencies

To run the examples you need:

```bash
# Dev dependency
pnpm add -D tsx

# LangChain (required for 02-langchain-sample.ts)
pnpm add @langchain/core @langchain/openai
```

**Note:** `01-basic-usage.ts` can run without LangChain.
