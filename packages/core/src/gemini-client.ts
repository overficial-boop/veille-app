import { GoogleGenAI } from '@google/genai';
import type { LlmClient, LlmCompleteOptions, LlmResponse } from './llm.js';

const DEFAULT_MODEL = 'gemini-2.5-flash';

export class GeminiLlmClient implements LlmClient {
  private client: GoogleGenAI;
  private model: string;

  constructor(apiKey: string, model?: string) {
    this.client = new GoogleGenAI({ apiKey });
    this.model = model ?? DEFAULT_MODEL;
  }

  async complete(prompt: string, opts?: LlmCompleteOptions): Promise<LlmResponse> {
    const resolvedModel = opts?.model ?? this.model;

    const config: Record<string, unknown> = {};
    if (opts?.jsonSchema) {
      config.responseMimeType = 'application/json';
      config.responseSchema = opts.jsonSchema;
    }

    const baseParams = {
      model: resolvedModel,
      contents: prompt,
      ...(Object.keys(config).length > 0 ? { config } : {}),
    };

    if (opts?.onTextChunk) {
      // Streaming path
      const stream = await this.client.models.generateContentStream(baseParams);
      let fullText = '';
      let inputTokens = 0;
      let outputTokens = 0;
      for await (const chunk of stream) {
        const t = chunk.text ?? '';
        if (t) {
          fullText += t;
          opts.onTextChunk(t);
        }
        const usage = chunk.usageMetadata;
        if (usage?.promptTokenCount) inputTokens = usage.promptTokenCount;
        if (usage?.candidatesTokenCount) outputTokens = usage.candidatesTokenCount;
      }
      return { text: fullText, inputTokens, outputTokens, model: resolvedModel };
    }

    // Non-streaming path
    const response = await this.client.models.generateContent(baseParams);
    return {
      text: response.text ?? '',
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      model: resolvedModel,
    };
  }
}
