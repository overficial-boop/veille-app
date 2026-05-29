import { extractText } from 'unpdf';
import type { Segment } from '@veille/core';

export class PdfEmptyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdfEmptyError';
  }
}

export type ExtractedPdf = {
  segments: Segment[];
  pageCount: number;
};

/** Run a PDF through unpdf and produce one Segment per page with text content.
 *  Pages are 1-indexed (start === end === page number) to match how humans cite
 *  PDFs. Empty pages are skipped. */
export async function extractPdfSegments(bytes: Uint8Array): Promise<ExtractedPdf> {
  const { text, totalPages } = await extractText(bytes, { mergePages: false });
  const pages: string[] = Array.isArray(text) ? text : [text];

  const segments: Segment[] = [];
  pages.forEach((raw, i) => {
    const cleaned = (raw ?? '').replace(/\s+/g, ' ').trim();
    if (!cleaned) return;
    segments.push({ start: i + 1, end: i + 1, text: cleaned });
  });

  if (segments.length === 0) {
    throw new PdfEmptyError('PDF has no extractable text (scanned image, encrypted, or empty).');
  }

  return { segments, pageCount: totalPages ?? pages.length };
}
