/**
 * Memory Optimizer
 *
 * Provides graph optimization operations: compress, shortcut, cleanup.
 * Each method sends the entire memory graph to an LLM and lets it decide
 * which operations to perform. Follows the same LLM-delegation pattern
 * as MemoryConsolidator but with distinct optimization responsibilities.
 *
 * - compress: Merge multiple related memories into a single summarized node
 * - createShortcuts: Add direct edges between frequently traversed node pairs
 * - cleanupLinks: Remove semantically weak or ambiguous edges
 * - runOptimization: Orchestrate all three strategies sequentially
 *
 * @public
 */

import type { MemoryStorage } from './storage';
import type {
  Memory,
  AfterResponseContextAdapter,
  OptimizerOperation,
  OptimizationOptions,
  OptimizationResult,
  EdgeTraversalStat,
} from '../types';

// ============================================================================
// System prompts
// ============================================================================

const COMPRESS_SYSTEM_PROMPT = `You are a memory graph optimizer. Your job is to find groups of closely related memories that can be compressed into a single, concise summary node.

You are given a list of memories for an entity. Each memory has:
- id: unique identifier (UUID)
- content: the memory text
- outgoingEdges: already linked memory IDs

Analyze the memories and identify groups that can be **compressed**:
- Memories that form a logical chain (e.g., "lives in Seoul" + "works at Naver" → "Lives in Seoul and works at Naver")
- Memories sharing the same theme that are better represented as one summary
- Only compress if the resulting summary is meaningfully shorter or clearer than keeping them separate

Output a JSON object with "operations" array:
{ "operations": [ { "action": "compress", "sourceMemoryIds": ["id-a", "id-b"], "compressedContent": "...", "linkTo": ["id-c"] }, ... ] }

**Rules:**
- sourceMemoryIds: at least 2 memory IDs from the provided list
- compressedContent: a concise natural-language summary covering all source memories
- linkTo (optional): memory IDs the compressed node should link to (must be from the list, must NOT be in sourceMemoryIds)
- Do NOT compress unrelated memories
- If nothing to compress, output { "operations": [] }
- Output ONLY valid JSON. No markdown code fences.`;

const SHORTCUT_SYSTEM_PROMPT = `You are a memory graph optimizer. Your job is to add shortcut edges between nodes that are frequently accessed together but lack a direct connection.

You are given:
1. A list of memories for an entity (id, content, outgoingEdges)
2. Edge traversal statistics showing how often each edge is traversed (from → to, traversalCount)

Analyze the graph and traversal patterns to find pairs of nodes that should have a direct edge:
- Nodes frequently reached via multi-hop traversals (high traversalCount on intermediate edges)
- Nodes that are semantically related but lack a direct edge
- Only add edges that don't already exist (check outgoingEdges)

Output a JSON object with "operations" array:
{ "operations": [ { "action": "addEdge", "fromMemoryId": "id-1", "toMemoryId": "id-62" }, ... ] }

**Rules:**
- Only use memory IDs from the provided list
- Do NOT add edges that already exist in outgoingEdges
- Do NOT create self-loops (fromMemoryId === toMemoryId)
- If no shortcuts needed, output { "operations": [] }
- Output ONLY valid JSON. No markdown code fences.`;

const CLEANUP_SYSTEM_PROMPT = `You are a memory graph optimizer. Your job is to identify and remove semantically weak or ambiguous edges, and optionally suggest better direct connections.

You are given a list of memories for an entity (id, content, outgoingEdges).

Analyze the edges and identify ones to remove:
- Edges connecting semantically unrelated memories
- Redundant edges (A→B exists but A→C→B is a better path)
- Ambiguous connections that add noise to graph traversal

You may also suggest replacement edges if removing an edge would disconnect important paths.

Output a JSON object with "operations" array:
{ "operations": [ { "action": "removeEdge", "fromMemoryId": "id-1", "toMemoryId": "id-7" }, { "action": "addEdge", "fromMemoryId": "id-1", "toMemoryId": "id-62" } ] }

**Rules:**
- Only use memory IDs from the provided list
- Only remove edges that actually exist in outgoingEdges
- Only add edges that don't already exist
- Do NOT create self-loops
- If nothing to clean up, output { "operations": [] }
- Output ONLY valid JSON. No markdown code fences.`;

