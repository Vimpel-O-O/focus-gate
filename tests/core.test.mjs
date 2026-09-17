import test from 'node:test';
import assert from 'node:assert/strict';
import {extractPlayer, validateInput, validateDecision, getVideoSource, evaluateVideo} from '../server/core.mjs';
import {createGateServer} from '../server/server.mjs';

const id = 'abcdefghijk';
const input = {videoId: id, goals: 'Learn C++', task: 'Understand binary search'};
const source = {videoId: id, title: 'Binary search in C++', evidence: 'title and channel only'};
const result = {verdict: 'allow', confidence: 0.95, reason: 'A specific tutorial for your task.', goal: 'Learn C++'};
test('extracts balanced player JSON without executing page code', () => {
  const player = {videoDetails: {videoId: id, title: 'Braces } and "quotes"', shortDescription: '{ nested text }'}};
  assert.deepEqual(extractPlayer(`x;var ytInitialPlayerResponse = ${JSON.stringify(player)};evil();`), player);
  assert.equal(extractPlayer('ytInitialPlayerResponse = evil()'), null);
});
test('rejects URLs as video IDs and oversized user context', () => {
  assert.throws(() => validateInput({...input, videoId: 'http://localhost'}));
  assert.throws(() => validateInput({...input, goals: 'x'.repeat(4001)}));
  assert.deepEqual(validateInput(input), {...input, trustedChannelIds: []});
});
test('uncertain, low confidence, malformed and explicit block never allow', () => {
  assert.equal(validateDecision(result).allowed, true);
  assert.equal(validateDecision({...result, confidence: 0.79}).allowed, false);
  assert.equal(validateDecision({...result, verdict: 'uncertain'}).allowed, false);
  assert.equal(validateDecision({...result, verdict: 'block'}).allowed, false);
  assert.throws(() => validateDecision({...result, confidence: '0.9'}));
});
test('retrieves caption text and labels evidence honestly', async () => {
  const player = {videoDetails: {videoId: id, title: 'SPI tutorial', author: 'Teacher', shortDescription: 'Learn SPI'}, captions: {playerCaptionsTracklistRenderer: {captionTracks: [{languageCode: 'en', baseUrl: 'https://www.youtube.com/api/timedtext?v=' + id}]}}};
  const fetcher = async url => String(url).includes('/watch?') ? new Response(`var ytInitialPlayerResponse=${JSON.stringify(player)};`) : new Response(JSON.stringify({events: [{segs: [{utf8: 'SPI transfers bits'}]}]}));
  const actual = await getVideoSource(id, fetcher);
  assert.equal(actual.transcript, 'SPI transfers bits');
  assert.equal(actual.evidence, 'metadata and available captions');
});
test('never fetches a hostile caption host', async () => {
  let calls = 0;
  const player = {videoDetails: {videoId: id, title: 'C++'}, captions: {playerCaptionsTracklistRenderer: {captionTracks: [{baseUrl: 'https://evil.example/api/timedtext'}]}}};
  const actual = await getVideoSource(id, async () => {calls++; return new Response(`ytInitialPlayerResponse=${JSON.stringify(player)};`);});
  assert.equal(calls, 1); assert.equal(actual.transcript, '');
});
test('unavailable watch page falls back to oEmbed metadata', async () => {
  const actual = await getVideoSource(id, async url => String(url).includes('/oembed?') ? Response.json({title: 'C++ tutorial', author_name: 'Teacher'}) : new Response('Consent required', {status: 403}));
  assert.equal(actual.evidence, 'title and channel only');
  assert.equal(actual.title, 'C++ tutorial');
});
test('Responses request uses structured output and does not store conversations', async () => {
  const decision = await evaluateVideo(input, source, {apiKey: 'test-only', fetcher: async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    const body = JSON.parse(options.body);
    assert.equal(body.store, false); assert.equal(body.text.format.strict, true);
    assert.equal(JSON.parse(body.input).source.title, source.title);
    return Response.json({status: 'completed', output: [{content: [{type: 'output_text', text: JSON.stringify(result)}]}]});
  }});
  assert.equal(decision.allowed, true);
});
test('API refusal, missing key and billing errors fail closed', async () => {
  await assert.rejects(evaluateVideo(input, source, {apiKey: ''}), /key is missing/);
  await assert.rejects(evaluateVideo(input, source, {apiKey: 'test', fetcher: async () => new Response('', {status: 429})}), /billing limit/);
  await assert.rejects(evaluateVideo(input, source, {apiKey: 'test', fetcher: async () => Response.json({status: 'completed', output: [{content: [{type: 'refusal', refusal: 'No'}]}]})}), /no valid decision/);
});
test('distinguishes exhausted quota from temporary rate limits without exposing raw errors', async () => {
  for (const [code, expected] of [['insufficient_quota', /quota is unavailable or exhausted/], ['rate_limit_exceeded', /temporarily rate-limited/]]) {
    await assert.rejects(evaluateVideo(input, source, {apiKey: 'test', fetcher: async () => Response.json({error: {code, message: 'private upstream detail'}}, {status: 429})}), error => expected.test(error.message) && !error.message.includes('private upstream detail'));
  }
});
test('HTTP authentication, origin checks, caching and goal changes', async t => {
  let calls = 0;
  const token = 'a'.repeat(64);
  const server = createGateServer({apiKey: 'test', token, sourceLoader: async () => source, evaluator: async () => {calls++; return {...validateDecision(result), ...source};}});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(url + '/health')).status, 401);
  const headers = {'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json'};
  assert.equal((await fetch(url + '/health', {headers: {...headers, Origin: 'https://youtube.com'}})).status, 403);
  assert.equal((await fetch(url + '/health', {headers})).status, 200);
  const call = data => fetch(url + '/evaluate', {method: 'POST', headers, body: JSON.stringify(data)});
  const first = await (await call(input)).json(); assert.equal(first.allowed, true);
  const second = await (await call(input)).json(); assert.equal(second.cached, true); assert.equal(calls, 1);
  await call({...input, task: 'Learn pointers'}); assert.equal(calls, 2);
  assert.equal((await call({...input, videoId: '../../etc/passwd'})).status, 400);
});
test('concurrent identical requests share one API call', async t => {
  let calls = 0; const token = 'b'.repeat(64);
  const server = createGateServer({apiKey: 'test', token, sourceLoader: async () => source, evaluator: async () => {calls++; await new Promise(r => setTimeout(r, 30)); return validateDecision(result);}});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const call = () => fetch(`http://127.0.0.1:${server.address().port}/evaluate`, {method: 'POST', headers: {'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json'}, body: JSON.stringify(input)});
  const responses = await Promise.all([call(), call()]); assert.ok(responses.every(r => r.status === 200)); assert.equal(calls, 1);
});
