/**
 * Memory Connector
 *
 * Connects to chatting manager to automatically detect context changes
 * and save memories. Also provides manual memory creation for application layer.
 *
 * @public
 */

import { Memory, SearchMode } from '../types';
import type { MemoryStorage } from './storage';
import type {
  ConversationContext,
  MemoryOperation,
  AfterResponseContextAdapter,
  GateDecisionRecord,
} from '../types';
import { normalizeMemoryTuning, type MemoryTuning } from '../tuning';
import { runRankedRetrieval } from './ranked-retrieval';

/**
 * Configuration for Memory Connector
 *
 * @public
 */
export interface MemoryConnectorConfig {
  /** Entity ID (e.g., persona ID, user ID) */
  entityId: string;
  /** Human-readable name for this entity (e.g., replica/persona name). Used in after-response prompts to distinguish "self" vs "partner" in memory content. */
  entityName?: string;
  /** Human-readable name for the conversation partner (e.g., user display name). Used in after-response prompts so the LLM can attribute facts to the correct subject. */
  partnerName?: string;
  /** Auto-saved memory content language. Default `ko`. */
  contentLocale?: 'ko' | 'en';
  /** Maximum depth for graph traversal (default: 10) */
  chainDepth?: number;
  /** Operation mode: read-only or read-write (default: 'read-write'). read-write includes handleAfterResponse (auto memory generation on response). */
  mode?: 'read-only' | 'read-write';
  /** Maximum number of memories to retrieve (default: 50) */
  maxMemoryCount?: number;
  /** Similarity threshold for vector search using SearchMode enum (default: SearchMode.CONSERVATIVE) */
  similarityThreshold?: SearchMode;
  /** Whether to enable decision logging via logMemoryDecision tool (default: false) */
  enableDecisionLogging?: boolean;
  /** Optional LLM adapter for obtaining create/update/updateLink/delete from context. When set, connector owns context slicing, prompt, parse, and execution. */
  contextAdapter?: AfterResponseContextAdapter;
  /** When true, log after-response flow and operation counts (default: false). Can be set at init or per-connector. */
  verbose?: boolean;
  /**
   * Optional runner to tag embedding calls as search (vector query) vs write (persist).
   * Used by application layers for cost observability (e.g. Langfuse scope).
   */
  runWithEmbeddingScope?: <T>(
    scope: 'search' | 'write',
    fn: () => T | Promise<T>,
  ) => T | Promise<T>;
  /** Runtime tuning values (dedup gate mode, thresholds). Invalid fields fall back to defaults. */
  tuning?: Partial<MemoryTuning>;
}

/**
 * Memory context retrieved for conversation
 *
 * @public
 */
export interface MemoryContext {
  /** Retrieved memories */
  memories: Memory[];
  /** Template string for system prompt */
  template: string;
  /** Query that was used for search (optional, for debugging and linking decisions) */
  searchQuery?: string;
  /** Whether memories came from vector search (true) or graph traversal (false) */
  isFromVectorSearch?: boolean;
}

/**
 * Options for creating a memory manually
 *
 * @public
 */
export interface CreateMemoryOptions {
  /** Related memory IDs to link to */
  relatedMemoryIds?: string[];
  /** Whether to automatically link to related memories (default: true) */
  autoLink?: boolean;
  /** Precomputed embedding for the content (e.g. reused from a dedup gate lookup) */
  embedding?: number[];
}

/**
 * Result of a dedup gate lookup for a creation candidate.
 * Mode-agnostic: contains the judgment only; how it is acted on
 * (log-only vs skip/link/seed) is decided by the caller based on the gate mode.
 *
 * @internal
 */
interface DedupGateJudgement {
  /** Embedding generated for the candidate content (reusable for creation) */
  embedding: number[];
  /** Nearest existing memories ordered by similarity (seed candidates) */
  matches: Memory[];
  /** Most similar existing memory, if any */
  top: Memory | null;
  /** Duplicate band: top similarity >= dedupSkipThreshold */
  wouldSkip: boolean;
  /** Gray zone band: dedupLinkThreshold <= top similarity < dedupSkipThreshold */
  inGrayZone: boolean;
}

/** Node strength added when a duplicate mention reinforces an existing memory */
const NODE_STRENGTH_BUMP = 0.1;
/** Initial strength of the gray-zone edge to the nearest neighbor (pending merge review) */
const GRAY_ZONE_EDGE_STRENGTH = 0.8;
/** Initial strength of conversation-origin edges (LLM-decided links) */
export const CONVERSATION_EDGE_STRENGTH = 0.7;
/** Edge strength added when an edge contributes to a served ranked retrieval */
const EDGE_USAGE_BUMP = 0.05;

/**
 * Callback function for context change detection
 *
 * @public
 */
export type ContextChangeCallback = (context: ConversationContext) => Promise<void>;

/**
 * Chatting manager interface for connecting to Memory Connector
 *
 * This interface allows Memory Connector to work with various chatting managers:
 * - Manually implemented chatting managers
 * - LangChain-based chains
 * - Other LLM frameworks
 *
 * @public
 */
export interface ChattingManager {
  /**
   * Called when context changes are detected
   * The chatting manager should call this method when conversation context changes
   */
  onContextChange?(context: ConversationContext): Promise<void>;

