import {DEFAULTS} from './defaults.js';
const $ = id => document.getElementById(id);
const settings = await chrome.storage.local.get(DEFAULTS);
for (const key of Object.keys(DEFAULTS)) if ($(key)) $(key).value = settings[key];
// Do not let an early keystroke be overwritten by asynchronous storage loading.
$('settings-fields').disabled = false;
$('settings').addEventListener('submit', async event => {
  event.preventDefault();
  const values = Object.fromEntries(Object.keys(DEFAULTS).filter(key => $(key)).map(key => [key, $(key).value.trim()]));
  if (!values.goals || !/^[a-f0-9]{64}$/.test(values.token)) {$('status').textContent = 'Enter your goals and the 64-character local pairing token printed by the service.'; return;}
  const save = $('settings').querySelector('button[type="submit"]');
  save.disabled = true;
  try {
    if (Object.hasOwn(values, 'trustedChannels')) {
      const entries = [...new Set(values.trustedChannels.split(/\r?\n/).map(s => s.trim()).filter(Boolean))];
      if (entries.length > 30) throw new Error('You can trust up to 30 channels.');
      if (entries.length) {
        $('status').textContent = 'Verifying channel identities…';
        const result = await chrome.runtime.sendMessage({type: 'resolve-channels', entries, token: values.token});
        if (result.error) throw new Error(result.error);
        if (!Array.isArray(result.trustedChannelIds)) throw new Error('Restart the local service to enable trusted channels.');
        values.trustedChannelIds = result.trustedChannelIds;
      } else values.trustedChannelIds = [];
    }
    await chrome.storage.local.set(values);
    try {await chrome.runtime.sendMessage({type: 'settings-updated'}); $('status').textContent = 'Saved. Open videos are being reviewed again.';}
    catch {$('status').textContent = 'Saved. Reload YouTube to apply your changes.';}
  } catch (error) {$('status').textContent = error.message || 'Could not save. Please try again.';}
  finally {save.disabled = false;}
});
$('test').onclick = async () => {
  $('connection').textContent = 'Connecting…';
  try {const result = await chrome.runtime.sendMessage({type: 'health'}); $('connection').textContent = result.error || (result.apiConfigured ? `Connected · ${result.model} · API key configured (not yet validated by a live request).` : 'Connected, but the service needs an API key.');}
  catch {$('connection').textContent = 'Cannot connect. Start the service and save your pairing token first.';}
};
