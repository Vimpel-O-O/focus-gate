import {limitedText} from './http.mjs';
import {requestDecision} from './providers.mjs';
export {DEFAULT_GOALS} from '../extension/defaults.js';
export const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

// Extract one JSON value without evaluating page JavaScript.
export function extractPlayer(html) {
  const marker = /(?:var\s+)?ytInitialPlayerResponse\s*=\s*/g;
  for (const match of html.matchAll(marker)) {
    const start = match.index + match[0].length;
    if (html[start] !== '{') continue;
    let depth = 0, quoted = false, escaped = false;
    for (let i = start; i < html.length; i++) {
      const ch = html[i];
      if (quoted) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') quoted = false; }
      else if (ch === '"') quoted = true;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) {
        try { return JSON.parse(html.slice(start, i + 1)); } catch { break; }
      }
    }
  }
  return null;
}

export function validateInput(body) {
  if (!body || !VIDEO_ID.test(body.videoId)) throw new Error('Invalid YouTube video ID.');
  if (typeof body.goals !== 'string' || !body.goals.trim() || body.goals.length > 4000) throw new Error('Goals must contain 1–4000 characters.');
  if (typeof body.task !== 'string' || body.task.length > 500) throw new Error('Current task must be at most 500 characters.');
  const ids = body.trustedChannelIds ?? [];
  if (!Array.isArray(ids) || ids.length > 30 || ids.some(id => typeof id !== 'string' || !/^UC[\w-]{22}$/.test(id))) throw new Error('Invalid trusted channel list. Save it again in settings.');
  return {videoId: body.videoId, goals: body.goals.trim(), task: body.task.trim(), trustedChannelIds: [...new Set(ids)].sort()};
}

export async function getVideoSource(videoId, fetcher = fetch, trustedChannelIds = []) {
  if (!VIDEO_ID.test(videoId)) throw new Error('Invalid YouTube video ID.');
  const source = {videoId, title: '', channel: '', channelId: '', description: '', transcript: '', evidence: 'title and channel only'};
  const options = () => ({redirect: 'error', signal: AbortSignal.timeout(9000)});
  // Public, cookie-free requests only. No account credentials or access-control bypass.
  try {
    const response = await fetcher(`https://www.youtube.com/watch?v=${videoId}&hl=en`, options());
    const player = extractPlayer(await limitedText(response, 4_000_000));
    const details = player?.videoDetails;
    if (details?.videoId === videoId) {
      source.title = String(details.title || '').slice(0, 500);
      source.channel = String(details.author || '').slice(0, 300);
      source.channelId = /^UC[\w-]{22}$/.test(details.channelId || '') ? details.channelId : '';
      source.description = String(details.shortDescription || '').slice(0, 10000);
      if (source.description) source.evidence = 'title, channel and description';
      if (source.channelId && trustedChannelIds.includes(source.channelId)) return source;
      const tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
      const track = tracks.find(t => t.languageCode === 'en' && t.kind !== 'asr') || tracks.find(t => t.languageCode === 'en') || tracks[0];
      if (track?.baseUrl) {
        const url = new URL(track.baseUrl);
        // Captions may contain hostile URLs; never follow arbitrary hosts/redirects.
        if (url.protocol === 'https:' && ['www.youtube.com', 'youtube.com'].includes(url.hostname) && url.pathname === '/api/timedtext' && !url.port && !url.username && !url.password) {
          url.searchParams.set('fmt', 'json3');
          try {
            const captions = JSON.parse(await limitedText(await fetcher(url, options()), 2_000_000));
            const text = (captions.events || []).flatMap(e => (e.segs || []).map(s => s.utf8 || '')).join(' ').replace(/\s+/g, ' ').trim();
            if (text) {
              // Sample beginning, middle and end rather than only the introduction.
              source.transcript = text.length <= 18000 ? text : [text.slice(0, 6000), text.slice(Math.floor(text.length / 2) - 3000, Math.floor(text.length / 2) + 3000), text.slice(-6000)].join('\n[...sample gap...]\n');
              source.evidence = text.length <= 18000 ? 'metadata and available captions' : 'metadata and sampled captions';
            }
          } catch { /* Missing captions are an explicit evidence downgrade. */ }
        }
      }
    }
  } catch { /* Consent, unavailable page, changed markup: try public oEmbed. */ }
  if (!source.title) {
    try {
      const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`;
      const data = JSON.parse(await limitedText(await fetcher(url, options()), 50000));
      source.title = String(data.title || '').slice(0, 500);
      source.channel = String(data.author_name || '').slice(0, 300);
      try {
        const author = new URL(data.author_url);
        if (author.protocol === 'https:' && ['www.youtube.com', 'youtube.com'].includes(author.hostname)) {
          source.channelId = author.pathname.match(/^\/channel\/(UC[\w-]{22})\/?$/)?.[1] || '';
        }
      } catch { /* Missing verified channel ID means normal AI review. */ }
    } catch { throw new Error('YouTube metadata could not be retrieved. Video remains blocked; try again later.'); }
  }
  if (!source.title) throw new Error('YouTube returned no usable title.');
  return source;
}

export const DECISION_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    verdict: {type: 'string', enum: ['allow', 'block', 'uncertain']},
    confidence: {type: 'number', minimum: 0, maximum: 1},
    reason: {type: 'string'}, goal: {type: 'string'}
  }, required: ['verdict', 'confidence', 'reason', 'goal']
};

export function validateDecision(d) {
  if (!d || !['allow', 'block', 'uncertain'].includes(d.verdict) || !Number.isFinite(d.confidence) || d.confidence < 0 || d.confidence > 1 || typeof d.reason !== 'string' || !d.reason.trim() || typeof d.goal !== 'string') throw new Error('The model returned an invalid decision. Video remains blocked.');
  return {allowed: d.verdict === 'allow' && d.confidence >= 0.8, verdict: d.verdict === 'allow' && d.confidence < 0.8 ? 'uncertain' : d.verdict, confidence: d.confidence, reason: d.reason.slice(0, 1200), goal: d.goal.slice(0, 300)};
}

export async function evaluateVideo(input, source, options) {
  const parsed = await requestDecision({goals: input.goals, currentTask: input.task, source}, DECISION_SCHEMA, options);
  return {...validateDecision(parsed), title: source.title, channel: source.channel, evidence: source.evidence};
}
