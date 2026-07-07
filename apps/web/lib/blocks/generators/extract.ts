import type { BlockDef } from '../types';
import type { SectionKey } from './item-analysis';

type StoredBundle = { sections: Record<string, string>; refs: { n: number; factId?: string; url: string }[] };

/** A visible catalog block that extracts one section of the cached item-analysis bundle. Zero LLM. */
export function makeExtractionBlock(id: string, name: string, section: SectionKey): BlockDef {
  return {
    id, name, scope: 'item',
    prerequisites: [{ kind: 'block', blockId: 'item-analysis' }],
    staleness: 'on-demand',
    async generate(inputs) {
      const raw = inputs.blocks?.['item-analysis'];
      if (!raw) throw new Error(`${id}: resolver must provide the item-analysis bundle`);
      let bundle: StoredBundle;
      try { bundle = JSON.parse(raw); } catch { throw new Error(`${id}: item-analysis bundle is not valid JSON`); }
      const content = bundle.sections?.[section];
      if (typeof content !== 'string' || !content.trim()) throw new Error(`${id}: bundle has no "${section}" section`);
      return { content: content.trim(), citations: (bundle.refs ?? []).map((r) => ({ factId: r.factId, url: r.url })) };
    },
  };
}

export const EXTRACTION_BLOCKS: BlockDef[] = [
  makeExtractionBlock('key-themes', 'Thèmes clés', 'key_themes'),
  makeExtractionBlock('detailed-breakdown', 'Analyse détaillée', 'detailed_breakdown'),
  makeExtractionBlock('arguments-evidence', 'Arguments et preuves', 'arguments_evidence'),
  makeExtractionBlock('notable-quotes', 'Citations marquantes', 'notable_quotes'),
  makeExtractionBlock('strengths-weaknesses', 'Forces et faiblesses', 'strengths_weaknesses'),
  makeExtractionBlock('actionable-takeaways', 'À retenir (actionnable)', 'actionable_takeaways'),
  makeExtractionBlock('open-questions', 'Questions ouvertes', 'open_questions'),
];
