import {readFile, writeFile, rename, mkdir} from 'node:fs/promises';
import {join} from 'node:path';

export const PROVIDERS = Object.freeze({
  openai: {label: 'OpenAI', keyEnv: 'OPENAI_API_KEY'},
  anthropic: {label: 'Anthropic (Claude)', keyEnv: 'ANTHROPIC_API_KEY'},
  gemini: {label: 'Google (Gemini)', keyEnv: 'GEMINI_API_KEY'},
  xai: {label: 'xAI (Grok)', keyEnv: 'XAI_API_KEY'}
});
export function validateProviderConfig({provider = 'openai', model} = {}) {
  if (!Object.hasOwn(PROVIDERS, provider)) throw new Error('Choose provider: openai, anthropic, gemini, or xai.');
  model ??= provider === 'openai' ? 'gpt-4.1-mini' : '';
  if (typeof model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,149}$/.test(model)) throw new Error('Enter a valid model ID supported by your provider for structured JSON output.');
  return {provider, model};
}
export async function readProviderConfig(dir) {
  try {return validateProviderConfig(JSON.parse(await readFile(join(dir, 'provider.json'), 'utf8')));}
  catch (error) {if (error.code === 'ENOENT') return validateProviderConfig(); throw new Error('Invalid provider.json. Run npm run setup with --provider and --model to repair it.');}
}
export async function writeProviderConfig(dir, config) {
  const clean = validateProviderConfig(config);
  await mkdir(dir, {recursive: true, mode: 0o700});
  await writeFile(join(dir, 'provider.json.tmp'), JSON.stringify(clean, null, 2) + '\n', {mode: 0o600});
  await rename(join(dir, 'provider.json.tmp'), join(dir, 'provider.json'));
}
export function keychainHelper(dir, provider) {
  validateProviderConfig({provider, model: 'validation'});
  // Preserve the original binary and its Keychain access permission on upgrades.
  return join(dir, 'bin', provider === 'openai' ? 'keychain' : 'keychain-provider');
}
