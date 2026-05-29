import Anthropic from '@anthropic-ai/sdk';
import type { LlmClient, LlmCompleteOptions, LlmResponse } from './llm.js';

const DEFAULT_MODEL = 'claude-opus-4-7';
const MAX_OUTPUT_TOKENS = 4096;

export class AnthropicLlmClient implements LlmClient {
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model?: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model ?? DEFAULT_MODEL;
  }

  async complete(prompt: string, opts?: LlmCompleteOptions): Promise<LlmResponse> {
    const model = opts?.model ?? this.model;

    if (opts?.onTextChunk) {
      // Streaming path — uses messages.stream() which is available in @anthropic-ai/sdk@0.30+
      const stream = this.client.messages.stream({
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        messages: [{ role: 'user', content: prompt }],
      });
      let fullText = '';
      stream.on('text', (delta: string) => {
        fullText += delta;
        opts.onTextChunk!(delta);
      });
      const final = await stream.finalMessage();
      return {
        text: fullText,
        inputTokens: final.usage.input_tokens,
        outputTokens: final.usage.output_tokens,
        model,
      };
    }

    // Non-streaming path
    const response = await this.client.messages.create({
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content
      .filter((c): c is Anthropic.TextBlock => c.type === 'text')
      .map((c) => c.text)
      .join('');

    return {
      text,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      model,
    };
  }
}
