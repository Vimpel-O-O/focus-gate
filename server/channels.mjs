import {limitedText} from './http.mjs';

export const CHANNEL_ID = /^UC[\w-]{22}$/;

export function parseChannelEntry(entry) {
  if (typeof entry !== 'string' || entry.length > 250) throw new Error('Enter a YouTube @handle, channel URL or channel ID.');
  let value = entry.trim();
  if (CHANNEL_ID.test(value)) return {id: value};
  if (/^(?:https?:\/\/)?(?:www\.|m\.)?youtube\.com\//i.test(value)) {
    const url = new URL(/^https?:/.test(value) ? value : 'https://' + value);
    if (!['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname) || url.port || url.username || url.password) throw new Error('Only YouTube channel URLs are supported.');
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'channel' && CHANNEL_ID.test(parts[1] || '')) return {id: parts[1]};
    value = decodeURIComponent(parts[0] || '');
  }
  if (/^@[\p{L}\p{N}_.\-\p{M}]{1,100}$/u.test(value)) return {handle: value};
  throw new Error('Use a YouTube @handle, youtube.com/@handle URL, or UC channel ID. Display names and video links are not supported.');
}

export async function resolveChannel(entry, fetcher = fetch) {
  const parsed = parseChannelEntry(entry);
  if (parsed.id) return parsed.id;
  const url = 'https://www.youtube.com/' + encodeURIComponent(parsed.handle).replace('%40', '@');
  const response = await fetcher(url, {redirect: 'error', signal: AbortSignal.timeout(10000)});
  const html = await limitedText(response, 4_000_000);
  // Only channel metadata identifies the page owner; recommendation IDs do not.
  const id = html.match(/"channelMetadataRenderer"\s*:\s*\{[^}]*?"externalId"\s*:\s*"(UC[\w-]{22})"/)?.[1];
  if (!id) throw new Error(`Could not verify ${parsed.handle}. Try its youtube.com/channel/UC… link or channel ID.`);
  return id;
}