  /**
   * Called before sending a message to prepare context
   * Returns memory context to include in system prompt
   */
  prepareContext?(conversationContext: string): Promise<MemoryContext>;

  /**
   * Called after receiving a response to handle memory creation
   */
  onAfterResponse?(context: ConversationContext): Promise<void>;
}

/**
 * Type guard to check if an object is a LangChain chain
 *
 * LangChain chains typically have:
 * - `invoke()` method
 * - `_chainType` property (internal)
 * - `run()` method (optional)
 *
 * **Note**: This is a runtime type check and may need adjustment based on
 * the actual LangChain library version and structure. When LangChain library
 * is installed, verify the actual type definitions and adjust this function
 * if necessary.
 *
 * @param obj - Object to check
 * @returns Whether the object is a LangChain chain
 *
 * @internal
 */
function isLangChainChain(obj: unknown): boolean {
  if (!obj || typeof obj !== 'object') {
    return false;
  }

  const chain = obj as Record<string, unknown>;

  // Check for LangChain chain characteristics
  // 1. Has invoke method
  if (typeof chain.invoke === 'function') {
    // 2. Has _chainType property (LangChain internal)
    if ('_chainType' in chain) {
      return true;
    }
    // 3. Has Runnable interface (LangChain v0.1+)
    if ('_runnable' in chain || 'runnable' in chain) {
      return true;
    }
    // 4. Has langchain in constructor name (fallback)
    if (
      chain.constructor &&
      typeof chain.constructor.name === 'string' &&
      chain.constructor.name.toLowerCase().includes('chain')
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Creates a ChattingManager adapter for LangChain chain
 *
 * @param chain - LangChain chain instance
 * @param connector - Memory Connector instance
 * @returns ChattingManager adapter
 *
 * @internal
 */
function createLangChainAdapter(chain: unknown, connector: MemoryConnector): ChattingManager {
  const langChain = chain as {
    invoke?: (input: unknown) => Promise<unknown>;
    run?: (input: unknown) => Promise<unknown>;
    [key: string]: unknown;
  };

  return {
    async prepareContext(conversationContext: string): Promise<MemoryContext> {
      return connector.getContext(conversationContext);
    },

    async onAfterResponse(context: ConversationContext): Promise<void> {
      await connector.handleAfterResponse(context);
    },
  };
}

/**
 * Memory Connector
 *
 * Provides automatic memory management by connecting to chatting manager
 * and detecting context changes. Also supports manual memory creation.
 *
 * Works with various chatting managers:
 * - Manually implemented chatting managers (via callback)
 * - LangChain-based chains (via ChattingManager interface)
 * - Other LLM frameworks
 *
 * @public
 */
export class MemoryConnector {
  private storage: MemoryStorage;
  private config: MemoryConnectorConfig;
  private tuning: MemoryTuning;
  private contextChangeCallback?: ContextChangeCallback;
  private chattingManager?: ChattingManager;
  private isConnected: boolean = false;

  /**
   * Creates a new Memory Connector instance
   *
   * @param storage - Memory storage instance
   * @param config - Connector configuration
   */
  constructor(storage: MemoryStorage, config: MemoryConnectorConfig) {
    this.storage = storage;
    this.config = {
      chainDepth: 10,
      mode: 'read-write',
      maxMemoryCount: 50,
      similarityThreshold: SearchMode.CONSERVATIVE,
      ...config,
    };
    this.tuning = normalizeMemoryTuning(config.tuning);
  }

  /**
   * Gets the normalized runtime tuning values
   *
   * Invalid or missing fields in the provided config are already replaced
   * with defaults.
   *
   * @returns Normalized tuning values
   *
   * @public
   */
  getTuning(): Readonly<MemoryTuning> {
    return { ...this.tuning };
  }

  /**
   * Connects to chatting manager for automatic context change detection
   *
   * Supports multiple connection modes:
   * 1. Callback mode: Simple callback function for manually implemented managers
   * 2. Interface mode: ChattingManager interface for custom implementations
   * 3. LangChain auto-detection: Automatically detects LangChain chains and creates adapter
   *
   * @param managerOrCallback - ChattingManager instance, callback function, or LangChain chain
   * @throws Error if already connected
   *
   * @public
   */
  async connect(
    managerOrCallback: ChattingManager | ContextChangeCallback | unknown,
  ): Promise<void> {
    if (this.isConnected) {
      throw new Error('Memory Connector is already connected');
    }

    // Check if it's a callback function
    if (typeof managerOrCallback === 'function') {
      // Callback mode (for manually implemented chatting managers)
      this.contextChangeCallback = managerOrCallback as ContextChangeCallback;
      this.isConnected = true;
      return;
    }

    // Check if it's a LangChain chain (auto-detection)
    if (isLangChainChain(managerOrCallback)) {
      // Automatically create adapter for LangChain chain
      this.chattingManager = createLangChainAdapter(managerOrCallback, this);
      this.isConnected = true;
      return;
    }

    // Interface mode (for ChattingManager implementations)
    if (managerOrCallback && typeof managerOrCallback === 'object') {
      this.chattingManager = managerOrCallback as ChattingManager;
      this.isConnected = true;
      console.log('[Memory] connect: ChattingManager (interface mode), isConnected=true');
      return;
    }

    throw new Error(
      'Invalid connection target. Expected ChattingManager, callback function, or LangChain chain.',
    );
  }

  /**
   * Disconnects from chatting manager
   *
   * @public
   */
  async disconnect(): Promise<void> {
    this.contextChangeCallback = undefined;
    this.isConnected = false;
  }

  /**
   * Handles context change from chatting manager
   *
   * This method should be called by the chatting manager when context changes
   * are detected. The connector will automatically determine if a new memory
   * should be created.
   *
   * @param context - Conversation context
   * @returns Whether a memory was created
   *
   * @public
   */
  async handleContextChange(context: ConversationContext): Promise<boolean> {
    if (!this.isConnected || this.config.mode === 'read-only') {
      return false;
    }

    // Callback mode
    if (this.contextChangeCallback) {
      await this.contextChangeCallback(context);
    }

    // Interface mode
    if (this.chattingManager?.onContextChange) {
      await this.chattingManager.onContextChange(context);
    }

    // TODO: Implement automatic memory generation logic
    // This will be implemented when Dynamic Memory Generator is ready
    // See: docs/backlogs/todo/007-epic-2-task-2-2-dynamic-memory-generator.md
    return false;
  }

  /**
   * Prepares memory context for conversation
   *
   * This method should be called by the chatting manager before sending a message
   * to prepare the system prompt with relevant memories.
   *
   * @param conversationContext - Current conversation context string
   * @returns Memory context with retrieved memories and template
   *
   * @public
   */
  async prepareContext(conversationContext: string): Promise<MemoryContext> {
    // If chatting manager has its own prepareContext, use it
    if (this.chattingManager?.prepareContext) {
      return this.chattingManager.prepareContext(conversationContext);
    }

    // Otherwise, use default implementation
    return this.getContext(conversationContext);
  }

  /**
   * Handles response from chatting manager
   *
   * When contextAdapter is set: connector owns context slicing, prompt, parse, and execution
   * (application passes context as-is). When not set: calls chattingManager.onAfterResponse if present.
   *
   * @param context - Conversation context (application passes as-is; connector decides how much to use)
   *
   * @public
   */
  async handleAfterResponse(context: ConversationContext): Promise<void> {
    // Unconditional entry log (package must be rebuilt for changes: pnpm --filter @openaikits/memory build)
    console.log(
      '[Memory] handleAfterResponse: entered',
      'isConnected:',
      this.isConnected,
      'mode:',
      this.config.mode,
    );

    if (!this.isConnected || this.config.mode === 'read-only') {
      console.log(
        '[Memory] handleAfterResponse: skipped (connected:',
        this.isConnected,
        'mode:',
        this.config.mode,
        ')',
      );
      return;
    }

    const contextAdapter = this.config.contextAdapter;
    console.log(
      '[Memory] handleAfterResponse:',
      contextAdapter ? 'contextAdapter' : 'onAfterResponse',
      'messages:',
      context.messages?.length ?? 0,
    );
    if (contextAdapter) {
      await this.runAfterResponseWithContext(context, contextAdapter);
      return;
    }

    if (this.chattingManager?.onAfterResponse) {
      await this.chattingManager.onAfterResponse(context);
    }
  }

  /**
   * Builds the system prompt for after-response memory decisions.
   * When entityName/partnerName are provided, injects ownership attribution rules
   * so the LLM clearly distinguishes "self (entity)" facts from "partner" facts.
   */
  private buildAfterResponseSystemPrompt(): string {
    const { entityName, partnerName, contentLocale = 'ko' } = this.config;
    const contentLanguageRule =
      contentLocale === 'en'
        ? '- Write all new/updated memory **content** in **English**.'
        : '- 모든 memory **content**는 **한국어** 평서문으로 작성.';

    const ownershipBlock =
      entityName || partnerName
        ? `
**Memory ownership — CRITICAL:**
This entity is "${entityName || 'the assistant'}" (the assistant in the conversation).
The conversation partner is "${partnerName || 'the user'}" (the user in the conversation).
When creating or updating memories, you MUST clearly indicate WHO the fact is about in the content:
- Facts about this entity (assistant): start with "나는 ~" or "${entityName || 'this entity'}는 ~"  (e.g. "나는 커피를 좋아한다", "나는 서울에 산다")
- Facts about the partner (user): start with "${partnerName || '상대방'}은(는) ~" or "상대방은 ~"  (e.g. "${partnerName || '상대방'}은(는) 서울에 산다", "${partnerName || '상대방'}은(는) 개발자이다")
- NEVER store a partner's fact without clearly attributing it to "${partnerName || '상대방'}". If the user says "I live in Seoul", the memory content must be "${partnerName || '상대방'}은(는) 서울에 산다", NOT "서울에 산다" or "I live in Seoul".
- NEVER confuse who said what. The "user" role in the conversation is ${partnerName || 'the partner'}, the "assistant" role is ${entityName || 'this entity'}.
- Store facts from BOTH sides — do not skip facts said by the assistant (${entityName || 'this entity'}). If the assistant says "나는 녹차를 좋아해", create a memory like "${entityName || '나'}는 녹차를 좋아한다".`
        : '';

    return `You are a memory manager for an entity in a chat.
You are given:
1. **Existing memories** for this entity (each with id, content, outgoingEdges). This list is the result of one retrieval from the conversation; you may only reference memory IDs that appear in this list. You cannot reference or update memories that are not listed here.
2. The recent conversation.
${ownershipBlock}
Output a JSON object with a single key "operations": an array of memory operations. Each operation must use exactly the schema below (other fields are ignored).

**Exact operation schema (use these field names only):**
- create: { "action": "create", "content": string, "relatedMemoryIds"?: string[] }  — relatedMemoryIds must be UUIDs from Existing memories only.
- update: { "action": "update", "memoryId": string, "content": string }  — memoryId must be from Existing memories.
- updateLink: { "action": "updateLink", "fromMemoryId": string, "toMemoryId": string, "linkAction": "add" | "remove" }  — both IDs from Existing memories; only "add" or "remove".
- delete: { "action": "delete", "memoryId": string }  — memoryId from Existing memories.

**When to use:**
- create: New fact about this entity OR its partner not already in existing memories. Avoid duplicates; if similar content exists, use update instead.
- update: Existing memory content has changed (e.g. "I live in NYC" → user said "I moved to Boston"). Do NOT use create when the fact is an update.
- updateLink: Two existing memories are related (add link) or no longer related (remove). Only add if not already in outgoingEdges.
- delete: Memory is clearly wrong or no longer needed. Prefer update over delete when possible.

**Example:** { "operations": [ { "action": "create", "content": "${partnerName || '상대방'}은(는) 커피를 좋아한다", "relatedMemoryIds": [] } ] }

**Rules:**
- Only output operations clearly implied by the conversation. If nothing to do, output { "operations": [] }.
- Use UUIDs from the "Existing memories" list only. Do not invent IDs.
- Prefer update over create when the conversation changes previously stated information.${ownershipBlock ? '\n- ALWAYS include the subject (who the fact is about) in the memory content.' : ''}
${contentLanguageRule}
Output ONLY valid JSON. No markdown code fences.`;
  }

  private static formatExistingMemoriesForPrompt(memories: Memory[]): string {
    if (memories.length === 0) return '(none)';
    return memories
      .map(
        m =>
          `- id: ${m.id}\n  content: ${m.content}\n  outgoingEdges: [${(m.outgoingEdges ?? []).join(', ')}]`,
      )
      .join('\n');
  }

  private static parseOperationsFromResponse(content: string): MemoryOperation[] {
    const trimmed = content
      .trim()
      .replace(/^```json?\s*|\s*```$/g, '')
      .trim();
    let parsed: { operations?: unknown[] };
    try {
      parsed = JSON.parse(trimmed) as { operations?: unknown[] };
    } catch {
      return [];
    }
    const ops = Array.isArray(parsed?.operations) ? parsed.operations : [];
    const valid: MemoryOperation[] = [];
    for (const o of ops) {
      if (!o || typeof o !== 'object' || !('action' in o)) continue;
      const raw = o as Record<string, unknown>;
      const a = raw.action as string;
      if (a === 'create' && typeof raw.content === 'string') {
        valid.push({
          action: 'create',
          content: raw.content,
          relatedMemoryIds: Array.isArray(raw.relatedMemoryIds)
            ? (raw.relatedMemoryIds as string[]).filter((s: unknown) => typeof s === 'string')
            : undefined,
        });
      } else if (
        a === 'update' &&
        typeof raw.memoryId === 'string' &&
        typeof raw.content === 'string'
      ) {
        valid.push({ action: 'update', memoryId: raw.memoryId, content: raw.content });
      } else if (
        a === 'updateLink' &&
        typeof raw.fromMemoryId === 'string' &&
        typeof raw.toMemoryId === 'string' &&
        (raw.linkAction === 'add' || raw.linkAction === 'remove')
      ) {
        valid.push({
          action: 'updateLink',
          fromMemoryId: raw.fromMemoryId,
          toMemoryId: raw.toMemoryId,
          linkAction: raw.linkAction as 'add' | 'remove',
        });
      } else if (a === 'delete' && typeof raw.memoryId === 'string') {
        valid.push({ action: 'delete', memoryId: raw.memoryId });
      }
    }
    return valid;
  }

  private async runAfterResponseWithContext(
    context: ConversationContext,
    contextAdapter: AfterResponseContextAdapter,
  ): Promise<void> {
    const { messages } = context;
    if (!messages?.length) return;

    // Package decides how much context to use (e.g. last 8 messages)
    const slice = messages.slice(-8);
    const conversationText = slice.map(m => `${m.role}: ${m.content}`).join('\n');

    if (this.config.verbose) {
      console.log('[Memory] verbose runAfterResponseWithContext: slice', slice.length, 'messages');
    }

    // Single retrieval: "Existing memories" shown to the LLM are from this one getContext call.
    // todo: Future: allow the memory-manager LLM to run memory search (e.g. as a tool) multiple times before deciding operations.
    const runScope = this.config.runWithEmbeddingScope ?? (<T>(_scope: 'search' | 'write', fn: () => T) => fn());
    let existingMemories: Memory[] = [];
    try {
      const memContext = await runScope('search', () => this.getContext(conversationText));
      existingMemories = memContext.memories ?? [];
    } catch {
      // continue with empty
    }

    if (this.config.verbose) {
      console.log(
        '[Memory] verbose existingMemories:',
        existingMemories.length,
        existingMemories.map(m => ({ id: m.id, content: m.content })),
      );
    }

    // Structured messages so the LLM sees user vs assistant (replica) roles; replica messages are not flattened into one blob.
    const preamble = `Existing memories for this entity:
${MemoryConnector.formatExistingMemoriesForPrompt(existingMemories)}

Use the conversation below to decide operations.`;

    const conversationMessages = slice.map(m => ({ role: m.role, content: m.content }));
    const tail = 'Output JSON: { "operations": [ ... ] }';

    const messagesToSend: Array<{ role: string; content: string }> = [
      { role: 'system', content: this.buildAfterResponseSystemPrompt() },
      { role: 'user', content: preamble },
      ...conversationMessages,
      { role: 'user', content: tail },
    ];

    let raw: string;
    try {
      raw = await contextAdapter.generate(messagesToSend);
    } catch (err) {
      console.error('[Memory] contextAdapter.generate error:', err);
      return;
    }

    if (this.config.verbose) {
      console.log('[Memory] verbose LLM raw (first 500 chars):', raw.slice(0, 500));
    }

    const operations = MemoryConnector.parseOperationsFromResponse(raw);
    console.log(
      '[Memory] after-response:',
      operations.length,
      'operations',
      operations.length > 0 ? operations.map(o => o.action) : '',
    );
    for (const op of operations) {
      try {
        await runScope('write', async () => {
          if (op.action === 'create') {
            const gateMode = this.tuning.dedupGateMode;
            const judgement = gateMode === 'off' ? null : await this.judgeDedupGate(op.content);
            const skip = gateMode === 'active' && judgement?.wouldSkip === true;

            let createdId: string | null = null;
            if (skip) {
              console.log('[Memory] dedup gate: skipped create', {
                similarity: judgement?.top?.similarity,
                matchedMemoryId: judgement?.top?.id,
              });
              // Duplicate mention = reinforcement signal for the existing memory
              if (judgement?.top) {
                try {
                  await this.storage.bumpMemoryStrength(judgement.top.id, NODE_STRENGTH_BUMP);
                } catch (err) {
                  console.error('[Memory] strength bump failed:', err);
                }
              }
            } else {
              const created = await this.createMemory(op.content, {
                relatedMemoryIds: op.relatedMemoryIds ?? [],
                ...(judgement?.embedding ? { embedding: judgement.embedding } : {}),
              });
              createdId = created.id;
              if (gateMode === 'active' && judgement) {
                await this.applyPostCreateGateActions(created.id, judgement);
              }
              if (this.config.verbose) {
                console.log('[Memory] verbose create:', {
                  id: created.id,
                  content: created.content,
                  relatedMemoryIds: op.relatedMemoryIds ?? [],
                });
              }
            }

            if (judgement && (gateMode === 'shadow' || gateMode === 'active')) {
              this.recordGateDecision(gateMode, op.content, judgement, skip, createdId);
            }
          } else if (op.action === 'update') {
            const updated = await this.updateMemory(op.memoryId, op.content);
            if (this.config.verbose) {
              console.log('[Memory] verbose update:', {
                memoryId: op.memoryId,
                newContent: updated.content,
              });
            }
          } else if (op.action === 'updateLink') {
            const linked = await this.updateMemoryLink(
              op.fromMemoryId,
              op.toMemoryId,
              op.linkAction,
            );
            if (this.config.verbose) {
              console.log('[Memory] verbose updateLink:', {
                linkAction: op.linkAction,
                fromMemoryId: op.fromMemoryId,
                toMemoryId: op.toMemoryId,
                outgoingEdges: linked.outgoingEdges,
              });
            }
          } else if (op.action === 'delete') {
            await this.deleteMemory(op.memoryId);
            if (this.config.verbose) {
              console.log('[Memory] verbose delete:', { memoryId: op.memoryId });
            }
          }
        });
      } catch (err) {
        console.error('[Memory] operation error:', op.action, err);
      }
    }
  }

  /**
   * Looks up the nearest existing memories for a creation candidate and
   * judges which similarity band it falls into.
   *
   * Mode-agnostic pure judgment — the caller decides how to act on it.
   * Lookup failures never block creation: returns null and logs the error.
   *
   * @param content - Candidate memory content
   * @returns Judgement with reusable embedding, or null when lookup failed
   */
  private async judgeDedupGate(content: string): Promise<DedupGateJudgement | null> {
    try {
      const { embedding, matches } = await this.storage.findMostSimilarMemories(
        content,
        this.config.entityId,
        Math.max(this.tuning.seedK, 1),
      );
      const top = matches[0] ?? null;
      const wouldSkip =
        top?.similarity !== undefined && top.similarity >= this.tuning.dedupSkipThreshold;
      const inGrayZone =
        !wouldSkip &&
        top?.similarity !== undefined &&
        top.similarity >= this.tuning.dedupLinkThreshold;
      if (this.config.verbose) {
        console.log('[Memory] dedup gate judgement:', {
          similarity: top?.similarity ?? null,
          matchedMemoryId: top?.id ?? null,
          threshold: this.tuning.dedupSkipThreshold,
          wouldSkip,
          inGrayZone,
          neighbors: matches.length,
        });
      }
      return { embedding, matches, top, wouldSkip, inGrayZone };
    } catch (err) {
      console.error('[Memory] dedup gate lookup failed (creation proceeds):', err);
      return null;
    }
  }

  /**
   * Post-create gate actions (active mode only):
   * - gray zone: high-strength edge to the nearest neighbor + merge review job
   * - otherwise: kNN edge seeding (strength = similarity) for neighbors
   *   at/above the seed floor
   *
   * Edges are hypotheses written to the edges table only (never to the legacy
   * outgoing_edges array — unverified links must not affect legacy traversal).
   * Failures never affect the already-created memory.
   */
  private async applyPostCreateGateActions(
    newMemoryId: string,
    judgement: DedupGateJudgement,
  ): Promise<void> {
    const entityId = this.config.entityId;
    try {
      if (judgement.inGrayZone && judgement.top) {
        await this.storage.insertEdges([
          {
            entityId,
            fromId: newMemoryId,
            toId: judgement.top.id,
            origin: 'knn_seed',
            strength: GRAY_ZONE_EDGE_STRENGTH,
          },
        ]);
        await this.storage.enqueueSleepJob({
          entityId,
          kind: 'merge_review',
          payload: {
            newMemoryId,
            matchedMemoryId: judgement.top.id,
            similarity: judgement.top.similarity ?? null,
          },
        });
        if (this.config.verbose) {
          console.log('[Memory] dedup gate: gray zone → linked + merge review queued', {
            newMemoryId,
            matchedMemoryId: judgement.top.id,
            similarity: judgement.top.similarity,
          });
        }
      } else {
        const seeds = judgement.matches.filter(
          m =>
            m.id !== newMemoryId &&
            m.similarity !== undefined &&
            m.similarity >= this.tuning.seedSimilarityFloor,
        );
        if (seeds.length > 0) {
          const inserted = await this.storage.insertEdges(
            seeds.map(m => ({
              entityId,
              fromId: newMemoryId,
              toId: m.id,
              origin: 'knn_seed' as const,
              strength: Math.min(1, Math.max(0, m.similarity as number)),
            })),
          );
          if (this.config.verbose) {
            console.log('[Memory] dedup gate: seeded knn edges:', inserted);
          }
        }
      }
    } catch (err) {
      console.error('[Memory] post-create gate actions failed:', err);
    }
  }

  /**
   * Records a dedup gate decision for audit and threshold calibration.
   * Fire-and-forget: logging failures never affect the memory pipeline.
   */
  private recordGateDecision(
    mode: 'shadow' | 'active',
    content: string,
    judgement: DedupGateJudgement,
    skipped: boolean,
    newMemoryId: string | null,
  ): void {
    const record: GateDecisionRecord = {
      entityId: this.config.entityId,
      mode,
      decision: skipped ? 'skipped' : judgement.wouldSkip ? 'would_skip' : 'created',
      similarity: judgement.top?.similarity ?? null,
      matchedMemoryId: judgement.top?.id ?? null,
      newMemoryId,
      candidateContent: content,
      threshold: this.tuning.dedupSkipThreshold,
    };
    this.storage.recordGateDecision(record).catch(err => {
      console.error('[Memory] failed to record gate decision:', err);
    });
  }

  /**
   * Gets memory context for the current conversation
   *
   * Dispatches on tuning.retrievalMode:
   * - legacy (default): original vector-threshold + array-graph retrieval
   * - shadow: legacy result is served; ranked runs side-effect-free in
   *   parallel and the comparison is logged (calibration)
   * - ranked: usage-carved ranked retrieval is served
   *
   * Node retrieval usage is recorded on whichever path is live.
   *
   * @param conversationContext - Current conversation context string
   * @returns Memory context with retrieved memories and template
   *
   * @public
   */
  async getContext(conversationContext: string): Promise<MemoryContext> {
    const mode = this.tuning.retrievalMode;
    if (mode === 'ranked') {
      return this.getContextRanked(conversationContext);
    }
    const legacy = await this.getContextLegacy(conversationContext);
    if (mode === 'shadow') {
      // Fire-and-forget: shadow comparison must never affect the live result
      this.runRetrievalShadow(conversationContext, legacy.memories).catch(err => {
        console.error('[Memory] retrieval shadow failed:', err);
      });
    }
    return legacy;
  }

  /**
   * Ranked retrieval path (live): serves ranked results and records usage
   * signals — node retrievals and contributing-edge strength bumps.
   */
  private async getContextRanked(conversationContext: string): Promise<MemoryContext> {
    const { memories, contributingEdgeIds } = await runRankedRetrieval(
      this.storage,
      this.config.entityId,
      conversationContext,
      this.tuning,
      this.config.maxMemoryCount || 50,
    );

    // Usage side effects (fire-and-forget — never block the chat path)
    if (memories.length > 0) {
      this.storage.recordNodeRetrievals(memories.map(m => m.id)).catch(err => {
        console.error('[Memory] failed to record node retrievals:', err);
      });
    }
    if (contributingEdgeIds.length > 0) {
      this.storage.bumpEdgeStrengths(contributingEdgeIds, EDGE_USAGE_BUMP).catch(err => {
        console.error('[Memory] failed to bump edge strengths:', err);
      });
    }

    const template = this.generateTemplate(memories, conversationContext, true);
    return {
      memories,
      template,
      searchQuery: conversationContext,
      isFromVectorSearch: true,
    };
  }

  /**
   * Shadow comparison: run ranked retrieval side-effect-free and log the
   * diff against the served legacy result.
   */
  private async runRetrievalShadow(
    conversationContext: string,
    legacyMemories: Memory[],
  ): Promise<void> {
    const { memories: ranked } = await runRankedRetrieval(
      this.storage,
      this.config.entityId,
      conversationContext,
      this.tuning,
      this.config.maxMemoryCount || 50,
    );
    const legacyIds = legacyMemories.map(m => m.id);
    const rankedIds = ranked.map(m => m.id);
    const rankedSet = new Set(rankedIds);
    const overlap = legacyIds.filter(id => rankedSet.has(id)).length;
    await this.storage.recordRetrievalShadow({
      entityId: this.config.entityId,
      query: conversationContext,
      legacyIds,
      rankedIds,
      overlap,
    });
    if (this.config.verbose) {
      console.log('[Memory] retrieval shadow:', {
        legacy: legacyIds.length,
        ranked: rankedIds.length,
        overlap,
      });
    }
  }

  /**
   * Legacy retrieval path: vector search (fixed threshold) + array-graph
   * traversal. Unchanged behavior; node retrieval usage recording added.
   */
  private async getContextLegacy(conversationContext: string): Promise<MemoryContext> {
    // Vector search for relevant memories
    const vectorMemories = await this.storage.searchByQuery(
      conversationContext,
      this.config.entityId,
      this.config.maxMemoryCount || 50,
      this.config.similarityThreshold || SearchMode.CONSERVATIVE,
    );

    // Graph traversal to get connected memories
    const allMemories: Memory[] = [];
    const visitedIds = new Set<string>();

    for (const memory of vectorMemories) {
      if (!visitedIds.has(memory.id)) {
        allMemories.push(memory);
        visitedIds.add(memory.id);

        // Get connected memories up to chainDepth
        const connected = await this.storage.getConnectedMemories(
          memory.id,
          this.config.chainDepth || 10,
        );

        for (const connectedMemory of connected) {
          if (!visitedIds.has(connectedMemory.id)) {
            allMemories.push(connectedMemory);
            visitedIds.add(connectedMemory.id);
          }
        }
      }
    }

    // Limit to maxMemoryCount
    const memories = allMemories.slice(0, this.config.maxMemoryCount || 50);

    // Record edge traversals for statistics tracking
    // Reconstruct traversed edges from returned memories' outgoingEdges
    const returnedIds = new Set(memories.map(m => m.id));
    const traversedEdges: Array<{ from: string; to: string }> = [];

    for (const mem of memories) {
      for (const edgeTarget of mem.outgoingEdges) {
        if (returnedIds.has(edgeTarget)) {
          traversedEdges.push({ from: mem.id, to: edgeTarget });
        }
      }
    }

    if (traversedEdges.length > 0) {
      this.storage
        .recordEdgeTraversals(this.config.entityId, traversedEdges)
        .catch(err => {
          console.error('[Memory] Failed to record edge traversals:', err);
        });
    }

    // Usage signal: record node retrievals on the live path (fire-and-forget)
    if (memories.length > 0) {
      this.storage.recordNodeRetrievals(memories.map(m => m.id)).catch(err => {
        console.error('[Memory] failed to record node retrievals:', err);
      });
    }

    // Generate template for system prompt
    const template = this.generateTemplate(memories, conversationContext, true);

    return {
      memories,
      template,
      searchQuery: conversationContext,
      isFromVectorSearch: true, // getContext always starts with vector search
    };
  }

  /**
   * Creates a memory manually
   *
   * Application layer can call this method to manually create a memory.
   * This is useful for initial setup or when you want to explicitly save
   * a memory outside of the automatic context change detection.
   *
   * @param content - Memory content
   * @param options - Creation options
   * @returns Created memory
   *
   * @public
   */
  async createMemory(content: string, options: CreateMemoryOptions = {}): Promise<Memory> {
    if (this.config.mode === 'read-only') {
      throw new Error('Cannot create memory in read-only mode');
    }

    const { autoLink = true, relatedMemoryIds = [], embedding } = options;

    // Create memory (embedding is generated unless a precomputed one is provided)
    const memory = await this.storage.createMemory({
      entityId: this.config.entityId,
      content,
      outgoingEdges: [],
      ...(embedding ? { embedding } : {}),
    });

    // Auto-link to related memories if enabled
    if (autoLink && relatedMemoryIds.length > 0) {
      const outgoingEdges = [...memory.outgoingEdges, ...relatedMemoryIds];
      await this.storage.updateOutgoingEdges(memory.id, outgoingEdges);
      // Dual-write: mirror conversation links into the edges table (kept in
      // sync with the legacy array until the cleanup step retires the array).
      try {
        await this.storage.insertEdges(
          relatedMemoryIds.map(toId => ({
            entityId: this.config.entityId,
            fromId: memory.id,
            toId,
            origin: 'conversation' as const,
            strength: CONVERSATION_EDGE_STRENGTH,
          })),
        );
      } catch (err) {
        console.error('[Memory] edge dual-write failed (array remains source of truth):', err);
      }
    }

    return memory;
  }

  /**
   * Updates an existing memory
   *
   * @param memoryId - Memory ID
   * @param content - New content
   * @returns Updated memory
   *
   * @public
   */
  async updateMemory(memoryId: string, content: string): Promise<Memory> {
    if (this.config.mode === 'read-only') {
      throw new Error('Cannot update memory in read-only mode');
    }

    return this.storage.updateMemory(memoryId, { content });
  }

  /**
   * Deletes a memory
   *
   * @param memoryId - Memory ID
   * @returns Whether deletion was successful
   *
   * @public
   */
  async deleteMemory(memoryId: string): Promise<boolean> {
    if (this.config.mode === 'read-only') {
      throw new Error('Cannot delete memory in read-only mode');
    }

    return this.storage.deleteMemory(memoryId);
  }

  /**
   * Adds or removes a link between two memories (same entity only).
   *
   * @param fromMemoryId - Source memory UUID
   * @param toMemoryId - Target memory UUID
   * @param action - 'add' or 'remove'
   * @returns Updated source memory
   * @throws Error if memories not found or belong to different entities
   *
   * @public
   */
  async updateMemoryLink(
    fromMemoryId: string,
    toMemoryId: string,
    action: 'add' | 'remove',
  ): Promise<Memory> {
    if (this.config.mode === 'read-only') {
      throw new Error('Cannot update memory link in read-only mode');
    }

    const fromMemory = await this.storage.getMemory(fromMemoryId);
    const toMemory = await this.storage.getMemory(toMemoryId);
    if (!fromMemory || !toMemory) {
      throw new Error(`Memory not found: ${!fromMemory ? fromMemoryId : toMemoryId}`);
    }
    if (
      fromMemory.entityId !== this.config.entityId ||
      toMemory.entityId !== this.config.entityId
    ) {
      throw new Error('Memories must belong to the connector entity');
    }
    if (fromMemoryId === toMemoryId) {
      throw new Error('Cannot link memory to itself');
    }

    let edges = [...fromMemory.outgoingEdges];
    if (action === 'add') {
      if (edges.includes(toMemoryId)) {
        return fromMemory;
      }
      edges.push(toMemoryId);
    } else {
      edges = edges.filter(id => id !== toMemoryId);
    }

    const updated = await this.storage.updateOutgoingEdges(fromMemoryId, edges);

    // Dual-write: mirror the link change into the edges table (kept in sync
    // with the legacy array until the cleanup step retires the array).
    try {
      if (action === 'add') {
        await this.storage.insertEdges([
          {
            entityId: this.config.entityId,
            fromId: fromMemoryId,
            toId: toMemoryId,
            origin: 'conversation',
            strength: CONVERSATION_EDGE_STRENGTH,
          },
        ]);
      } else {
        await this.storage.deleteEdge(fromMemoryId, toMemoryId, 'related');
      }
    } catch (err) {
      console.error('[Memory] edge dual-write failed (array remains source of truth):', err);
    }

    return updated;
  }

  /**
   * Gets the current configuration
   *
   * @returns Current configuration
   *
   * @public
   */
  getConfig(): Readonly<MemoryConnectorConfig> {
    return { ...this.config };
  }

  /**
   * Generates a template string from memories for system prompt
   *
   * @param memories - Memories to include in template
   * @param searchQuery - Query that was used for search (optional)
   * @param isFromVectorSearch - Whether memories came from vector search (optional)
   * @returns Template string
   *
   * @private
   */
  private generateTemplate(
    memories: Memory[],
    searchQuery?: string,
    isFromVectorSearch?: boolean,
  ): string {
    if (memories.length === 0) {
      return '# Memories\n(No memories stored yet)';
    }

    const memoryLines = memories.map((memory, index) => {
      const parts: string[] = [];

      // Memory ID
      parts.push(`[Memory #${index + 1} (UUID: ${memory.id})]`);

      // Similarity (if from vector search)
      if (memory.similarity !== undefined && isFromVectorSearch) {
        parts.push(`Similarity: ${(memory.similarity * 100).toFixed(1)}%`);
      }

      // Edge connections
      if (memory.outgoingEdges && memory.outgoingEdges.length > 0) {
        parts.push(`Connected memories: ${memory.outgoingEdges.length}`);
      }

      // Content
      parts.push(memory.content);

      return parts.join(' | ');
    });

    let header = `# Memories\n${memories.length} relevant memor${memories.length === 1 ? 'y' : 'ies'} retrieved.`;
    if (searchQuery && isFromVectorSearch) {
      header += `\nSearch query: "${searchQuery}"`;
    }
    if (isFromVectorSearch === false) {
      header += `\n(Retrieved via graph traversal)`;
    }

    return `${header}\n\n${memoryLines.join('\n')}`;
  }
}
