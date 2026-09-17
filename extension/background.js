import {DEFAULTS} from './defaults.js';
// Prevent page content scripts from reading the pairing token through storage.
chrome.storage.local.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'});

async function request(path, settings, body) {
  if (!settings.token) throw new Error('Connect your local service in Focus Gate settings first.');
  let response;
  try {
    response = await fetch('http://127.0.0.1:43127' + path, {
      method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(55000),
      headers: {'Content-Type': 'application/json', Authorization: `Bearer ${settings.token}`},
      ...(body ? {body: JSON.stringify(body)} : {})
    });
  } catch {throw new Error('Cannot reach the local service. Start it, then retry. Playback stays blocked.');}
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Check failed.');
  return result;
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  (async () => {
    if (sender.id !== chrome.runtime.id) throw new Error('Invalid sender.');
    const url = new URL(sender.url || 'https://invalid.local');
    const ownPage = url.protocol === 'chrome-extension:' && url.hostname === chrome.runtime.id;
    if (message.type === 'settings-updated' && ownPage) {
      const tabs = await chrome.tabs.query({});
      await Promise.allSettled(tabs.filter(tab => Number.isInteger(tab.id)).map(tab => chrome.tabs.sendMessage(tab.id, {type: 'focus-settings-changed'})));
      return {ok: true};
    }
    const settings = await chrome.storage.local.get(DEFAULTS);
    if (message.type === 'resolve-channels' && ownPage) {
      if (typeof message.token !== 'string' || !/^[a-f0-9]{64}$/.test(message.token)) throw new Error('Enter the local pairing token first.');
      return await request('/resolve-channels', {...settings, token: message.token}, {entries: message.entries});
    }
    if (message.type === 'health' && ownPage) return await request('/health', settings);
    if (message.type !== 'evaluate' || url.protocol !== 'https:' || !/(^|\.)(youtube\.com|youtube-nocookie\.com)$/.test(url.hostname)) throw new Error('Request not allowed.');
    // sender.url may retain the initial document URL after SPA navigation.
    // Trust its validated origin, not its stale path. Content-script generation
    // checks bind each decision to the live video before unlocking playback.
    // A validated ID reaches fixed YouTube endpoints, never an arbitrary URL.
    if (typeof message.videoId !== 'string' || !/^[\w-]{11}$/.test(message.videoId)) throw new Error('Invalid video ID.');
    return await request('/evaluate', settings, {videoId: message.videoId, goals: settings.goals, task: settings.task, trustedChannelIds: settings.trustedChannelIds});
  })().then(respond, error => respond({error: error.message}));
  return true;
});
