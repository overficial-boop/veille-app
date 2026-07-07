// Registration bootstrap: importing this module makes the registry complete and validated.
import { registerBlock, validateRegistry, listBlocks, getBlock, hiddenPrereqIds } from './registry';
import { itemAnalysisBlock } from './generators/item-analysis';
import { EXTRACTION_BLOCKS } from './generators/extract';
import { execSummaryBlock } from './generators/exec-summary';
import { tldrBlock } from './generators/tldr';

// Self-healing bootstrap: after dev-HMR the registry Map may be recreated empty while any
// global flag would survive — so guard on the registry's own state, not a flag.
if (!getBlock(itemAnalysisBlock.id)) {
  registerBlock(itemAnalysisBlock);
  registerBlock(execSummaryBlock);
  for (const b of EXTRACTION_BLOCKS) registerBlock(b);
  registerBlock(tldrBlock);
  const errors = validateRegistry();
  if (errors.length) throw new Error(`invalid block registry:\n${errors.join('\n')}`);
}

export { listBlocks, getBlock, hiddenPrereqIds };
