import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
function worker() {
  const handlers = {}, storage = new Map();
  const cache = { async match(key) { return storage.get(typeof key === 'string' ? key : key.url); }, async put(key, value) { storage.set(typeof key === 'string' ? key : key.url, value); } };
  const context = { self: { location: { origin: 'https://campus.example' }, addEventListener: (key, fn) => handlers[key] = fn, skipWaiting() {}, clients: { async claim() {} } }, caches: { async open() { return cache; }, async keys() { return []; } }, URL, Response, fetch: async () => new Response('asset', { status: 200 }) };
  vm.runInNewContext(source, context); return { handlers, storage, context };
}
test('service worker never caches API responses, auth or cross-origin resources', () => { const { handlers } = worker(); for (const url of ['https://campus.example/api/workspace', 'https://campus.example/signin-with-chatgpt', 'https://other.example/file.js']) { let intercepted = false; handlers.fetch({ request: { method: 'GET', url }, respondWith() { intercepted = true; } }); assert.equal(intercepted, false); } });
test('offline navigation falls back to the prepared shell', async () => { const { handlers, storage, context } = worker(); storage.set('/', new Response('cached-shell')); context.fetch = async () => { throw new Error('offline'); }; let response; handlers.fetch({ request: { method: 'GET', url: 'https://campus.example/', mode: 'navigate' }, respondWith(p) { response = p; } }); assert.equal(await (await response).text(), 'cached-shell'); });
test('warmup only fetches the app shell and same-origin static assets', async () => { const { handlers, context, storage } = worker(); const fetched = []; context.fetch = async url => { fetched.push(url); return new Response('asset'); }; let done; handlers.message({ data: { type: 'PREPARE_OFFLINE', urls: ['https://campus.example/assets/app.js', 'https://other.example/tracker.js', 'https://campus.example/api/private.js'] }, waitUntil(p) { done = p; } }); await done; assert.deepEqual(fetched, ['/', 'https://campus.example/assets/app.js']); assert.equal(storage.size, 2); });
