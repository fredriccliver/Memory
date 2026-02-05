/**
 * Memory Consolidator
 *
 * Handles memory consolidation - scanning entity memories and linking
 * related memories using LLM judgment.
 * Similar to how humans consolidate memories during sleep.
 *
 * Uses the same LLM-based approach as real-time memory linking:
 * shows all memories to LLM and lets it decide logical relationships.
 *
 * @public
 */

import type { MemoryStorage } from './storage';
import type { Memory, AfterResponseContextAdapter, MemoryOperation } from '../types';

/**
 * Options for memory consolidation
 *
 * @public
 */
export interface ConsolidateMemoriesOptions {
  /**
   * LLM adapter for generating link decisions
   * Required - consolidation uses LLM to determine logical relationships
   */
  contextAdapter: AfterResponseContextAdapter;

  /**
   * Whether to create bidirectional links (A→B and B→A)
   * @default true
   */
  bidirectional?: boolean;

  /**
   * Maximum memories to process in a single LLM call
   * If entity has more memories, they will be processed in batches
   * @default 50
   */
  batchSize?: number;

  /**
   * Callback for progress reporting
   */
  onProgress?: (progress: ConsolidationProgress) => void;

  /**
   * Enable verbose logging
   * @default false
   */
  verbose?: boolean;
}

/**
 * Progress information during consolidation
 *
 * @public
 */
export interface ConsolidationProgress {
  /** Current batch being processed */
  currentBatch: number;
  /** Total number of batches */
  totalBatches: number;
  /** Total memories in entity */
  totalMemories: number;
  /** Number of new links created so far */
  linksCreated: number;
}

/**
 * Result of memory consolidation
 *
 * @public
 */
export interface ConsolidateMemoriesResult {
  /** Whether the operation was successful */
  success: boolean;
  /** Total memories processed */
  memoriesProcessed: number;
  /** Total new links created */
  linksCreated: number;
  /** Links that were created */
  createdLinks: Array<{
    fromMemoryId: string;
    toMemoryId: string;
  }>;
  /** Error message if failed */
  error?: string;
  /** Duration in milliseconds */
  durationMs: number;
}

/**
 * System prompt for consolidation LLM
 */
const CONSOLIDATION_SYSTEM_PROMPT = `You are a memory link analyzer. Your job is to identify logical relationships between memories and suggest links.

You are given a list of memories for an entity. Each memory has:
- id: unique identifier
- content: the memory text
- outgoingEdges: already linked memory IDs

Analyze the memories and identify pairs that should be linked based on:
- Logical relationships (cause-effect, context, related topics)
- Semantic connections (same person, place, project, theme)
- Temporal relationships (events that happened together or in sequence)

Output a JSON object with "operations" array containing updateLink operations:
{ "operations": [ { "action": "updateLink", "fromMemoryId": "...", "toMemoryId": "...", "linkAction": "add" }, ... ] }

**Rules:**
- Only suggest links that don't already exist (check outgoingEdges)
- Only use memory IDs from the provided list
- Focus on meaningful relationships, not superficial word matches
- If no new links are needed, output { "operations": [] }
- Output ONLY valid JSON. No markdown code fences.

**Example relationships to link:**
- "I run an AI startup" ↔ "Fundraising is the hardest part" (same context: startup)
- "I live in Seoul" ↔ "My commute takes 1 hour" (related: location/daily life)
- "I'm learning Python" ↔ "Built a web scraper last week" (related: programming)`;

/**
 * Memory Consolidator
 *
 * Scans entity memories and creates links between related memories
 * using LLM judgment. Designed to be called periodically
 * (like background maintenance) or manually triggered.
 *
 * @public
 */
export class MemoryConsolidator {
  private storage: MemoryStorage;

  /**
   * Creates a new Memory Consolidator instance
   *
   * @param storage - Memory storage instance for database operations
   */
  constructor(storage: MemoryStorage) {
    this.storage = storage;
  }

  /**
   * Consolidate memories for an entity
   *
   * Scans all memories for the given entity and creates links between
   * related memories based on LLM judgment.
   *
   * @param entityId - Entity ID to consolidate memories for
   * @param options - Consolidation options (contextAdapter required)
   * @returns Consolidation result with statistics
   *
   * @public
   */
  async consolidateMemories(
    entityId: string,
    options: ConsolidateMemoriesOptions,
  ): Promise<ConsolidateMemoriesResult> {
    const startTime = Date.now();
    const {
      contextAdapter,
      bidirectional = true,
      batchSize = 50,
      onProgress,
      verbose = false,
    } = options;

    try {
      const memories = await this.storage.getMemoriesByEntity(entityId);

      if (memories.length === 0) {
        return {
          success: true,
          memoriesProcessed: 0,
          linksCreated: 0,
          createdLinks: [],
          durationMs: Date.now() - startTime,
        };
      }

      if (verbose) {
        console.log(`[Consolidator] Processing ${memories.length} memories for entity ${entityId}`);
      }

      const totalBatches = Math.ceil(memories.length / batchSize);
      let totalLinksCreated = 0;
      const allCreatedLinks: Array<{ fromMemoryId: string; toMemoryId: string }> = [];

      for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
        const batchStart = batchIndex * batchSize;
        const batchMemories = memories.slice(batchStart, batchStart + batchSize);

        if (onProgress) {
          onProgress({
            currentBatch: batchIndex + 1,
            totalBatches,
            totalMemories: memories.length,
            linksCreated: totalLinksCreated,
          });
        }

        const operations = await this.getLinkOperationsFromLLM(
          batchMemories,
          contextAdapter,
          verbose,
        );

        const createdLinks = await this.executeOperations(operations, bidirectional, verbose);

        totalLinksCreated += createdLinks.length;
        allCreatedLinks.push(...createdLinks);
      }

      if (verbose) {
        console.log(`[Consolidator] Completed: ${totalLinksCreated} links created`);
      }

      return {
        success: true,
        memoriesProcessed: memories.length,
        linksCreated: totalLinksCreated,
        createdLinks: allCreatedLinks,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      if (verbose) {
        console.error(`[Consolidator] Error: ${errorMessage}`);
      }
      return {
        success: false,
        memoriesProcessed: 0,
        linksCreated: 0,
        createdLinks: [],
        error: errorMessage,
        durationMs: Date.now() - startTime,
      };
    }
  }

