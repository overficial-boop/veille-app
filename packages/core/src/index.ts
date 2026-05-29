// Types
export type {
  AdapterName,
  ProvenanceData,
  ExtractedBy,
  Fact,
  SourceConfig,
  Subject,
  DiscoveryTool,
  DiscoveryToolKind,
  TavilyConfig,
  RssConfig,
  YouTubeChannelConfig,
  Proposal,
  ProposalStatus,
} from './types.js';

// ID helper (re-export so consumers don't each need a uuid dep)
export { v7 as uuidv7 } from 'uuid';

// Extract registry + dispatch
export {
  extract,
  extractInput,
  registerAdapter,
  resetAdapters,
  findAdapter,
  UnsupportedInputError,
  UnsupportedUrlError,
} from './extract.js';
export type { Adapter, ExtractHints, ExtractInput } from './extract.js';

// Pricing
export { PRICING, estimateUsd } from './pricing.js';
export type { ModelPricing, TokenUsage, CostInfo } from './pricing.js';

// Chunking
export { chunkSegments, CHUNK_DURATION_SECONDS, CHUNK_OVERLAP_SECONDS } from './chunk.js';
export type { Segment, Chunk } from './chunk.js';

// Passage
export { reconstructPassage } from './passage.js';

// Prompt
export { loadPrompt, renderPrompt } from './prompt.js';
export type { LocatorConfig, PromptVars } from './prompt.js';

// LLM
export {
  selectLlmClient,
  extractFromChunk,
  FACTS_RESPONSE_SCHEMA,
  LlmExtractionError,
} from './llm.js';
export type { LlmClient, LlmCompleteOptions, LlmResponse, ExtractionResult, RawFact } from './llm.js';

// Summary stream parser
export { createSummaryStreamParser } from './summary-stream-parser.js';
export type { SummaryStreamParser } from './summary-stream-parser.js';

// Pipeline
export { runFactExtraction, mapWithConcurrency } from './pipeline.js';
export type { RunFactExtractionInput, RunFactExtractionResult } from './pipeline.js';

// Subject store
export {
  subjectStoreDir,
  slugify,
  loadSubject,
  saveSubject,
  deleteSubject,
  listSubjects,
  subjectExists,
  SubjectNotFoundError,
  SubjectAlreadyExistsError,
  InvalidSlugError,
} from './subject-store.js';
export type { SubjectSummary } from './subject-store.js';

// Subject operations (cross-surface: CLI, web)
export {
  createSubject,
  addSource,
  removeSource,
  editSubject,
  runRefresh,
  resolveSubjectSlug,
  deleteSubjectByArg,
  NoSourcesError,
  // Discovery tools & proposals
  addDiscoveryTool,
  editDiscoveryTool,
  listDiscoveryTools,
  removeDiscoveryTool,
  markToolDiscovered,
  addProposals,
  hideProposal,
  unhideProposal,
  acceptProposal,
  setProposalSummary,
  ProposalNotFoundError,
  DiscoveryToolNotFoundError,
  ProposalAlreadyTriagedError,
} from './operations.js';
export type {
  CreateSubjectInput,
  EditSubjectPatch,
  RefreshCallbacks,
  RefreshOptions,
  RefreshResult,
  AddDiscoveryToolInput,
  CandidateLike,
  AddProposalsResult,
} from './operations.js';

// Subject export (markdown + json)
export {
  exportSubject,
  exportSubjectAsMarkdown,
  exportSubjectAsJson,
  exportSubjectMimeType,
  exportSubjectFilename,
} from './export.js';
export type { ExportFormat } from './export.js';
