import type { BlockDef, ResolvedInputs } from './types';
import { combineFingerprints, contentFingerprint } from './fingerprint';

/** Injected data access so the resolver stays pure and unit-testable. */
export type BlockLoaders = {
  factPool: (dossierId: string) => Promise<{ facts: { id: string; text: string; sourceUrl: string; sourcePassage: string }[]; version: string }>;
  document: (documentId: string) => Promise<{ content: string | null; title: string; url: string; siteName?: string; publishedAt: Date | string | null } | null>;
  cachedOutput: (dossierId: string, blockId: string, targetKey: string) => Promise<{ content: string; fingerprint: string } | null>;
  allOutputs: (dossierId: string, blockId: string) => Promise<{ targetKey: string; content: string }[]>;
  itemFacts: (documentId: string) => Promise<{ facts: { id: string; text: string; sourceUrl: string; sourcePassage: string }[] }>;
};

export type ResolveTarget = { dossierId: string; documentId?: string };
export type Resolved = { inputs: ResolvedInputs; fingerprint: string };
export type ResolveResult = Resolved | { missing: string };

/** Kahn topological order over block/all-items edges, restricted to the given set. Duplicate ids
 *  are deduped (first occurrence wins) — callers may pass one entry per (block, target) pair.
 *  Assumes the registry graph is validated (acyclic) at boot; edges leaving the set are ignored. */
export function topoOrder(defs: BlockDef[]): BlockDef[] {
  const seen = new Set<string>();
  const unique = defs.filter((d) => (seen.has(d.id) ? false : (seen.add(d.id), true)));
  const inSet = new Map(unique.map((d) => [d.id, d]));
  const deps = new Map<string, Set<string>>();
  for (const d of unique) {
    const s = new Set<string>();
    for (const p of d.prerequisites) {
      if ((p.kind === 'block' || p.kind === 'all-items') && inSet.has(p.blockId)) s.add(p.blockId);
    }
    deps.set(d.id, s);
  }
  const out: BlockDef[] = [];
  const done = new Set<string>();
  while (out.length < unique.length) {
    const ready = unique.filter((d) => !done.has(d.id) && [...deps.get(d.id)!].every((x) => done.has(x)));
    if (ready.length === 0) break; // unreachable if registry is acyclic; guard anyway
    for (const d of ready) { out.push(d); done.add(d.id); }
  }
  return out;
}

/** Resolve a block's declared inputs for one target. Returns the inputs bundle + the cache
 *  fingerprint, or { missing } naming the first unsatisfiable prerequisite. */
export async function resolveInputs(def: BlockDef, target: ResolveTarget, loaders: BlockLoaders): Promise<ResolveResult> {
  const inputs: ResolvedInputs = {};
  const prints: string[] = [];
  const targetKey = target.documentId ?? 'page';

  for (const p of def.prerequisites) {
    if (p.kind === 'fact-pool') {
      const pool = await loaders.factPool(target.dossierId);
      inputs.factPool = pool;
      prints.push(pool.version);
    } else if (p.kind === 'raw-content' || p.kind === 'item-metadata') {
      if (!target.documentId) return { missing: `${p.kind} requires an item target` };
      const doc = await loaders.document(target.documentId);
      if (!doc) return { missing: `${p.kind}: document ${target.documentId} not found` };
      if (p.kind === 'raw-content') {
        if (!doc.content) return { missing: `raw-content: document ${target.documentId} has no stored content` };
        inputs.rawContent = { text: doc.content, title: doc.title ?? '', url: doc.url };
        prints.push(contentFingerprint(doc.content));
      } else {
        inputs.itemMetadata = {
          title: doc.title ?? '', url: doc.url, siteName: doc.siteName,
          publishedAt: doc.publishedAt ? new Date(doc.publishedAt).toISOString() : undefined,
        };
        prints.push(contentFingerprint(`${doc.title}|${doc.url}`));
      }
    } else if (p.kind === 'item-facts') {
      if (!target.documentId) return { missing: 'item-facts requires an item target' };
      const { facts } = await loaders.itemFacts(target.documentId);
      inputs.itemFacts = { facts };
      // Id-only fingerprint is sound: facts are insert-only in this codebase (never edited in place).
      prints.push(contentFingerprint(facts.map((f) => f.id).join(',')));
    } else if (p.kind === 'block') {
      const cached = await loaders.cachedOutput(target.dossierId, p.blockId, targetKey);
      if (!cached) return { missing: `block "${p.blockId}" has no cached output for ${targetKey}` };
      inputs.blocks = { ...inputs.blocks, [p.blockId]: cached.content };
      prints.push(cached.fingerprint);
    } else if (p.kind === 'all-items') {
      const outs = await loaders.allOutputs(target.dossierId, p.blockId);
      inputs.allItems = { ...inputs.allItems, [p.blockId]: outs };
      prints.push(contentFingerprint(outs.map((o) => `${o.targetKey}:${contentFingerprint(o.content)}`).join(',')));
    }
  }
  return { inputs, fingerprint: combineFingerprints([def.id, targetKey, ...prints]) };
}