  private formatMemoriesForPrompt(memories: Memory[]): string {
    if (memories.length === 0) return '(none)';
    return memories
      .map(
        m =>
          `- id: ${m.id}\n  content: ${m.content}\n  outgoingEdges: [${(m.outgoingEdges ?? []).join(', ')}]`,
      )
      .join('\n');
  }

  private async getLinkOperationsFromLLM(
    memories: Memory[],
    contextAdapter: AfterResponseContextAdapter,
    verbose: boolean,
  ): Promise<MemoryOperation[]> {
    const memoriesText = this.formatMemoriesForPrompt(memories);

    const messages = [
      { role: 'system', content: CONSOLIDATION_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Analyze these memories and suggest links:\n\n${memoriesText}\n\nOutput JSON: { "operations": [ ... ] }`,
      },
    ];

    let raw: string;
    try {
      raw = await contextAdapter.generate(messages);
    } catch (err) {
      if (verbose) {
        console.error('[Consolidator] LLM error:', err);
      }
      return [];
    }

    if (verbose) {
      console.log('[Consolidator] LLM response:', raw.slice(0, 500));
    }

    return this.parseOperationsFromResponse(raw, memories);
  }

  private parseOperationsFromResponse(content: string, memories: Memory[]): MemoryOperation[] {
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
    const validIds = new Set(memories.map(m => m.id));
    const existingEdges = new Map<string, Set<string>>();

    for (const m of memories) {
      existingEdges.set(m.id, new Set(m.outgoingEdges ?? []));
    }

    const valid: MemoryOperation[] = [];

    for (const o of ops) {
      if (!o || typeof o !== 'object' || !('action' in o)) continue;
      const raw = o as Record<string, unknown>;

      if (
        raw.action === 'updateLink' &&
        typeof raw.fromMemoryId === 'string' &&
        typeof raw.toMemoryId === 'string' &&
        raw.linkAction === 'add'
      ) {
        const fromId = raw.fromMemoryId;
        const toId = raw.toMemoryId;

        if (!validIds.has(fromId) || !validIds.has(toId)) continue;
        if (fromId === toId) continue;
        if (existingEdges.get(fromId)?.has(toId)) continue;

        valid.push({
          action: 'updateLink',
          fromMemoryId: fromId,
          toMemoryId: toId,
          linkAction: 'add',
        });
      }
    }

    return valid;
  }

  private async executeOperations(
    operations: MemoryOperation[],
    bidirectional: boolean,
    verbose: boolean,
  ): Promise<Array<{ fromMemoryId: string; toMemoryId: string }>> {
    const createdLinks: Array<{ fromMemoryId: string; toMemoryId: string }> = [];

    for (const op of operations) {
      if (op.action !== 'updateLink') continue;

      try {
        const fromMemory = await this.storage.getMemory(op.fromMemoryId);
        if (!fromMemory) continue;

        const edges = [...fromMemory.outgoingEdges];
        if (!edges.includes(op.toMemoryId)) {
          edges.push(op.toMemoryId);
          await this.storage.updateOutgoingEdges(op.fromMemoryId, edges);
          createdLinks.push({ fromMemoryId: op.fromMemoryId, toMemoryId: op.toMemoryId });

          if (verbose) {
            console.log(`[Consolidator] Linked: ${op.fromMemoryId} → ${op.toMemoryId}`);
          }
        }

        if (bidirectional) {
          const toMemory = await this.storage.getMemory(op.toMemoryId);
          if (toMemory) {
            const reverseEdges = [...toMemory.outgoingEdges];
            if (!reverseEdges.includes(op.fromMemoryId)) {
              reverseEdges.push(op.fromMemoryId);
              await this.storage.updateOutgoingEdges(op.toMemoryId, reverseEdges);

              if (verbose) {
                console.log(
                  `[Consolidator] Linked (reverse): ${op.toMemoryId} → ${op.fromMemoryId}`,
                );
              }
            }
          }
        }
      } catch (err) {
        if (verbose) {
          console.error('[Consolidator] Operation error:', err);
        }
      }
    }

    return createdLinks;
  }
}

/**
 * Convenience function to consolidate memories
 *
 * Creates a MemoryConsolidator and runs consolidation for the given entity.
 *
 * @param storage - Memory storage instance
 * @param entityId - Entity ID to consolidate memories for
 * @param options - Consolidation options (contextAdapter required)
 * @returns Consolidation result
 *
 * @public
 */
export async function consolidateMemories(
  storage: MemoryStorage,
  entityId: string,
  options: ConsolidateMemoriesOptions,
): Promise<ConsolidateMemoriesResult> {
  const consolidator = new MemoryConsolidator(storage);
  return consolidator.consolidateMemories(entityId, options);
}
