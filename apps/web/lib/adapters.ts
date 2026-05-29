import { registerAdapter, resetAdapters } from '@veille/core';
import { youtubeAdapter } from '@veille/adapter-youtube';
import { webAdapter } from '@veille/adapter-web';
import { textAdapter } from '@veille/adapter-text';
import { pdfAdapter } from '@veille/adapter-pdf';

/** Register all built-in adapters. Specialty URL adapters before the
 *  catch-all web adapter. */
export function registerAllAdapters(): void {
  resetAdapters();
  registerAdapter(youtubeAdapter);
  registerAdapter(pdfAdapter);
  registerAdapter(webAdapter);
  registerAdapter(textAdapter);
}
