(() => {
  let current = null, approved = null, generation = 0, panel = null;
  let approvalTimer = null, navigating = false, navigationTimer = null;
  function videoId() {
    const u = new URL(location.href);
    const id = u.pathname === '/watch' ? u.searchParams.get('v') : u.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]{11})(?:\/|$)/)?.[1];
    return /^[\w-]{11}$/.test(id || '') ? id : null;
  }
  function isAllowed() {return !navigating && approved !== null && approved === videoId();}
  function pause() {if (!isAllowed()) document.querySelectorAll('video').forEach(v => v.pause());}
  function reset() {
    generation++; approved = null;
    clearTimeout(approvalTimer); approvalTimer = null;
    document.documentElement?.removeAttribute('data-focus-gate-allowed');
    panel?.remove(); panel = null; pause();
  }
  document.addEventListener('play', event => {
    if (!isAllowed() && event.target instanceof HTMLMediaElement) event.target.pause();
  }, true);
  function element(tag, text, parent) {
    const el = document.createElement(tag); if (text) el.textContent = text; if (parent) parent.append(el); return el;
  }
  function show(state, title, description = '') {
    if (!document.documentElement) return;
    panel?.remove(); panel = element('div'); panel.id = 'focus-gate-panel';
    panel.style.cssText = 'position:fixed!important;inset:0!important;z-index:2147483647!important;display:grid!important;place-items:center!important;background:#101715ee!important;';
    const root = panel.attachShadow({mode: 'open'});
    element('style', `:host{all:initial}*{box-sizing:border-box}.card{width:min(410px,88vw);padding:42px 32px;background:#f8f9f4;border-radius:24px;text-align:center;font:16px/1.6 system-ui,sans-serif;color:#20382e;box-shadow:0 24px 100px #0004}.icon{display:grid;place-items:center;width:68px;height:68px;margin:0 auto 22px;border-radius:50%}.icon svg{display:block;width:32px;height:32px;overflow:visible}.loading{width:48px;height:48px;margin:10px auto 32px;border:4px solid #dce6db;border-top-color:#315d46;border-radius:50%;animation:spin .85s linear infinite}.allowed{color:#227343;background:#e0f2e4}.blocked{color:#b83f43;background:#fbe5e4}.error{color:#946418;background:#f7edd7}h1{font-size:25px;line-height:1.25;letter-spacing:-.6px;margin:0}p{font-size:14px;color:#667367;margin:12px 0 0;overflow-wrap:anywhere}@keyframes spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.loading{animation-duration:2s}}`, root);
    const card = element('section', '', root); card.className = 'card';
    card.setAttribute('role', 'status'); card.setAttribute('aria-live', 'polite');
    card.setAttribute('aria-busy', state === 'loading' ? 'true' : 'false');
    const icon = element('div', '', card);
    icon.className = state === 'loading' ? 'loading' : `icon ${state}`; icon.setAttribute('aria-hidden', 'true');
    if (state !== 'loading') {
      // Fixed vector geometry avoids font-dependent glyph baselines and bearings.
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 32 32'); svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '3');
      svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
      svg.setAttribute('focusable', 'false');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', state === 'allowed' ? 'M7 16 L13 22 L25 10' : state === 'blocked' ? 'M9 9 L23 23 M23 9 L9 23' : 'M16 8 V18 M16 24 h0');
      svg.append(path); icon.append(svg);
    }
    element('h1', title, card); if (description) element('p', description, card);
    document.documentElement.append(panel);
  }
  function startPlayback() {
    if (!isAllowed()) return;
    const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
    // A browser autoplay restriction may still require the native Play control.
    if (video) video.play().catch(() => {});
  }
  document.addEventListener('loadedmetadata', startPlayback, true);
  async function check() {
    reset(); const id = videoId(); current = id; const ticket = generation;
    if (!id) return;
    if (location.pathname.startsWith('/shorts/')) {
      show('blocked', 'Shorts are blocked', 'Save your attention.');
      return;
    }
    show('loading', 'Checking video…');
    try {
      const result = await chrome.runtime.sendMessage({type: 'evaluate', videoId: id});
      if (ticket !== generation || videoId() !== id || navigating) return;
      if (result?.error) return show('error', 'Couldn’t check this video', result.error);
      if (typeof result?.allowed !== 'boolean') return show('error', 'Couldn’t check this video', 'Reload this page to try again.');
      if (!result.allowed) {
        return result.verdict === 'uncertain'
          ? show('blocked', 'Save your attention', 'This video’s relevance could not be confirmed.')
          : show('blocked', 'Save your attention', 'This video isn’t relevant to your interests.');
      }
      show('allowed', 'Good to watch');
      approvalTimer = setTimeout(() => {
        if (ticket !== generation || videoId() !== id || navigating) return;
        approved = id; document.documentElement.setAttribute('data-focus-gate-allowed', id);
        panel?.remove(); panel = null; startPlayback();
      }, 300);
    } catch {
      if (ticket === generation) show('error', 'Couldn’t check this video', 'Reload this page to reconnect.');
    }
  }
  function sync() {
    if (!document.documentElement || navigating) return pause();
    const id = videoId();
    if (id !== current) {if (id) check(); else {current = null; reset();}}
    pause();
  }
  document.addEventListener('yt-navigate-start', () => {
    navigating = true; current = null; reset(); clearTimeout(navigationTimer);
    // Some surfaces omit the finish event; never remain stuck indefinitely.
    navigationTimer = setTimeout(() => {navigating = false; sync();}, 1500);
  });
  document.addEventListener('yt-navigate-finish', () => {clearTimeout(navigationTimer); navigating = false; sync();});
  chrome.runtime.onMessage.addListener(message => {
    if (message.type === 'focus-settings-changed') {current = null; reset(); sync();}
  });
  window.addEventListener('popstate', sync);
  setInterval(sync, 250);
  document.addEventListener('DOMContentLoaded', sync, {once: true});
  sync();
})();
