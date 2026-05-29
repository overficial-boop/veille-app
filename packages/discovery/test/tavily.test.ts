import { describe, it, expect, vi, afterEach } from 'vitest';
import { discoverTavily } from '../src/providers/tavily.js';

describe('discoverTavily includeDomains', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env['VEILLE_TAVILY_KEY'];
  });

  function stubFetchOk() {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('forwards includeDomains as include_domains', async () => {
    process.env['VEILLE_TAVILY_KEY'] = 'test-key';
    const fetchMock = stubFetchOk();
    await discoverTavily({ query: 'pro padel', includeDomains: ['padelmagazine.fr', 'lequipe.fr'] });
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body.include_domains).toEqual(['padelmagazine.fr', 'lequipe.fr']);
  });

  it('omits include_domains when absent or empty', async () => {
    process.env['VEILLE_TAVILY_KEY'] = 'test-key';
    const fetchMock = stubFetchOk();
    await discoverTavily({ query: 'pro padel', includeDomains: [] });
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect('include_domains' in body).toBe(false);
  });
});
