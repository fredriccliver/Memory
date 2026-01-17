/**
 * Memory Tool Handler
 *
 * Handles AI tool calling requests for memory operations.
 * This class processes tool calls from AI and performs actual memory operations
 * using MemoryStorage.
 *
 * @public
 */

import type { MemoryStorage } from './storage';
import type { Memory } from '../types';
import { DynamicMemoryGenerator } from './generator';

/**
 * Parameters for creating a memory
 *
 * @public
 */
export interface CreateMemoryParams {
  /** Memory content (natural language text) */
  content: string;
  /** Entity ID this memory belongs to (TEXT, not UUID) */
  entityId: string;
  /** Related memory UUIDs to link with (optional) - Array of Memory UUIDs */
  relatedMemoryIds?: string[];
}

/**
 * Parameters for updating a memory
 *
 * @public
 */
export interface UpdateMemoryParams {
  /** Memory UUID to update (not table index) */
  memoryId: string;
  /** Updated memory content */
  content: string;
}

/**
 * Parameters for updating memory links
 *
 * @public
 */
export interface UpdateMemoryLinkParams {
  /** Source memory UUID (not table index) */
  fromMemoryId: string;
  /** Target memory UUID (not table index) */
  toMemoryId: string;
  /** Action to perform: 'add' or 'remove' */
  action: 'add' | 'remove';
}

/**
 * Parameters for deleting a memory
 *
 * @public
 */
export interface DeleteMemoryParams {
  /** Memory UUID to delete (not table index) */
  memoryId: string;
}

/**
 * Result of a tool handler operation
 *
 * @public
 */
export interface ToolHandlerResult<T = Memory> {
  /** Whether the operation was successful */
  success: boolean;
  /** Result data (if successful) */
  data?: T;
  /** Error message (if failed) */
  error?: string;
}

/**
 * Memory Tool Handler
 *
 * Processes AI tool calling requests and performs memory operations.
 * Handles create, update, link, and delete operations for memories.
 *
 * @public
 */
export class MemoryToolHandler {
  private storage: MemoryStorage;
  private generator: DynamicMemoryGenerator;

  /**
   * Creates a new Memory Tool Handler instance
   *
   * @param storage - Memory storage instance for database operations
   */
  constructor(storage: MemoryStorage) {
    this.storage = storage;
    this.generator = new DynamicMemoryGenerator(storage);
  }

