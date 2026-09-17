import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile, stat, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openCache, CACHE_TTL} from '../server/cache.mjs';
import {createGateServer} from '../server/server.mjs';

async function cacheFile(t) {
  const dir = await mkdtemp(join(tmpdir(), 'focus-gate-test-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  return join(dir, 'decisions.json');
}
test('cache persists bounded decisions privately and expires old entries', async t => {
  const file = await cacheFile(t), now = Date.now();
  const cache = await openCache(file, {now: () => now, max: 2});
  for (const key of ['a','b','c']) cache.set(key.repeat(64), {at: now, value: {allowed: true}});
  await cache.flush();
  const restored = await openCache(file, {now: () => now});
  assert.equal(restored.size, 2); assert.equal(restored.has('a'.repeat(64)), false);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal((await openCache(file, {now: () => now + CACHE_TTL})).size, 0);
});
test('damaged and invalid cache cannot grant playback', async t => {
  const file = await cacheFile(t);
  for (const data of ['{broken', JSON.stringify({version: 1, entries: [['a'.repeat(64), {at: Date.now() + 100000, value: {allowed: true}}]]}), JSON.stringify({version: 1, entries: [['b'.repeat(64), {at: Date.now(), value: {allowed: 'yes'}}]]})]) {
    await writeFile(file, data); assert.equal((await openCache(file)).size, 0);
  }
});
test('restarted backend reuses decisions without source or AI calls; changed interests recheck', async t => {
  const file = await cacheFile(t), token = 'a'.repeat(64);
  let calls = 0, lookups = 0;
  async function boot() {
    const cache = await openCache(file);
    const server = createGateServer({apiKey: 'test', token, cache, sourceLoader: async () => {lookups++; return {title: 'Example'};}, evaluator: async () => {calls++; return {allowed: true, verdict: 'allow'};}});
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return {post: async goals => (await fetch(`http://127.0.0.1:${server.address().port}/evaluate`, {method: 'POST', headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'}, body: JSON.stringify({videoId: 'abcdefghijk', goals, task: ''})})).json(), close: async () => {await new Promise(resolve => server.close(resolve)); await cache.flush();}};
  }
  const first = await boot();
  try {assert.equal((await first.post('Gardening')).cached, false);} finally {await first.close();}
  const second = await boot();
  try {
    assert.equal((await second.post('Gardening')).cached, true); assert.equal(calls, 1); assert.equal(lookups, 1);
    assert.equal((await second.post('Cooking')).cached, false); assert.equal(calls, 2);
    assert.equal((await readFile(file, 'utf8')).includes('Gardening'), false);
  } finally {await second.close();}
});
