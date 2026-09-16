(() => {
  let current = null, approved = null, generation = 0, panel = null;
  function videoId() {
    const u = new URL(location.href);
    const candidate = u.pathname === '/watch' ? u.searchParams.get('v') : u.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]{11})(?:\/|$)/)?.[1];
    return /^[\w-]{11}$/.test(candidate || '') ? candidate : null;
  }
  function isAllowed() {return approved !== null && approved === videoId();}
  function lock() {approved = null; document.documentElement?.removeAttribute('data-focus-gate-allowed'); pause();}
  function pause() {
    if (isAllowed()) return;
    document.querySelectorAll('video').forEach(v => {v.pause();});
  }
  // Capturing play events catches dynamically inserted players and autoplay.
  document.addEventListener('play', event => {if (!isAllowed() && event.target instanceof HTMLMediaElement) event.target.pause();}, true);
  function element(tag, text, parent) {const el = document.createElement(tag); if (text) el.textContent = text; if (parent) parent.append(el); return el;}
  function show(title, description, details = '', allow = false) {
    if (!document.documentElement) return;
    panel?.remove();
    panel = element('div'); panel.id = 'focus-gate-panel';
    panel.style.cssText = 'position:fixed!important;inset:0!important;z-index:2147483647!important;display:grid!important;place-items:center!important;background:#101715f5!important;';
    const root = panel.attachShadow({mode: 'open'});
    const style = element('style', '', root);
    style.textContent = ':host{all:initial}*{box-sizing:border-box}.card{width:min(580px,90vw);padding:40px;background:#f5f4eb;border-radius:24px;font:16px/1.6 system-ui,sans-serif;color:#18372d;box-shadow:0 24px 100px #0005}small{font-size:11px;letter-spacing:3px;font-weight:750}h1{font-size:32px;line-height:1.15;letter-spacing:-1px;margin:16px 0}p{color:#465950;margin:14px 0}.details{font-size:12px;color:#66746c;overflow-wrap:anywhere}nav{display:flex;gap:10px;flex-wrap:wrap;margin-top:26px}button,a{font:600 14px system-ui;padding:12px 18px;border:1px solid #c6d0c6;border-radius:10px;background:transparent;color:#18372d;cursor:pointer;text-decoration:none}button.primary{background:#234f3f;color:#fff;border-color:#234f3f}button:focus-visible,a:focus-visible{outline:3px solid #b99034;outline-offset:3px}';
    const card = element('section', '', root); card.className = 'card'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', 'Focus Gate video check');
    element('small', 'FOCUS GATE / WATCH WITH INTENT', card);
    element('h1', title, card); element('p', description, card);
    element('p', details, card).className = 'details';
    const nav = element('nav', '', card);
    if (allow) {
      const watch = element('button', 'Watch this video', nav); watch.className = 'primary';
      const id = current, ticket = generation;
      watch.onclick = () => {
        if (videoId() !== id || generation !== ticket) return sync();
        approved = id; document.documentElement.setAttribute('data-focus-gate-allowed', id); panel?.remove(); panel = null;
        // User click starts playback; navigating to another video revokes access.
        const video = document.querySelector('video'); if (video) video.play().catch(() => {});
      };
    } else if (current) {
      const retry = element('button', 'Check again', nav); retry.onclick = () => check();
    }
    const leave = element('a', 'Leave video', nav); leave.href = 'about:blank';
    const settings = element('button', 'Settings', nav); settings.onclick = () => chrome.runtime.sendMessage({type: 'settings'}).catch(() => {});
    document.documentElement.append(panel);
  }
  async function check() {
    const id = videoId(); current = id; const ticket = ++generation; lock();
    if (!id) return;
    show('Checking this video', 'Comparing the available video text with your goals. Playback is paused.', 'A check sends your goals and this video’s public text to OpenAI.');
    try {
      const result = await chrome.runtime.sendMessage({type: 'evaluate', videoId: id});
      if (ticket !== generation || videoId() !== id) return;
      if (result?.error) return show('Still paused', result.error);
      if (typeof result?.allowed !== 'boolean') return show('Still paused', 'No valid decision received.');
      show(result.allowed ? 'This supports your goals' : result.verdict === 'uncertain' ? 'Not enough evidence' : 'Save your attention', result.reason,
        `${result.title} · ${result.channel}\nChecked: ${result.evidence}. Footage was not analyzed.${result.cached ? ' Cached decision.' : ''}`, result.allowed);
    } catch {if (ticket === generation) show('Still paused', 'Extension connection was interrupted. Reload this page to reconnect.');}
  }
  function sync() {
    const id = videoId();
    if (id !== current) {current = id; generation++; lock(); panel?.remove(); panel = null; if (id) check();}
    if (!id && panel) {panel.remove(); panel = null;}
    pause();
  }
  document.addEventListener('yt-navigate-start', () => {generation++; current = null; lock(); panel?.remove(); panel = null;});
  document.addEventListener('yt-navigate-finish', sync);
  window.addEventListener('popstate', sync);
  // URL polling also covers history changes on embeds and mobile YouTube.
  setInterval(sync, 250);
  document.addEventListener('DOMContentLoaded', sync, {once: true});
  sync();
})();
