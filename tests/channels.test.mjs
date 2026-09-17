import test from 'node:test';
import assert from 'node:assert/strict';
import {parseChannelEntry, resolveChannel} from '../server/channels.mjs';
import {createGateServer} from '../server/server.mjs';
import {getVideoSource} from '../server/core.mjs';
const channel = 'UC' + 'a'.repeat(22);
const other = 'UC' + 'b'.repeat(22);
test('channel entries accept handles and IDs, not display names, video URLs or arbitrary hosts', () => {
  assert.deepEqual(parseChannelEntry(channel), {id:channel});
  assert.deepEqual(parseChannelEntry(`https://www.youtube.com/channel/${channel}/videos`), {id:channel});
  assert.deepEqual(parseChannelEntry('https://youtube.com/@engineer/videos'), {handle:'@engineer'});
  for (const entry of ['An Engineer','https://evil.example/@engineer','https://youtube.com.evil.example/@engineer','https://youtube.com/watch?v=abcdefghijk','https://youtube.com:8000/@engineer']) assert.throws(()=>parseChannelEntry(entry));
});
test('handle resolution only trusts channel-owner metadata', async () => {
  let fetched;
  const id = await resolveChannel('@engineer',async url=>{fetched=url;return new Response(`{"recommendation":{"channelId":"${other}"},"channelMetadataRenderer":{"title":"Engineer","externalId":"${channel}"}}`);});
  assert.equal(id,channel);assert.equal(fetched,'https://www.youtube.com/@engineer');
  await assert.rejects(resolveChannel('@engineer',async()=>new Response(`{"recommendation":{"channelId":"${channel}"}}`)),/Could not verify/);
});
test('trusted owner skips caption retrieval after matching exact video identity', async () => {
  let calls=0;
  const player={videoDetails:{videoId:'abcdefghijk',title:'Vague title',author:'Engineer',channelId:channel},captions:{playerCaptionsTracklistRenderer:{captionTracks:[{baseUrl:'https://www.youtube.com/api/timedtext?v=abcdefghijk'}]}}};
  const source=await getVideoSource('abcdefghijk',async()=>{calls++;return new Response('var ytInitialPlayerResponse='+JSON.stringify(player));},[channel]);
  assert.equal(calls,1);assert.equal(source.channelId,channel);
});
test('trusted channels bypass AI; removing trust invalidates cached approval',async t=>{
  let aiCalls=0;const token='c'.repeat(64);
  const server=createGateServer({apiKey:'test',token,channelResolver:async()=>channel,sourceLoader:async()=>({channelId:channel,channel:'Engineer',title:'Vague title'}),evaluator:async()=>{aiCalls++;return {allowed:false,verdict:'uncertain'};}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const post=(path,body)=>fetch(`http://127.0.0.1:${server.address().port}${path}`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const resolved=await(await post('/resolve-channels',{entries:['@engineer']})).json();assert.deepEqual(resolved.trustedChannelIds,[channel]);
  const input={videoId:'abcdefghijk',goals:'Computer science',task:'',trustedChannelIds:[channel]};
  let result=await(await post('/evaluate',input)).json();assert.equal(result.allowed,true);assert.equal(result.trustedChannel,true);assert.equal(aiCalls,0);
  result=await(await post('/evaluate',{...input,trustedChannelIds:[]})).json();assert.equal(result.allowed,false);assert.equal(aiCalls,1);
  result=await(await post('/evaluate',{...input,trustedChannelIds:[other]})).json();assert.equal(result.allowed,false);assert.equal(aiCalls,2);
});
test('display-name match without verified channel ID cannot bypass AI',async t=>{
  let aiCalls=0;const token='d'.repeat(64);
  const server=createGateServer({apiKey:'test',token,sourceLoader:async()=>({channelId:'',channel:'Engineer',title:'Vague title'}),evaluator:async()=>{aiCalls++;return {allowed:false};}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const response=await fetch(`http://127.0.0.1:${server.address().port}/evaluate`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({videoId:'abcdefghijk',goals:'CS',task:'',trustedChannelIds:[channel]})});
  assert.equal((await response.json()).allowed,false);assert.equal(aiCalls,1);
});
