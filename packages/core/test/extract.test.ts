import { describe, it, expect, beforeEach } from 'vitest';
import {
  extract,
  extractInput,
  registerAdapter,
  resetAdapters,
  UnsupportedUrlError,
  UnsupportedInputError,
  type Adapter,
  type ExtractInput,
} from '../src/extract.js';

describe('extract', () => {
  beforeEach(() => resetAdapters());

  it('throws UnsupportedUrlError when no adapter matches', async () => {
    await expect(extract('https://example.com/foo')).rejects.toThrow(UnsupportedUrlError);
  });

  it('dispatches to the first matching adapter', async () => {
    const fakeAdapter: Adapter = {
      name: 'youtube',
      matches: (input) => input.kind === 'url' && input.url.includes('youtube'),
      extract: async () => [
        {
          id: 'f1',
          text: 'a fact',
          sourceUrl: 'x',
          sourcePassage: 'y',
          language: 'en',
          extractedAt: '2026-05-13T00:00:00Z',
          provenance: {},
          extractedBy: { model: 'm', promptHash: 'h', adapter: 'youtube' },
        },
      ],
    };
    registerAdapter(fakeAdapter);
    const facts = await extract('https://youtube.com/watch?v=abc');
    expect(facts).toHaveLength(1);
    expect(facts[0]?.text).toBe('a fact');
  });

  it('passes hints through to the adapter', async () => {
    let receivedHints: unknown;
    registerAdapter({
      name: 'youtube',
      matches: () => true,
      extract: async (_input, hints) => {
        receivedHints = hints;
        return [];
      },
    });
    await extract('http://x', { language: 'fr', subjectHint: 'pro padel' });
    expect(receivedHints).toEqual({ language: 'fr', subjectHint: 'pro padel' });
  });
});

describe('extractInput', () => {
  beforeEach(() => resetAdapters());

  it('throws UnsupportedInputError when no adapter matches', async () => {
    await expect(
      extractInput({ kind: 'text', content: 'hello' }),
    ).rejects.toThrow(UnsupportedInputError);
  });

  it('dispatches text input to a matching text adapter', async () => {
    const textAdapter: Adapter = {
      name: 'youtube', // reusing AdapterName for test; real text adapter would have its own name
      matches: (input: ExtractInput) => input.kind === 'text',
      extract: async (input: ExtractInput) => {
        const content = input.kind === 'text' ? input.content : '';
        return [
          {
            id: 't1',
            text: `extracted from: ${content}`,
            sourceUrl: input.kind === 'text' ? (input.label ?? 'text') : '',
            sourcePassage: content,
            language: 'en',
            extractedAt: '2026-05-14T00:00:00Z',
            provenance: {},
            extractedBy: { model: 'm', promptHash: 'h', adapter: 'text' },
          },
        ];
      },
    };
    registerAdapter(textAdapter);
    const facts = await extractInput({ kind: 'text', content: 'some article text', label: 'article-1' });
    expect(facts).toHaveLength(1);
    expect(facts[0]?.text).toBe('extracted from: some article text');
  });
});
