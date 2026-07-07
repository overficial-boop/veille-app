import { selectLlmClient } from '@veille/core';
import type { BlockDef } from '../types';

export const CONTENT_CAP = 24_000;

export const SECTION_KEYS = [
  'executive_summary', 'key_themes', 'detailed_breakdown', 'arguments_evidence',
  'notable_quotes', 'strengths_weaknesses', 'actionable_takeaways', 'open_questions',
] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export type BundleRef = { n: number; factId?: string; url: string };
export type Bundle = { sections: Record<SectionKey, string>; refs: BundleRef[] };

const sectionProps: Record<string, { type: string }> = Object.fromEntries(
  SECTION_KEYS.map((k) => [k, { type: 'STRING' }]),
);
export const BUNDLE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    ...sectionProps,
    refs: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { n: { type: 'NUMBER' }, url: { type: 'STRING' } },
        required: ['n', 'url'],
      },
    },
  },
  required: [...SECTION_KEYS],
};

export function buildItemAnalysisPrompt(a: {
  title: string; url: string; content: string; language: string;
  facts: { id: string; text: string; sourceUrl: string; sourcePassage: string }[];
}): string {
  const content = a.content.length > CONTENT_CAP ? `${a.content.slice(0, CONTENT_CAP)}\n[…tronqué]` : a.content;
  const factLines = a.facts.map((f, i) => `${i + 1}. ${f.text} (source: ${f.sourceUrl})`).join('\n') || '(none extracted yet)';
  return `You are an expert analyst of published content (videos, articles).
Produce a thorough, structured analysis in ${a.language}. Be specific, ground every statement in the content, no generic filler.

## Item
- Title: ${a.title}
- URL: ${a.url}

## Known facts (cite them with [n] markers wherever a claim relies on one)
${factLines}

## Content
${content}

---

Return JSON with these fields, each a Markdown string in ${a.language} (no headings inside — the field name is the heading):
- executive_summary: 2-4 paragraphs, the item's purpose and core message.
- key_themes: bullet list of major themes with one-line explanations.
- detailed_breakdown: section-by-section or topic-by-topic analysis.
- arguments_evidence: what claims are made and how they are supported.
- notable_quotes: 3-8 verbatim quotes from the content with brief commentary.
- strengths_weaknesses: what works and what is missing, weak, or questionable.
- actionable_takeaways: concrete insights a reader/viewer could apply.
- open_questions: what remains unclear or debatable.
Append [n] markers to any sentence relying on a numbered fact. Also return refs: the list of { n, url } you actually cited.`;
}

export function parseBundle(text: string): Bundle {
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(text.trim()); } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('bundle: model returned no JSON object');
    try { raw = JSON.parse(m[0]); } catch { throw new Error('bundle: unparseable JSON'); }
  }
  const sections = {} as Record<SectionKey, string>;
  for (const k of SECTION_KEYS) {
    const v = raw[k];
    if (typeof v !== 'string' || !v.trim()) throw new Error(`bundle: missing section "${k}"`);
    sections[k] = v.trim();
  }
  const refs: BundleRef[] = Array.isArray(raw.refs)
    ? (raw.refs as Record<string, unknown>[])
        .filter((r) => typeof r?.n === 'number' && typeof r?.url === 'string')
        .map((r) => ({
          n: r.n as number,
          url: r.url as string,
          ...(typeof r.factId === 'string' ? { factId: r.factId } : {}),
        }))
    : [];
  return { sections, refs };
}

/** Hidden bundle: ONE holistic LLM call per item; the visible analysis blocks are pure extractions. */
export const itemAnalysisBlock: BlockDef = {
  id: 'item-analysis',
  name: 'Analyse (interne)',
  scope: 'item',
  hidden: true,
  prerequisites: [{ kind: 'raw-content' }, { kind: 'item-metadata' }, { kind: 'item-facts' }],
  staleness: 'on-demand',
  async generate(inputs, ctx) {
    const rc = inputs.rawContent; const meta = inputs.itemMetadata; const facts = inputs.itemFacts?.facts ?? [];
    if (!rc || !meta) throw new Error('item-analysis: resolver must provide raw-content + item-metadata');
    const client = selectLlmClient(process.env as Record<string, string | undefined>);
    const r = await client.complete(
      buildItemAnalysisPrompt({ title: meta.title, url: meta.url, content: rc.text, language: ctx.language, facts }),
      { jsonSchema: BUNDLE_SCHEMA });
    const bundle = parseBundle(r.text); // validates; throws → fail-soft in the runner
    // Re-attach factIds server-side: the model only ever sees numbers.
    const withIds = bundle.refs.map((ref) => ({ ...ref, factId: facts[ref.n - 1]?.id }));
    const content = JSON.stringify({ sections: bundle.sections, refs: withIds });
    return { content, citations: withIds.map((ref) => ({ factId: ref.factId, url: ref.url })) };
  },
};
