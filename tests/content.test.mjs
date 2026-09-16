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
  const listeners = new Map(); const pending = []; let interval;
  const location = {href: initial, get pathname() {return new URL(this.href).pathname;}};
  const document = {
    documentElement: root,
    createElement: tag => new Element(tag),
    querySelectorAll: selector => selector === 'video' ? [video] : [],
    querySelector: selector => selector === 'video' ? video : null,
    addEventListener(type, callback) {if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(callback);}
  };
  const emit = (event, target = document) => (listeners.get(event) || []).forEach(fn => fn({target}));
  const chrome = {runtime: {sendMessage: msg => new Promise(resolve => pending.push({msg, resolve}))}};
  runInNewContext(script, {document, location, chrome, URL, HTMLMediaElement: Media, window: {addEventListener() {}}, setInterval: callback => {interval = callback;}});
  return {root, video, pending, emit,
    tick: () => interval(),
    go(id) {emit('yt-navigate-start'); location.href = `https://www.youtube.com/watch?v=${id}`; emit('yt-navigate-finish');},
    find: text => root.all().find(el => el.textContent === text),
    get allowed() {return root.attrs['data-focus-gate-allowed'];}
  };
}
const allowed = {allowed:true, verdict:'allow', reason:'Related to computer science.', title:'CS discussion', channel:'Example', evidence:'title and channel only'};
const blocked = {...allowed, allowed:false, verdict:'block', reason:'Unrelated gameplay.'};

test('pauses before evaluation and requires an explicit click after approval', async () => {
  const f = fixture(); assert.equal(f.video.paused,true); assert.equal(f.allowed,undefined);
  f.pending[0].resolve(allowed); await flush();
  assert.equal(f.video.paused,true);
  f.find('Watch this video').onclick();
  assert.equal(f.allowed,'aaaaaaaaaaa'); assert.equal(f.video.paused,false);
});
test('SPA navigation revokes approval and stops playback', async () => {
  const f = fixture(); f.pending[0].resolve(allowed); await flush(); f.find('Watch this video').onclick();
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
test('service errors and repeated play events stay blocked; Shorts are reviewed', async () => {
  const f = fixture(); f.pending[0].resolve({error:'Service offline'}); await flush();
  assert.ok(f.find('Still paused')); f.video.paused = false; f.emit('play',f.video); assert.equal(f.video.paused,true);
  const shorts = fixture('https://www.youtube.com/shorts/aaaaaaaaaaa');
  assert.ok(shorts.find('Checking this video')); assert.equal(shorts.pending.length,1); assert.equal(shorts.video.paused,true);
  shorts.pending[0].resolve(blocked); await flush(); assert.ok(shorts.find('Save your attention'));
});
