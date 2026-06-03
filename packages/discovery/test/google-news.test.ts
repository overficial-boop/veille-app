import { describe, it, expect } from 'vitest';
import { localeFor, cleanTitle, buildFeedUrl } from '../src/providers/google-news.js';

describe('localeFor', () => {
  it('maps fr to French locale', () => {
    expect(localeFor('fr')).toEqual({ hl: 'fr', gl: 'FR' });
  });
  it('defaults unknown/undefined to en/US', () => {
    expect(localeFor(undefined)).toEqual({ hl: 'en', gl: 'US' });
    expect(localeFor('xx')).toEqual({ hl: 'en', gl: 'US' });
  });
});

describe('cleanTitle', () => {
  it('strips a trailing " - Publisher" suffix', () => {
    expect(cleanTitle('Violences à Paris après PSG-Arsenal - Le Monde')).toBe('Violences à Paris après PSG-Arsenal');
  });
  it('leaves a title without the suffix unchanged', () => {
    expect(cleanTitle('Un titre simple')).toBe('Un titre simple');
  });
});

describe('buildFeedUrl', () => {
  it('builds a localized Google News search RSS url', () => {
    expect(buildFeedUrl('violences PSG', 'fr')).toBe(
      'https://news.google.com/rss/search?q=violences%20PSG&hl=fr&gl=FR&ceid=FR%3Afr',
    );
  });
});
