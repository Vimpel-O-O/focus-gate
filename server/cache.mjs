import {mkdir, readFile, writeFile, rename, stat} from 'node:fs/promises';
import {dirname} from 'node:path';

export const CACHE_TTL = 6 * 3600000;
// Cache files contain private video metadata. Keys are hashes of the full policy.
export async function openCache(file, {now = Date.now, max = 300} = {}) {
  const cache = new Map();
  try {
    if ((await stat(file)).size > 8 * 1024 * 1024) throw new Error('Cache too large');
    const data = JSON.parse(await readFile(file, 'utf8'));
    if (data.version === 1 && Array.isArray(data.entries)) {
      for (const [key, entry] of data.entries.slice(-max)) {
        if (/^[a-f0-9]{64}$/.test(key) && Number.isFinite(entry?.at) && entry.at <= now() && now() - entry.at < CACHE_TTL && typeof entry?.value?.allowed === 'boolean') cache.set(key, entry);
      }
    }
  } catch { /* Missing, expired or damaged cache: recheck safely. */ }
  let writing = Promise.resolve();
  const originalSet = cache.set.bind(cache);
  cache.set = (key, value) => {
    cache.delete(key);
    while (cache.size >= max) cache.delete(cache.keys().next().value);
    originalSet(key, value);
    const data = JSON.stringify({version: 1, entries: [...cache]});
    writing = writing.then(async () => {
      await mkdir(dirname(file), {recursive: true, mode: 0o700});
      await writeFile(file + '.tmp', data, {mode: 0o600});
      await rename(file + '.tmp', file);
    }).catch(() => {console.error('Could not persist decision cache. Checks remain available.');});
    return cache;
  };
  cache.flush = () => writing;
  return cache;
}
