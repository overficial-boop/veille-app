import { describe, it, expect } from 'vitest';
import { planTavilyQueries, EmptyIntentError } from '../src/plan-queries.js';
import type { LlmClient } from '@veille/core';

function fakeClient(text: string): LlmClient {
  return { complete: async () => ({ text, inputTokens: 0, outputTokens: 0, model: 'fake-model' }) };
}

describe('planTavilyQueries', () => {
  it('parses queries, clamps days, filters topic enum, dedups domains', async () => {
    const client = fakeClient(
      JSON.stringify({
        queries: [
          { query: 'padel professionnel', days: 7.9, topic: 'news', includeDomains: ['lequipe.fr', 'lequipe.fr', ''], rationale: 'r1' },
          { query: 'Premier Padel transfers', topic: 'bogus', rationale: 'r2' },
        ],
      }),
    );
    const res = await planTavilyQueries({ intent: 'le padel pro', client });
    expect(res.queries).toHaveLength(2);
    expect(res.queries[0]!.config.days).toBe(7);
    expect(res.queries[0]!.config.topic).toBe('news');
    expect(res.queries[0]!.config.includeDomains).toEqual(['lequipe.fr']);
    expect(res.queries[1]!.config.topic).toBeUndefined();
    expect(res.model).toBe('fake-model');
  });

  it('caps at 3 queries', async () => {
    const client = fakeClient(
      JSON.stringify({ queries: Array.from({ length: 5 }, (_, i) => ({ query: `q${i}`, rationale: 'r' })) }),
    );
    const res = await planTavilyQueries({ intent: 'x', client });
    expect(res.queries).toHaveLength(3);
  });

  it('throws on empty intent', async () => {
    await expect(planTavilyQueries({ intent: '   ', client: fakeClient('{}') })).rejects.toThrow(EmptyIntentError);
  });

  it('returns empty queries on unparseable response', async () => {
    const res = await planTavilyQueries({ intent: 'x', client: fakeClient('not json at all') });
    expect(res.queries).toEqual([]);
  });
});
