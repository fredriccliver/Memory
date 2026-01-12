/**
 * Embedding Service
 *
 * Provides embedding generation functionality using AI model adapters.
 * This service abstracts embedding generation and can work with any AI provider
 * through the AIModelAdapter interface.
 */

import type { AIModelAdapter } from '../adapters/ai-adapter';

/**
 * Embedding service options
 *
 * @public
 */
export interface EmbeddingServiceOptions {
  /** Maximum number of retries on failure */
  maxRetries?: number;
  /** Initial delay before retry (ms) */
  initialDelayMs?: number;
  /** Backoff factor for exponential backoff */
  backoffFactor?: number;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
}

/**
 * Embedding Service
 *
 * Provides embedding generation functionality using an AI model adapter.
 * Handles retry logic, error handling, and batch processing.
 *
 * @public
 */
export class EmbeddingService {
  private adapter: AIModelAdapter;
  private options: {
    maxRetries: number;
    initialDelayMs: number;
    backoffFactor: number;
    signal?: AbortSignal;
  };

  /**
   * Creates a new embedding service
   *
   * @param adapter - AI model adapter to use for embedding generation
   * @param options - Service options
   */
  constructor(adapter: AIModelAdapter, options: EmbeddingServiceOptions = {}) {
    this.adapter = adapter;
    this.options = {
      maxRetries: options.maxRetries ?? 3,
      initialDelayMs: options.initialDelayMs ?? 500,
      backoffFactor: options.backoffFactor ?? 2,
      signal: options.signal,
    };
  }

  /**
   * Generate embedding for a single text
   *
   * @param text - Text to generate embedding for
   * @returns Embedding vector (1536 dimensions for OpenAI)
   * @throws Error if generation fails after retries
   *
   * @public
   */
  async generateEmbedding(text: string): Promise<number[]> {
    const normalizedText = this.normalizeText(text);
    if (!normalizedText) {
      throw new Error('Text cannot be empty');
    }

    return this.withRetry(() => this.adapter.generateEmbedding(normalizedText));
  }

  /**
   * Generate embeddings for multiple texts (batch processing)
   *
   * @param texts - Array of texts to generate embeddings for
   * @returns Array of embedding vectors
   * @throws Error if generation fails after retries
   *
   * @public
   */
  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    const normalizedTexts = this.normalizeTexts(texts);
    if (normalizedTexts.length === 0) {
      return [];
    }

    return this.withRetry(() => this.adapter.generateEmbeddings(normalizedTexts));
  }

  /**
   * Generate embedding for a search query (convenience method)
   *
   * @param query - Search query text
   * @returns Query embedding vector
   * @throws Error if generation fails after retries
   *
   * @public
   */
  async generateQueryEmbedding(query: string): Promise<number[]> {
    return this.generateEmbedding(query);
  }

  /**
   * Normalize a single text
   */
  private normalizeText(text: string | null | undefined): string {
    if (!text || typeof text !== 'string') {
      return '';
    }
    return text.trim();
  }

  /**
   * Normalize multiple texts
   */
  private normalizeTexts(texts: (string | null | undefined)[]): string[] {
    return texts.map(text => this.normalizeText(text)).filter(text => text.length > 0);
  }

  /**
   * Execute a function with retry logic
   */
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let attempt = 0;
    let delay = this.options.initialDelayMs;

    while (attempt <= this.options.maxRetries) {
      try {
        return await fn();
      } catch (error) {
        attempt += 1;
        if (attempt > this.options.maxRetries) {
          throw error;
        }

        // Check if operation was aborted
        if (this.options.signal?.aborted) {
          throw new Error('Operation aborted');
        }

        // Wait before retry
        await this.sleep(delay);
        delay *= this.options.backoffFactor;
      }
    }

    throw new Error('Failed after retries');
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
