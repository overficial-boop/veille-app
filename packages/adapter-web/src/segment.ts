import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import type { Segment } from '@veille/core';

export class WebContentEmptyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebContentEmptyError';
  }
}

export type ExtractedArticle = {
  title: string;
  byline: string | null;
  publishedTime: string | null;
  lang: string | null;
  segments: Segment[];
};

const BLOCK_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE']);

function collectBlocks(root: Element, out: Element[]): void {
  for (const child of Array.from(root.children)) {
    if (BLOCK_TAGS.has(child.tagName)) {
      out.push(child);
      // Don't recurse — the element's textContent already covers its descendants.
    } else {
      collectBlocks(child, out);
    }
  }
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function emptyToNull(s: string | null | undefined): string | null {
  return s && s.trim().length > 0 ? s : null;
}

export function extractArticle(html: string, url: string): ExtractedArticle {
  const dom = new JSDOM(html, { url });
  const doc = dom.window.document;
  const docLang = emptyToNull(doc.documentElement.getAttribute('lang'));

  const article = new Readability(doc).parse();
  if (!article || normalize(article.textContent).length === 0) {
    throw new WebContentEmptyError(`No readable content extracted from ${url}`);
  }

  const contentDom = new JSDOM(`<!DOCTYPE html><html><body>${article.content}</body></html>`);
  const blocks: Element[] = [];
  collectBlocks(contentDom.window.document.body, blocks);

  const segments: Segment[] = [];
  let idx = 0;
  for (const el of blocks) {
    const text = normalize(el.textContent ?? '');
    if (!text) continue;
    segments.push({ start: idx, end: idx, text });
    idx++;
  }

  if (segments.length === 0) {
    throw new WebContentEmptyError(`No paragraph segments extracted from ${url}`);
  }

  return {
    title: article.title ?? '',
    byline: emptyToNull(article.byline),
    publishedTime: emptyToNull(article.publishedTime),
    lang: emptyToNull(article.lang) ?? docLang,
    segments,
  };
}
