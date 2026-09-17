import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

const script = await readFile(new URL('../extension/content.js', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

// Small DOM/runtime fixture: tests the shipped content script's state transitions.
// This is not a substitute for browser integration testing.
function fixture(initial = 'https://www.youtube.com/watch?v=aaaaaaaaaaa') {
  class Element {
    constructor(tag) {this.tagName = tag; this.children = []; this.attrs = {}; this.style = {}; this.textContent = '';}
    append(child) {child.parent = this; this.children.push(child);}
    remove() {if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this);}
    setAttribute(k, v) {this.attrs[k] = v;}
    removeAttribute(k) {delete this.attrs[k];}
    attachShadow() {const root = new Element('shadow'); this.append(root); return root;}
    all() {return [this, ...this.children.flatMap(c => c.all())];}
  }
  class Media extends Element {
    constructor() {super('video'); this.paused = false;}
    pause() {this.paused = true;}
    play() {this.paused = false; return Promise.resolve();}
  }
  const root = new Element('html'), video = new Media(); root.append(video);
  const listeners = new Map(); const pending = []; let interval, onMessage;
  let now = 0, nextTimer = 0; const timers = new Map();
  const setTimeout = (callback, ms) => {const id = ++nextTimer; timers.set(id, {callback, at: now + ms}); return id;};
  const clearTimeout = id => timers.delete(id);
  const location = {href: initial, get pathname() {return new URL(this.href).pathname;}};
  const document = {
    documentElement: root,
    createElement: tag => new Element(tag),
    createElementNS: (_namespace, tag) => new Element(tag),
    querySelectorAll: selector => selector === 'video' ? [video] : [],
    querySelector: selector => selector === 'video' ? video : null,
    addEventListener(type, callback) {if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(callback);}
  };
  const emit = (event, target = document) => (listeners.get(event) || []).forEach(fn => fn({target}));
  const chrome = {runtime: {sendMessage: msg => new Promise(resolve => pending.push({msg, resolve})), onMessage: {addListener(fn) {onMessage = fn;}}}};
  runInNewContext(script, {document, location, chrome, URL, HTMLMediaElement: Media, window: {addEventListener() {}}, setTimeout, clearTimeout, setInterval: callback => {interval = callback;}});
  return {root, video, pending, emit,
    advance(ms) {now += ms; for (const [id, timer] of timers) if (timer.at <= now) {timers.delete(id); timer.callback();}},
    settingsChanged: () => onMessage({type: 'focus-settings-changed'}),
    tick: () => interval(),
    go(id) {emit('yt-navigate-start'); location.href = `https://www.youtube.com/watch?v=${id}`; emit('yt-navigate-finish');},
    find: text => root.all().find(el => el.textContent === text),
    get allowed() {return root.attrs['data-focus-gate-allowed'];}
  };
}
const allowed = {allowed:true, verdict:'allow', reason:'Related to computer science.', title:'CS discussion', channel:'Example', evidence:'title and channel only'};
const blocked = {...allowed, allowed:false, verdict:'block', reason:'Unrelated gameplay.'};

test('shows loading and approves playback only after 300 ms, without buttons', async () => {
  const f = fixture(); assert.equal(f.video.paused,true); assert.equal(f.allowed,undefined);
  assert.ok(f.root.all().some(el => el.className === 'loading'));
  f.pending[0].resolve(allowed); await flush();
  assert.equal(f.video.paused,true); assert.ok(f.root.all().some(el => el.className === 'icon allowed'));
  assert.ok(!f.root.all().some(el => ['button','a'].includes(el.tagName)));
  f.advance(299); assert.equal(f.allowed,undefined);
  f.advance(1);
  assert.equal(f.allowed,'aaaaaaaaaaa'); assert.equal(f.video.paused,false);
  assert.equal(f.find('Good to watch'),undefined);
});
test('SPA navigation revokes approval and stops playback', async () => {
  const f = fixture(); f.pending[0].resolve(allowed); await flush(); f.advance(300);
  f.go('bbbbbbbbbbb'); assert.equal(f.allowed,undefined); assert.equal(f.video.paused,true);
  f.pending[1].resolve(blocked); await flush();
  assert.ok(f.find('Save your attention')); assert.equal(f.find('Watch this video'),undefined);
});
test('stale approval cannot overwrite the current blocked video', async () => {
  const f = fixture(); f.go('bbbbbbbbbbb');
  f.pending[1].resolve(blocked); await flush();
  f.pending[0].resolve(allowed); await flush();
  assert.ok(f.find('Save your attention')); assert.equal(f.allowed,undefined); assert.equal(f.find('Watch this video'),undefined);
});
test('service errors stay blocked; Shorts block immediately without any API request', async () => {
  const f = fixture(); f.pending[0].resolve({error:'Service offline'}); await flush();
  assert.ok(f.find('Couldn’t check this video')); f.video.paused = false; f.emit('play',f.video); assert.equal(f.video.paused,true);
  const shorts = fixture('https://www.youtube.com/shorts/aaaaaaaaaaa');
  assert.ok(shorts.find('Shorts are blocked')); assert.equal(shorts.pending.length,0); assert.equal(shorts.video.paused,true);
  shorts.tick(); shorts.advance(5000); assert.equal(shorts.pending.length,0);
});
test('navigation during green check cancels its delayed playback', async () => {
  const f = fixture(); f.pending[0].resolve(allowed); await flush(); f.advance(200);
  f.go('bbbbbbbbbbb'); f.pending[1].resolve(blocked); await flush(); f.advance(300);
  assert.equal(f.allowed,undefined); assert.equal(f.video.paused,true); assert.ok(f.root.all().some(el => el.className === 'icon blocked'));
});
test('home page to video starts a check without a reload', () => {
  const f = fixture('https://www.youtube.com/'); assert.equal(f.pending.length,0);
  f.go('aaaaaaaaaaa'); assert.equal(f.pending.length,1); assert.equal(f.pending[0].msg.videoId,'aaaaaaaaaaa');
});
test('saving popup settings cancels pending approval and rechecks the video', async () => {
  const f = fixture(); f.pending[0].resolve(allowed); await flush();
  f.settingsChanged(); f.advance(300);
  assert.equal(f.allowed,undefined); assert.equal(f.pending.length,2);
  f.pending[1].resolve(blocked); await flush(); assert.ok(f.find('Save your attention'));
});
