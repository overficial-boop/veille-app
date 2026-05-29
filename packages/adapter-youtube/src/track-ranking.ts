import type { CaptionTrack } from './metadata.js';

function baseLanguage(code: string): string {
  return (code.split('-')[0] ?? code).toLowerCase();
}

export function pickTrack(
  tracks: CaptionTrack[],
  targetLanguage: string,
  primaryLanguage: string,
): CaptionTrack {
  if (tracks.length === 0) {
    throw new Error('pickTrack: empty track list');
  }

  const target = baseLanguage(targetLanguage);
  const primary = baseLanguage(primaryLanguage);

  const exactTarget = tracks.find((t) => baseLanguage(t.languageCode) === target);
  if (exactTarget) return exactTarget;

  const primaryMatch = tracks.find((t) => baseLanguage(t.languageCode) === primary);
  if (primaryMatch) return primaryMatch;

  return tracks[0]!;
}
