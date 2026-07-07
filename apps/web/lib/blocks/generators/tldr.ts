import { selectLlmClient } from '@veille/core';
import type { BlockDef } from '../types';

export function buildTldrPrompt(a: { summary: string; language: string }): string {
  return `Condense this executive summary into ONE sentence in ${a.language} (a TL;DR).
Keep the single most important point. No preamble, no quotes — une seule phrase.

## Executive summary
${a.summary}`;
}

/** The "smaller summary": derives from exec-summary's cached output — near-free by construction. */
export const tldrBlock: BlockDef = {
  id: 'tldr',
  name: 'TL;DR',
  scope: 'item',
  prerequisites: [{ kind: 'block', blockId: 'exec-summary' }],
  staleness: 'on-demand',
  async generate(inputs, ctx) {
    const summary = inputs.blocks?.['exec-summary'];
    if (!summary) throw new Error('tldr: resolver must provide exec-summary output');
    const client = selectLlmClient(process.env as Record<string, string | undefined>);
    const r = await client.complete(buildTldrPrompt({ summary, language: ctx.language }), {});
    return { content: r.text.trim(), citations: [] };
  },
};
