import type { Segment } from '@veille/core';

/**
 * Split text into paragraph segments — one Segment per line, separated by ANY run of newlines
 * (single or blank-line). This matches how stored content is produced: the pipeline joins the web
 * adapter's per-block paragraphs with a single `\n` (`segments.map(s => s.text).join('\n')`), so a
 * single newline IS a paragraph boundary here. Splitting only on blank lines collapsed such content
 * into one giant segment, which made the LLM's paragraph locators resolve to the whole article or
 * to nothing. Each non-empty line → `{ start === end === paragraphIndex }`.
 */
export function segmentByParagraph(content: string): Segment[] {
  const paragraphs = content.split(/[ \t\r]*\n[ \t\r\n]*/);
  const segments: Segment[] = [];
  let idx = 0;
  for (const raw of paragraphs) {
    const text = raw.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    segments.push({ start: idx, end: idx, text });
    idx++;
  }
  return segments;
}