// ============================================================================
// Result types for individual strategies
// ============================================================================

/**
 * Result of a compress operation
 *
 * @public
 */
export interface CompressResult {
  /** Whether the operation was successful */
  success: boolean;
  /** Number of compressed nodes created */
  compressedNodesCreated: number;
  /** Created compressed memories */
  createdMemories: Memory[];
  /** Error message if failed */
  error?: string;
  /** Duration in milliseconds */
  durationMs: number;
}

/**
 * Result of a createShortcuts operation
 *
 * @public
 */
export interface ShortcutResult {
  /** Whether the operation was successful */
  success: boolean;
  /** Number of shortcut edges added */
  shortcutsCreated: number;
  /** Created shortcut details */
  createdShortcuts: Array<{ fromMemoryId: string; toMemoryId: string }>;
  /** Error message if failed */
  error?: string;
  /** Duration in milliseconds */
  durationMs: number;
}

/**
 * Result of a cleanupLinks operation
 *
 * @public
 */
export interface CleanupResult {
  /** Whether the operation was successful */
  success: boolean;
  /** Number of edges removed */
  linksRemoved: number;
  /** Number of replacement edges added */
  linksAdded: number;
  /** Error message if failed */
  error?: string;
  /** Duration in milliseconds */
  durationMs: number;
}

/**
 * Common options for individual optimizer methods
 *
 * @public
 */
export interface OptimizerMethodOptions {
  /** LLM adapter for generating optimization decisions (required) */
  contextAdapter: AfterResponseContextAdapter;
  /** Maximum memories per LLM call (default: 50) */
  batchSize?: number;
  /** Enable verbose logging (default: false) */
  verbose?: boolean;
}

// ============================================================================
// MemoryOptimizer class
// ============================================================================

/**
 * Memory Optimizer
 *
 * Provides three graph optimization strategies, each delegating decisions
 * to an LLM. Can be used individually or orchestrated via runOptimization().
 *
 * @public
 */
export class MemoryOptimizer {
  private storage: MemoryStorage;

  /**
   * Creates a new Memory Optimizer instance
   *
   * @param storage - Memory storage instance for database operations
   */
  constructor(storage: MemoryStorage) {
    this.storage = storage;
  }

  // --------------------------------------------------------------------------
  // Public methods
  // --------------------------------------------------------------------------

