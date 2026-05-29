import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Resolves from dist/ → package root → prompts/extract.md
const PROMPT_PATH = path.resolve(__dirname, '..', 'prompts', 'extract.md');

let _cached: { template: string; hash: string } | null = null;

export async function loadPrompt(): Promise<{ template: string; hash: string }> {
  if (_cached) return _cached;
  const template = await fs.readFile(PROMPT_PATH, 'utf-8');
  const hash = createHash('sha256').update(template).digest('hex').slice(0, 16);
  _cached = { template, hash };
  return _cached;
}

/**
 * Per-adapter configuration that customizes the shared extraction prompt
 * for a particular content type and locator scheme.
 */
export type LocatorConfig = {
  /** Singular noun for the content type, e.g. "transcript", "article", "text". */
  contentType: string;
  /** Function that renders a locator marker given a start value, e.g. `(s) => "[" + s.toFixed(1) + "s]"`. Used when serializing segments into the prompt. */
  formatMarker: (start: number) => string;
  /** Human-readable phrase describing what a locator means, e.g. "seconds within the video", "paragraph index", "line number". */
  locatorUnit: string;
  /**
   * Whether the LLM-emitted `end` locator is inclusive of its endpoint. For
   * continuous locators like seconds, the LLM naturally emits half-open ranges
   * (default, false). For discrete locators like paragraph indices, the LLM
   * reads "ends at paragraph 5" as inclusive — set true so `[3, 5]` includes
   * paragraph 5 and a single-paragraph fact `[3, 3]` is non-empty.
   */
  inclusiveEnd?: boolean;
};

export type PromptVars = {
  language: string;
  subjectHint: string;
  chunk: string;
  contentType: string;
  locatorUnit: string;
  markerExample: string;
};

export function renderPrompt(template: string, vars: PromptVars): string {
  const subjectHint = vars.subjectHint.trim() === '' ? '(none)' : vars.subjectHint;
  return template
    .replaceAll('{{language}}', vars.language)
    .replaceAll('{{subjectHint}}', subjectHint)
    .replaceAll('{{chunk}}', vars.chunk)
    .replaceAll('{{contentType}}', vars.contentType)
    .replaceAll('{{locatorUnit}}', vars.locatorUnit)
    .replaceAll('{{markerExample}}', vars.markerExample);
}
