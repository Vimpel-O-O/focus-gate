import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {DEFAULTS} from '../extension/defaults.js';
const script = (await readFile(new URL('../extension/background.js', import.meta.url), 'utf8')).replace("import {DEFAULTS} from './defaults.js';", '');
function fixture() {
  let listener; const requests = [], broadcasts = [];
  const id = 'a'.repeat(32);
  const chrome = {
    storage: {local: {setAccessLevel() {}, async get() {return {...DEFAULTS, token:'test-token'};}}},
    tabs: {async query() {return [{id:1},{id:2}];}, async sendMessage(id, message) {broadcasts.push({id,message});}},
    runtime: {id, onMessage: {addListener(fn) {listener = fn;}}}
  };
  runInNewContext(script, {chrome,DEFAULTS,URL,AbortSignal,fetch:async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>({allowed:true})};}});
  return {requests,broadcasts, send: (message,url,senderId=id) => new Promise(resolve=>listener(message,{id:senderId,url},resolve))};
}
test('accepts video ID from trusted YouTube document with stale home-page URL', async () => {
  const f=fixture(); const result=await f.send({type:'evaluate',videoId:'abcdefghijk'},'https://www.youtube.com/');
  assert.equal(result.allowed,true); assert.equal(JSON.parse(f.requests[0].options.body).videoId,'abcdefghijk');
});
test('accepts new video when sender still identifies the previous video', async () => {
  const f=fixture(); const result=await f.send({type:'evaluate',videoId:'bbbbbbbbbbb'},'https://www.youtube.com/watch?v=aaaaaaaaaaa');
  assert.equal(result.allowed,true);
});
test('rejects untrusted origins, invalid IDs and foreign extension senders', async () => {
  const f=fixture();
  for(const [url,id,sender] of [['https://evil.example/','abcdefghijk'],['https://youtube.com.evil.example/','abcdefghijk'],['https://www.youtube.com/','../../secret'],['https://www.youtube.com/','abcdefghijk','other-extension']]) {
    assert.ok((await f.send({type:'evaluate',videoId:id},url,sender)).error);
  }
  assert.equal(f.requests.length,0);
});
test('only extension popup can broadcast settings changes', async () => {
  const f=fixture();
  assert.ok((await f.send({type:'settings-updated'},'https://www.youtube.com/')).error);
  assert.equal(f.broadcasts.length,0);
  assert.equal((await f.send({type:'settings-updated'},`chrome-extension://${'a'.repeat(32)}/popup.html`)).ok,true);
  assert.equal(f.broadcasts.length,2);
});
