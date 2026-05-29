// Replaces jsdom's xhr-sync-worker.js at build time via webpack's
// NormalModuleReplacementPlugin. See next.config.ts for the rationale —
// jsdom statically refers to its sync-XHR worker via require.resolve(),
// which webpack interprets as a module reference and bundles. When the
// bundle loads, the real worker's top-level code attaches a process.stdin
// listener and JSON.parse('') throws on the closed stdin.
//
// We never use synchronous XHR (adapter-web uses native fetch + jsdom for
// HTML parsing only), so swapping in this no-op stub is safe: jsdom's
// require.resolve still returns a valid module reference, and the stub's
// top-level does nothing.
'use strict';
