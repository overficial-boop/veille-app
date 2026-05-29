import type { Segment } from '@veille/core';

/**
 * Split text into paragraph segments. Paragraphs are runs separated by one or
 * more blank lines (a blank line being whitespace-only). Returns one Segment
 * per non-empty paragraph, with `start === end === paragraphIndex` (matching
 * the paragraph-index locator scheme used by the web adapter).
 */
export function segmentByParagraph(content: string): Segment[] {
  const paragraphs = content.split(/\n[\t ]*\n+/);
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
