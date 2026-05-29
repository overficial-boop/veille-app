import type { Fact } from '@veille/core';

export function dedupKey(fact: Pick<Fact, 'sourceUrl' | 'text'>): string {
  return `${fact.sourceUrl}\n${fact.text.trim()}`;
}

/** Returns facts not already in `seen`; mutates `seen` to include the kept ones. */
export function filterNewFacts(incoming: Fact[], seen: Set<string>): Fact[] {
  const fresh: Fact[] = [];
  for (const fact of incoming) {
    const key = dedupKey(fact);
    if (seen.has(key)) continue;
    seen.add(key);
    fresh.push(fact);
  }
  return fresh;
}
