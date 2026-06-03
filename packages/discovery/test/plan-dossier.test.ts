import { describe, it, expect } from 'vitest';
import { planDossier } from '../src/plan-dossier.js';
import type { LlmClient } from '@veille/core';

const fakeClient = (json: object): LlmClient =>
  ({ complete: async () => ({ text: JSON.stringify(json), model: 'fake' }) } as unknown as LlmClient);

describe('planDossier', () => {
  it('emits state queries as tavily and watch queries as google-news', async () => {
    const client = fakeClient({
      subjectName: "l'affaire X",
      template: 'chronology',
      stateQueries: [
        { query: 'affaire X chronologie', rationale: 'r' },
        { query: 'affaire X faits', rationale: 'r' },
      ],
      watchQueries: [{ query: 'affaire X dernières actualités', rationale: 'r' }],
    });
    const plan = await planDossier({ intent: 'une chronologie de l’affaire X', language: 'fr', client });
    const standing = plan.sources.filter((s) => s.kind === 'standing');
    const state = standing.filter((s) => s.purpose === 'state');
    const watch = standing.filter((s) => s.purpose === 'watch');
    expect(state).toHaveLength(2);
    expect(watch).toHaveLength(1);
    expect(state.every((s) => s.connector === 'tavily')).toBe(true);
    expect(watch.every((s) => s.connector === 'google-news')).toBe(true);
    // watch = google-news carries just the query (no topic/days)
    expect(watch[0]!.input).toEqual({ query: 'affaire X dernières actualités' });
  });

  it('caps each set at maxQueries independently', async () => {
    const five = (p: string) => Array.from({ length: 5 }, (_, i) => ({ query: `${p}${i}`, rationale: 'r' }));
    const client = fakeClient({ subjectName: 'X', template: 'feed', stateQueries: five('s'), watchQueries: five('w') });
    const plan = await planDossier({ intent: 'suivre X', language: 'fr', client, maxQueries: 3 });
    expect(plan.sources.filter((s) => s.purpose === 'state')).toHaveLength(3);
    expect(plan.sources.filter((s) => s.purpose === 'watch')).toHaveLength(3);
  });

  it('keyword guardrail forces chronology even if the model says profile', async () => {
    const client = fakeClient({ subjectName: 'X', template: 'profile', stateQueries: [{ query: 'q', rationale: 'r' }], watchQueries: [] });
    const plan = await planDossier({ intent: 'chronologie des faits', language: 'fr', client });
    expect(plan.template).toBe('chronology');
  });

  it('adds explicit URLs in the intent as item sources, on top of the cap', async () => {
    const client = fakeClient({ subjectName: 'X', template: 'feed', stateQueries: [{ query: 'q', rationale: 'r' }], watchQueries: [] });
    const plan = await planDossier({ intent: 'suivre https://example.com/article X', language: 'fr', client });
    const items = plan.sources.filter((s) => s.kind === 'item');
    expect(items).toHaveLength(1);
    expect(items[0]!.input).toEqual({ url: 'https://example.com/article' });
    expect(items[0]!.purpose).toBe('state');
  });
});
