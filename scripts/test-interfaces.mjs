import { build } from 'vite';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

// Render real components without needing a browser or a listening socket.
await build({ configFile: false, logLevel: 'warn', build: {
    ssr: resolve('tests/interfaces.test.mjs'), outDir: '.sites-runtime/interface-tests', emptyOutDir: true,
    rollupOptions: { output: { entryFileNames: 'interfaces.test.mjs' } },
} });
const result = spawnSync(process.execPath, ['--test', resolve('.sites-runtime/interface-tests/interfaces.test.mjs')], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
