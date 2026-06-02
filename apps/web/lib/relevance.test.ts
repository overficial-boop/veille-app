import { describe, it, expect } from 'vitest';
import { parseRelevance, buildRelevancePrompt } from './relevance';

describe('parseRelevance', () => {
  it('parses score + reason', () => {
    expect(parseRelevance('{"score":0.8,"reason":"traite directement le sujet"}')).toEqual({ score: 0.8, reason: 'traite directement le sujet' });
  });
  it('clamps score to [0,1] and tolerates fences', () => {
    expect(parseRelevance('```json\n{"score":1.7,"reason":"x"}\n```').score).toBe(1);
    expect(parseRelevance('{"score":-2,"reason":"x"}').score).toBe(0);
  });
  it('falls back to score 0 + empty reason on garbage', () => {
    expect(parseRelevance('not json')).toEqual({ score: 0, reason: '' });
  });
});
describe('buildRelevancePrompt', () => {
  it('includes the intent and the content', () => {
    const p = buildRelevancePrompt({ title: 'T', content: 'CORPUS', intent: 'suivre X', language: 'fr' });
    expect(p).toContain('suivre X');
    expect(p).toContain('CORPUS');
  });
});
