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

/** Returns items whose `url` is not already in `seenUrls`; mutates `seenUrls` to
 *  include the kept ones (so duplicate URLs within one batch collapse too).
 *  Used to skip candidate URLs already extracted on a prior refresh. */
export function freshCandidates<T extends { url: string }>(items: T[], seenUrls: Set<string>): T[] {
  const fresh: T[] = [];
  for (const item of items) {
    if (seenUrls.has(item.url)) continue;
    seenUrls.add(item.url);
    fresh.push(item);
  }
  return fresh;
}
