import { createMDX } from 'fumadocs-mdx/next';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, '../..');
const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // openroom-sdk is a workspace package that ships raw TypeScript with
  // NodeNext-style `.js` import specifiers. transpilePackages runs it
  // through the Next.js TypeScript pipeline so the extensions resolve
  // correctly in both server and browser bundles.
  transpilePackages: ['openroom-sdk'],
  // Pin the turbopack workspace root to the monorepo root so it doesn't
  // climb past it looking for lockfiles. Using the repo root (rather than
  // this app directory) is required for Next to resolve its own package
  // through the pnpm store.
  turbopack: {
    root: workspaceRoot,
  },
  // Fumadocs ships content at /docs/<slug> as HTML. AI agents and CLI
  // tools can request the raw markdown via /docs/<slug>.mdx — rewrite
  // that to the llms.mdx content route. The previous Node-runtime
  // proxy.ts file also negotiated via Accept header, but that needs
  // Node middleware which OpenNext on CF doesn't support yet; the
  // suffix form covers the main AI-consumption use case.
  async rewrites() {
    return [
      {
        source: '/docs/:path*.mdx',
        destination: '/llms.mdx/docs/:path*/content.md',
      },
    ];
  },
};

export default withMDX(config);
