import { selectLlmClient } from '@veille/core';

export type OptimizeSuggestionRequestInput = {
  /** Current draft of the user's request for what the AI should suggest. */
  query: string;
  /** Subject's name — used as background context only (not the primary signal). */
  subjectName?: string;
  /** Subject's description — used as background context only. */
  subjectDescription?: string;
  /** Output language for the rewritten request (e.g. 'en', 'fr'). */
  language?: string;
  model?: string;
};

export type OptimizeSuggestionRequestResult = {
  query: string;
  model: string;
};

function buildPrompt(input: OptimizeSuggestionRequestInput): string {
  const language = input.language ?? 'en';
  const name = input.subjectName?.trim();
  const desc = input.subjectDescription?.trim();
  return [
    "You are refining a user's request for source/tool suggestions in a subject-monitoring tool.",
    'The downstream system uses the request to propose seed source URLs (one-time extractions)',
    'and discovery tools (Tavily search queries, RSS / Atom feeds, YouTube channels) that the',
    'user then triages.',
    '',
    'Subject the request belongs to (background context only — do not echo it back):',
    `  Name: ${name || '(none)'}`,
    `  Description: ${desc || '(none)'}`,
    '',
    "Current draft of the user's request:",
    `"${input.query.trim()}"`,
    '',
    'Rewrite the request so it is concrete, specific, and actionable. Aim for 1-3 sentences.',
    'In the rewrite, make these dimensions explicit when they apply:',
    '  - Which KINDS of suggestions are wanted (seed articles / Tavily queries / RSS feeds / YouTube channels — or "any").',
    '  - Which ANGLES of the subject (sub-topics, actors, geographies, time horizons, languages).',
    '  - Any exclusions ("not paywalled", "not in English", etc.) the original draft implied.',
    '',
    `Write the rewritten request in: ${language}`,
    '',
    'Return ONLY the rewritten request text. No preamble, no quotes around it, no markdown,',
    'no commentary.',
  ].join('\n');
}

function clean(raw: string): string {
  let s = raw.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith('“') && s.endsWith('”'))) {
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '');
  return s.trim();
}

export class EmptySuggestionRequestError extends Error {
  constructor() {
    super('Suggestion request is empty — nothing to optimize.');
    this.name = 'EmptySuggestionRequestError';
  }
}

export async function optimizeSuggestionRequest(
  input: OptimizeSuggestionRequestInput,
): Promise<OptimizeSuggestionRequestResult> {
  if (!input.query || input.query.trim().length === 0) {
    throw new EmptySuggestionRequestError();
  }
  const client = selectLlmClient(process.env);
  const prompt = buildPrompt(input);
  const opts: { model?: string } = {};
  if (input.model !== undefined) opts.model = input.model;
  const response = await client.complete(prompt, opts);
  return {
    query: clean(response.text),
    model: response.model,
  };
}
