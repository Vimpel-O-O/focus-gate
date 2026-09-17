import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, stat, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {evaluateVideo} from '../server/core.mjs';
import {createGateServer} from '../server/server.mjs';
import {readProviderConfig, writeProviderConfig, validateProviderConfig, keychainHelper} from '../server/provider-config.mjs';
const input = {videoId: 'abcdefghijk', goals: 'Gardening', task: ''};
const source = {title: 'Grow tomatoes', evidence: 'metadata'};
const result = {verdict: 'allow', confidence: 0.95, reason: 'About gardening', goal: 'Gardening'};
const envelopes = {
  openai: value => ({status: 'completed', output: [{content: [{type: 'output_text', text: JSON.stringify(value)}]}]}),
  anthropic: value => ({stop_reason: 'end_turn', content: [{type: 'text', text: JSON.stringify(value)}]}),
  gemini: value => ({candidates: [{finishReason: 'STOP', content: {parts: [{text: JSON.stringify(value)}]}}]}),
  xai: value => ({choices: [{finish_reason: 'stop', message: {content: JSON.stringify(value)}}]})
};
const hosts = {openai: 'api.openai.com', anthropic: 'api.anthropic.com', gemini: 'generativelanguage.googleapis.com', xai: 'api.x.ai'};
for (const provider of Object.keys(envelopes)) {
  test(`${provider}: correct endpoint, credentials, schema and validated decision`, async () => {
    const value = await evaluateVideo(input, source, {provider, model: 'test-model', apiKey: 'private-test-key', fetcher: async (url, options) => {
      const target = new URL(url), body = JSON.parse(options.body);
      assert.equal(target.hostname, hosts[provider]); assert.equal(options.redirect, 'error');
      assert.equal(url.includes('private-test-key'), false); assert.equal(options.body.includes('private-test-key'), false);
      if (provider === 'anthropic') {assert.equal(options.headers['x-api-key'], 'private-test-key'); assert.equal(options.headers['anthropic-version'], '2023-06-01'); assert.equal(body.output_config.format.schema.properties.confidence.minimum, undefined); assert.equal(body.system.includes('untrusted evidence'), true);}
      else if (provider === 'gemini') {assert.equal(options.headers['x-goog-api-key'], 'private-test-key'); assert.ok(body.generationConfig.responseJsonSchema.required.includes('confidence')); assert.equal(body.generationConfig.responseMimeType, 'application/json'); assert.equal(body.systemInstruction.parts[0].text.includes('untrusted evidence'), true);}
      else {assert.equal(options.headers.Authorization, 'Bearer private-test-key'); if (provider === 'xai') assert.equal(body.response_format.json_schema.strict, true); else assert.equal(body.store, false);}
      return Response.json(envelopes[provider](result));
    }});
    assert.equal(value.allowed, true); assert.equal(value.title, source.title);
  });
  test(`${provider}: invalid confidence, uncertainty and malformed JSON never allow`, async () => {
    const call = value => evaluateVideo(input, source, {provider, model: 'test-model', apiKey: 'test', fetcher: async () => Response.json(envelopes[provider](value))});
    for (const confidence of [-1, 2, '0.95']) await assert.rejects(call({...result, confidence}), /invalid decision/);
    assert.equal((await call({...result, verdict: 'uncertain'})).allowed, false);
    assert.equal((await call({...result, confidence: 0.5})).allowed, false);
    await assert.rejects(evaluateVideo(input, source, {provider, model: 'test-model', apiKey: 'test', fetcher: async () => new Response('{bad')}), /no valid decision/);
  });
  test(`${provider}: auth and quota errors never expose upstream details`, async () => {
    for (const status of [400,401,403,404,429,500]) await assert.rejects(evaluateVideo(input, source, {provider, model: 'test-model', apiKey: 'secret', fetcher: async () => Response.json({error:{message:'secret upstream text'}},{status})}), e => e.message.includes('Video remains blocked') && !e.message.includes('secret'));
  });
}
test('all providers reject truncated/refused responses even with plausible allow JSON', async () => {
  const bad = {
    openai: [{...envelopes.openai(result), status:'incomplete'}, {status:'completed',output:[{content:[{type:'refusal'},{type:'output_text',text:JSON.stringify(result)}]}]}],
    anthropic: [{...envelopes.anthropic(result), stop_reason:'max_tokens'}, {...envelopes.anthropic(result),stop_reason:'refusal'}],
    gemini: [{candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:JSON.stringify(result)}]}}]}, {...envelopes.gemini(result),promptFeedback:{blockReason:'SAFETY'}}],
    xai: [{choices:[{finish_reason:'length',message:{content:JSON.stringify(result)}}]}, {choices:[{finish_reason:'stop',message:{refusal:'refused',content:JSON.stringify(result)}}]}]
  };
  for (const [provider, bodies] of Object.entries(bad)) for (const body of bodies) await assert.rejects(evaluateVideo(input,source,{provider,model:'test-model',apiKey:'test',fetcher:async()=>Response.json(body)}), /no valid decision/);
});
test('provider configuration migrates old setup, stores no keys and validates model names', async t => {
  const dir = await mkdtemp(join(tmpdir(),'focus-provider-')); t.after(()=>rm(dir,{recursive:true,force:true}));
  assert.deepEqual(await readProviderConfig(dir), {provider:'openai',model:'gpt-4.1-mini'});
  await writeProviderConfig(dir,{provider:'anthropic',model:'test-model',apiKey:'do-not-store'});
  assert.deepEqual(await readProviderConfig(dir),{provider:'anthropic',model:'test-model'});
  assert.equal((await stat(join(dir,'provider.json'))).mode & 0o777, 0o600);
  assert.equal((await readFile(join(dir,'provider.json'),'utf8')).includes('do-not-store'),false);
  assert.equal(keychainHelper(dir,'openai'),join(dir,'bin/keychain'));
  assert.equal(keychainHelper(dir,'gemini'),join(dir,'bin/keychain-provider'));
  for (const provider of ['__proto__','invalid','https://evil.example']) assert.throws(()=>validateProviderConfig({provider,model:'test'}));
  for (const model of ['','../evil','x?key=foo','x/y','a\nb']) assert.throws(()=>validateProviderConfig({provider:'gemini',model}));
  assert.throws(()=>validateProviderConfig({provider:'anthropic'}));
  await writeFile(join(dir,'provider.json'),'{bad'); await assert.rejects(readProviderConfig(dir),/Invalid provider.json/);
});
test('provider and model changes cannot reuse another cached decision', async t => {
  const cache = new Map(), token = 'a'.repeat(64); let calls = 0;
  for (const [provider, model] of [['openai','same-model'],['anthropic','same-model'],['anthropic','other-model'],['openai','same-model']]) {
    const server = createGateServer({apiKey:'test',token,cache,provider,model,sourceLoader:async()=>source,evaluator:async(_input,_source,options)=>{assert.equal(options.provider,provider); calls++; return {allowed:true};}});
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    try {
      const base=`http://127.0.0.1:${server.address().port}`, headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
      const health=await(await fetch(base+'/health',{headers})).json(); assert.equal(health.provider,provider); assert.equal(health.model,model);
      const response=await fetch(base+'/evaluate',{method:'POST',headers,body:JSON.stringify(input)}); assert.equal(response.status,200);
    } finally {await new Promise(r=>server.close(r));}
  }
  assert.equal(calls,3);
});
