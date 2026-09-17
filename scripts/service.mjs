import {mkdir, readFile, writeFile, copyFile, cp, rm, chmod, access} from 'node:fs/promises';
import {execFileSync, spawn} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';
import {createInterface} from 'node:readline/promises';
import {Writable} from 'node:stream';
import {homedir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const data = join(homedir(), 'Library/Application Support/FocusGate');
const app = join(data, 'app'), bin = join(data, 'bin');
const label = 'com.focusgate.service', domain = `gui/${process.getuid()}`;
const plist = join(homedir(), 'Library/LaunchAgents', label + '.plist');
const target = `${domain}/${label}`;
const helper = join(bin, 'keychain');
const command = process.argv[2];
const exists = path => access(path).then(() => true, () => false);
const run = (name, args, options = {}) => execFileSync(name, args, {stdio: ['ignore', 'pipe', 'pipe'], ...options});
const xml = s => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
function loaded() {try {run('launchctl', ['print', target]); return true;} catch {return false;}}
function stop() {if (loaded()) run('launchctl', ['bootout', target]);}
function keyAvailable() {try {return run(helper, ['get']).length > 0;} catch {return false;}}
async function health() {
  const token = (await readFile(join(data, 'pairing-token'), 'utf8')).trim();
  const response = await fetch('http://127.0.0.1:43127/health', {headers: {Authorization: `Bearer ${token}`}, signal: AbortSignal.timeout(1500)});
  if (!response.ok) throw new Error('Local service authentication failed.');
  return response.json();
}
async function start() {
  if (!keyAvailable()) throw new Error('API key unavailable. Run npm run setup in your terminal first.');
  if (!loaded()) {
    // Do not take over a port occupied by an unmanaged foreground service.
    try {await fetch('http://127.0.0.1:43127/health', {signal: AbortSignal.timeout(1000)}); throw new Error('Port 43127 is occupied. Stop your old npm start process, then run npm run service:start.');}
    catch (error) {if (error.message.startsWith('Port 43127')) throw error;}
    run('launchctl', ['bootstrap', domain, plist]);
  } else run('launchctl', ['kickstart', '-k', target]);
  for (let n = 0; n < 25; n++) {
    try {const result = await health(); if (result.apiConfigured) {console.log('Background service is running and will start at login.'); return;}} catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('Service did not become ready. Check npm run service:status and the private service.err.log.');
}
async function stage() {
  await mkdir(bin, {recursive: true, mode: 0o700}); await chmod(data, 0o700);
  const source = await readFile(join(root, 'scripts/keychain.swift'));
  const hash = createHash('sha256').update(source).digest('hex');
  const savedHash = await readFile(join(bin, 'keychain.sha256'), 'utf8').catch(() => '');
  if (savedHash !== hash || !await exists(helper)) {
    run('/usr/bin/xcrun', ['swiftc', join(root, 'scripts/keychain.swift'), '-o', helper]);
    await chmod(helper, 0o700);
    await writeFile(join(bin, 'keychain.sha256'), hash, {mode: 0o600});
  }
  // Keep a stable runtime independent of shell initialization and version managers.
  await copyFile(process.execPath, join(bin, 'node.next')); await chmod(join(bin, 'node.next'), 0o700);
  const {rename} = await import('node:fs/promises'); await rename(join(bin, 'node.next'), join(bin, 'node'));
  await mkdir(app, {recursive: true, mode: 0o700});
  await cp(join(root, 'server'), join(app, 'server'), {recursive: true});
  await mkdir(join(app, 'extension'), {recursive: true, mode: 0o700});
  await copyFile(join(root, 'extension/defaults.js'), join(app, 'extension/defaults.js'));
  await copyFile(join(root, 'package.json'), join(app, 'package.json'));
  const tokenFile = join(data, 'pairing-token');
  if (!await exists(tokenFile)) {
    const old = await readFile(join(root, '.local/pairing-token'), 'utf8').catch(() => '');
    const token = /^[a-f0-9]{64}$/.test(old.trim()) ? old.trim() : randomBytes(32).toString('hex');
    await writeFile(tokenFile, token, {mode: 0o600, flag: 'wx'});
  }
  await chmod(tokenFile, 0o600);
  for (const name of ['service.log', 'service.err.log']) {await writeFile(join(data, name), '', {flag: 'a', mode: 0o600}); await chmod(join(data, name), 0o600);}
  await mkdir(dirname(plist), {recursive: true});
  await writeFile(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${xml(join(bin, 'node'))}</string><string>${xml(join(app, 'server/start.mjs'))}</string></array>
<key>WorkingDirectory</key><string>${xml(app)}</string>
<key>EnvironmentVariables</key><dict><key>FOCUS_GATE_DATA_DIR</key><string>${xml(data)}</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>30</integer>
<key>Umask</key><integer>63</integer>
<key>StandardOutPath</key><string>${xml(join(data, 'service.log'))}</string>
<key>StandardErrorPath</key><string>${xml(join(data, 'service.err.log'))}</string>
</dict></plist>`, {mode: 0o600});
  console.log('Installed background runtime and login service.');
}
async function saveKey() {
  if (!process.stdin.isTTY) throw new Error('Run npm run setup in an interactive terminal to enter your API key privately.');
  process.stdout.write('OpenAI API key (hidden, stored in Apple Keychain; Enter keeps existing key): ');
  const silent = new Writable({write(_chunk, _encoding, done) {done();}});
  const rl = createInterface({input: process.stdin, output: silent, terminal: true});
  let key;
  try {key = (await rl.question('')).trim();} finally {rl.close(); process.stdout.write('\n');}
  if (key) {
    await new Promise((resolve, reject) => {
      const child = spawn(helper, ['set'], {stdio: ['pipe', 'ignore', 'inherit']});
      child.on('error', reject); child.stdin.on('error', reject);
      child.on('exit', code => code === 0 ? resolve() : reject(new Error('Could not store the key.')));
      child.stdin.end(key);
    });
  }
  if (!keyAvailable()) throw new Error('No readable key in Apple Keychain. Run setup again with your login Keychain unlocked.');
}
try {
  if (process.platform !== 'darwin') throw new Error('This background setup supports macOS.');
  switch (command) {
    case 'setup': await stage(); await saveKey(); await start(); console.log('Local pairing token (paste into extension settings):\n' + (await readFile(join(data, 'pairing-token'), 'utf8')).trim()); break;
    case 'install': await stage(); console.log('Run npm run setup once to save your API key and activate the service.'); break;
    case 'update': {const active = loaded(); stop(); try {await stage();} catch (error) {if (active) await start(); throw error;} await start(); break;}
    case 'start': await start(); break;
    case 'stop': stop(); console.log('Stopped until manually started or next login.'); break;
    case 'status': console.log('Login service: ' + (loaded() ? 'loaded' : 'not loaded')); try {const result = await health(); console.log('Backend reachable. API configured: ' + result.apiConfigured);} catch {console.log('Backend not reachable with the saved pairing token.');} break;
    case 'token': console.log((await readFile(join(data, 'pairing-token'), 'utf8')).trim()); break;
    case 'uninstall': stop(); await rm(plist, {force: true}); console.log('Login service removed. Keychain entry and private local data retained.'); break;
    default: throw new Error('Use setup, update, start, stop, status, token, or uninstall.');
  }
} catch (error) {console.error(error.message); process.exitCode = 1;}
