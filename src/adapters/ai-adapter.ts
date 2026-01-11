/**
 * AI Model Adapter Interface
 *
 * Abstracts AI model operations for embedding generation and memory generation.
 * Implementations can use any AI provider (OpenAI, Anthropic, etc.)
 */

/**
 * AI model adapter interface
 *
 * @public
 */
export interface AIModelAdapter {
  /**
   * Generate embedding for text
   *
   * @param text - Text to generate embedding for
   * @returns Embedding vector
   */
  generateEmbedding(text: string): Promise<number[]>;

  /**
   * Generate embeddings for multiple texts
   *
   * @param texts - Array of texts to generate embeddings for
   * @returns Array of embedding vectors
   */
  generateEmbeddings(texts: string[]): Promise<number[][]>;

  /**
   * Generate memory content using AI
   *
   * @param prompt - Prompt for memory generation
   * @param context - Additional context for generation
   * @returns Generated memory content
   */
  generateMemory(
    prompt: string,
    context?: {
      augmentationData?: unknown;
      existingMemories?: unknown[];
      [key: string]: unknown;
    },
  ): Promise<string>;

  /**
   * Validate memory consistency
   *
   * @param newMemory - New memory to validate
   * @param existingMemories - Existing memories to check against
   * @returns Validation result with errors/warnings
   */
  validateConsistency(
    newMemory: { content: string; [key: string]: unknown },
    existingMemories: Array<{ content: string; [key: string]: unknown }>,
  ): Promise<{
    isValid: boolean;
    errors?: string[];
    warnings?: string[];
  }>;
}