  /**
   * Handles createMemory tool call
   *
   * Creates a new memory with automatic embedding generation and optional linking
   * to related memories.
   *
   * @param params - Create memory parameters
   * @param params.content - Memory content (natural language text)
   * @param params.entityId - Entity ID (TEXT, not UUID) this memory belongs to
   * @param params.relatedMemoryIds - Optional array of Memory UUIDs to link with
   * @returns Tool handler result with created memory (includes generated UUID)
   *
   * @public
   */
  async handleCreateMemory(
    params: CreateMemoryParams,
  ): Promise<ToolHandlerResult<Memory>> {
    try {
      // Validate parameters
      if (!params.content || params.content.trim().length === 0) {
        return {
          success: false,
          error: 'Memory content is required and cannot be empty',
        };
      }

      if (!params.entityId || params.entityId.trim().length === 0) {
        return {
          success: false,
          error: 'Entity ID is required',
        };
      }

      // Validate related memory UUIDs exist
      if (params.relatedMemoryIds && params.relatedMemoryIds.length > 0) {
        for (const relatedId of params.relatedMemoryIds) {
          const relatedMemory = await this.storage.getMemory(relatedId);
          if (!relatedMemory) {
            return {
              success: false,
              error: `Related memory with UUID ${relatedId} not found`,
            };
          }
          // Ensure related memory belongs to the same entity
          if (relatedMemory.entityId !== params.entityId) {
            return {
              success: false,
              error: `Related memory ${relatedId} belongs to a different entity`,
            };
          }
        }
      }

      // Create memory with automatic embedding generation
      const memory = await this.storage.createMemory(
        {
          content: params.content.trim(),
          entityId: params.entityId,
          outgoingEdges: params.relatedMemoryIds || [],
        },
        {
          autoGenerateEmbedding: true,
        },
      );

      // Link to related memories (update their outgoingEdges to include this new memory)
      if (params.relatedMemoryIds && params.relatedMemoryIds.length > 0) {
        await Promise.all(
          params.relatedMemoryIds.map(async relatedId => {
            const relatedMemory = await this.storage.getMemory(relatedId);
            if (relatedMemory) {
              // Add bidirectional link (if not already present)
              const updatedEdges = [...relatedMemory.outgoingEdges];
              if (!updatedEdges.includes(memory.id)) {
                updatedEdges.push(memory.id);
                await this.storage.updateOutgoingEdges(relatedId, updatedEdges);
              }
            }
          }),
        );
      }

      return {
        success: true,
        data: memory,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  /**
   * Handles updateMemory tool call
   *
   * Updates an existing memory's content and automatically regenerates embedding.
   *
   * @param params - Update memory parameters
   * @param params.memoryId - Memory UUID (not table index)
   * @param params.content - Updated memory content
   * @returns Tool handler result with updated memory
   *
   * @public
   */
  async handleUpdateMemory(
    params: UpdateMemoryParams,
  ): Promise<ToolHandlerResult<Memory>> {
    try {
      // Validate parameters
      if (!params.memoryId || params.memoryId.trim().length === 0) {
        return {
          success: false,
          error: 'Memory UUID is required',
        };
      }

      if (!params.content || params.content.trim().length === 0) {
        return {
          success: false,
          error: 'Memory content is required and cannot be empty',
        };
      }

      // Check if memory exists
      const existingMemory = await this.storage.getMemory(params.memoryId);
      if (!existingMemory) {
        return {
          success: false,
          error: `Memory with UUID ${params.memoryId} not found`,
        };
      }

      // Update memory (embedding will be automatically regenerated)
      const updatedMemory = await this.storage.updateMemory(params.memoryId, {
        content: params.content.trim(),
      });

      return {
        success: true,
        data: updatedMemory,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  /**
   * Handles updateMemoryLink tool call
   *
   * Adds or removes a link between two memories by updating outgoingEdges.
   *
   * @param params - Update memory link parameters
   * @param params.fromMemoryId - Source memory UUID (not table index)
   * @param params.toMemoryId - Target memory UUID (not table index)
   * @param params.action - Action to perform: 'add' or 'remove'
   * @returns Tool handler result with updated memory
   *
   * @public
   */
  async handleUpdateMemoryLink(
    params: UpdateMemoryLinkParams,
  ): Promise<ToolHandlerResult<Memory>> {
    try {
      // Validate parameters
      if (!params.fromMemoryId || params.fromMemoryId.trim().length === 0) {
        return {
          success: false,
          error: 'From memory UUID is required',
        };
      }

      if (!params.toMemoryId || params.toMemoryId.trim().length === 0) {
        return {
          success: false,
          error: 'To memory UUID is required',
        };
      }

      if (params.fromMemoryId === params.toMemoryId) {
        return {
          success: false,
          error: 'Cannot link memory to itself',
        };
      }

      if (params.action !== 'add' && params.action !== 'remove') {
        return {
          success: false,
          error: "Action must be either 'add' or 'remove'",
        };
      }

      // Check if both memories exist
      const fromMemory = await this.storage.getMemory(params.fromMemoryId);
      if (!fromMemory) {
        return {
          success: false,
          error: `Memory with UUID ${params.fromMemoryId} not found`,
        };
      }

      const toMemory = await this.storage.getMemory(params.toMemoryId);
      if (!toMemory) {
        return {
          success: false,
          error: `Memory with UUID ${params.toMemoryId} not found`,
        };
      }

      // Ensure both memories belong to the same entity
      if (fromMemory.entityId !== toMemory.entityId) {
        return {
          success: false,
          error: 'Cannot link memories from different entities',
        };
      }

      // Update outgoingEdges
      let updatedEdges = [...fromMemory.outgoingEdges];

      if (params.action === 'add') {
        // Add link if not already present
        if (!updatedEdges.includes(params.toMemoryId)) {
          updatedEdges.push(params.toMemoryId);
        } else {
          return {
            success: false,
            error: 'Link already exists',
          };
        }
      } else {
        // Remove link
        const index = updatedEdges.indexOf(params.toMemoryId);
        if (index === -1) {
          return {
            success: false,
            error: 'Link does not exist',
          };
        }
        updatedEdges.splice(index, 1);
      }

      // Update memory
      const updatedMemory = await this.storage.updateOutgoingEdges(
        params.fromMemoryId,
        updatedEdges,
      );

      return {
        success: true,
        data: updatedMemory,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  /**
   * Handles deleteMemory tool call
   *
   * Deletes a memory and cleans up related connections.
   *
   * @param params - Delete memory parameters
   * @param params.memoryId - Memory UUID to delete (not table index)
   * @returns Tool handler result
   *
   * @public
   */
  async handleDeleteMemory(
    params: DeleteMemoryParams,
  ): Promise<ToolHandlerResult<void>> {
    try {
      // Validate parameters
      if (!params.memoryId || params.memoryId.trim().length === 0) {
        return {
          success: false,
          error: 'Memory UUID is required',
        };
      }

      // Check if memory exists
      const memory = await this.storage.getMemory(params.memoryId);
      if (!memory) {
        return {
          success: false,
          error: `Memory with UUID ${params.memoryId} not found`,
        };
      }

      // Find all memories that have this memory in their outgoingEdges
      // and remove the link
      const allMemories = await this.storage.getMemoriesByEntity(memory.entityId);
      const memoriesToUpdate = allMemories.filter(m =>
        m.outgoingEdges.includes(params.memoryId),
      );

      // Remove this memory from their outgoingEdges
      await Promise.all(
        memoriesToUpdate.map(async m => {
          const updatedEdges = m.outgoingEdges.filter(
            id => id !== params.memoryId,
          );
          await this.storage.updateOutgoingEdges(m.id, updatedEdges);
        }),
      );

      // Delete the memory
      const deleted = await this.storage.deleteMemory(params.memoryId);
      if (!deleted) {
        return {
          success: false,
          error: 'Failed to delete memory',
        };
      }

      return {
        success: true,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }
}
