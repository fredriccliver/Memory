# @openaikits/memory

Memory Infrastructure Layer - Vector/Graph based memory search and generation system.

> 📄 **Research Paper**: [View PDF](openaikits-memory-technical-pre-report.pdf) | [Download PDF](https://github.com/fredriccliver/Memory/raw/main/openaikits-memory-technical-pre-report.pdf)

## Overview

`@openaikits/memory` is a reusable package that provides memory infrastructure capabilities for AI applications. It introduces **entity-specific associative networks** inspired by human brain structure, where each entity maintains its own unique memory network structure.

### Key Features

- **Usage-carved memory**: LLM cost scales with the change (ΔN), never with the amount held (N). Candidates come from vectors and SQL; only confirmation uses an LLM, and every LLM call sees O(1) context. See the design docs below.
- **Write-time dedup gate (no LLM)**: one nearest-neighbour lookup per new fact — near-identical mentions reinforce the existing node instead of duplicating it, ambiguous pairs are linked and deferred, new facts get cheap kNN edge hypotheses.
- **Score-ranked retrieval**: vector top-k seeds + first-class edge expansion, ranked by `α·similarity + β·edge activation + γ·recency + δ·node strength`. No similarity threshold, so there is no starvation or flooding failure mode.
- **Forgetting as a ranking term**: effective strength decays lazily at read time (`strength × e^(−λ·days)`). No batch job ever touches all rows; nothing is deleted, and dormant memories resurface when a topic returns.
- **Sleep executor (stateless, no cron)**: deferred pair judgements are consumed one batch at a time, piggybacked on conversation turns or run manually with a write-free preview. All verdicts are soft (demotion, never deletion).
- **Entity-specific networks**: each entity (user, persona, workspace, agent) keeps its own associative graph.
- **Adapter pattern, framework-agnostic**: pluggable database and AI-model adapters; works with LangChain, custom stacks, or any LLM framework.

## Architecture

This package is designed to be:

- **Independent**: No dependencies on application-specific code
- **Extensible**: Easy to add new memory sources or search methods
- **Reusable**: Can be used across different projects
- **Framework-agnostic**: Works with any LLM framework (LangChain, etc.)

### Core Principles

1. **Separation of Concerns**: memory infrastructure is completely independent from application logic. The application throws interaction logs; the package decides what to keep.
2. **Adapter Pattern**: database and AI-model interactions are abstracted through interfaces.
3. **Edges are hypotheses**: cheap to create, reinforced by use, decayed by disuse. First-class `edges` table with per-edge strength and origin (`conversation` = context-confirmed, `knn_seed` = similarity rule).
4. **Demote, never delete**: every automatic judgement is soft and reversible, which is what makes cheap models safe to use.

### Documentation

| Document | What it covers |
|---|---|
| [docs/usage-carved-memory.ko.md](docs/usage-carved-memory.ko.md) · [en](docs/usage-carved-memory.en.md) | Principles, data model, gate, ranked retrieval, forgetting, sleep, dials, scenarios, integration contract |
| [docs/usage-carved-memory-concepts.ko.md](docs/usage-carved-memory-concepts.ko.md) · [en](docs/usage-carved-memory-concepts.en.md) | Glossary: embeddings, cosine similarity, kNN, exponential decay, weighted sums |
| [docs/usage-carved-memory-maintainer-guide.ko.md](docs/usage-carved-memory-maintainer-guide.ko.md) | Code map, module dependencies, schema invariants, request flows, tuning contract, boot/migration/rollback, sleep executor contract, observation queries, verification method |
| [docs/usage-carved-memory-technical-report.ko.md](docs/usage-carved-memory-technical-report.ko.md) | Production evaluation of the gate, ranked retrieval and lazy decay over a two-month window |
| [docs/tool-definitions-usage.md](docs/tool-definitions-usage.md) | Tool-calling integration (`memoryToolDefinitions`, `MemoryToolHandler`) |

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

## Database connection (Postgres / Supabase)

This package connects to PostgreSQL **directly** via the `pg` client (and pgvector). It does not use the Supabase HTTP API.

| Access path | Role | Config |
|-------------|------|--------|
| **Supabase Client** (host app) | REST API, Auth, Storage, RLS | `NEXT_PUBLIC_SUPABASE_URL` + keys |
| **Memory (this package)** | Vector search, memory CRUD (pg + pgvector) | Postgres connection URI passed at `Memory.initialize()` |

When the host app uses **Supabase**, both access the **same** Postgres database: the app via Supabase Client, this package via a direct connection string. You cannot derive the Postgres URI from `NEXT_PUBLIC_SUPABASE_URL`; use **Supabase Dashboard → Settings → Database → Connection string** (URI).

- **Local (Supabase CLI)**: typically `postgresql://postgres:postgres@127.0.0.1:54332/postgres` (see `supabase start` output).
- **Production (Supabase Hosted)**: use a **Transaction pooler** URI (port 6543) for serverless (e.g. Vercel).
  - **Shared Pooler (IPv4 compatible)**: recommended when the host is IPv4-only (e.g. Vercel). In Dashboard → Connection string → URI → Transaction pooler, use **"Using the Shared Pooler"** (green IPv4 COMPATIBLE). Format: `postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-1-[REGION].pooler.supabase.com:6543/postgres`.
  - **Dedicated Pooler** (`db.[ref].supabase.co:6543`) is **not IPv4 compatible** unless you have the IPv4 add-on; use Shared Pooler if you see `ENOTFOUND` or connection failures.

The host app is responsible for passing the connection string at init (e.g. from `MEMORY_DATABASE_URL` in Neume).

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

### Search Modes

The package provides `SearchMode` enum for controlling vector similarity search behavior:

```typescript
enum SearchMode {
  AGGRESSIVE = 0.2, // Returns more results, useful for exploratory searches
  NORMAL = 0.5, // Balanced between recall and precision
  CONSERVATIVE = 0.7, // Returns fewer but more relevant results (default)
}
```

**Usage**:

```typescript
import { MemoryStorage, SearchMode } from '@openaikits/memory';

// Use SearchMode enum
const results = await storage.searchByQuery(
  'user query',
  entityId,
  10,
  SearchMode.AGGRESSIVE, // or NORMAL, CONSERVATIVE
);
```

### Examples

Usage examples are available in the [`examples/`](./examples/) directory.

**Example list**:

1. **`01-basic-usage.ts`** - Basic usage
   - Memory Storage initialization
   - Memory creation and search
   - Automatic embedding generation

2. **`02-langchain-sample.ts`** - LangChain integration sample
   - Connect LangChain chain with Memory Connector
   - Automatic memory search and context assembly
   - Conversation simulation

3. **`03-generator-test.ts`** - DynamicMemoryGenerator test
   - DynamicMemoryGenerator initialization
   - collectAugmentation() method test
   - Vector search result collection
   - Graph traversal result collection (BFS)
   - Existing relationship collection

See [examples/README.md](./examples/README.md) for run instructions and environment setup.

## Package Structure

```
packages/memory/
├── src/
│   ├── index.ts              # Public API exports
│   ├── types.ts              # Common type definitions (Memory, AugmentationData, etc.)
│   ├── adapters/             # Adapter interfaces
│   │   ├── database-adapter.ts  # MemoryStorageAdapter interface
│   │   └── ai-adapter.ts        # AIModelAdapter interface
│   ├── storage/              # Storage implementations
│   │   ├── adapters/
│   │   │   └── postgres-adapter.ts  # PostgreSQL storage adapter
│   │   └── storage-types.ts
│   ├── vector/               # Vector search components
│   │   ├── embedding-service.ts    # Embedding generation service
│   │   └── openai-adapter.ts       # OpenAI embedding adapter
│   ├── memory/               # Memory management components
│   │   ├── storage.ts            # MemoryStorage facade (embedding + adapter passthrough)
│   │   ├── connector.ts          # MemoryConnector: conversation entrance (extraction, gate, dual-write)
│   │   ├── ranked-retrieval.ts   # Score-ranked retrieval with lazy decay (side-effect free)
│   │   ├── sleep.ts              # Sleep executor (queue consumer, stateless, dry-run)
│   │   ├── bulk-plan.ts          # Bulk load planning (compute only)
│   │   ├── tool-handler.ts       # MemoryToolHandler
│   │   ├── generator.ts          # DynamicMemoryGenerator
│   │   ├── consolidator.ts       # Legacy full-scan pass (kept for compatibility)
│   │   └── optimizer.ts          # Legacy full-scan pass (kept for compatibility)
│   ├── tuning.ts             # MemoryTuning contract, defaults, validation
│   └── tools/                # AI tool definitions
│       ├── definitions.ts    # Memory management tool definitions
│       └── system-prompt-guide.ts
├── tools/                    # Developer tools
│   └── graph-viewer/         # Memory graph visualization
│       ├── server.ts         # HTTP server
│       └── index.html        # Visualization UI
├── examples/                 # Usage examples
│   ├── README.md             # Examples documentation
│   ├── 01-basic-usage.ts     # Basic usage example
│   ├── 02-langchain-sample.ts # LangChain integration example
│   ├── 03-generator-test.ts  # DynamicMemoryGenerator test
│   └── 04-tool-handler-test.ts # Tool handler test
├── openaikits-memory-technical-pre-report.pdf    # Technical pre-report (arXiv submission)
└── README.md
```

### Scope

The package owns storage, the write-time gate, ranked retrieval with lazy decay, the sleep
executor, and bulk-load planning. Extensions that follow the same principles but are not
part of the package today: LLM pair review inside sleep (polarity and temporal updates),
community summaries, an archive tier for "fully forgotten", and a lifetime axis for
transient state. See the boundary section of the design document.

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

### Graph Viewer Tool

A built-in developer tool for visualizing memory nodes and their relationships.

**Features:**

- Interactive force-directed graph visualization
- Entity selector to switch between different memory networks
- Bidirectional edge rendering (A→B + B→A shown as ↔)
- Node hover tooltip with content preview
- Click to copy node ID

**Usage:**

```bash
pnpm graph:viewer
```

This starts a local server at `http://localhost:3333` and opens the viewer in your browser.

**Requirements:**

- Database connection configured in `.env` (uses the same `DATABASE_URL` as the main package)
- Memory data must exist in the database for the selected entity

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

This project is licensed under the [Apache License 2.0](LICENSE).  
See [NOTICE](NOTICE) for attribution and [TRADEMARKS.md](TRADEMARKS.md) for use of OpenAIKits names and marks.