  /**
   * Compress related memories into summarized nodes
   *
   * @description Sends all entity memories to LLM, which identifies groups
   * that can be compressed. Creates new compressed memory nodes with
   * automatically generated embeddings. Original memories are preserved.
   *
   * @param entityId - Entity ID to optimize
   * @param options - Optimizer options (contextAdapter required)
   * @returns Compress result with statistics and created memories
   *
   * @public
   */
  async compress(entityId: string, options: OptimizerMethodOptions): Promise<CompressResult> {
    const startTime = Date.now();
    const { contextAdapter, batchSize = 50, verbose = false } = options;

    try {
      const memories = await this.storage.getMemoriesByEntity(entityId);

      if (memories.length < 2) {
        return {
          success: true,
          compressedNodesCreated: 0,
          createdMemories: [],
          durationMs: Date.now() - startTime,
        };
      }

      if (verbose) {
        console.log(
          `[Optimizer:compress] Processing ${memories.length} memories for entity ${entityId}`,
        );
      }

      const validIds = new Set(memories.map(m => m.id));
      const totalBatches = Math.ceil(memories.length / batchSize);
      const allCreatedMemories: Memory[] = [];

      for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
        const batchStart = batchIndex * batchSize;
        const batchMemories = memories.slice(batchStart, batchStart + batchSize);

        const operations = await this.getOperationsFromLLM(
          batchMemories,
          COMPRESS_SYSTEM_PROMPT,
          'compress',
          contextAdapter,
          verbose,
        );

        for (const op of operations) {
          if (op.action !== 'compress') continue;

          // Validate sourceMemoryIds
          const validSources = op.sourceMemoryIds.filter(id => validIds.has(id));
          if (validSources.length < 2) {
            if (verbose) {
              console.log('[Optimizer:compress] Skipping: less than 2 valid source IDs');
            }
            continue;
          }

          // Create compressed memory (embedding auto-generated by MemoryStorage)
          const compressedMemory = await this.storage.createMemory({
            entityId,
            content: op.compressedContent,
            outgoingEdges: [],
          });

          // Build outgoing edges: linkTo + sourceMemoryIds, deduplicated
          const edgeSet = new Set<string>();
          for (const id of validSources) {
            edgeSet.add(id);
          }
          if (op.linkTo) {
            for (const id of op.linkTo) {
              if (validIds.has(id) && !validSources.includes(id)) {
                edgeSet.add(id);
              }
            }
          }

          // Remove self-reference if somehow present
          edgeSet.delete(compressedMemory.id);

          if (edgeSet.size > 0) {
            await this.storage.updateOutgoingEdges(compressedMemory.id, Array.from(edgeSet));
          }

          allCreatedMemories.push(compressedMemory);

          if (verbose) {
            console.log(
              `[Optimizer:compress] Created compressed node ${compressedMemory.id} from ${validSources.length} sources`,
            );
          }
        }
      }

      return {
        success: true,
        compressedNodesCreated: allCreatedMemories.length,
        createdMemories: allCreatedMemories,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (verbose) {
        console.error(`[Optimizer:compress] Error: ${errorMessage}`);
      }
      return {
        success: false,
        compressedNodesCreated: 0,
        createdMemories: [],
        error: errorMessage,
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Add shortcut edges between frequently traversed node pairs
   *
   * @description Sends all entity memories and edge traversal statistics
   * to LLM, which identifies pairs that benefit from a direct edge.
   *
   * @param entityId - Entity ID to optimize
   * @param options - Optimizer options (contextAdapter required)
   * @returns Shortcut result with statistics
   *
   * @public
   */
  async createShortcuts(
    entityId: string,
    options: OptimizerMethodOptions,
  ): Promise<ShortcutResult> {
    const startTime = Date.now();
    const { contextAdapter, batchSize = 50, verbose = false } = options;

    try {
      const [memories, stats] = await Promise.all([
        this.storage.getMemoriesByEntity(entityId),
        this.storage.getEdgeTraversalStats(entityId),
      ]);

      if (memories.length === 0) {
        return {
          success: true,
          shortcutsCreated: 0,
          createdShortcuts: [],
          durationMs: Date.now() - startTime,
        };
      }

      if (verbose) {
        console.log(
          `[Optimizer:shortcut] Processing ${memories.length} memories, ${stats.length} edge stats`,
        );
      }

      const validIds = new Set(memories.map(m => m.id));
      const existingEdges = this.buildExistingEdgesMap(memories);
      const totalBatches = Math.ceil(memories.length / batchSize);
      const allCreatedShortcuts: Array<{ fromMemoryId: string; toMemoryId: string }> = [];

      for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
        const batchStart = batchIndex * batchSize;
        const batchMemories = memories.slice(batchStart, batchStart + batchSize);

        const operations = await this.getShortcutOperationsFromLLM(
          batchMemories,
          stats,
          contextAdapter,
          verbose,
        );

        for (const op of operations) {
          if (op.action !== 'addEdge') continue;

          const { fromMemoryId, toMemoryId } = op;

          // Validate IDs
          if (!validIds.has(fromMemoryId) || !validIds.has(toMemoryId)) continue;
          if (fromMemoryId === toMemoryId) continue;
          if (existingEdges.get(fromMemoryId)?.has(toMemoryId)) continue;

          // Add edge
          const fromMemory = await this.storage.getMemory(fromMemoryId);
          if (!fromMemory) continue;

          const edges = new Set(fromMemory.outgoingEdges);
          edges.add(toMemoryId);
          await this.storage.updateOutgoingEdges(fromMemoryId, Array.from(edges));

          // Update local tracking
          if (!existingEdges.has(fromMemoryId)) {
            existingEdges.set(fromMemoryId, new Set());
          }
          existingEdges.get(fromMemoryId)!.add(toMemoryId);

          allCreatedShortcuts.push({ fromMemoryId, toMemoryId });

          if (verbose) {
            console.log(`[Optimizer:shortcut] Added edge: ${fromMemoryId} → ${toMemoryId}`);
          }
        }
      }

      return {
        success: true,
        shortcutsCreated: allCreatedShortcuts.length,
        createdShortcuts: allCreatedShortcuts,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (verbose) {
        console.error(`[Optimizer:shortcut] Error: ${errorMessage}`);
      }
      return {
        success: false,
        shortcutsCreated: 0,
        createdShortcuts: [],
        error: errorMessage,
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Remove semantically weak or ambiguous edges
   *
   * @description Sends all entity memories to LLM, which identifies
   * edges to remove and optionally suggests replacement edges.
   *
   * @param entityId - Entity ID to optimize
   * @param options - Optimizer options (contextAdapter required)
   * @returns Cleanup result with statistics
   *
   * @public
   */
  async cleanupLinks(entityId: string, options: OptimizerMethodOptions): Promise<CleanupResult> {
    const startTime = Date.now();
    const { contextAdapter, batchSize = 50, verbose = false } = options;

    try {
      const memories = await this.storage.getMemoriesByEntity(entityId);

      if (memories.length === 0) {
        return {
          success: true,
          linksRemoved: 0,
          linksAdded: 0,
          durationMs: Date.now() - startTime,
        };
      }

      if (verbose) {
        console.log(
          `[Optimizer:cleanup] Processing ${memories.length} memories for entity ${entityId}`,
        );
      }

      const validIds = new Set(memories.map(m => m.id));
      const existingEdges = this.buildExistingEdgesMap(memories);
      const totalBatches = Math.ceil(memories.length / batchSize);
      let totalRemoved = 0;
      let totalAdded = 0;

      for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
        const batchStart = batchIndex * batchSize;
        const batchMemories = memories.slice(batchStart, batchStart + batchSize);

        const operations = await this.getOperationsFromLLM(
          batchMemories,
          CLEANUP_SYSTEM_PROMPT,
          'cleanup',
          contextAdapter,
          verbose,
        );

        for (const op of operations) {
          if (op.action === 'removeEdge') {
            const { fromMemoryId, toMemoryId } = op;

            if (!validIds.has(fromMemoryId) || !validIds.has(toMemoryId)) continue;
            if (!existingEdges.get(fromMemoryId)?.has(toMemoryId)) continue;

            const fromMemory = await this.storage.getMemory(fromMemoryId);
            if (!fromMemory) continue;

            const edges = fromMemory.outgoingEdges.filter(id => id !== toMemoryId);
            await this.storage.updateOutgoingEdges(fromMemoryId, edges);

            existingEdges.get(fromMemoryId)?.delete(toMemoryId);
            totalRemoved++;

            if (verbose) {
              console.log(`[Optimizer:cleanup] Removed edge: ${fromMemoryId} → ${toMemoryId}`);
            }
          } else if (op.action === 'addEdge') {
            const { fromMemoryId, toMemoryId } = op;

            if (!validIds.has(fromMemoryId) || !validIds.has(toMemoryId)) continue;
            if (fromMemoryId === toMemoryId) continue;
            if (existingEdges.get(fromMemoryId)?.has(toMemoryId)) continue;

            const fromMemory = await this.storage.getMemory(fromMemoryId);
            if (!fromMemory) continue;

            const edges = new Set(fromMemory.outgoingEdges);
            edges.add(toMemoryId);
            await this.storage.updateOutgoingEdges(fromMemoryId, Array.from(edges));

            if (!existingEdges.has(fromMemoryId)) {
              existingEdges.set(fromMemoryId, new Set());
            }
            existingEdges.get(fromMemoryId)!.add(toMemoryId);
            totalAdded++;

            if (verbose) {
              console.log(
                `[Optimizer:cleanup] Added replacement edge: ${fromMemoryId} → ${toMemoryId}`,
              );
            }
          }
        }
      }

      return {
        success: true,
        linksRemoved: totalRemoved,
        linksAdded: totalAdded,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (verbose) {
        console.error(`[Optimizer:cleanup] Error: ${errorMessage}`);
      }
      return {
        success: false,
        linksRemoved: 0,
        linksAdded: 0,
        error: errorMessage,
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Run all optimization strategies sequentially
   *
   * @description Orchestrates cleanup → compress → shortcut in order.
   * Respects the `scope` option to run only specific strategies.
   *
   * @param entityId - Entity ID to optimize
   * @param options - Optimization options (contextAdapter required)
   * @returns Aggregated optimization result
   *
   * @public
   */
  async runOptimization(
    entityId: string,
    options: OptimizationOptions,
  ): Promise<OptimizationResult> {
    const startTime = Date.now();
    const { scope = 'all', contextAdapter, batchSize = 50, verbose = false } = options;
    const methodOptions: OptimizerMethodOptions = { contextAdapter, batchSize, verbose };

    let compressedNodesCreated = 0;
    let shortcutsCreated = 0;
    let linksRemoved = 0;

    if (verbose) {
      console.log(`[Optimizer] runOptimization: scope=${scope}, entity=${entityId}`);
    }

    // 1. Cleanup links first (clean graph before compression)
    if (scope === 'all' || scope === 'cleanup') {
      const cleanupResult = await this.cleanupLinks(entityId, methodOptions);
      linksRemoved += cleanupResult.linksRemoved;
    }

    // 2. Compress (operate on cleaned graph)
    if (scope === 'all' || scope === 'compress') {
      const compressResult = await this.compress(entityId, methodOptions);
      compressedNodesCreated += compressResult.compressedNodesCreated;
    }

    // 3. Create shortcuts (final optimization pass)
    if (scope === 'all' || scope === 'shortcut') {
      const shortcutResult = await this.createShortcuts(entityId, methodOptions);
      shortcutsCreated += shortcutResult.shortcutsCreated;
    }

    const result: OptimizationResult = {
      compressedNodesCreated,
      shortcutsCreated,
      linksRemoved,
      durationMs: Date.now() - startTime,
    };

    if (verbose) {
      console.log('[Optimizer] runOptimization complete:', result);
    }

    return result;
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  /**
   * Formats memories for LLM prompt
   */
  private formatMemoriesForPrompt(memories: Memory[]): string {
    if (memories.length === 0) return '(none)';
    return memories
      .map(
        m =>
          `- id: ${m.id}\n  content: ${m.content}\n  outgoingEdges: [${(m.outgoingEdges ?? []).join(', ')}]`,
      )
      .join('\n');
  }

  /**
   * Formats edge traversal statistics for LLM prompt
   */
  private formatStatsForPrompt(stats: EdgeTraversalStat[]): string {
    if (stats.length === 0) return '(no traversal statistics available)';
    return stats
      .map(
        s =>
          `- ${s.fromMemoryId} → ${s.toMemoryId} (traversals: ${s.traversalCount})`,
      )
      .join('\n');
  }

  /**
   * Builds a map of existing outgoing edges for quick lookup
   */
  private buildExistingEdgesMap(memories: Memory[]): Map<string, Set<string>> {
    const map = new Map<string, Set<string>>();
    for (const m of memories) {
      map.set(m.id, new Set(m.outgoingEdges ?? []));
    }
    return map;
  }

  /**
   * Gets optimizer operations from LLM for compress/cleanup strategies
   *
   * @param memories - Memories to analyze
   * @param systemPrompt - Strategy-specific system prompt
   * @param strategy - Strategy name for logging
   * @param contextAdapter - LLM adapter
   * @param verbose - Enable logging
   * @returns Parsed optimizer operations
   */
  private async getOperationsFromLLM(
    memories: Memory[],
    systemPrompt: string,
    strategy: string,
    contextAdapter: AfterResponseContextAdapter,
    verbose: boolean,
  ): Promise<OptimizerOperation[]> {
    const memoriesText = this.formatMemoriesForPrompt(memories);

    const messages = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Analyze these memories and suggest operations:\n\n${memoriesText}\n\nOutput JSON: { "operations": [ ... ] }`,
      },
    ];

    let raw: string;
    try {
      raw = await contextAdapter.generate(messages);
    } catch (err) {
      if (verbose) {
        console.error(`[Optimizer:${strategy}] LLM error:`, err);
      }
      return [];
    }

    if (verbose) {
      console.log(`[Optimizer:${strategy}] LLM response:`, raw.slice(0, 500));
    }

    return this.parseOperations(raw, memories);
  }

  /**
   * Gets shortcut operations from LLM (includes traversal statistics)
   *
   * @param memories - Memories to analyze
   * @param stats - Edge traversal statistics
   * @param contextAdapter - LLM adapter
   * @param verbose - Enable logging
   * @returns Parsed optimizer operations
   */
  private async getShortcutOperationsFromLLM(
    memories: Memory[],
    stats: EdgeTraversalStat[],
    contextAdapter: AfterResponseContextAdapter,
    verbose: boolean,
  ): Promise<OptimizerOperation[]> {
    const memoriesText = this.formatMemoriesForPrompt(memories);
    const statsText = this.formatStatsForPrompt(stats);

    const messages = [
      { role: 'system', content: SHORTCUT_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Analyze these memories and traversal statistics to suggest shortcut edges:\n\nMemories:\n${memoriesText}\n\nEdge Traversal Statistics:\n${statsText}\n\nOutput JSON: { "operations": [ ... ] }`,
      },
    ];

    let raw: string;
    try {
      raw = await contextAdapter.generate(messages);
    } catch (err) {
      if (verbose) {
        console.error('[Optimizer:shortcut] LLM error:', err);
      }
      return [];
    }

    if (verbose) {
      console.log('[Optimizer:shortcut] LLM response:', raw.slice(0, 500));
    }

    return this.parseOperations(raw, memories);
  }

  /**
   * Parses LLM response into validated optimizer operations
   *
   * @param content - Raw LLM response string
   * @param memories - Context memories for ID validation
   * @returns Validated optimizer operations
   */
  private parseOperations(content: string, memories: Memory[]): OptimizerOperation[] {
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
    const valid: OptimizerOperation[] = [];

    for (const o of ops) {
      if (!o || typeof o !== 'object' || !('action' in o)) continue;
      const raw = o as Record<string, unknown>;
      const action = raw.action as string;

      if (action === 'compress') {
        const sourceIds = Array.isArray(raw.sourceMemoryIds)
          ? (raw.sourceMemoryIds as unknown[]).filter(
              (s): s is string => typeof s === 'string' && validIds.has(s),
            )
          : [];
        const linkTo = Array.isArray(raw.linkTo)
          ? (raw.linkTo as unknown[]).filter(
              (s): s is string => typeof s === 'string' && validIds.has(s),
            )
          : undefined;

        if (sourceIds.length >= 2 && typeof raw.compressedContent === 'string') {
          valid.push({
            action: 'compress',
            sourceMemoryIds: sourceIds,
            compressedContent: raw.compressedContent,
            linkTo: linkTo && linkTo.length > 0 ? linkTo : undefined,
          });
        }
      } else if (action === 'addEdge') {
        if (
          typeof raw.fromMemoryId === 'string' &&
          typeof raw.toMemoryId === 'string' &&
          validIds.has(raw.fromMemoryId) &&
          validIds.has(raw.toMemoryId) &&
          raw.fromMemoryId !== raw.toMemoryId
        ) {
          valid.push({
            action: 'addEdge',
            fromMemoryId: raw.fromMemoryId,
            toMemoryId: raw.toMemoryId,
          });
        }
      } else if (action === 'removeEdge') {
        if (
          typeof raw.fromMemoryId === 'string' &&
          typeof raw.toMemoryId === 'string' &&
          validIds.has(raw.fromMemoryId) &&
          validIds.has(raw.toMemoryId)
        ) {
          valid.push({
            action: 'removeEdge',
            fromMemoryId: raw.fromMemoryId,
            toMemoryId: raw.toMemoryId,
          });
        }
      }
    }

    return valid;
  }
}

// ============================================================================
// Convenience functions
// ============================================================================

/**
 * Convenience function to run all optimization strategies
 *
 * Creates a MemoryOptimizer and runs optimization for the given entity.
 * Orchestrates cleanup → compress → shortcut in order.
 *
 * @param storage - Memory storage instance
 * @param entityId - Entity ID to optimize
 * @param options - Optimization options (contextAdapter required)
 * @returns Aggregated optimization result
 *
 * @public
 */
export async function optimizeMemories(
  storage: MemoryStorage,
  entityId: string,
  options: OptimizationOptions,
): Promise<OptimizationResult> {
  const optimizer = new MemoryOptimizer(storage);
  return optimizer.runOptimization(entityId, options);
}

/**
 * Convenience function to compress related memories into summarized nodes
 *
 * Creates a MemoryOptimizer and runs compression for the given entity.
 * Original memories are preserved; new compressed nodes are created.
 *
 * @param storage - Memory storage instance
 * @param entityId - Entity ID to optimize
 * @param options - Optimizer method options (contextAdapter required)
 * @returns Compress result with statistics and created memories
 *
 * @public
 */
export async function compressMemories(
  storage: MemoryStorage,
  entityId: string,
  options: OptimizerMethodOptions,
): Promise<CompressResult> {
  const optimizer = new MemoryOptimizer(storage);
  return optimizer.compress(entityId, options);
}

/**
 * Convenience function to add shortcut edges between frequently traversed node pairs
 *
 * Creates a MemoryOptimizer and adds shortcuts for the given entity.
 * Uses edge traversal statistics to identify candidates.
 *
 * @param storage - Memory storage instance
 * @param entityId - Entity ID to optimize
 * @param options - Optimizer method options (contextAdapter required)
 * @returns Shortcut result with statistics
 *
 * @public
 */
export async function createMemoryShortcuts(
  storage: MemoryStorage,
  entityId: string,
  options: OptimizerMethodOptions,
): Promise<ShortcutResult> {
  const optimizer = new MemoryOptimizer(storage);
  return optimizer.createShortcuts(entityId, options);
}

/**
 * Convenience function to remove semantically weak or ambiguous edges
 *
 * Creates a MemoryOptimizer and runs link cleanup for the given entity.
 * May also add replacement edges when removing would disconnect important paths.
 *
 * @param storage - Memory storage instance
 * @param entityId - Entity ID to optimize
 * @param options - Optimizer method options (contextAdapter required)
 * @returns Cleanup result with statistics
 *
 * @public
 */
export async function cleanupMemoryLinks(
  storage: MemoryStorage,
  entityId: string,
  options: OptimizerMethodOptions,
): Promise<CleanupResult> {
  const optimizer = new MemoryOptimizer(storage);
  return optimizer.cleanupLinks(entityId, options);
}
