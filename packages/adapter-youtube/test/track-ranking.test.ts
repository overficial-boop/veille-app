import { describe, it, expect } from 'vitest';
import { pickTrack } from '../src/track-ranking.js';
import type { CaptionTrack } from '../src/metadata.js';

const t = (languageCode: string, kind: 'manual' | 'asr' = 'manual'): CaptionTrack => ({
  languageCode,
  kind,
  name: `${languageCode} ${kind}`,
});

describe('pickTrack', () => {
  it('picks exact target language match', () => {
    const tracks = [t('fr'), t('en'), t('de')];
    expect(pickTrack(tracks, 'en', 'fr').languageCode).toBe('en');
  });

  it('matches base language regardless of region (en matches en-US)', () => {
    const tracks = [t('fr'), t('en-US'), t('de')];
    expect(pickTrack(tracks, 'en', 'fr').languageCode).toBe('en-US');
  });

  it('falls back to primary language when target absent', () => {
    const tracks = [t('fr'), t('de')];
    expect(pickTrack(tracks, 'en', 'fr').languageCode).toBe('fr');
  });

  it('falls back to first track when neither target nor primary match', () => {
    const tracks = [t('ar'), t('zh')];
    expect(pickTrack(tracks, 'en', 'pt').languageCode).toBe('ar');
  });

  it('throws when given an empty track list', () => {
    expect(() => pickTrack([], 'en', 'en')).toThrow();
  });
});
