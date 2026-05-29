import { selectLlmClient } from '@veille/core';
import {
  isYouTubeUrl,
  extractVideoId,
  fetchVideoInfo,
  fetchTranscript,
  pickTrack,
} from '@veille/adapter-youtube';
import { fetchHtml, extractArticle } from '@veille/adapter-web';
import { isLikelyPdfUrl, fetchPdfBytes, extractPdfSegments } from '@veille/adapter-pdf';

const MAX_PROMPT_CHARS = 8000;

function buildPrompt(text: string, language: string, contentType: string): string {
  return [
    `Summarize the following ${contentType} in 2-3 sentences in ${language}.`,
    'Be factual and neutral; do not add opinions or marketing language.',
    'Output the summary text only — no preamble, no headings, no markdown.',
    '',
    `--- ${contentType.toUpperCase()} CONTENT ---`,
    text,
  ].join('\n');
}

async function fetchYouTubeText(url: string, fallbackLang: string): Promise<string> {
  const id = extractVideoId(url);
  if (!id) throw new Error(`Could not extract video id from ${url}`);
  // fetchVideoInfo (youtubei.js) is blocked from datacenter IPs; treat it as
  // best-effort for the caption language and let Supadata supply the transcript.
  let captionLang = fallbackLang;
  try {
    const info = await fetchVideoInfo(id);
    const track = pickTrack(info.captionTracks, info.primaryLanguage, info.primaryLanguage);
    captionLang = track.languageCode;
  } catch {
    // proceed with Supadata using the fallback language
  }
  const segments = await fetchTranscript(id, captionLang);
  return segments.map((s) => s.text).join(' ');
}

async function fetchWebText(url: string): Promise<string> {
  const html = await fetchHtml(url);
  const article = extractArticle(html, url);
  return article.segments.map((s) => s.text).join('\n\n');
}

async function fetchPdfText(url: string): Promise<string> {
  const bytes = await fetchPdfBytes(url);
  const { segments } = await extractPdfSegments(bytes);
  // Take up to first three pages; PDFs are often long and we want a cheap summary.
  return segments
    .slice(0, 3)
    .map((s) => s.text)
    .join('\n\n');
}

export type SummarizeOptions = {
  language?: string;
  model?: string;
};

export type SummarizeResult = {
  summary: string;
  contentType: 'video' | 'PDF' | 'article';
  model: string;
};

/** Fetch the URL via the appropriate adapter, run the text through a single
 *  LLM call, and return a 2-3 sentence summary. Used by the proposal Summarize
 *  action to help the user triage before deciding accept vs. hide. */
export async function summarizeUrl(
  url: string,
  options: SummarizeOptions = {},
): Promise<SummarizeResult> {
  let text: string;
  let contentType: SummarizeResult['contentType'];

  if (isYouTubeUrl(url)) {
    text = await fetchYouTubeText(url, options.language ?? 'en');
    contentType = 'video';
  } else if (isLikelyPdfUrl(url)) {
    text = await fetchPdfText(url);
    contentType = 'PDF';
  } else {
    text = await fetchWebText(url);
    contentType = 'article';
  }

  const trimmed = text.length > MAX_PROMPT_CHARS ? text.slice(0, MAX_PROMPT_CHARS) + ' [...]' : text;
  const language = options.language ?? 'en';
  const prompt = buildPrompt(trimmed, language, contentType);

  const client = selectLlmClient(process.env);
  const opts: { model?: string } = {};
  if (options.model !== undefined) opts.model = options.model;
  const response = await client.complete(prompt, opts);
  return {
    summary: response.text.trim(),
    contentType,
    model: response.model,
  };
}
