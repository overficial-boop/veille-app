import { describe, it, expect } from 'vitest';
import { planDossier } from '../src/plan-dossier.js';
import type { LlmClient } from '@veille/core';

const fakeClient = (json: object): LlmClient =>
  ({ complete: async () => ({ text: JSON.stringify(json), model: 'fake' }) } as unknown as LlmClient);

describe('planDossier', () => {
  it('classifies a chronology intent and caps sources at 3', async () => {
    const client = fakeClient({
      subjectName: "l'affaire X",
      template: 'chronology',
      queries: [
        { query: 'affaire X chronologie', rationale: 'r' },
        { query: 'affaire X faits', rationale: 'r' },
        { query: 'affaire X procès', rationale: 'r' },
        { query: 'affaire X extra', rationale: 'r' },
      ],
    });
    const plan = await planDossier({ intent: 'une chronologie de l’affaire X', language: 'fr', client });
    expect(plan.template).toBe('chronology');
    expect(plan.subjectName).toBe("l'affaire X");
    expect(plan.sources.filter((s) => s.connector === 'tavily')).toHaveLength(3); // capped
    expect(plan.sources.every((s) => s.kind === 'standing')).toBe(true);
  });

  it('keyword guardrail forces chronology even if the model says profile', async () => {
    const client = fakeClient({ subjectName: 'X', template: 'profile', queries: [{ query: 'q', rationale: 'r' }] });
    const plan = await planDossier({ intent: 'chronologie des faits', language: 'fr', client });
    expect(plan.template).toBe('chronology');
  });

  it('adds explicit URLs in the intent as item sources, on top of the cap', async () => {
    const client = fakeClient({ subjectName: 'X', template: 'feed', queries: [{ query: 'q', rationale: 'r' }] });
    const plan = await planDossier({ intent: 'suivre https://example.com/article X', language: 'fr', client });
    const items = plan.sources.filter((s) => s.kind === 'item');
    expect(items).toHaveLength(1);
    expect(items[0]!.input).toEqual({ url: 'https://example.com/article' });
  });
});
