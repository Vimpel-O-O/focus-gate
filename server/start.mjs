import {randomBytes} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createInterface} from 'node:readline/promises';
import {Writable} from 'node:stream';
import {createGateServer} from './server.mjs';

let apiKey = process.env.OPENAI_API_KEY || '';
if (!apiKey && process.stdin.isTTY) {
  process.stdout.write('OpenAI API key (hidden; kept in memory, never saved): ');
  const silent = new Writable({write(_chunk, _enc, cb) {cb();}});
  const rl = createInterface({input: process.stdin, output: silent, terminal: true});
  apiKey = (await rl.question('')).trim(); rl.close(); process.stdout.write('\n');
}
if (!apiKey) {console.error('An OpenAI API key is required. Run npm start in your terminal or set OPENAI_API_KEY.'); process.exit(1);}
const local = new URL('../.local/', import.meta.url);
await mkdir(local, {recursive: true, mode: 0o700});
const tokenFile = new URL('pairing-token', local);
let token;
try {token = (await readFile(tokenFile, 'utf8')).trim();} catch {token = randomBytes(32).toString('hex'); await writeFile(tokenFile, token, {mode: 0o600});}
const server = createGateServer({apiKey, token, model: process.env.OPENAI_MODEL || 'gpt-4.1-mini'});
server.on('error', e => {console.error(e.code === 'EADDRINUSE' ? 'Port 43127 is already in use. Stop the other service first.' : e.message); process.exitCode = 1;});
server.listen(43127, '127.0.0.1', () => {
  console.log('Focus Gate is running on http://127.0.0.1:43127');
  console.log('Paste this LOCAL pairing token into extension settings (not your OpenAI key):\n' + token);
  console.log('Keep this terminal open. Press Ctrl+C to stop.');
});
