import { describe, it, expect } from 'vitest';
import { extractArticle, WebContentEmptyError } from '../src/segment.js';

const ARTICLE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <title>The State of Padel — 2026</title>
  <meta name="author" content="Marie Dupont">
  <meta property="article:published_time" content="2026-04-12T08:00:00Z">
</head>
<body>
  <header><nav>home about</nav></header>
  <article>
    <h1>The State of Padel — 2026</h1>
    <p class="byline">By Marie Dupont</p>
    <p>Padel has grown faster than any other racket sport this decade. The international federation reported 30 million players across 130 countries in 2025.</p>
    <h2>Spain still leads</h2>
    <p>Spain remains the dominant nation, hosting eleven of the twenty top-ranked male players and nine of the twenty top-ranked female players.</p>
    <ul>
      <li>Premier Padel had 24 events in 2025.</li>
      <li>FIP sanctioned 412 tournaments globally.</li>
    </ul>
    <blockquote>"Padel is no longer Spanish — it's becoming truly global," said FIP president Luigi Carraro.</blockquote>
    <p>The next World Championships will be hosted in Doha in November 2026.</p>
  </article>
  <footer>copyright stuff</footer>
</body>
</html>`;

describe('extractArticle', () => {
  it('returns title from the article', () => {
    const result = extractArticle(ARTICLE_HTML, 'https://example.com/padel');
    expect(result.title).toContain('Padel');
  });

  it('detects lang from <html lang>', () => {
    const result = extractArticle(ARTICLE_HTML, 'https://example.com/padel');
    expect(result.lang).toBe('en');
  });

  it('returns paragraph segments with sequential integer indices starting at 0', () => {
    const result = extractArticle(ARTICLE_HTML, 'https://example.com/padel');
    expect(result.segments.length).toBeGreaterThanOrEqual(4);
    expect(result.segments[0]!.start).toBe(0);
    expect(result.segments[0]!.end).toBe(0);
    for (let i = 0; i < result.segments.length; i++) {
      expect(result.segments[i]!.start).toBe(i);
      expect(result.segments[i]!.end).toBe(i);
    }
  });

  it('extracts text content from paragraphs, headings, list items, and blockquotes', () => {
    const result = extractArticle(ARTICLE_HTML, 'https://example.com/padel');
    const joined = result.segments.map((s) => s.text).join('\n');
    expect(joined).toContain('30 million players');
    expect(joined).toContain('Spain still leads');
    expect(joined).toContain('Premier Padel had 24 events');
    expect(joined).toContain('no longer Spanish');
    expect(joined).toContain('Doha');
  });

  it('normalizes whitespace inside segments', () => {
    const html = '<!DOCTYPE html><html><body><article><p>  multi\n  line\n  whitespace   here  </p><p>another paragraph long enough to survive readability filtering. another paragraph long enough to survive readability filtering. another paragraph long enough to survive readability filtering.</p></article></body></html>';
    const result = extractArticle(html, 'https://example.com/');
    const first = result.segments.find((s) => s.text.includes('multi'));
    expect(first?.text).toBe('multi line whitespace here');
  });

  it('throws WebContentEmptyError on empty or content-free HTML', () => {
    const html = '<!DOCTYPE html><html><body></body></html>';
    expect(() => extractArticle(html, 'https://example.com/empty')).toThrow(WebContentEmptyError);
  });
});
