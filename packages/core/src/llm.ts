import { z } from 'zod';

const RawFactSchema = z.object({
  text: z.string(),
  timestampStart: z.number(),
  timestampEnd: z.number(),
  confidence: z.number().min(0).max(1),
});
export type RawFact = z.infer<typeof RawFactSchema>;

const FactsObjectSchema = z.object({
  summary: z.string().optional(),
  facts: z.array(RawFactSchema),
});

/**
 * Schema for the LLM's response object. The order in `propertyOrdering` is
 * load-bearing: Gemini emits keys in this order so the summary streams first.
 */
export const FACTS_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    summary: { type: 'STRING' },
    facts: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          text: { type: 'STRING' },
          timestampStart: { type: 'NUMBER' },
          timestampEnd: { type: 'NUMBER' },
          confidence: { type: 'NUMBER' },
        },
        required: ['text', 'timestampStart', 'timestampEnd', 'confidence'],
        propertyOrdering: ['text', 'timestampStart', 'timestampEnd', 'confidence'],
      },
    },
  },
  required: ['summary', 'facts'],
  propertyOrdering: ['summary', 'facts'],
} as const;

export type LlmResponse = {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
};

export type LlmCompleteOptions = {
  jsonSchema?: object;
  model?: string;
  /** Receives raw text chunks as they stream from the model. When set, the
   *  client uses streaming mode under the hood. Final return value is unchanged. */
  onTextChunk?: (text: string) => void;
};

export interface LlmClient {
  complete(prompt: string, opts?: LlmCompleteOptions): Promise<LlmResponse>;
}

export type ExtractionResult = {
  summary: string;
  facts: RawFact[];
  inputTokens: number;
  outputTokens: number;
  model: string;
};

export class LlmExtractionError extends Error {
  public override cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'LlmExtractionError';
    if (cause !== undefined) this.cause = cause;
  }
}

export async function extractFromChunk(
  client: LlmClient,
  prompt: string,
  opts?: { onTextChunk?: (text: string) => void; model?: string },
): Promise<ExtractionResult> {
  const callOpts: LlmCompleteOptions = { jsonSchema: FACTS_RESPONSE_SCHEMA };
  if (opts?.onTextChunk) callOpts.onTextChunk = opts.onTextChunk;
  if (opts?.model !== undefined) callOpts.model = opts.model;

  let response: LlmResponse;
  try {
    response = await client.complete(prompt, callOpts);
  } catch (err: unknown) {
    throw new LlmExtractionError(
      `LLM call failed: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }

  const usage = {
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
    model: response.model,
  };

  const trimmed = response.text.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // Fallback: extract the first {...} object from possibly-wrapped output.
    const objectMatch = response.text.match(/\{[\s\S]*\}/);
    if (!objectMatch) {
      return { summary: '', facts: [], ...usage };
    }
    try {
      parsed = JSON.parse(objectMatch[0]);
    } catch (err) {
      throw new LlmExtractionError(`LLM returned malformed JSON: ${String(err)}`, err);
    }
  }

  const result = FactsObjectSchema.safeParse(parsed);
  if (!result.success) {
    throw new LlmExtractionError(
      `LLM JSON failed schema validation: ${result.error.message}`,
      result.error,
    );
  }

  return { summary: result.data.summary ?? '', facts: result.data.facts, ...usage };
}

export function selectLlmClient(env: Record<string, string | undefined>): LlmClient {
  const anthropicKey = env['VEILLE_ANTHROPIC_KEY'];
  if (anthropicKey && anthropicKey.length > 0) {
    return new AnthropicLlmClientLazy(anthropicKey);
  }
  const geminiKey = env['VEILLE_GEMINI_KEY'];
  if (geminiKey && geminiKey.length > 0) {
    return new GeminiLlmClientLazy(geminiKey);
  }
  throw new Error(
    'No LLM API key set. Provide VEILLE_ANTHROPIC_KEY or VEILLE_GEMINI_KEY in the environment.',
  );
}

/**
 * Lazy wrapper that instantiates the inner client on first use. The model
 * passed in opts on the first call is captured into the inner client constructor.
 * Subsequent calls with a different opts.model are forwarded to complete() where
 * the per-call opts.model takes precedence — see the client implementations.
 *
 * Limitation (acceptable for v0.x): the inner client is created once per process.
 * If --model changes between calls in the same process, only the first call's
 * constructor-level default is used; the per-call opts.model passed to complete()
 * does override it. This is fine for the CLI where model is set once per process.
 */
class AnthropicLlmClientLazy implements LlmClient {
  private inner: Promise<LlmClient> | null = null;
  constructor(private apiKey: string) {}
  async complete(prompt: string, opts?: LlmCompleteOptions): Promise<LlmResponse> {
    if (!this.inner) {
      this.inner = import('./anthropic-client.js').then(
        (m) => new m.AnthropicLlmClient(this.apiKey, opts?.model),
      );
    }
    const c = await this.inner;
    return c.complete(prompt, opts);
  }
}

class GeminiLlmClientLazy implements LlmClient {
  private inner: Promise<LlmClient> | null = null;
  constructor(private apiKey: string) {}
  async complete(prompt: string, opts?: LlmCompleteOptions): Promise<LlmResponse> {
    if (!this.inner) {
      this.inner = import('./gemini-client.js').then(
        (m) => new m.GeminiLlmClient(this.apiKey, opts?.model),
      );
    }
    const c = await this.inner;
    return c.complete(prompt, opts);
  }
}
