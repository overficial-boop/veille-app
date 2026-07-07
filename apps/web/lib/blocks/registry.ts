import type { BlockDef, BlockScope } from './types';

const registry = new Map<string, BlockDef>();

export function registerBlock(def: BlockDef): void {
  if (registry.has(def.id)) throw new Error(`duplicate block id: ${def.id}`);
  registry.set(def.id, def);
}

export function getBlock(id: string): BlockDef | undefined { return registry.get(id); }
export function listBlocks(): BlockDef[] { return [...registry.values()]; }
export function __clearRegistryForTests(): void { registry.clear(); }

const canRun = (def: BlockDef, scope: BlockScope) => def.scope === 'both' || def.scope === scope;

/** Validate the whole registry: unknown refs, scope violations, cycles. Returns human-readable errors. */
export function validateRegistry(): string[] {
  const errors: string[] = [];
  for (const def of registry.values()) {
    for (const p of def.prerequisites) {
      if ((p.kind === 'raw-content' || p.kind === 'item-metadata' || p.kind === 'item-facts') && !canRun(def, 'item'))
        errors.push(`block "${def.id}": ${p.kind} requires item scope`);
      if (p.kind === 'all-items') {
        if (!canRun(def, 'page')) errors.push(`block "${def.id}": all-items requires page scope`);
        const ref = registry.get(p.blockId);
        if (!ref) errors.push(`block "${def.id}": unknown prerequisite "${p.blockId}"`);
        else if (!canRun(ref, 'item')) errors.push(`block "${def.id}": all-items target "${p.blockId}" is not item-capable`);
      }
      if (p.kind === 'block' && !registry.has(p.blockId))
        errors.push(`block "${def.id}": unknown prerequisite "${p.blockId}"`);
    }
  }
  // Cycle detection (DFS over block + all-items edges).
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (id: string, path: string[]): void => {
    const s = state.get(id);
    if (s === 'done') return;
    if (s === 'visiting') { errors.push(`cycle: ${[...path, id].join(' → ')}`); return; }
    state.set(id, 'visiting');
    const def = registry.get(id);
    for (const p of def?.prerequisites ?? []) {
      if (p.kind === 'block' || p.kind === 'all-items') visit(p.blockId, [...path, id]);
    }
    state.set(id, 'done');
  };
  for (const id of registry.keys()) visit(id, []);
  return errors;
}
