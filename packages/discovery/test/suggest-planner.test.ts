import { describe, it, expect, vi, afterEach } from 'vitest';
import { suggestSubjectSetup } from '../src/suggest.js';
import type { LlmClient } from '@veille/core';

// A client that returns planner JSON for the planner prompt and empty-source
// JSON for the main suggestion prompt — keeps the test fully offline (no seed /
// rss / youtube validation network calls).
function routingClient(): LlmClient {
  return {
    complete: async (prompt: string) => {
      const text = prompt.includes('search-query planner')
        ? JSON.stringify({
            queries: [
              { query: 'padel france', days: 7, topic: 'news', includeDomains: ['lequipe.fr'], rationale: 'rp' },
              { query: 'padel transferts', rationale: 'rp2' },
            ],
          })
        : JSON.stringify({ seedSources: [], rss: [], youtubeChannels: [] });
      return { text, inputTokens: 0, outputTokens: 0, model: 'fake-model' };
    },
  };
}

describe('suggestSubjectSetup planner integration', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env['VEILLE_TAVILY_KEY'];
  });

  it('sources Tavily suggestions from the planner (includeDomains); unchecked when no key', async () => {
    const res = await suggestSubjectSetup({ query: 'le padel pro', client: routingClient() });
    const tavily = res.discoveryTools.filter((t) => t.kind === 'tavily');
    expect(tavily).toHaveLength(2);
    expect(tavily[0]!.config.query).toBe('padel france');
    expect(tavily[0]!.config.includeDomains).toEqual(['lequipe.fr']);
    expect(tavily[0]!.status).toBe('unchecked');
    expect(res.seedSources).toEqual([]);
  });

  it('drops suggestions that duplicate existing subject content', async () => {
    // Suggest call returns one of each kind; planner returns two queries.
    const client: LlmClient = {
      complete: async (prompt: string) => {
        const text = prompt.includes('search-query planner')
          ? JSON.stringify({
              queries: [
                { query: 'padel france', rationale: 'rp' },
                { query: 'padel transferts', rationale: 'rp2' },
              ],
            })
          : JSON.stringify({
              seedSources: [{ url: 'https://seed.com/x', rationale: 'rs' }],
              rss: [{ feedUrl: 'https://a.com/feed', rationale: 'rr' }],
              youtubeChannels: [{ channelId: 'UCabcdefghijklmnopqrstuv', rationale: 'ry' }],
            });
        return { text, inputTokens: 0, outputTokens: 0, model: 'fake-model' };
      },
    };
    // Existing content matches the seed/rss/yt and one of the two queries.
    const res = await suggestSubjectSetup({
      query: 'le padel pro',
      client,
      existing: {
        sourceUrls: ['https://seed.com/x/'], // trailing slash → still matches
        rssFeedUrls: ['https://a.com/feed'],
        youtubeChannelIds: ['UCabcdefghijklmnopqrstuv'],
        tavilyQueries: ['Padel France'], // case-insensitive → matches
      },
    });
    expect(res.seedSources).toEqual([]);
    expect(res.discoveryTools.filter((t) => t.kind === 'rss')).toEqual([]);
    expect(res.discoveryTools.filter((t) => t.kind === 'youtube-channel')).toEqual([]);
    const tavily = res.discoveryTools.filter((t) => t.kind === 'tavily');
    expect(tavily).toHaveLength(1);
    expect(tavily[0]!.config.query).toBe('padel transferts');
  });

  it('dry-run verifies Tavily queries when VEILLE_TAVILY_KEY is set', async () => {
    process.env['VEILLE_TAVILY_KEY'] = 'test-key';
    const results = Array.from({ length: 3 }, (_, i) => ({ url: `https://x/${i}`, title: 't' }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ results }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    const res = await suggestSubjectSetup({ query: 'le padel pro', client: routingClient() });
    const tavily = res.discoveryTools.filter((t) => t.kind === 'tavily');
    expect(tavily).toHaveLength(2);
    expect(tavily.every((t) => t.status === 'verified')).toBe(true);
  });
});
