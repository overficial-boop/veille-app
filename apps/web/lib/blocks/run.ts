import './index'; // ensure registry is populated + validated
import type { BlockDef, ResolvedInputs } from './types';
import { topoOrder, type ResolveResult } from './resolve';

export type WorkItem = { instanceId: string; blockId: string; targetKey: string };

/** Injected effects so the batch semantics (order, skip, miss, fail-soft) are unit-testable. */
export type ExecDeps = {
  getDef: (id: string) => BlockDef | undefined;
  resolve: (def: BlockDef, targetKey: string) => Promise<ResolveResult>;
  existing: (instanceId: string, targetKey: string) => Promise<{ fingerprint: string; stale: boolean } | null>;
  save: (item: WorkItem, content: string, citations: { factId?: string; url: string }[], fingerprint: string) => Promise<void>;
  narrate: (label: string) => void;
};

export type ExecResult = {
  ran: string[]; skipped: string[];
  missed: { blockId: string; reason: string }[];
  failed: { blockId: string; error: string }[];
};

/** Run a batch of block instances in DAG order. Fresh cache → skip; missing prereq → record and
 *  continue; generator error → record and continue. Never throws for a single block's sake. */
export async function executeBlocks(items: WorkItem[], ctx: { dossierId: string; language: string }, deps: ExecDeps): Promise<ExecResult> {
  const res: ExecResult = { ran: [], skipped: [], missed: [], failed: [] };
  const defs = items.map((i) => deps.getDef(i.blockId)).filter((d): d is BlockDef => !!d);
  const order = topoOrder(defs).map((d) => d.id);
  const sorted = [...items].sort((a, b) => order.indexOf(a.blockId) - order.indexOf(b.blockId));

  for (const item of sorted) {
    const def = deps.getDef(item.blockId);
    if (!def) { res.missed.push({ blockId: item.blockId, reason: 'unknown block' }); continue; }
    const r = await deps.resolve(def, item.targetKey);
    if ('missing' in r) { res.missed.push({ blockId: def.id, reason: r.missing }); continue; }
    const cached = await deps.existing(item.instanceId, item.targetKey);
    if (cached && cached.fingerprint === r.fingerprint && !cached.stale) {
      res.skipped.push(def.id);
      continue;
    }
    deps.narrate(`Bloc « ${def.name} » — génération…`);
    try {
      const out = await def.generate(r.inputs as ResolvedInputs, { language: ctx.language });
      await deps.save(item, out.content, out.citations, r.fingerprint);
      res.ran.push(def.id);
      deps.narrate(`Bloc « ${def.name} » — terminé.`);
    } catch (e) {
      res.failed.push({ blockId: def.id, error: e instanceof Error ? e.message : String(e) });
      deps.narrate(`Bloc « ${def.name} » — échec.`);
    }
  }
  return res;
}

/** Entry point for the worker: binds executeBlocks to the real DB. */
export async function runBlocksJob(
  dossierId: string,
  params: { instanceIds?: string[]; targetKeys?: string[] },
  narrate: (label: string) => void,
): Promise<ExecResult> {
  const { listInstances, upsertOutput, dbLoaders } = await import('./store');
  const { getBlock } = await import('./index');
  const { resolveInputs } = await import('./resolve');
  const { db } = await import('../db');
  const { blockOutputs, dossiers } = await import('../db/schema');
  const { and, eq } = await import('drizzle-orm');

  const [dossier] = await db.select({ language: dossiers.language }).from(dossiers).where(eq(dossiers.id, dossierId));
  const language = dossier?.language ?? 'fr';
  const instances = await listInstances(dossierId, params.instanceIds);
  const loaders = dbLoaders();

  // Page instances target 'page'; item instances fan out over the provided targetKeys (documents).
  const items: WorkItem[] = [];
  for (const inst of instances) {
    if (inst.scope === 'page') items.push({ instanceId: inst.id, blockId: inst.blockId, targetKey: 'page' });
    else for (const t of params.targetKeys ?? []) items.push({ instanceId: inst.id, blockId: inst.blockId, targetKey: t });
  }

  return executeBlocks(items, { dossierId, language }, {
    getDef: getBlock,
    resolve: (def, targetKey) => resolveInputs(def, { dossierId, documentId: targetKey === 'page' ? undefined : targetKey }, loaders),
    existing: async (instanceId, targetKey) => {
      const [row] = await db.select({ fingerprint: blockOutputs.fingerprint, stale: blockOutputs.stale })
        .from(blockOutputs).where(and(eq(blockOutputs.instanceId, instanceId), eq(blockOutputs.targetKey, targetKey)));
      return row ?? null;
    },
    save: (item, content, citations, fingerprint) =>
      upsertOutput({ instanceId: item.instanceId, targetKey: item.targetKey, content, citations, fingerprint }),
    narrate,
  });
}
