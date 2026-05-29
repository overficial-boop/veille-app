import { selectLlmClient } from '@veille/core';
import type { LlmClient, TavilyConfig } from '@veille/core';

export type PlannedQuery = { config: TavilyConfig; rationale: string };

export type PlanQueriesInput = {
  /** Free-form description of what to track. Non-empty after trim. */
  intent: string;
  language?: string;
  model?: string;
  /** Injectable for testing; defaults to selectLlmClient(process.env). */
  client?: LlmClient;
};

export type PlanQueriesResult = { queries: PlannedQuery[]; model: string };

export class EmptyIntentError extends Error {
  constructor() {
    super('Intent is empty — describe what you want to track (e.g. "le padel professionnel français").');
    this.name = 'EmptyIntentError';
  }
}

const MAX_QUERIES = 3;

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    queries: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          query: { type: 'STRING' },
          days: { type: 'NUMBER' },
          topic: { type: 'STRING' },
          includeDomains: { type: 'ARRAY', items: { type: 'STRING' } },
          rationale: { type: 'STRING' },
        },
        required: ['query', 'rationale'],
        propertyOrdering: ['query', 'days', 'topic', 'includeDomains', 'rationale'],
      },
    },
  },
  required: ['queries'],
  propertyOrdering: ['queries'],
} as const;

function buildPrompt(intent: string, language: string): string {
  return [
    "You are a search-query planner for a subject-monitoring tool. Turn the user's",
    'free-form intent into up to 3 high-quality web-search queries for the Tavily API.',
    '',
    'USER INTENT:',
    intent,
    '',
    'For each query, apply:',
    '  - Terminology normalization: prefer the precise/official term the press uses',
    '    (e.g. "inculpation" -> "mise en examen"; "Coronavirus" -> "COVID-19").',
    '  - Decomposition: if the intent spans distinct angles, split into separate atomic',
    '    queries rather than one broad one. Do NOT pad — fewer sharp queries beat many vague ones.',
    '  - Temporal extraction: map recency cues to `days` ("récemment"/"latest" -> 7;',
    '    "this year" -> 365; an ongoing-affair framing -> omit `days`).',
    '  - topic: one of "news" (current events), "finance" (markets/companies), or "general".',
    '  - includeDomains: ONLY when the intent implies a region/community with known outlets',
    '    (e.g. French local affairs -> ["francebleu.fr","sudouest.fr","ici.fr"]). Otherwise omit.',
    '  - rationale: one sentence on why this query serves the intent.',
    '',
    `Write query text and rationale in: ${language}`,
    '',
    'Return JSON only — no preamble, no markdown.',
  ].join('\n');
}

type RawPlan = {
  queries?: Array<{ query?: string; days?: number; topic?: string; includeDomains?: string[]; rationale?: string }>;
};

function parse(text: string): RawPlan {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as RawPlan;
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]) as RawPlan;
      } catch {
        // fall through
      }
    }
    return {};
  }
}

export async function planTavilyQueries(input: PlanQueriesInput): Promise<PlanQueriesResult> {
  if (!input.intent || input.intent.trim().length === 0) {
    throw new EmptyIntentError();
  }
  const client = input.client ?? selectLlmClient(process.env);
  const language = input.language ?? 'en';
  const prompt = buildPrompt(input.intent.trim(), language);
  const opts: { jsonSchema: object; model?: string } = { jsonSchema: RESPONSE_SCHEMA };
  if (input.model !== undefined) opts.model = input.model;
  const response = await client.complete(prompt, opts);
  const parsed = parse(response.text);

  const queries: PlannedQuery[] = (parsed.queries ?? [])
    .filter(
      (q): q is { query: string; rationale: string; days?: number; topic?: string; includeDomains?: string[] } =>
        typeof q.query === 'string' && q.query.trim().length > 0 && typeof q.rationale === 'string',
    )
    .slice(0, MAX_QUERIES)
    .map((q) => {
      const config: TavilyConfig = { query: q.query.trim() };
      if (typeof q.days === 'number' && q.days > 0) config.days = Math.floor(q.days);
      if (q.topic === 'general' || q.topic === 'news' || q.topic === 'finance') config.topic = q.topic;
      if (Array.isArray(q.includeDomains)) {
        const domains = [
          ...new Set(
            q.includeDomains.filter((d) => typeof d === 'string' && d.trim().length > 0).map((d) => d.trim()),
          ),
        ];
        if (domains.length > 0) config.includeDomains = domains;
      }
      return { config, rationale: q.rationale };
    });

  return { queries, model: response.model };
}
