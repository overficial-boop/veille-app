import path from 'node:path';
import type { NextConfig } from 'next';

const workspaceRoot = path.resolve(import.meta.dirname, '..', '..');

const nextConfig: NextConfig = {
  // Load @veille/* and their Node-only transitive deps as runtime Node modules
  // instead of bundling them. Bundling these caused dev-mode webpack to fail
  // emitting vendor chunks (e.g. zod), producing 500s. With externals, modules
  // resolve at runtime via the normal Node loader. Trade-off: packages' dist/
  // must be built before `next dev`/`next build` (handled by the predev/prebuild
  // scripts in package.json).
  serverExternalPackages: [
    '@veille/core',
    '@veille/adapter-youtube',
    '@veille/adapter-web',
    '@veille/adapter-text',
    '@veille/adapter-pdf',
    '@veille/discovery',
    'jsdom',
    '@mozilla/readability',
    'youtubei.js',
    'youtube-transcript',
    'rss-parser',
    'unpdf',
    'canvas',
    '@anthropic-ai/sdk',
    '@google/genai',
    'pg',
  ],
  webpack: (config, { isServer, webpack }) => {
    if (isServer) {
      // jsdom/unpdf list `canvas` as an optional native dep we never use.
      config.externals = [
        ...((config.externals ?? []) as unknown[]),
        { canvas: 'commonjs canvas' },
      ] as typeof config.externals;

      // jsdom statically require.resolve()s its xhr-sync-worker, which webpack
      // bundles and runs at startup, throwing on closed stdin. We never use sync
      // XHR (adapter-web uses fetch + jsdom for parsing only), so stub it out.
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(
          /xhr-sync-worker(\.js)?$/,
          path.resolve(import.meta.dirname, 'jsdom-xhr-sync-worker-stub.js'),
        ),
      );
    }
    return config;
  },
  outputFileTracingRoot: workspaceRoot,
};

export default nextConfig;
