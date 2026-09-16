import {DEFAULTS} from './defaults.js';
// Prevent page content scripts from reading the pairing token through storage.
chrome.storage.local.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'});
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

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
    const ownPage = url.origin === new URL(chrome.runtime.getURL('/')).origin;
    if (message.type === 'settings') {await chrome.runtime.openOptionsPage(); return {ok: true};}
    const settings = await chrome.storage.local.get(DEFAULTS);
    if (message.type === 'health' && ownPage) return await request('/health', settings);
    if (message.type !== 'evaluate' || url.protocol !== 'https:' || !/(^|\.)(youtube\.com|youtube-nocookie\.com)$/.test(url.hostname)) throw new Error('Request not allowed.');
    const match = url.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]{11})(?:\/|$)/);
    const actualId = url.pathname === '/watch' ? url.searchParams.get('v') : match?.[1];
    if (!/^[\w-]{11}$/.test(message.videoId) || actualId !== message.videoId) throw new Error('Video changed. Retry the current video.');
    return await request('/evaluate', settings, {videoId: message.videoId, goals: settings.goals, task: settings.task});
  })().then(respond, error => respond({error: error.message}));
  return true;
});
