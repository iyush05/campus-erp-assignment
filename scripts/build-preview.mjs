import { resolve, join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const root = process.cwd();
const modules = resolve(process.argv[2] || 'node_modules');
const { build } = await import(pathToFileURL(join(modules, 'vite/dist/node/index.js')).href);
const source = join(root, 'outputs/preview-source');
await mkdir(source, { recursive: true });
await writeFile(join(source, 'index.html'), '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#216b53"><title>Campus — Academic workspace</title><link rel="icon" href="/favicon.svg"><link rel="manifest" href="/manifest.webmanifest"></head><body><div id="root"></div><script type="module" src="/entry.tsx"></script></body></html>');
await writeFile(join(source, 'entry.tsx'), `
import React from 'react';
import { createRoot } from 'react-dom/client';
import CampusApp from '../../app/workspace';
import '../../app/globals.css';
async function start() {
  let owner = null;
  try { owner = sessionStorage.getItem('campus-local-account'); } catch {}
  try {
    const response = await fetch('/api/demo/account', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (response.ok) owner = (await response.json()).owner;
    else owner = null;
    try { if (owner) sessionStorage.setItem('campus-local-account', owner); else sessionStorage.removeItem('campus-local-account'); } catch {}
  } catch {}
  createRoot(document.getElementById('root')!).render(<CampusApp owner={owner} localDemo />);
}
void start();
`);
await build({ configFile: false, root: source, publicDir: join(root, 'public'), css: { postcss: { plugins: [] } }, resolve: { alias: { 'react-dom': join(modules, 'react-dom'), react: join(modules, 'react') } }, define: { 'process.env.NODE_ENV': '"production"' }, build: { outDir: join(root, 'outputs/local-preview'), emptyOutDir: true } });
