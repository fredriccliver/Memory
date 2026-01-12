/**
 * OpenAI AI Model Adapter
 *
 * Implements AIModelAdapter using OpenAI API.
 * This adapter provides embedding generation and memory generation capabilities.
 */

import type { AIModelAdapter } from '../adapters/ai-adapter';

/**
 * OpenAI adapter configuration
 *
 * @public
 */
export interface OpenAIAdapterConfig {
  /** OpenAI API key */
  apiKey: string;
  /** Embedding model to use (default: 'text-embedding-3-small') */
  embeddingModel?: string;
  /** Base URL for OpenAI API (default: 'https://api.openai.com/v1') */
  baseURL?: string;
}

/**
 * OpenAI API response types
 */
interface OpenAIEmbeddingResponse {
  data: Array<{
    embedding: number[];
    index: number;
  }>;
}

/**
 * OpenAI AI Model Adapter implementation
 *
 * @public
 */
export class OpenAIAdapter implements AIModelAdapter {
  private config: Required<Pick<OpenAIAdapterConfig, 'embeddingModel' | 'baseURL'>> &
    Pick<OpenAIAdapterConfig, 'apiKey'>;

  /**
   * Creates a new OpenAI adapter
   *
   * @param config - OpenAI adapter configuration
   */
  constructor(config: OpenAIAdapterConfig) {
    if (!config.apiKey) {
      throw new Error('OpenAI API key is required');
    }

    this.config = {
      apiKey: config.apiKey,
      embeddingModel: config.embeddingModel ?? 'text-embedding-3-small',
      baseURL: config.baseURL ?? 'https://api.openai.com/v1',
    };
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const [embedding] = await this.generateEmbeddings([text]);
    return embedding;
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const response = await this.requestEmbeddings(texts);
    return this.parseEmbeddings(response, texts.length);
  }

  async generateMemory(
    prompt: string,
    context?: {
      augmentationData?: unknown;
      existingMemories?: unknown[];
      [key: string]: unknown;
    },
  ): Promise<string> {
    // TODO: Implement memory generation using OpenAI Chat API
    throw new Error('Memory generation not yet implemented');
  }

  async validateConsistency(
    newMemory: { content: string; [key: string]: unknown },
    existingMemories: Array<{ content: string; [key: string]: unknown }>,
  ): Promise<{
    isValid: boolean;
    errors?: string[];
    warnings?: string[];
  }> {
    // TODO: Implement consistency validation using OpenAI
    throw new Error('Consistency validation not yet implemented');
  }

  /**
   * Request embeddings from OpenAI API
   */
  private async requestEmbeddings(texts: string[]): Promise<OpenAIEmbeddingResponse> {
    const response = await fetch(`${this.config.baseURL}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.embeddingModel,
        input: texts,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`OpenAI embedding failed (status ${response.status}): ${body}`);
    }

    return (await response.json()) as OpenAIEmbeddingResponse;
  }

  /**
   * Parse embeddings from OpenAI response
   */
  private parseEmbeddings(response: OpenAIEmbeddingResponse, expected: number): number[][] {
    if (!response?.data || response.data.length !== expected) {
      throw new Error('Invalid embedding response shape');
    }

    return response.data.sort((a, b) => a.index - b.index).map(item => item.embedding);
  }
}
