import {DEFAULTS} from './defaults.js';
const $ = id => document.getElementById(id);
const settings = await chrome.storage.local.get(DEFAULTS);
for (const key of Object.keys(DEFAULTS)) $(key).value = settings[key];
$('settings').addEventListener('submit', async event => {
  event.preventDefault();
  const values = Object.fromEntries(Object.keys(DEFAULTS).map(key => [key, $(key).value.trim()]));
  if (!values.goals || !/^[a-f0-9]{64}$/.test(values.token)) {$('status').textContent = 'Enter your goals and the 64-character local pairing token printed by the service.'; return;}
  try {await chrome.storage.local.set(values); $('status').textContent = 'Saved. Reload your YouTube tabs to use these goals.';} catch {$('status').textContent = 'Could not save. Please try again.';}
});
$('test').onclick = async () => {
  $('connection').textContent = 'Connecting…';
  try {const result = await chrome.runtime.sendMessage({type: 'health'}); $('connection').textContent = result.error || (result.apiConfigured ? `Connected · ${result.model} · API key configured (not yet validated by a live request).` : 'Connected, but the service needs an API key.');}
  catch {$('connection').textContent = 'Cannot connect. Start the service and save your pairing token first.';}
};
