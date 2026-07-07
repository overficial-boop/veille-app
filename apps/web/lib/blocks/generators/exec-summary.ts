import { selectLlmClient } from '@veille/core';
import type { BlockDef } from '../types';

export const CONTENT_CAP = 24_000; // chars of source content sent to the model

export function buildExecSummaryPrompt(a: { title: string; url: string; content: string; language: string }): string {
  const content = a.content.length > CONTENT_CAP ? `${a.content.slice(0, CONTENT_CAP)}\n[…tronqué]` : a.content;
  return `You are an expert analyst of published content (videos, articles).
Write an executive summary in ${a.language}.

## Item
- Title: ${a.title}
- URL: ${a.url}

## Content
${content}

---

Write 2 to 4 paragraphs summarizing the item's purpose and core message.
Be specific, ground every statement in the content, no generic filler, no heading — paragraphs only, Markdown.`;
}

export const execSummaryBlock: BlockDef = {
  id: 'exec-summary',
  name: 'Résumé exécutif',
  scope: 'item',
  prerequisites: [{ kind: 'raw-content' }, { kind: 'item-metadata' }],
  staleness: 'on-demand',
  async generate(inputs, ctx) {
    const rc = inputs.rawContent;
    const meta = inputs.itemMetadata;
    if (!rc || !meta) throw new Error('exec-summary: resolver must provide raw-content + item-metadata');
    const client = selectLlmClient(process.env as Record<string, string | undefined>);
    const r = await client.complete(
      buildExecSummaryPrompt({ title: meta.title, url: meta.url, content: rc.text, language: ctx.language }), {});
    return { content: r.text.trim(), citations: [{ url: meta.url }] };
  },
};
