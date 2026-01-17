/**
 * Memory Connector
 *
 * Connects to chatting manager to automatically detect context changes
 * and save memories. Also provides manual memory creation for application layer.
 *
 * @public
 */

import type { Memory } from '../types';
import type { MemoryStorage } from './storage';
import type { ConversationContext } from '../types';

/**
 * Configuration for Memory Connector
 *
 * @public
 */
export interface MemoryConnectorConfig {
  /** Entity ID (e.g., persona ID, user ID) */
  entityId: string;
  /** Maximum depth for graph traversal (default: 10) */
  chainDepth?: number;
  /** Operation mode: read-only or read-write (default: 'read-write') */
  mode?: 'read-only' | 'read-write';
  /** Maximum number of memories to retrieve (default: 50) */
  maxMemoryCount?: number;
  /** Similarity threshold for vector search (default: 0.7) */
  similarityThreshold?: number;
  /** Whether to automatically generate memories from context changes (default: true) */
  autoGenerate?: boolean;
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
  /** Whether to automatically generate embedding (default: true) */
  autoGenerateEmbedding?: boolean;
}

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
      similarityThreshold: 0.7,
      autoGenerate: true,
      ...config,
    };
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
    if (!this.isConnected || !this.config.autoGenerate) {
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
   * This method should be called by the chatting manager after receiving a response
   * to handle memory creation if needed.
   *
   * @param context - Conversation context
   *
   * @public
   */
  async handleAfterResponse(context: ConversationContext): Promise<void> {
    if (!this.isConnected || !this.config.autoGenerate) {
      return;
    }

    // Interface mode
    if (this.chattingManager?.onAfterResponse) {
      await this.chattingManager.onAfterResponse(context);
    }

    // TODO: Implement automatic memory generation logic
    // This will be implemented when Dynamic Memory Generator is ready
    // See: docs/backlogs/todo/007-epic-2-task-2-2-dynamic-memory-generator.md
  }

  /**
   * Gets memory context for the current conversation
   *
   * Automatically searches for relevant memories using vector search and graph traversal.
   *
   * @param conversationContext - Current conversation context string
   * @returns Memory context with retrieved memories and template
   *
   * @public
   */
  async getContext(conversationContext: string): Promise<MemoryContext> {
    // Vector search for relevant memories
    const vectorMemories = await this.storage.searchByQuery(
      conversationContext,
      this.config.entityId,
      this.config.maxMemoryCount || 50,
      this.config.similarityThreshold || 0.7,
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

    // Generate template for system prompt
    const template = this.generateTemplate(memories);

    return {
      memories,
      template,
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

    const { autoLink = true, autoGenerateEmbedding = true, relatedMemoryIds = [] } = options;

    // Create memory
    const memory = await this.storage.createMemory(
      {
        entityId: this.config.entityId,
        content,
        outgoingEdges: [],
      },
      {
        autoGenerateEmbedding,
      },
    );

    // Auto-link to related memories if enabled
    if (autoLink && relatedMemoryIds.length > 0) {
      const outgoingEdges = [...memory.outgoingEdges, ...relatedMemoryIds];
      await this.storage.updateOutgoingEdges(memory.id, outgoingEdges);
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
   * @returns Template string
   *
   * @private
   */
  private generateTemplate(memories: Memory[]): string {
    if (memories.length === 0) {
      return '# 기억\n(아직 저장된 기억이 없습니다)';
    }

    const memoryLines = memories.map((memory, index) => {
      const similarityInfo =
        memory.similarity !== undefined ? ` (유사도: ${(memory.similarity * 100).toFixed(1)}%)` : '';
      return `[기억 #${index + 1}${similarityInfo}] ${memory.content}`;
    });

    return `# 기억\n총 ${memories.length}개의 관련 기억이 검색되었습니다.\n\n${memoryLines.join('\n')}`;
  }
}
