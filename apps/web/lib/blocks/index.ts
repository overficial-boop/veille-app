// Registration bootstrap: importing this module makes the registry complete and validated.
import { registerBlock, validateRegistry, listBlocks, getBlock } from './registry';
import { execSummaryBlock } from './generators/exec-summary';
import { tldrBlock } from './generators/tldr';

const g = globalThis as { __verso_blocksRegistered?: boolean };
if (!g.__verso_blocksRegistered) {
  g.__verso_blocksRegistered = true;
  registerBlock(execSummaryBlock);
  registerBlock(tldrBlock);
  const errors = validateRegistry();
  if (errors.length) throw new Error(`invalid block registry:\n${errors.join('\n')}`);
}

export { listBlocks, getBlock };
