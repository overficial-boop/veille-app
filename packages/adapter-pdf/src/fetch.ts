export class PdfFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdfFetchError';
  }
}

const DEFAULT_TIMEOUT_MS = 60_000;

export async function fetchPdfBytes(
  url: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Uint8Array> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
            '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/pdf,*/*;q=0.8',
        },
        redirect: 'follow',
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new PdfFetchError(`Fetch timed out after ${timeoutMs}ms: ${url}`);
      }
      throw new PdfFetchError(
        `Fetch failed for ${url}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!res.ok) {
      throw new PdfFetchError(`HTTP ${res.status} ${res.statusText} for ${url}`);
    }
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  } finally {
    clearTimeout(timer);
  }
}
