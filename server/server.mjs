import {createServer} from 'node:http';
import {timingSafeEqual, createHash} from 'node:crypto';
import {validateInput, getVideoSource, evaluateVideo} from './core.mjs';
import {resolveChannel} from './channels.mjs';

export function createGateServer({apiKey, token, model = 'gpt-4.1-mini', sourceLoader = getVideoSource, evaluator = evaluateVideo, channelResolver = resolveChannel, cache = new Map()}) {
  if (!token || token.length < 32) throw new Error('A strong pairing token is required.');
  const pending = new Map(); let calls = [], lookups = [], resolutions = [];
  const server = createServer(async (req, res) => {
    const origin = req.headers.origin;
    const host = req.headers.host || '';
    const send = (status, body) => {res.writeHead(status, {'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}); res.end(JSON.stringify(body));};
    if (!/^127\.0\.0\.1:\d+$/.test(host)) return send(403, {error: 'Invalid host.'});
    if (origin && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) return send(403, {error: 'Only the paired extension can use this service.'});
    if (origin) {res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin');}
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
      res.writeHead(204); return res.end();
    }
    const supplied = Buffer.from(String(req.headers.authorization || '').replace(/^Bearer /, ''));
    const expected = Buffer.from(token);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return send(401, {error: 'Pairing token is missing or incorrect. Open extension settings.'});
    if (req.url === '/health' && req.method === 'GET') return send(200, {ok: true, apiConfigured: Boolean(apiKey), model});
    if (!['/evaluate', '/resolve-channels'].includes(req.url) || req.method !== 'POST') return send(404, {error: 'Not found.'});
    if (!String(req.headers['content-type']).startsWith('application/json')) return send(415, {error: 'JSON required.'});
    try {
      let body = ''; let bytes = 0;
      for await (const chunk of req) {bytes += chunk.length; if (bytes > 20000) return send(413, {error: 'Request too large.'}); body += chunk;}
      let parsed; try {parsed = JSON.parse(body);} catch {return send(400, {error: 'Invalid JSON.'});}
      if (req.url === '/resolve-channels') {
        if (!Array.isArray(parsed.entries) || parsed.entries.length > 30 || parsed.entries.some(e => typeof e !== 'string' || e.length > 250)) return send(400, {error: 'Enter up to 30 channels, one per line.'});
        resolutions = resolutions.filter(t => Date.now() - t < 60000);
        if (resolutions.length >= 5) return send(429, {error: 'Too many channel saves. Wait a minute and try again.'});
        resolutions.push(Date.now());
        const ids = await Promise.all([...new Set(parsed.entries)].map(entry => channelResolver(entry)));
        if (ids.some(id => !/^UC[\w-]{22}$/.test(id))) throw new Error('YouTube returned an invalid channel identity.');
        return send(200, {trustedChannelIds: [...new Set(ids)].sort()});
      }
      let input; try {input = validateInput(parsed);} catch (e) {return send(400, {error: e.message});}
      const key = createHash('sha256').update(JSON.stringify({...input, model, policyVersion: 2})).digest('hex');
      const hit = cache.get(key);
      if (hit && Date.now() - hit.at < 6 * 3600000) return send(200, {...hit.value, cached: true});
      if (!pending.has(key)) {
        lookups = lookups.filter(t => Date.now() - t < 3600000);
        if (lookups.length >= 120 || pending.size >= 2) return send(429, {error: 'Local lookup limit reached. Try later. Videos stay blocked.'});
        lookups.push(Date.now());
        const job = (async () => {
          const source = await sourceLoader(input.videoId, undefined, input.trustedChannelIds);
          let value;
          if (source.channelId && input.trustedChannelIds.includes(source.channelId)) {
            value = {allowed: true, verdict: 'allow', confidence: 1, trustedChannel: true, reason: 'You trusted this channel.', goal: '', title: source.title, channel: source.channel, evidence: 'verified YouTube channel ID'};
          } else {
            if (!apiKey) throw new Error('No OpenAI API key configured. Restart the local service with your key.');
            calls = calls.filter(t => Date.now() - t < 3600000);
            if (calls.length >= 30) throw new Error('Local AI check limit reached. Try later. Videos stay blocked.');
            calls.push(Date.now());
            value = await evaluator(input, source, {apiKey, model});
          }
          if (cache.size >= 300) cache.delete(cache.keys().next().value);
          cache.set(key, {at: Date.now(), value});
          return value;
        })();
        pending.set(key, job);
      }
      const job = pending.get(key);
      try {return send(200, {...await job, cached: false});} finally {if (pending.get(key) === job) pending.delete(key);}
    } catch (error) {send(502, {error: error.name === 'TimeoutError' ? 'The check timed out. Video remains blocked.' : error.message || 'Check failed. Video remains blocked.'});}
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  return server;
}
