/*
 * Fair Tickets: shared engine used by every app.
 * Built by XDC Outpost (https://xdcoutpost.xyz). MIT licence.
 *
 * Plain-language rule: nothing a family sees mentions blockchains, wallets, keys or gas.
 * Inside the code we use the real terms:
 *   "ticket code"    = the family phone's address + a signed, rotating permit
 *   "backup message" = the phone's private key, texted to the owner
 *   "fee credit"     = XDC on staff phones for network fees
 */
(function () {
  'use strict';

  const VERSION = '1.0.0';
  const CFG = window.FAIR_CONFIG;
  const ethers = window.ethers;
  const C = window.FAIR_CONTRACTS;
  const fairIface = new ethers.Interface(C.FairTickets.abi);
  const factoryIface = new ethers.Interface(C.FairFactory.abi);
  const TOPIC = (n) => fairIface.getEvent(n).topicHash;
  const T = {
    Transfer: TOPIC('Transfer'), StaffSet: TOPIC('StaffSet'), Sold: TOPIC('Sold'), SaleUndone: TOPIC('SaleUndone'),
    Charged: TOPIC('Charged'), Refunded: TOPIC('Refunded'), Corrected: TOPIC('Corrected'), FamilyGroupSet: TOPIC('FamilyGroupSet'),
    Closed: TOPIC('Closed'), FairCreated: factoryIface.getEvent('FairCreated').topicHash
  };
  const ROLES = { NONE: 0, BOOTH: 1, STALL: 2 };
  const METHODS = ['Cash', 'Card', 'Compassionate reissue'];

  const APPS = {
    family: { name: 'Fair Tickets', path: 'family/', icon: 'family' },
    booth: { name: 'Ticket Booth', path: 'booth/', icon: 'booth' },
    stall: { name: 'Fair Stall', path: 'stall/', icon: 'stall' },
    organiser: { name: 'Fair Organiser', path: 'organiser/', icon: 'organiser' },
    tally: { name: 'Fair Tally', path: 'tally/', icon: 'family' },
    stats: { name: 'Fair Tickets stats', path: 'stats/', icon: 'organiser' }
  };

  // ------------------------------------------------------------------ storage
  const NS = 'fairtix.';
  const store = {
    get(k, d) { try { const v = localStorage.getItem(NS + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(NS + k, JSON.stringify(v)); } catch (e) { } },
    del(k) { try { localStorage.removeItem(NS + k); } catch (e) { } }
  };
  let ROLE = 'family';
  const rk = (k) => ROLE + '.' + k;
  const fk = (k) => rk(k) + '.' + (fairAddress() || 'none').toLowerCase();
  const fstore = { get: (k, d) => store.get(fk(k), d), set: (k, v) => store.set(fk(k), v), del: (k) => store.del(fk(k)) };

  // ------------------------------------------------------------------ network + fair from the link
  // Links: ?fair=0x…[&net=test]. A local test node may be named for development only:
  // ?rpc=http://localhost:8545&factory=0x… (never a remote server, so prank links can't fake screens).
  const isLocal = (u) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(String(u || ''));
  (function readLink() {
    const p = new URLSearchParams(location.search);
    const f = p.get('fair');
    if (f && /^(0x|xdc)[0-9a-f]{40}$/i.test(f)) store.set('fair', '0x' + f.slice(-40));
    if (p.get('rpc') && isLocal(p.get('rpc'))) store.set('dev', { rpc: p.get('rpc'), factory: p.get('factory') || '' });
    if (p.get('net') === 'test') { store.set('net', 51); if (!p.get('rpc')) store.del('dev'); }
    else if (p.get('net') === 'main' || (f && !p.get('rpc'))) { store.set('net', 50); if (!p.get('rpc')) store.del('dev'); }
  })();
  const fairAddress = () => store.get('fair', '') || '';
  function network() {
    const dev = store.get('dev');
    if (dev && dev.rpc) return { chainId: null, label: 'Local test', rpc: dev.rpc, factory: dev.factory, explorer: '', dev: true };
    const id = store.get('net', 50);
    const n = CFG.networks[id] || CFG.networks[50];
    return Object.assign({ chainId: id }, n);
  }
  const isPractice = () => { const n = network(); return n.dev || n.chainId === 51; };
  function linkQuery(fair) {
    const q = new URLSearchParams();
    if (fair) q.set('fair', fair);
    const n = network();
    if (n.dev) { q.set('rpc', n.rpc); if (n.factory) q.set('factory', n.factory); }
    else if (n.chainId === 51) q.set('net', 'test');
    return q.toString();
  }
  function appUrl(role, withFair = true) {
    const base = new URL('../', location.href.split('#')[0]);
    let u = new URL(APPS[role].path, base).href;
    const q = linkQuery(withFair ? fairAddress() : '');
    return q ? u + '?' + q : u;
  }
  function syncUrl() {
    const extra = new URLSearchParams(location.search);
    ['fair', 'net', 'rpc', 'factory'].forEach((k) => extra.delete(k));
    const q = new URLSearchParams(linkQuery(fairAddress()));
    extra.forEach((v, k) => q.set(k, v));
    const qs = q.toString();
    const url = location.pathname + (qs ? '?' + qs : '') + location.hash;
    if (url !== location.pathname + location.search + location.hash) { try { history.replaceState(null, '', url); } catch (e) { } }
    refreshManifest();
  }
  function setFair(addr) { if (addr) store.set('fair', addr); else store.del('fair'); syncUrl(); }

  // Installed apps open on the exact fair: swap in a manifest whose start_url is this link.
  let baseManifest = null;
  async function refreshManifest() {
    const link = document.querySelector('link[rel="manifest"]');
    if (!link || !fairAddress()) return;
    try {
      if (!baseManifest) {
        const href = new URL(link.dataset.src || link.getAttribute('href'), location.href).href;
        link.dataset.src = href;
        baseManifest = { url: href, json: await (await fetch(href)).json() };
      }
      const m = JSON.parse(JSON.stringify(baseManifest.json));
      const abs = (u) => new URL(u, baseManifest.url).href;
      m.id = abs(m.id || './'); m.scope = abs(m.scope || './'); m.start_url = location.href.split('#')[0];
      m.icons = (m.icons || []).map((i) => Object.assign({}, i, { src: abs(i.src) }));
      link.setAttribute('href', 'data:application/manifest+json,' + encodeURIComponent(JSON.stringify(m)));
    } catch (e) { }
  }

  // ------------------------------------------------------------------ helpers
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Tickets are stored in hundredths (2 decimals).
  const units = (n) => { const v = Math.round(Number(n) * 100); if (!isFinite(v) || v < 0) throw new Error('Bad amount'); return BigInt(v); };
  const num = (u) => Number(BigInt(u)) / 100;
  const fmt = (n) => { const v = typeof n === 'bigint' ? num(n) : Number(n); return (Math.round(v * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 }); };
  const ticketWord = (n) => (Math.abs((typeof n === 'bigint' ? num(n) : n) - 1) < 0.005 ? 'ticket' : 'tickets');
  const tix = (n) => fmt(n) + ' ' + ticketWord(n);
  const dollars = (v) => CFG.currency + (Math.round(Number(v) * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const isAddr = (a) => /^(0x|xdc)[0-9a-fA-F]{40}$/.test(String(a || '').trim());
  const normAddr = (a) => ethers.getAddress('0x' + String(a).trim().slice(-40).toLowerCase());
  const sameAddr = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
  const xdcAddr = (a) => (a ? 'xdc' + a.slice(2) : '');
  const xdc = (wei) => Number(ethers.formatEther(wei)).toLocaleString(undefined, { maximumFractionDigits: 4 });
  const timeStr = (t) => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const colourHex = (n) => '#' + Number(n).toString(16).padStart(6, '0');
  const topicAddr = (a) => ethers.zeroPadValue(a, 32).toLowerCase();

  // House colours: a fixed palette so text stays readable on every colour.
  const PALETTE = [
    ['Red', 0xC0392B], ['Blue', 0x2457A6], ['Green', 0x23874F], ['Yellow', 0xE3B505], ['Gold', 0xB8860B],
    ['Orange', 0xE07B1F], ['Purple', 0x6C3BAA], ['Pink', 0xD6457E], ['Black', 0x1F2328], ['White', 0xF4F5F7],
    ['Silver', 0x9AA3AD], ['Maroon', 0x7B1E2B], ['Navy', 0x1B2A4E], ['Teal', 0x1A8A8A]
  ];

  // ------------------------------------------------------------------ icons
  const ICON = {
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    camera: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
    ticket: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4z"/><path d="M14 5v14" stroke-dasharray="2 2"/></svg>',
    bag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 7h12l1 13H5z"/><path d="M9 7a3 3 0 0 1 6 0"/></svg>',
    undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg>',
    fix: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/></svg>',
    heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l8.8 8.8 8.8-8.8a5.5 5.5 0 0 0 0-7.8z"/></svg>',
    cash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/></svg>',
    card: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-11 11M22 2l-7 20-4-9-9-4z"/></svg>'
  };
  const BEACON = '<svg class="mark" viewBox="0 0 32 32" aria-hidden="true"><path d="M11 29 L16 11 L21 29 M12.6 23 H19.4 M13.8 18 H18.2" fill="none" stroke="#0F1E33" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="16" cy="7.5" r="3" fill="#B08433"/><path d="M9.5 4.5 A9 9 0 0 0 9.5 10.5 M22.5 4.5 A9 9 0 0 1 22.5 10.5" fill="none" stroke="#B08433" stroke-width="1.75" stroke-linecap="round"/></svg>';

  // ------------------------------------------------------------------ analytics (cookie-free GoatCounter, counts only)
  function setupAnalytics() {
    if (!/(^|\.)xdcoutpost\.xyz$/.test(location.hostname)) return;
    // Count pages without their query string, so fair addresses never leave the phone.
    // Practice (Apothem) visits are counted under /practice/... so they stay apart from real fairs.
    window.goatcounter = Object.assign(window.goatcounter || {}, { path: () => (isPractice() ? '/practice' : '') + location.pathname.replace(/index\.html$/, '') });
    const s = document.createElement('script');
    s.src = '/assets/analytics.js';
    document.head.appendChild(s);
  }
  function track(name) {
    try { if (window.xdcTrack) window.xdcTrack((isPractice() ? 'practice/' : '') + 'fair-tickets/' + name); } catch (e) { }
  }

  // ------------------------------------------------------------------ chain
  const state = { provider: null, chainId: null, wallet: null, fair: null, factory: null, info: null, gasPrice: null, gasAt: 0, online: true, clockOffset: 0 };

  async function rawRpc(url, method, params, timeoutMs = 8000) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }), signal: ctl.signal });
      const j = await r.json();
      if (j.error) throw new Error(j.error.message || 'rpc error');
      return j.result;
    } finally { clearTimeout(t); }
  }

  async function connect() {
    const n = network();
    const cid = Number(await rawRpc(n.rpc, 'eth_chainId', []));
    const net = ethers.Network.from(cid);
    state.chainId = cid;
    state.provider = new ethers.JsonRpcProvider(n.rpc, net, { staticNetwork: net, batchMaxCount: 1 });
    if (state.wallet) state.wallet = state.wallet.connect(state.provider);
    const signer = state.wallet || state.provider;
    state.fair = fairAddress() ? new ethers.Contract(fairAddress(), C.FairTickets.abi, signer) : null;
    state.factory = n.factory ? new ethers.Contract(n.factory, C.FairFactory.abi, signer) : null;
    setOnline(true);
    syncClock();
    return state.provider;
  }

  // The family phone signs codes with the chain's clock, so a phone set a few minutes wrong still works.
  async function syncClock() {
    try {
      const b = await state.provider.send('eth_getBlockByNumber', ['latest', false]);
      const off = parseInt(b.timestamp, 16) - Math.floor(Date.now() / 1000);
      state.clockOffset = Math.abs(off) > 20 ? off : 0;
      store.set('clockOffset', state.clockOffset);
    } catch (e) { state.clockOffset = store.get('clockOffset', 0); }
  }
  const chainNow = () => Math.floor(Date.now() / 1000) + (state.clockOffset || 0);

  async function retry(fn, tries = 3, delay = 600) {
    let last;
    for (let i = 0; i < tries; i++) {
      try { const v = await fn(); setOnline(true); return v; } catch (e) { last = e; if (isRevert(e)) throw e; await sleep(delay * (i + 1)); }
    }
    if (friendly(last).code === 'OFFLINE') setOnline(false);
    throw last;
  }
  function setOnline(on) {
    if (state.online === on) return;
    state.online = on;
    let bar = $('#netbar');
    if (!on && !bar) {
      bar = document.createElement('div'); bar.id = 'netbar'; bar.className = 'netbar'; bar.textContent = 'No connection, retrying…';
      const top = $('.topbar'); top ? top.after(bar) : document.body.prepend(bar);
    } else if (on && bar) bar.remove();
  }
  window.addEventListener('offline', () => setOnline(false));

  const isRevert = (e) => /revert|execution reverted|CALL_EXCEPTION/i.test(String((e && (e.shortMessage || e.message)) || '') + JSON.stringify((e && e.info) || ''));
  function revertReason(e) {
    const s = [e && e.reason, e && e.shortMessage, e && e.message, JSON.stringify((e && (e.info || e.error)) || '')].join(' ');
    const m = s.match(/reverted:? ?"?([^"\\]+)"?/i) || s.match(/reason="([^"]+)"/) || s.match(/revert ([^"\\]+)/i);
    return m ? m[1].trim() : '';
  }

  class Friendly extends Error { constructor(title, msg, code) { super(msg); this.title = title; this.code = code; } }
  const REASONS = {
    'Not enough tickets': ['Not enough tickets', 'There aren\'t enough tickets for that.', 'NO_TICKETS'],
    'Code expired': ['Code too old', 'That ticket code has expired. Ask them to show their screen again and scan the new code.', 'EXPIRED'],
    'Code already used': ['Code already used', 'That ticket code was just used. Ask them to show their screen again and scan the new code.', 'USED'],
    'Not a valid code': ['Not a valid code', 'That code doesn\'t belong to a Fair Tickets phone at this fair.', 'INVALID'],
    'Too many charges': ['Please wait a moment', 'This family has been charged several times very quickly. Wait a minute and try again.', 'SPEED'],
    'This fair has closed': ['The fair has closed', 'Nothing more can be sold or charged at this fair.', 'CLOSED'],
    'over the charge limit': ['Over the limit', 'That\'s more than one charge allows at this fair. Split it into smaller charges.', 'CAP'],
    'over the sale limit': ['Over the limit', 'That\'s more than one sale allows at this fair. Split it into smaller sales.', 'CAP'],
    'Not a booth': ['Not a ticket booth', 'This phone isn\'t set up as a ticket booth yet. Ask the organiser to add it.', 'ROLE'],
    'Not a stall': ['Not a stall', 'This phone isn\'t set up as a stall yet, or was removed. Ask the organiser.', 'ROLE'],
    'Not a family code': ['That\'s a helper\'s phone', 'Tickets can only be sold to family phones.', 'ROLE'],
    'Too late to undo': ['Too late to undo', 'Sales can only be undone for a few minutes. Ask the organiser to correct it.', 'LATE'],
    'Only the organiser': ['Organiser only', 'Only the organiser\'s phone can do that.', 'ROLE']
  };
  function friendly(err) {
    if (err instanceof Friendly) return err;
    const reason = revertReason(err);
    let all = '';
    try { all = [err && err.reason, err && err.shortMessage, err && err.message, JSON.stringify((err && (err.info || err.error || err.data)) || '')].join(' '); } catch (e) { all = String(err); }
    for (const k in REASONS) if (all.includes(k)) return new Friendly(...REASONS[k]);
    const m = String((err && (err.shortMessage || err.message)) || err || '').toLowerCase();
    if (m.includes('insufficient funds')) return new Friendly('Fee credit is empty', 'This phone needs more XDC for network fees. Ask the organiser to top it up.', 'NO_CREDIT');
    if (m.includes('nonce') || m.includes('replacement')) return new Friendly('Please try again', 'The last action was still finishing. Wait a few seconds and try again.');
    if (m.includes('timeout') || m.includes('timed out')) return new Friendly('Still processing', 'This is taking longer than normal. Check in a moment before trying again.', 'TIMEOUT');
    if (m.includes('failed to fetch') || m.includes('network') || m.includes('could not detect') || m.includes('abort') || !navigator.onLine)
      return new Friendly('No connection', 'Can\'t reach the fair system. Check this phone has internet and try again.', 'OFFLINE');
    if (reason) return new Friendly('That didn\'t work', reason + '.');
    return new Friendly('Something went wrong', 'Please try again. If it keeps happening, ask a fair organiser for help.');
  }

  async function gasPrice() {
    if (state.gasPrice && Date.now() - state.gasAt < 60000) return state.gasPrice;
    const gp = BigInt(await retry(() => state.provider.send('eth_gasPrice', [])));
    state.gasPrice = gp + gp / 10n; state.gasAt = Date.now();
    return state.gasPrice;
  }
  async function nextNonce() {
    const me = myAddress();
    const chain = Number(await retry(() => state.provider.send('eth_getTransactionCount', [me, 'pending'])));
    const local = store.get(rk('nonce'), null);
    if (local && local.addr === me && local.chainId === state.chainId && local.n > chain) return local.n;
    return chain;
  }
  const commitNonce = (n) => store.set(rk('nonce'), { addr: myAddress(), chainId: state.chainId, n: n + 1 });

  /** Sign locally and send. Estimates gas first so friendly errors appear before anything is sent. */
  async function sendTx({ to, data, value = 0n, gasLimit, exactGas }) {
    if (!state.wallet) throw new Friendly('Not ready', 'The app is still starting. Try again in a moment.');
    const from = myAddress();
    let gas = gasLimit;
    if (!exactGas) try {
      const est = BigInt(await state.provider.send('eth_estimateGas', [{ from, to: to || undefined, data, value: ethers.toQuantity(value) }]));
      gas = est + est / 3n + 20000n;
    } catch (e) {
      if (isRevert(e) || revertReason(e)) throw friendly(e);
      if (!gas) throw friendly(e);
    }
    const gp = await gasPrice();
    const bal = await retry(() => state.provider.getBalance(from));
    if (bal < gas * gp + value) throw new Friendly('Fee credit is empty', ROLE === 'organiser' ? 'This phone needs more XDC for network fees. Open "Add XDC" on the dashboard.' : 'This phone needs more XDC for network fees. Ask the organiser to top it up (they scan this phone\'s code).', 'NO_CREDIT');
    let nonce = await nextNonce();
    for (let attempt = 0; attempt < 3; attempt++) {
      const signed = await state.wallet.signTransaction({ type: 0, chainId: state.chainId, gasPrice: gp, nonce, to: to || null, data: data || '0x', value, gasLimit: gas });
      const hash = ethers.keccak256(signed);
      try {
        await state.provider.send('eth_sendRawTransaction', [signed]);
        setOnline(true);
        return { hash, nonce };
      } catch (e) {
        const m = String((e && (e.shortMessage || e.message)) || '').toLowerCase() + JSON.stringify((e && e.error) || '').toLowerCase();
        if (/already known|known transaction|already imported/.test(m)) return { hash, nonce };
        if (/nonce too low|nonce has already been used|replacement/.test(m) && attempt < 2) {
          nonce = Math.max(nonce + 1, Number(await retry(() => state.provider.send('eth_getTransactionCount', [from, 'pending']))));
          continue;
        }
        throw friendly(e);
      }
    }
    throw new Friendly('Please try again', 'The last action was still finishing. Wait a few seconds and try again.');
  }
  async function waitTx(hash, timeoutMs = 90000) {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      let rc = null;
      try { rc = await state.provider.send('eth_getTransactionReceipt', [hash]); setOnline(true); } catch (e) { if (friendly(e).code === 'OFFLINE') setOnline(false); }
      if (rc && rc.blockNumber) {
        if (Number(rc.status) !== 1) throw new Friendly('That didn\'t go through', 'Nothing was changed. Please try again.');
        return { hash, block: Number(rc.blockNumber), logs: rc.logs || [], contractAddress: rc.contractAddress || null };
      }
      await sleep(900);
    }
    const e = new Friendly('Still going through', 'The network is slow right now. This will most likely finish by itself in a minute. Please don\'t repeat it yet.', 'TIMEOUT');
    e.hash = hash; throw e;
  }
  /** Call a fair or factory function: send, wait, remember the nonce. */
  async function call(contract, fn, args, value = 0n, gasLimit) {
    const iface = contract === 'factory' ? factoryIface : fairIface;
    const to = contract === 'factory' ? network().factory : fairAddress();
    const { hash, nonce } = await sendTx({ to, data: iface.encodeFunctionData(fn, args), value, gasLimit });
    try { const r = await waitTx(hash); commitNonce(nonce); return r; } catch (e) { e.hash = hash; throw e; }
  }
  async function sendXdc(to, wei) {
    const { hash, nonce } = await sendTx({ to: normAddr(to), data: '0x', value: wei, gasLimit: 21000n, exactGas: true });
    const r = await waitTx(hash); commitNonce(nonce); return r;
  }

  // ------------------------------------------------------------------ fair info
  async function loadInfo(force) {
    const fa = fairAddress();
    if (!fa) return null;
    const key = 'info.' + fa.toLowerCase();
    const cached = store.get(key);
    if (cached && !force) state.info = cached;
    try {
      const f = state.fair;
      const [name, cents, organiser, createdAtBlock, closed, isOpen, autoCloseAt, limits, groups, factory] = await retry(() => Promise.all([
        f.name(), f.centsPerTicket(), f.organiser(), f.createdAtBlock(), f.closed(), f.isOpen(), f.autoCloseAt(), f.limits(), f.groups(), f.factory()
      ]));
      state.info = {
        address: fa, name, cents: Number(cents), organiser, createdAtBlock: Number(createdAtBlock), closed, isOpen,
        autoCloseAt: Number(autoCloseAt), chainId: state.chainId, factory,
        limits: { maxSale: Number(limits.maxSale), maxCharge: Number(limits.maxCharge), chargesPerMinute: Number(limits.chargesPerMinute), undoWindow: Number(limits.undoWindow), codeWindow: Number(limits.codeWindow) },
        groups: groups.names.map((n, i) => ({ id: i + 1, name: n, colour: colourHex(groups.colours[i]) }))
      };
      store.set(key, state.info);
      const known = store.get('fairs', []).filter((x) => x.address.toLowerCase() !== fa.toLowerCase());
      known.unshift({ address: fa, name, chainId: state.chainId, last: Date.now() });
      store.set('fairs', known.slice(0, 20));
    } catch (e) {
      if (!state.info) throw new Friendly('Fair not found', 'This phone can\'t find the fair. Check the internet connection, or open the fair\'s link again.', 'NOFAIR');
    }
    $$('[data-fair-name]').forEach((el) => (el.textContent = state.info.name));
    return state.info;
  }
  /** Was this fair made by Fair Tickets? null = couldn't check (no factory set or offline). */
  async function isOfficial() {
    if (!state.factory) return null;
    try { return await state.factory.isFair(fairAddress()); } catch (e) { return null; }
  }
  const groupById = (id) => (state.info && state.info.groups.find((g) => g.id === Number(id))) || null;

  // ------------------------------------------------------------------ logs
  async function blockNumber() { return Number(await retry(() => state.provider.send('eth_blockNumber', []))); }
  /** Read the fair's event logs in chunks; servers limit how many blocks one request may cover. */
  async function scanLogs(topics, fromBlock, progress, address) {
    const end = await blockNumber();
    let size = store.get('logChunk', 50000);
    let from = fromBlock;
    const out = [];
    while (from <= end) {
      const to = Math.min(end, from + size - 1);
      try {
        const logs = await retry(() => state.provider.send('eth_getLogs', [{ address: address || fairAddress(), fromBlock: ethers.toQuantity(from), toBlock: ethers.toQuantity(to), topics }]), 2, 500);
        for (const l of logs) out.push(l);
        from = to + 1;
        if (progress) progress((from - fromBlock) / Math.max(1, end - fromBlock + 1));
      } catch (e) {
        if (size <= 100) throw friendly(e);
        size = Math.max(100, Math.floor(size / 2)); store.set('logChunk', size);
      }
    }
    return { logs: out, end };
  }
  /** Cached incremental scan: keeps everything seen so far and only asks for new blocks. */
  function logCache(name, topics) {
    const key = 'logs.' + name + '.' + (fairAddress() || '').toLowerCase();
    return {
      async update(progress) {
        const c = store.get(key, null) || { next: state.info.createdAtBlock, logs: [] };
        const { logs, end } = await scanLogs(topics, c.next, progress);
        const slim = logs.map((l) => ({ topics: l.topics, data: l.data, block: parseInt(l.blockNumber, 16), tx: l.transactionHash, i: parseInt(l.logIndex, 16) }));
        c.logs = c.logs.concat(slim); c.next = end + 1;
        try { store.set(key, c); } catch (e) { }
        return c.logs;
      },
      clear() { store.del(key); }
    };
  }
  const parse = (l) => { const ev = fairIface.parseLog({ topics: l.topics, data: l.data }); return Object.assign({ name: ev.name, args: ev.args, block: l.block, tx: l.tx, i: l.i }); };

  /** The organiser's team, rebuilt from the chain: works on any phone. */
  const staffLogs = () => logCache('staff', [T.StaffSet]);
  async function staffList() {
    const logs = await staffLogs().update();
    const map = {};
    logs.map(parse).forEach((e) => {
      const a = e.args.phone.toLowerCase();
      map[a] = { address: e.args.phone, role: Number(e.args.role), name: e.args.label, featured: e.args.featured };
    });
    return Object.values(map);
  }
  function staffName(addr, list) {
    if (!addr) return '';
    if (state.info && sameAddr(addr, state.info.organiser)) return 'Organiser';
    const m = (list || []).find((s) => sameAddr(s.address, addr));
    return m ? m.name : '';
  }

  /** Every ticket movement to or from one phone, newest first, with plain-language labels. */
  async function activityFor(addr) {
    const me = topicAddr(addr);
    const [inLogs, outLogs, staff] = await Promise.all([
      logCache('in.' + addr.toLowerCase(), [T.Transfer, null, me]).update(),
      logCache('out.' + addr.toLowerCase(), [T.Transfer, me]).update(),
      staffList()
    ]);
    const seen = new Set();
    const rows = [];
    for (const l of inLogs.concat(outLogs)) {
      const id = l.tx + ':' + l.i; if (seen.has(id)) continue; seen.add(id);
      const e = parse(l);
      const incoming = sameAddr(e.args.to, addr);
      const other = incoming ? e.args.from : e.args.to;
      const s = staff.find((x) => sameAddr(x.address, other));
      const isOrg = state.info && sameAddr(other, state.info.organiser);
      let title;
      if (other === ethers.ZeroAddress) title = 'Tickets created';
      else if (isOrg) title = incoming ? 'From the organiser' : 'To the organiser';
      else if (s && s.role === ROLES.BOOTH) title = incoming ? (s.name || 'Ticket booth') : 'Returned to ' + (s.name || 'the booth');
      else if (s && s.role === ROLES.STALL) title = incoming ? 'Refund from ' + (s.name || 'a stall') : (s.name || 'Stall');
      else title = incoming ? 'Tickets received' : 'Tickets moved';
      rows.push({ incoming, amount: e.args.value, other, title, block: e.block, tx: e.tx, i: e.i });
    }
    rows.sort((a, b) => b.block - a.block || b.i - a.i);
    return rows;
  }
  /** Block times for display, cached. */
  async function blockTimes(blocks) {
    const cache = store.get('blockTimes', {});
    const need = [...new Set(blocks)].filter((b) => !cache[b]).slice(0, 40);
    await Promise.all(need.map(async (b) => {
      try { const blk = await state.provider.send('eth_getBlockByNumber', [ethers.toQuantity(b), false]); cache[b] = parseInt(blk.timestamp, 16) * 1000; } catch (e) { }
    }));
    const keys = Object.keys(cache); if (keys.length > 3000) keys.slice(0, keys.length - 2000).forEach((k) => delete cache[k]);
    store.set('blockTimes', cache);
    return cache;
  }

  // ------------------------------------------------------------------ wallet
  function loadWallet() {
    const pk = store.get(rk('key'));
    if (!pk) return null;
    try {
      state.wallet = new ethers.Wallet(pk, state.provider || undefined);
      if (state.fair) state.fair = state.fair.connect(state.wallet);
      if (state.factory) state.factory = state.factory.connect(state.wallet);
      return state.wallet;
    } catch (e) { return null; }
  }
  function saveKey(pk) { store.set(rk('key'), pk); store.set(rk('created'), Date.now()); loadWallet(); }
  const myAddress = () => state.wallet && state.wallet.address;
  const ticketBalance = (a) => retry(() => state.fair.balanceOf(a || myAddress()));
  const creditBalance = (a) => retry(() => state.provider.getBalance(a || myAddress()));

  function parseBackup(text) {
    const s = String(text || '');
    let m = s.match(/FT-([0-9a-fA-F]{64})/);
    if (!m) m = s.match(/(?:^|[^0-9a-fA-F])(?:0x)?([0-9a-fA-F]{64})(?![0-9a-fA-F])/);
    if (!m) return null;
    try { return new ethers.Wallet('0x' + m[1]).privateKey; } catch (e) { return null; }
  }
  function parseFairLink(text) {
    const m = String(text || '').match(/[?&]fair=((?:0x|xdc)[0-9a-fA-F]{40})/);
    return m ? { address: normAddr(m[1]), test: /[?&]net=test/.test(text) } : null;
  }
  function backupLink() { return appUrl(ROLE, true) + '#restore=FT-' + state.wallet.privateKey.slice(2); }
  function backupText() {
    const name = (state.info && state.info.name) || 'your fair';
    return '⚠️ DO NOT SEND THIS MESSAGE TO ANYONE ⚠️\n' +
      APPS[ROLE].name + ' backup for ' + name + '.\n' +
      'If your tickets disappear from your phone, tap this link to bring them back:\n' +
      backupLink() + '\n' +
      '⚠️ DO NOT SEND THIS MESSAGE TO ANYONE ⚠️';
  }
  const hasBackedUp = () => !!store.get(rk('backedUp'));

  // ------------------------------------------------------------------ family ticket codes
  // QR: FT1:<address>:<codeTime>:<nonce>:<group>:<flags>:<signature base64url>
  const b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64u = (s) => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); };
  function permitHash(fair, chainId, family, codeTime, nonce, group) {
    return ethers.solidityPackedKeccak256(['string', 'address', 'uint256', 'address', 'uint64', 'uint64', 'uint8'],
      ['FairTickets charge permit', fair, BigInt(chainId), family, BigInt(codeTime), BigInt(nonce), Number(group)]);
  }
  function randomNonce() { const a = new Uint32Array(2); crypto.getRandomValues(a); return (BigInt(a[0] & 0x1fffff) << 32n) | BigInt(a[1]); }
  async function makeFamilyCode(group, flags) {
    const t = Math.floor(chainNow() / 30) * 30;
    const nonce = randomNonce();
    const h = permitHash(fairAddress(), state.chainId, myAddress(), t, nonce, group || 0);
    const sig = ethers.Signature.from(await state.wallet.signMessage(ethers.getBytes(h)));
    const compact = ethers.getBytes(ethers.concat([sig.r, sig.yParityAndS]));
    return { text: ['FT1', myAddress().slice(2), t, nonce.toString(36), group || 0, flags || '-', b64u(compact)].join(':'), time: t };
  }
  function parseFamilyCode(text) {
    const p = String(text || '').trim().split(':');
    if (p[0] !== 'FT1' || p.length !== 7 || !/^[0-9a-fA-F]{40}$/.test(p[1])) return null;
    try {
      const sig = unb64u(p[6]);
      if (sig.length !== 64) return null;
      let nonce = 0n; for (const ch of p[3]) nonce = nonce * 36n + BigInt(parseInt(ch, 36));
      return { kind: 'F', address: normAddr(p[1]), codeTime: Number(p[2]), nonce, group: Number(p[4]) || 0, backedUp: p[5].includes('b'),
        r: ethers.hexlify(sig.slice(0, 32)), vs: ethers.hexlify(sig.slice(32)) };
    } catch (e) { return null; }
  }
  /** Check a family code on this phone before sending anything: signature and freshness. */
  function checkFamilyCode(c) {
    try {
      const h = permitHash(fairAddress(), state.chainId, c.address, c.codeTime, c.nonce, c.group);
      const sig = ethers.Signature.from({ r: c.r, yParityAndS: c.vs });
      const signer = ethers.verifyMessage(ethers.getBytes(h), sig);
      if (!sameAddr(signer, c.address)) return 'That code isn\'t from this fair. Ask them to open Fair Tickets for this fair.';
      const w = (state.info && state.info.limits.codeWindow) || 60;
      if (Math.abs(chainNow() - c.codeTime) > w + 15) return 'That code is too old. Ask them to show their screen again.';
      return null;
    } catch (e) { return 'That isn\'t a valid ticket code.'; }
  }

  // Codes shown by helper phones so the organiser can add them: FTS:<B|S>:<address>:<name>
  const Codes = {
    staff: (kind, a, name) => 'FTS:' + kind + ':' + a + ':' + encodeURIComponent(name || ''),
    parse(text) {
      text = String(text || '').trim();
      const f = parseFamilyCode(text); if (f) return f;
      if (/^https?:\/\//i.test(text)) { const l = parseFairLink(text); return l ? { kind: 'L', address: l.address, test: l.test } : null; }
      const m = text.match(/^FTS:([BS]):((?:0x|xdc)[0-9a-fA-F]{40})(?::(.*))?$/i);
      if (m) { let name = ''; try { name = decodeURIComponent(m[3] || ''); } catch (e) { } return { kind: m[1].toUpperCase(), address: normAddr(m[2]), name }; }
      if (isAddr(text)) return { kind: 'A', address: normAddr(text) };
      return null;
    }
  };

  // ------------------------------------------------------------------ UI kit
  function qrSvg(text) {
    const q = window.qrcode(0, text.length > 120 ? 'L' : 'M');
    q.addData(text); q.make();
    return q.createSvgTag({ cellSize: 8, margin: 2, scalable: true });
  }
  function showView(name) {
    const boot = $('#booting'); if (boot) boot.remove();
    $$('[data-view]').forEach((v) => (v.hidden = v.dataset.view !== name));
    window.scrollTo(0, 0);
    document.body.dataset.current = name;
  }
  let toastTimer;
  function toast(msg, kind = '') {
    $$('.toast').forEach((t) => t.remove());
    const t = document.createElement('div'); t.className = 'toast ' + kind; t.textContent = msg;
    document.body.appendChild(t); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.remove(), 3200);
  }
  /** Bottom sheet. buttons: [{ label, value, style, submit }]. Resolves { value, el }. */
  function sheet({ title, html = '', buttons = [{ label: 'OK', value: true }], dismissable = true, onOpen, validate }) {
    return new Promise((resolve) => {
      const ov = document.createElement('div'); ov.className = 'overlay';
      ov.innerHTML = '<div class="sheet" role="dialog" aria-modal="true">' + (title ? '<h2>' + esc(title) + '</h2>' : '') +
        '<div class="sheet-body">' + html + '</div><div class="err" hidden></div><div class="sheet-btns"></div></div>';
      const box = $('.sheet-btns', ov);
      const finish = (value) => { ov.remove(); document.removeEventListener('keydown', onKey); resolve({ value, el: ov }); };
      buttons.forEach((b) => {
        const btn = document.createElement('button'); btn.className = 'btn ' + (b.style || ''); btn.innerHTML = b.label;
        btn.onclick = async () => {
          if (b.submit && validate) { const err = await validate(ov); if (err) { const e = $('.err', ov); e.textContent = err; e.hidden = false; return; } }
          finish(b.value);
        };
        box.appendChild(btn);
      });
      if (dismissable) ov.addEventListener('click', (e) => { if (e.target === ov) finish(null); });
      const onKey = (e) => {
        if (e.key === 'Escape' && dismissable) finish(null);
        if (e.key === 'Enter' && e.target.tagName === 'INPUT') { const s = buttons.findIndex((b) => b.submit); if (s >= 0) box.children[s].click(); }
      };
      document.addEventListener('keydown', onKey);
      document.body.appendChild(ov);
      if (onOpen) onOpen(ov);
      const first = $('input,textarea', ov); if (first && !('ontouchstart' in window)) setTimeout(() => first.focus(), 50);
    });
  }
  const alertSheet = (title, msg, label = 'OK') => sheet({ title, html: '<p>' + esc(msg) + '</p>', buttons: [{ label, value: true }] });
  async function confirmSheet(title, msgHtml, yes = 'Yes', no = 'Cancel', danger) {
    const r = await sheet({ title, html: '<p>' + msgHtml + '</p>', buttons: [{ label: yes, value: true, style: danger ? 'danger' : '' }, { label: no, value: false, style: 'secondary' }] });
    return r.value === true;
  }
  async function showError(err) { const f = friendly(err); console.warn(err); await alertSheet(f.title, f.message); }
  function busy(text) {
    const el = document.createElement('div'); el.className = 'busy';
    el.innerHTML = '<div><div class="spinner"></div><b></b><p class="muted">Please keep the app open</p></div>';
    $('b', el).textContent = text || 'Working…'; document.body.appendChild(el);
    return { update(t) { $('b', el).textContent = t; }, close() { el.remove(); } };
  }
  let audioCtx;
  function unlockAudio() {
    try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state === 'suspended') audioCtx.resume();
      const src = audioCtx.createBufferSource(); src.buffer = audioCtx.createBuffer(1, 1, 22050); src.connect(audioCtx.destination); src.start(0); } catch (e) { }
  }
  ['touchstart', 'pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, unlockAudio, { once: true, passive: true, capture: true }));
  function chime(good = true) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state === 'suspended') audioCtx.resume();
      (good ? [784, 1047, 1319] : [330, 262]).forEach((f, i) => {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain(); o.type = 'sine'; o.frequency.value = f;
        const t = audioCtx.currentTime + i * 0.11; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
        o.connect(g).connect(audioCtx.destination); o.start(t); o.stop(t + 0.32);
      });
    } catch (e) { }
    try { navigator.vibrate && navigator.vibrate(good ? [60, 40, 120] : [200, 80, 200]); } catch (e) { }
  }
  function splash(title, sub, good = true, ms = 2600) {
    return new Promise((resolve) => {
      chime(good);
      const el = document.createElement('div'); el.className = 'splash ' + (good ? 'ok' : 'bad');
      el.innerHTML = '<div><div class="mark">' + (good ? '✓' : '✕') + '</div><h1></h1><p></p><p class="small" style="opacity:.8;margin-top:28px">Tap to continue</p></div>';
      $('h1', el).textContent = title; $('p', el).textContent = sub || '';
      const done = () => { el.remove(); resolve(); };
      el.onclick = done; document.body.appendChild(el);
      if (ms) setTimeout(() => el.isConnected && done(), ms);
    });
  }

  // ------------------------------------------------------------------ scanner
  /**
   * Camera scanner. Normal mode resolves with the first good code.
   * Multi mode (multi: fn(parsed, raw) -> label string or { error }) stays open, lists each code,
   * and resolves with the array of codes when the person taps the finish button (or null on cancel).
   */
  function scan({ title = 'Scan the code', hint = 'Point the camera at the code', check, multi, finishLabel } = {}) {
    return new Promise((resolve) => {
      $$('.toast').forEach((t) => t.remove());
      const el = document.createElement('div'); el.className = 'scanner';
      el.innerHTML = '<video playsinline muted autoplay></video><div class="frame"></div><div class="top"><b></b><span></span></div>' +
        '<div class="bottom"><div class="msg" hidden></div>' + (multi ? '<ul class="scanlist" hidden></ul><button class="btn" data-finish hidden></button>' : '') + '<button class="btn secondary" data-cancel>Cancel</button><button class="link" data-type>Camera not working? Type or paste the code</button></div>';
      $('.top b', el).textContent = title; $('.top span', el).textContent = hint;
      document.body.appendChild(el);
      const video = $('video', el), msg = $('.msg', el);
      let stream, done = false, lastBad = '', lastBadAt = 0, detector = null;
      const got = [], seen = new Set(), list = multi ? $('.scanlist', el) : null, fin = multi ? $('[data-finish]', el) : null;
      const finish = (val) => { if (done) return; done = true; if (stream) stream.getTracks().forEach((t) => t.stop()); el.remove(); resolve(val); };
      const consider = (raw) => {
        if (done || !raw) return false;
        const parsed = Codes.parse(raw);
        const err = parsed ? (check ? check(parsed, raw) : null) : 'That isn\'t a Fair Tickets code. Try again.';
        if (err) {
          if (raw !== lastBad || Date.now() - lastBadAt > 2500) { msg.textContent = err; msg.hidden = false; chime(false); }
          lastBad = raw; lastBadAt = Date.now(); return false;
        }
        if (!multi) { chime(true); finish(parsed); return true; }
        const key = parsed.address ? parsed.address.toLowerCase() : raw;
        if (seen.has(key)) return false; // the camera keeps seeing the same code: ignore quietly
        const res = multi(parsed, raw);
        if (res && res.error) {
          if (raw !== lastBad || Date.now() - lastBadAt > 2500) { msg.className = 'msg'; msg.textContent = res.error; msg.hidden = false; chime(false); }
          lastBad = raw; lastBadAt = Date.now(); return false;
        }
        seen.add(key); got.push(parsed); chime(true);
        msg.className = 'msg ok'; msg.textContent = 'Got it. Scan the next one.'; msg.hidden = false;
        const li = document.createElement('li'); li.textContent = '✓ ' + res; list.prepend(li); list.hidden = false;
        fin.textContent = (finishLabel || ((n) => 'Done (' + n + ')'))(got.length); fin.hidden = false;
        return true;
      };
      if (fin) fin.onclick = () => finish(got.slice());
      $('[data-cancel]', el).onclick = async () => {
        if (got.length && !(await confirmSheet('Stop scanning?', 'The ' + got.length + ' code' + (got.length === 1 ? '' : 's') + ' you scanned won\'t be used.', 'Stop', 'Keep scanning', true))) return;
        finish(null);
      };
      $('[data-type]', el).onclick = async () => {
        const r = await sheet({
          title: 'Type or paste the code',
          html: '<label class="field"><textarea class="input" id="manualcode" placeholder="Paste the code here"></textarea></label>',
          buttons: [{ label: 'Use this code', value: true, submit: true }, { label: 'Back', value: false, style: 'secondary' }],
          validate: (ov) => { const raw = $('#manualcode', ov).value.trim(); const p = Codes.parse(raw); if (!p) return 'That isn\'t a Fair Tickets code.'; return (check && check(p, raw)) || null; }
        });
        if (r.value) consider($('#manualcode', r.el).value.trim());
      };
      (async () => {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
          if (done) { stream.getTracks().forEach((t) => t.stop()); return; }
          video.srcObject = stream; await video.play().catch(() => { });
        } catch (e) { msg.textContent = 'The camera isn\'t available. Allow camera access for this app in your phone settings, or type the code instead.'; msg.hidden = false; return; }
        if ('BarcodeDetector' in window) { try { detector = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch (e) { detector = null; } }
        const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true });
        const tick = async () => {
          if (done) return;
          if (video.readyState >= 2 && video.videoWidth) {
            try {
              if (detector) { const codes = await detector.detect(video); if (codes && codes[0]) consider(codes[0].rawValue); }
              else if (window.jsQR) {
                const scale = Math.min(1, 720 / video.videoWidth);
                canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const r = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
                if (r && r.data) consider(r.data);
              }
            } catch (e) { }
          }
          setTimeout(() => requestAnimationFrame(tick), detector ? 120 : 160);
        };
        tick();
      })();
    });
  }

  // ------------------------------------------------------------------ install help
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; document.dispatchEvent(new Event('ft-installable')); });
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  function platform() {
    const ua = navigator.userAgent || '';
    const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const android = /Android/.test(ua);
    const inApp = /FBAN|FBAV|Instagram|Line\/|Snapchat|TikTok|MicroMessenger|; wv\)/.test(ua);
    return { ios, android, inApp, samsung: /SamsungBrowser/.test(ua), iosOther: ios && /CriOS|FxiOS|EdgiOS/.test(ua), mobile: ios || android };
  }
  const SHARE_ICON = '<svg style="width:18px;height:18px;vertical-align:-3px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8"/></svg>';
  function installHow(app) {
    const p = platform();
    if (p.inApp) return '<div class="notice warn"><b>Open this page in your normal browser first.</b><br>Tap the <b>⋯</b> menu and choose <b>Open in browser</b>.</div>';
    if (p.ios) return '<ol class="steps"><li>Tap the <b>Share</b> button ' + SHARE_ICON + (p.iosOther ? '.' : ' at the bottom of Safari.') + '</li><li>Scroll down and tap <b>Add to Home Screen</b>.</li><li>Tap <b>Add</b>, then open <b>' + esc(app.name) + '</b> from your home screen.</li></ol>';
    if (p.android) return '<div data-native-install hidden><button class="btn huge" data-install>Add to my home screen</button></div><ol class="steps" data-manual>' +
      (p.samsung ? '<li>Tap the <b>☰</b> menu at the bottom.</li><li>Tap <b>Add page to</b> → <b>Home screen</b>.</li>' : '<li>Tap the <b>⋮</b> menu at the top right.</li><li>Tap <b>Add to Home screen</b> or <b>Install app</b>.</li>') +
      '<li>Then open <b>' + esc(app.name) + '</b> from your home screen.</li></ol>';
    return '<p class="muted">On a phone, this step adds the app to the home screen. On a computer you can keep using it in the browser.</p>';
  }
  function wireNativeInstall(el, onAccepted) {
    const nativeBox = $('[data-native-install]', el);
    const show = () => { if (deferredPrompt && nativeBox) { nativeBox.hidden = false; const m = $('[data-manual]', el); if (m) m.hidden = true; } };
    show(); document.addEventListener('ft-installable', show);
    const btn = $('[data-install]', el);
    if (btn) btn.onclick = async () => { if (!deferredPrompt) return; deferredPrompt.prompt(); const { outcome } = await deferredPrompt.userChoice; deferredPrompt = null; if (outcome === 'accepted') onAccepted && onAccepted(); else show(); };
  }

  // ------------------------------------------------------------------ setup wizard
  /**
   * Full-screen, one question per screen. steps: [{ id, skip?(data), render(data) -> { title, html, next, onOpen(el, data, go), validate(el, data) } }]
   * Progress is saved so an interrupted setup resumes where it stopped.
   */
  function wizard(key, steps, initial = {}) {
    return new Promise((resolve) => {
      const saved = store.get(rk('wizard.' + key), null);
      const data = Object.assign({}, initial, saved ? saved.data : {});
      let i = saved ? Math.min(saved.i, steps.length - 1) : 0;
      const el = document.createElement('div'); el.className = 'fullscreen';
      document.body.appendChild(el);
      const visible = () => steps.filter((s) => !(s.skip && s.skip(data)));
      const save = () => store.set(rk('wizard.' + key), { i, data });
      async function render() {
        while (steps[i] && steps[i].skip && steps[i].skip(data)) i++;
        if (i >= steps.length) { store.del(rk('wizard.' + key)); el.remove(); resolve(data); return; }
        save();
        const step = steps[i];
        const v = visible(), pos = v.indexOf(step);
        const s = await step.render(data);
        el.innerHTML = '<div class="inner"><div class="wizard-top"><button class="link" data-back' + (i === 0 || s.noBack ? ' style="visibility:hidden"' : '') + '>← Back</button>' +
          '<div class="dots">' + v.map((_, k) => '<i class="' + (k === pos ? 'on' : '') + '"></i>').join('') + '</div><span style="width:48px"></span></div>' +
          (s.title ? '<h1>' + esc(s.title) + '</h1>' : '') + (s.html || '') + '<div class="err notice bad" hidden></div>' +
          (s.next === false ? '' : '<button class="btn huge' + (s.nextStyle ? ' ' + s.nextStyle : '') + '" data-next>' + esc(s.next || 'Next') + '</button>') + '</div>';
        const go = async (dir) => {
          if (dir > 0 && s.validate) { const err = await s.validate(el, data); if (err) { const e = $('.err', el); e.textContent = err; e.hidden = false; return; } }
          i += dir;
          if (dir < 0) while (i > 0 && steps[i].skip && steps[i].skip(data)) i--;
          render();
        };
        const nb = $('[data-next]', el); if (nb) nb.onclick = () => go(1);
        $('[data-back]', el).onclick = () => go(-1);
        if (s.onOpen) s.onOpen(el, data, go);
        el.scrollTop = 0;
      }
      render();
    });
  }
  /** Shared wizard steps */
  const Steps = {
    install: (app) => ({
      id: 'install', skip: () => isStandalone() || !platform().mobile,
      render: () => ({ title: 'Add ' + app.name + ' to your home screen', html: '<p class="muted">It takes ten seconds and makes the app easy to find all day.</p><div class="card">' + installHow(app) + '</div>', next: 'Done, or skip for now',
        onOpen: (el) => wireNativeInstall(el, () => toast('Added! You can open it from your home screen', 'ok')) })
    }),
    backup: () => ({
      id: 'backup', skip: () => hasBackedUp(),
      render: () => ({
        title: 'Save your backup',
        html: '<p>This text brings everything back if the phone is lost or reset.</p><div class="card"><ol class="steps"><li>Tap <b>Text it to myself</b>.</li><li>In the <b>To</b> box, type <b>your own mobile number</b>.</li><li>Press <b>Send</b>, then come back here.</li></ol>' +
          '<a class="btn" data-sms href="' + esc(smsLink(backupText())) + '">Text it to myself</a><button class="btn secondary" data-share>Save it another way (email, notes)</button></div>' +
          '<label class="check"><input type="checkbox" data-done> <span>I\'ve saved my backup message</span></label><p class="small muted">Keep it private. Never send it to anyone.</p>',
        next: 'Continue',
        onOpen: (el) => {
          const cb = $('[data-done]', el);
          $('[data-sms]', el).addEventListener('click', () => setTimeout(() => { cb.checked = true; }, 800));
          $('[data-share]', el).onclick = async () => { if (navigator.share) { try { await navigator.share({ title: APPS[ROLE].name + ' backup', text: backupText() }); cb.checked = true; } catch (e) { } } else { copyText(backupText()); cb.checked = true; } };
        },
        validate: async (el) => {
          if ($('[data-done]', el).checked) { store.set(rk('backedUp'), Date.now()); track(ROLE + '/backup-saved'); return null; }
          const ok = await confirmSheet('Skip the backup?', 'Without it, if anything happens to this phone, what\'s on it can\'t be brought back.', 'Skip for now', 'Go back', true);
          return ok ? null : ' ';
        }
      })
    })
  };

  // ------------------------------------------------------------------ backup + restore
  function smsLink(body) { return 'sms:' + (platform().ios ? '&' : '?') + 'body=' + encodeURIComponent(body); }
  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); toast('Copied', 'ok'); }
    catch (e) { const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); toast('Copied', 'ok'); } catch (e2) { toast('Couldn\'t copy'); } ta.remove(); }
  }
  async function backupSheet() {
    await sheet({
      title: 'Save your backup',
      html: '<p>Text it to your own number, or save it somewhere private. Never send it to anyone else.</p><a class="btn" href="' + esc(smsLink(backupText())) + '" data-sms>Text it to myself</a><button class="btn secondary" data-share>Save it another way</button><button class="link" data-copy>Copy backup message</button>',
      buttons: [{ label: 'Done', value: true, style: 'secondary' }],
      onOpen: (ov) => {
        $('[data-sms]', ov).addEventListener('click', () => store.set(rk('backedUp'), Date.now()));
        $('[data-share]', ov).onclick = async () => { if (navigator.share) { try { await navigator.share({ text: backupText() }); store.set(rk('backedUp'), Date.now()); } catch (e) { } } else copyText(backupText()); };
        $('[data-copy]', ov).onclick = () => { copyText(backupText()); store.set(rk('backedUp'), Date.now()); };
      }
    });
  }
  /** A backup link opened on the phone: #restore=FT-<key>. Never sent to the server. */
  async function restoreFromHash() {
    const m = location.hash.match(/restore=FT-([0-9a-fA-F]{64})/);
    if (!m) return false;
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { }
    const pk = '0x' + m[1];
    const current = store.get(rk('key'));
    if (current && current.toLowerCase() !== pk.toLowerCase()) {
      const ok = await confirmSheet('Use the backed-up tickets?', 'This phone already has its own tickets for this app. Switching brings back the backed-up ones instead. Only continue if this phone\'s own tickets are saved or empty.', 'Switch', 'Cancel', true);
      if (!ok) return false;
    }
    saveKey(pk); store.set(rk('backedUp'), Date.now()); track(ROLE + '/restored');
    toast('Restored!', 'ok');
    return true;
  }
  async function restoreSheet() {
    const r = await sheet({
      title: 'Restore from backup',
      html: '<p>Open your backup text message and tap its link. Or copy the whole message and paste it here.</p><label class="field"><textarea class="input" id="restoretext" placeholder="Paste the whole backup message here"></textarea></label>',
      buttons: [{ label: 'Restore', value: true, submit: true }, { label: 'Cancel', value: false, style: 'secondary' }],
      validate: (ov) => (parseBackup($('#restoretext', ov).value) ? null : 'That doesn\'t look like a backup message. Paste the whole message.')
    });
    if (!r.value) return false;
    const text = $('#restoretext', r.el).value;
    saveKey(parseBackup(text)); store.set(rk('backedUp'), Date.now()); track(ROLE + '/restored');
    const link = parseFairLink(text);
    if (link) { store.set('fair', link.address); if (!network().dev) store.set('net', link.test ? 51 : 50); }
    toast('Restored!', 'ok');
    return true;
  }

  // ------------------------------------------------------------------ connect to a fair
  function ensureFair(hintHtml) {
    if (fairAddress()) return Promise.resolve();
    return new Promise(() => {
      const el = document.createElement('div'); el.className = 'fullscreen';
      el.innerHTML = '<div class="inner center"><img class="appicon" src="../icons/' + APPS[ROLE].icon + '-192.png" alt=""><h1>Connect to your fair</h1>' +
        '<p>' + (hintHtml || 'Open the link the fair organiser sent you, or scan the fair\'s QR code from a poster or the organiser\'s phone.') + '</p>' +
        '<button class="btn huge" data-scan>' + ICON.camera + ' Scan the fair\'s QR code</button><button class="btn secondary" data-restore>I have a backup message</button>' +
        '<p class="small muted" style="margin-top:14px">Organising a fair? Start at the <a href="../">Fair Tickets home page</a>.</p></div>';
      document.body.appendChild(el);
      $('[data-scan]', el).onclick = async () => {
        const c = await scan({ title: 'Scan the fair\'s QR code', hint: 'From a poster or the organiser\'s phone', check: (p) => (p.kind === 'L' ? null : 'That\'s not the fair\'s QR code.') });
        if (!c) return;
        store.set('fair', c.address); if (!network().dev) store.set('net', c.test ? 51 : 50);
        location.reload();
      };
      $('[data-restore]', el).onclick = async () => { if (await restoreSheet()) { syncUrl(); location.reload(); } };
    });
  }

  // ------------------------------------------------------------------ settings
  async function openSettings(extraHtml = '', onExtra) {
    const n = network();
    const others = store.get('fairs', []).filter((x) => !sameAddr(x.address, fairAddress()));
    const html =
      (others.length ? '<div class="card flat"><h3>Your other fairs</h3>' + others.map((x, i) => '<button class="btn secondary" data-other="' + i + '">' + esc(x.name) + (x.chainId === 51 ? ' (practice)' : '') + '</button>').join('') + '</div>' : '') +
      '<div class="card flat"><button class="btn secondary" data-a="backup">Text my backup again</button><button class="btn secondary" data-a="restore">Restore from backup</button>' + extraHtml + '</div>' +
      '<details class="small" style="margin-bottom:14px"><summary class="muted">Technical details (only if asked by a helper)</summary>' +
      '<p class="muted mono" style="margin-top:12px">Fair: ' + esc(state.info ? state.info.name : '-') + '<br>This phone: ' + esc(xdcAddr(myAddress()) || '-') + '<br>Fair code: ' + esc(xdcAddr(fairAddress()) || '-') + '<br>Network: ' + esc(n.label) + ' · App ' + VERSION + '</p>' +
      '<button class="btn secondary small" data-a="fair">Change fair</button> <button class="btn danger small" data-a="wipe">Remove from this phone</button></details>' +
      '<p class="small muted center">Fair Tickets by <a href="' + esc(CFG.builtByUrl) + '" target="_blank" rel="noopener">' + esc(CFG.builtBy) + '</a> · <a href="../terms.html" target="_blank">Terms of Use</a></p>';
    let action = null;
    await sheet({
      title: 'Settings', html, buttons: [{ label: 'Close', value: null, style: 'secondary' }],
      onOpen: (ov) => {
        $$('[data-a]', ov).forEach((b) => (b.onclick = () => { action = b.dataset.a; ov.remove(); handle(); }));
        $$('[data-other]', ov).forEach((b) => (b.onclick = () => { const x = others[Number(b.dataset.other)]; store.set('fair', x.address); if (x.chainId === 50 || x.chainId === 51) { store.set('net', x.chainId); store.del('dev'); } syncUrl(); location.reload(); }));
        if (onExtra) onExtra(ov, (a) => { action = a; ov.remove(); handle(); });
      }
    });
    async function handle() {
      if (action === 'backup') await backupSheet();
      else if (action === 'restore') { if (await restoreSheet()) { syncUrl(); location.reload(); } }
      else if (action === 'fair') { const c = await scan({ title: 'Scan the fair\'s QR code', check: (p) => (p.kind === 'L' ? null : 'That\'s not a fair QR code.') }); if (c) { store.set('fair', c.address); if (!network().dev) store.set('net', c.test ? 51 : 50); syncUrl(); location.reload(); } }
      else if (action === 'wipe') {
        const ok = await confirmSheet('Remove from this phone?', 'This deletes this app\'s account from this phone. Only do this if you have your backup message, or nothing is left on it.', 'Remove', 'Cancel', true);
        if (ok) { store.del(rk('key')); store.del(rk('backedUp')); location.reload(); }
      }
    }
    return action;
  }

  // ------------------------------------------------------------------ page chrome
  function credit() {
    const f = document.createElement('div'); f.className = 'credit no-print';
    f.innerHTML = '<a href="' + esc(CFG.builtByUrl) + '" target="_blank" rel="noopener">' + BEACON.replace('class="mark"', '') + 'Fair Tickets by ' + esc(CFG.builtBy) + '</a>';
    document.body.appendChild(f);
  }
  function registerSW() {
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname))) navigator.serviceWorker.register('../sw.js', { scope: '../' }).catch(() => { });
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => { });
  }
  async function keepAwake() {
    const get = async () => { try { if ('wakeLock' in navigator && document.visibilityState === 'visible') await navigator.wakeLock.request('screen'); } catch (e) { } };
    document.addEventListener('visibilitychange', get); get();
  }
  function practiceBar() {
    if (!isPractice() || $('#practicebar')) return;
    const bar = document.createElement('div'); bar.id = 'practicebar'; bar.className = 'netbar practice no-print';
    bar.textContent = 'Practice mode: tickets here are pretend';
    const top = $('.topbar'); top ? top.after(bar) : document.body.prepend(bar);
  }

  /** Standard start-up used by every app. */
  async function start(role, opts = {}) {
    ROLE = role;
    document.body.classList.add('role-' + role);
    const mk = $('.topbar .mark-slot'); if (mk) mk.outerHTML = BEACON;
    setupAnalytics(); registerSW(); credit();
    const main = $('main');
    if (main) main.insertAdjacentHTML('afterbegin', '<div id="booting" class="center" style="padding:70px 0"><div class="spinner"></div><p class="muted">Loading…</p></div>');
    const restored = await restoreFromHash();
    if (opts.needsFair !== false) await ensureFair(opts.fairHint);
    syncUrl();
    loadWallet();
    let b;
    for (let i = 0; ; i++) {
      try { await connect(); break; } catch (e) { setOnline(false); if (i === 1 && !b) b = busy('Connecting to the fair…'); await sleep(Math.min(8000, 1000 * (i + 1))); }
    }
    if (b) b.close();
    practiceBar();
    if (fairAddress()) { try { await loadInfo(); } catch (e) { await showError(e); } }
    if (state.wallet) { if (state.fair) state.fair = state.fair.connect(state.wallet); if (state.factory) state.factory = state.factory.connect(state.wallet); }
    return { restored };
  }

  function newAccount() { saveKey(ethers.Wallet.createRandom().privateKey); if (state.fair) state.fair = state.fair.connect(state.wallet); if (state.factory) state.factory = state.factory.connect(state.wallet); }

  window.Fair = {
    VERSION, CFG, APPS, ROLES, METHODS, PALETTE, ICON, BEACON, T, state, store, fstore, fairIface, factoryIface,
    $, $$, esc, sleep, units, num, fmt, tix, ticketWord, dollars, isAddr, normAddr, sameAddr, xdcAddr, xdc, timeStr, colourHex, topicAddr,
    network, isPractice, fairAddress, setFair, appUrl, linkQuery, syncUrl, track,
    connect, loadInfo, isOfficial, groupById, call, sendXdc, waitTx, retry, friendly, Friendly, chainNow, syncClock,
    blockNumber, scanLogs, logCache, parse, staffList, staffLogs, staffName, activityFor, blockTimes,
    loadWallet, saveKey, newAccount, myAddress, ticketBalance, creditBalance, backupText, backupLink, hasBackedUp, parseBackup, parseFairLink,
    makeFamilyCode, parseFamilyCode, checkFamilyCode, Codes,
    qrSvg, showView, toast, sheet, alertSheet, confirmSheet, showError, busy, splash, chime, scan,
    platform, isStandalone, installHow, wireNativeInstall, wizard, Steps, smsLink, copyText, backupSheet, restoreSheet,
    openSettings, keepAwake, start, ethers, get role() { return ROLE; }
  };
})();
