import { selectLlmClient } from '@veille/core';

export type OptimizeDescriptionInput = {
  /** Subject's display name. Used as a starting hint when the current
   *  description is empty; otherwise treated as supporting context. */
  name: string;
  /** Existing description, possibly empty. */
  description?: string;
  /** Output language for the rewritten description (e.g. 'en', 'fr'). */
  language?: string;
  model?: string;
};

export type OptimizeDescriptionResult = {
  description: string;
  model: string;
};

function buildPrompt(input: OptimizeDescriptionInput): string {
  const language = input.language ?? 'en';
  const current = input.description?.trim();
  return [
    'You are improving the description of a topic that a researcher tracks with a',
    'subject-monitoring tool. The description is used by the system in several',
    'downstream tasks:',
    '',
    '  1. As a subject hint passed to an extraction LLM to bias it toward on-topic',
    '     facts when processing articles, transcripts, or PDFs.',
    '  2. As the ONLY content signal when the system AI-suggests seed URLs and',
    '     discovery tools (Tavily queries, RSS feeds, YouTube channels).',
    '  3. As the human-readable context shown in the UI and in exports.',
    '',
    'Rewrite the description below so it is concrete, specific, and useful for',
    'these tasks. Aim for 1-3 sentences. Name the entities / dimensions / angles',
    'the user likely cares about (key actors, geographies, time horizons, sub-topics).',
    'Do not pad with generic phrasing like "news and updates about X".',
    '',
    `Subject name: ${input.name}`,
    `Current description: ${current ? `"${current}"` : '(empty — start from the name only)'}`,
    `Write the new description in: ${language}`,
    '',
    'Return ONLY the rewritten description text. No preamble, no quotes around',
    'it, no markdown, no commentary.',
  ].join('\n');
}

function clean(raw: string): string {
  let s = raw.trim();
  // Strip surrounding quotes if the model wrapped its answer despite the instruction.
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith('“') && s.endsWith('”'))) {
    s = s.slice(1, -1).trim();
  }
  // Drop markdown code fences.
  s = s.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '');
  return s.trim();
}

/** Rewrite a subject description into something the rest of the system can
 *  use effectively. Works even when the input description is empty — falls
 *  back to the name as the only signal. */
export async function optimizeDescription(
  input: OptimizeDescriptionInput,
): Promise<OptimizeDescriptionResult> {
  const client = selectLlmClient(process.env);
  const prompt = buildPrompt(input);
  const opts: { model?: string } = {};
  if (input.model !== undefined) opts.model = input.model;
  const response = await client.complete(prompt, opts);
  return {
    description: clean(response.text),
    model: response.model,
  };
}
