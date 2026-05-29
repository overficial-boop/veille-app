import { describe, it, expect, afterEach } from 'vitest';
import { fetchTranscriptViaSupadata, SupadataError } from '../src/supadata.js';

function resp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('fetchTranscriptViaSupadata', () => {
  afterEach(() => {
    delete process.env['SUPADATA_API_KEY'];
  });

  it('throws when no API key', async () => {
    await expect(fetchTranscriptViaSupadata('vid', 'en')).rejects.toThrow(SupadataError);
  });

  it('maps a synchronous 200 transcript (ms -> seconds) and uses the videoId param', async () => {
    process.env['SUPADATA_API_KEY'] = 'k';
    let calledUrl = '';
    const fetchImpl = (async (u: string) => {
      calledUrl = u;
      return resp({
        content: [
          { text: 'a', offset: 0, duration: 1000, lang: 'en' },
          { text: 'b', offset: 1000, duration: 2000, lang: 'en' },
        ],
        lang: 'en',
      });
    }) as unknown as typeof fetch;
    const segs = await fetchTranscriptViaSupadata('vid', 'en', { fetchImpl });
    expect(calledUrl).toContain('videoId=vid');
    expect(calledUrl).not.toContain('url=vid');
    expect(segs).toEqual([
      { start: 0, end: 1, text: 'a' },
      { start: 1, end: 3, text: 'b' },
    ]);
  });

  it('polls the async job until completed', async () => {
    process.env['SUPADATA_API_KEY'] = 'k';
    let call = 0;
    const fetchImpl = (async () => {
      call += 1;
      if (call === 1) return resp({ jobId: 'job1' }, 202);
      if (call === 2) return resp({ status: 'active' });
      return resp({ status: 'completed', content: [{ text: 'x', offset: 0, duration: 500 }], lang: 'en' });
    }) as unknown as typeof fetch;
    const segs = await fetchTranscriptViaSupadata('vid', 'en', {
      fetchImpl,
      sleep: async () => {},
    });
    expect(segs).toEqual([{ start: 0, end: 0.5, text: 'x' }]);
    expect(call).toBe(3);
  });

  it('throws when the async job fails', async () => {
    process.env['SUPADATA_API_KEY'] = 'k';
    let call = 0;
    const fetchImpl = (async () => {
      call += 1;
      if (call === 1) return resp({ jobId: 'job1' }, 202);
      return resp({ status: 'failed', error: 'no captions' });
    }) as unknown as typeof fetch;
    await expect(
      fetchTranscriptViaSupadata('vid', 'en', { fetchImpl, sleep: async () => {} }),
    ).rejects.toThrow(/no captions/);
  });

  it('throws on a non-ok response', async () => {
    process.env['SUPADATA_API_KEY'] = 'k';
    const fetchImpl = (async () => resp({ error: 'bad' }, 400)) as unknown as typeof fetch;
    await expect(fetchTranscriptViaSupadata('vid', 'en', { fetchImpl })).rejects.toThrow(
      SupadataError,
    );
  });
});
