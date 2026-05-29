import { selectLlmClient } from '@veille/core';
import type { LlmClient, TavilyConfig } from '@veille/core';

export type DossierTemplate = 'profile' | 'chronology' | 'feed';

export type PlannedSource =
  | { connector: 'tavily'; kind: 'standing'; input: TavilyConfig; label: string }
  | { connector: 'web' | 'youtube' | 'pdf'; kind: 'item'; input: { url: string }; label: string };

export type DossierPlan = {
  subjectName: string;
  template: DossierTemplate;
  cadence: string | null;
  sources: PlannedSource[];
};

export type PlanDossierInput = { intent: string; language?: string; model?: string; client?: LlmClient };

export class EmptyIntentError extends Error {
  constructor() {
    super('Intent is empty.');
    this.name = 'EmptyIntentError';
  }
}

const MAX_TAVILY = 3;
const URL_RE = /https?:\/\/[^\s)]+/g;
const CHRONO_RE = /\b(chronolog\w*|timeline|affaire|frise)\b/i;

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    subjectName: { type: 'STRING' },
    template: { type: 'STRING' }, // profile | chronology | feed
    queries: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          query: { type: 'STRING' },
          days: { type: 'NUMBER' },
          topic: { type: 'STRING' },
          rationale: { type: 'STRING' },
        },
        required: ['query', 'rationale'],
        propertyOrdering: ['query', 'days', 'topic', 'rationale'],
      },
    },
  },
  required: ['subjectName', 'template', 'queries'],
  propertyOrdering: ['subjectName', 'template', 'queries'],
} as const;

function prompt(intent: string, language: string): string {
  return [
    'You plan a subject-monitoring dossier from a free-form intent.',
    'Return JSON: { subjectName, template, queries[] }.',
    '- subjectName: the short canonical name of the subject (person, entity, or affair), in ' + language + '.',
    '- template: "profile" if the subject is a person/entity; "chronology" if the intent asks for a timeline/sequence of events/an affair; otherwise "feed".',
    '- queries: up to 3 sharp Tavily web-search queries (query + one-sentence rationale; optional days, topic in news|finance|general). Decompose distinct angles; do not pad.',
    '',
    'INTENT:',
    intent,
    '',
    'Write text in: ' + language,
    'Return JSON only.',
  ].join('\n');
}

function parse(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text.trim());
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        /* fall through */
      }
    }
    return {};
  }
}

export async function planDossier(input: PlanDossierInput): Promise<DossierPlan> {
  const intent = (input.intent ?? '').trim();
  if (!intent) throw new EmptyIntentError();
  const client = input.client ?? selectLlmClient(process.env);
  const language = input.language ?? 'fr';
  const opts: { jsonSchema: object; model?: string } = { jsonSchema: SCHEMA };
  if (input.model !== undefined) opts.model = input.model;
  const res = await client.complete(prompt(intent, language), opts);
  const raw = parse(res.text);

  // template: model's choice, with keyword guardrail
  let template: DossierTemplate =
    raw.template === 'profile' || raw.template === 'chronology' || raw.template === 'feed' ? raw.template : 'feed';
  if (CHRONO_RE.test(intent)) template = 'chronology';

  const subjectName =
    typeof raw.subjectName === 'string' && raw.subjectName.trim() ? raw.subjectName.trim() : intent.slice(0, 80);

  const rawQueries = Array.isArray(raw.queries) ? raw.queries : [];
  const tavily: PlannedSource[] = rawQueries
    .filter((q: any) => q && typeof q.query === 'string' && q.query.trim())
    .slice(0, MAX_TAVILY)
    .map((q: any) => {
      const config: TavilyConfig = { query: q.query.trim() };
      if (typeof q.days === 'number' && q.days > 0) config.days = Math.floor(q.days);
      if (q.topic === 'news' || q.topic === 'finance' || q.topic === 'general') config.topic = q.topic;
      return { connector: 'tavily' as const, kind: 'standing' as const, input: config, label: q.query.trim() };
    });

  const urls = [...new Set((intent.match(URL_RE) ?? []).map((u) => u.replace(/[.,]$/, '')))];
  const items: PlannedSource[] = urls.map((url) => ({
    connector: 'web',
    kind: 'item',
    input: { url },
    label: url,
  }));

  return { subjectName, template, cadence: null, sources: [...tavily, ...items] };
}
