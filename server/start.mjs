import {randomBytes} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createGateServer} from './server.mjs';
import {openCache} from './cache.mjs';

const local = process.env.FOCUS_GATE_DATA_DIR || join(homedir(), 'Library/Application Support/FocusGate');
await mkdir(local, {recursive: true, mode: 0o700});
let apiKey = process.env.OPENAI_API_KEY || '';
if (!apiKey) {
  try {apiKey = execFileSync(join(local, 'bin/keychain'), ['get'], {stdio: ['ignore', 'pipe', 'pipe']}).toString().trim();}
  catch {console.error('API key unavailable. Run npm run setup with your login Keychain unlocked.');}
}
const tokenFile = join(local, 'pairing-token');
let token;
try {token = (await readFile(tokenFile, 'utf8')).trim();}
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  token = randomBytes(32).toString('hex');
  await writeFile(tokenFile, token, {mode: 0o600, flag: 'wx'});
}
if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Invalid pairing token. Restore your local pairing-token file.');
const cache = await openCache(join(local, 'decisions.json'));
const server = createGateServer({apiKey, token, cache, model: process.env.OPENAI_MODEL || 'gpt-4.1-mini'});
server.on('error', e => {console.error(e.code === 'EADDRINUSE' ? 'Port 43127 is already in use. Stop the other service first.' : 'Local service failed to start.'); process.exitCode = 1;});
server.listen(43127, '127.0.0.1', () => console.log('Focus Gate listening on 127.0.0.1:43127. API configured: ' + Boolean(apiKey)));
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => process.exit(1), 15000); deadline.unref();
  server.close(async () => {await cache.flush(); clearTimeout(deadline); process.exit(0);});
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
