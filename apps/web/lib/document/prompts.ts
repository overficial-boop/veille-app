import type { ElaborationTopic } from './types';

const LANG = (lang: string) => `Write everything in: ${lang}.`;

export function buildReviewPrompt(a: { content: string; title: string; siteName?: string; lang: string }): string {
  return [
    "You write a tight reader's review of a document for someone who has not read or watched it,",
    'so that engaging with the original becomes optional.',
    LANG(a.lang),
    'Write as continuous prose. Open with one orienting sentence (who or what this is, what kind of document, what it sets out to do),',
    "then move through the document's substance in the order it presents it. Cover the main ideas, claims, examples, and tensions — but stay compact: keep only what carries real information and cut the rest.",
    'Quote sparingly and only when a phrase carries weight the paraphrase would lose.',
    'What to avoid:',
    '- Bullet lists, headings, tables. Use paragraphs.',
    '- Generic praise or criticism of the document itself ("interesting take", "great explanation"). Describe what it says, not how good it is.',
    '- Filler openers like "In this document, the author discusses…". Just start.',
    '- Mentioning transcripts, captions, or timestamps. Speak about the content.',
    'Length: be brief — scale to the source but stay terse: a short piece gets 1–2 short paragraphs, a long one 3–6. Density matters more than length — every paragraph should carry information a reader could not get from the title, and never pad to fill space.',
    `Document: "${a.title}"${a.siteName ? ` — ${a.siteName}` : ''}`,
    'Content:',
    a.content,
    'Return only the review prose. No preamble, no title line, no markdown headings, no closing remarks.',
  ].join('\n');
}

export function buildResumePrompt(a: { review: string; title: string; lang: string }): string {
  return [
    'You distill a detailed review into the takeaways a reader should remember a week from now.',
    LANG(a.lang),
    'Output 3 to 7 bullets. Each bullet is one sentence (two only if a single sentence would be vague). Lead with the substance —',
    'the claim, the fact, the surprising connection. No filler verbs ("explores", "discusses", "covers"). No re-titling the document. No closing remark.',
    'If the review covers multiple independent threads, group bullets by thread under a one-line bolded label. If a single argument, no labels.',
    `Document: "${a.title}"`,
    'Review to distill:',
    a.review,
    'Return only the bulleted markdown. No preamble.',
  ].join('\n');
}

export function buildElaboratePrompt(a: { review: string; title: string; lang: string; withTavily: boolean }): string {
  return [
    'You identify 3 to 5 distinct topics from a document review and, for each topic, name specific resources a curious reader could explore further.',
    LANG(a.lang),
    'Return a JSON object with exactly this shape:',
    '{"topics":[{"name":"<short topic name>","summary":"<1-2 sentences on why it is interesting>","resources":[{"name":"<specific real work/person>","kind":"book|paper|talk|person|other","note":"<one-line annotation, optional>"}]}]}',
    'Resources must be specific named items you are confident exist (real books, papers, talks, people) — not generic phrases.',
    'If you are uncertain a resource exists, omit it. It is better to return 2 solid resources per topic than 5 doubtful ones.',
    `Document: "${a.title}"`,
    'Review:',
    a.review,
    'Return ONLY the JSON object. No preamble, no markdown fences.',
  ].join('\n');
}

export function buildFactCheckPrompt(a: { factText: string; title: string; lang: string }): string {
  return [
    'You assess a single factual claim using ONLY your background knowledge from sources OTHER than the one this claim came from.',
    'You do NOT have access to the original source content, and you must NOT verify the claim against the source itself.',
    'The task is external corroboration: does this claim match what is reported, written about, or established by independent sources you know of?',
    `Source context (provided only to disambiguate the topic — do NOT treat it as evidence): "${a.title}"`,
    'Claim to assess:',
    a.factText,
    `Write 1 to 3 sentences. ${LANG(a.lang)} Be direct.`,
    '- If well-corroborated by independent sources you know of, say so and name the kind of evidence (e.g. "mainstream reporting", "consensus in the field", "primary literature", "well-documented historical record").',
    '- If contested, controversial, or a minority view, say so plainly and name the disagreement.',
    '- If it appears to contradict well-established facts, say so directly.',
    '- If you cannot verify it independently (too obscure, too recent, too specific to a private context), say so explicitly.',
    'Hard rules:',
    '- Never write phrases like "the source supports this", "the passage confirms", "as stated in the article" — the source is NOT your evidence.',
    '- Avoid hedging filler ("It\'s important to note that…"). Don\'t agree just to agree.',
    'Return only your assessment text. No JSON, no markdown headings, no preamble, no trailing remarks.',
  ].join('\n');
}

export const ELABORATE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    topics: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
      name: { type: 'STRING' }, summary: { type: 'STRING' },
      resources: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
        name: { type: 'STRING' }, kind: { type: 'STRING' }, note: { type: 'STRING' },
      }, required: ['name'], propertyOrdering: ['name', 'kind', 'note'] } },
    }, required: ['name', 'summary'], propertyOrdering: ['name', 'summary', 'resources'] } },
  },
  required: ['topics'], propertyOrdering: ['topics'],
} as const;

export function parseElaboration(text: string): { topics: ElaborationTopic[] } {
  let raw: unknown = null;
  try { raw = JSON.parse(text.trim()); }
  catch { const m = text.match(/\{[\s\S]*\}/); if (m) { try { raw = JSON.parse(m[0]); } catch { /* ignore */ } } }
  const topics = (raw as { topics?: unknown } | null)?.topics;
  if (!Array.isArray(topics)) return { topics: [] };
  return { topics: topics.filter((t): t is ElaborationTopic => !!t && typeof (t as { name?: unknown }).name === 'string' && typeof (t as { summary?: unknown }).summary === 'string') };
}
