/* Fair Tickets: ticket booth app. Sells tickets for cash or card, reissues, and undoes mistakes. */
(async function () {
  'use strict';
  const F = window.Fair, S = window.Staff;
  const { $, $$, esc } = F;

  $('#settingsBtn').innerHTML = F.ICON.gear;
  await F.start('booth', { fairHint: 'Open the booth link the organiser sent you, or scan the fair\'s QR code.' });
  if ((await F.isOfficial()) === false) { F.alertSheet('Not an official fair', 'This link wasn\'t made by Fair Tickets. Ask the organiser for the right link.'); return; }
  if (!F.store.get('booth.name')) F.store.set('booth.name', 'Ticket booth');
  await S.setup('booth');
  F.keepAwake();

  const D = F.CFG.defaults;
  let info = F.state.info;
  let float = null;
  const cents = () => (info && info.cents) || 100;
  const ticketsFor = (dollars) => Math.round((dollars * 100 / cents()) * 100) / 100;
  const me = () => F.myAddress();
  const boothTopic = () => F.topicAddr(me());
  let sales = []; // { id, family, amount, method, block, undone }

  // ---------------------------------------------------------------- data
  async function loadSales() {
    const [sold, undone] = await Promise.all([
      F.logCache('booth.sold.' + me().toLowerCase(), [F.T.Sold, null, boothTopic()]).update(),
      F.logCache('booth.undo.' + me().toLowerCase(), [F.T.SaleUndone, null, boothTopic()]).update()
    ]);
    const u = {};
    undone.map(F.parse).forEach((e) => { const id = e.args.id.toString(); u[id] = (u[id] || 0n) + e.args.amount; });
    sales = sold.map(F.parse).map((e) => ({ id: e.args.id, family: e.args.family, amount: e.args.amount, method: Number(e.args.method), block: e.block, undone: u[e.args.id.toString()] || 0n }));
    sales.sort((a, b) => b.block - a.block);
  }
  function totals() {
    const t = { cash: 0, card: 0, reissue: 0n, n: 0 };
    for (const s of sales) {
      const net = s.amount - s.undone;
      if (net <= 0n) continue;
      t.n++;
      if (s.method === 0) t.cash += F.num(net) * cents() / 100;
      else if (s.method === 1) t.card += F.num(net) * cents() / 100;
      else t.reissue += net;
    }
    return t;
  }

  // ---------------------------------------------------------------- rendering
  function renderQuick() {
    const amounts = (F.store.get('booth.presets') || D.presets);
    $('#quick').innerHTML = amounts.map((d) => '<button class="amount-btn" data-d="' + d + '"><b>' + F.dollars(d).replace(/\.00$/, '') + '</b><span>' + F.tix(ticketsFor(d)) + '</span></button>').join('');
    $$('#quick [data-d]').forEach((b) => (b.onclick = () => sell(Number(b.dataset.d))));
    $('#price').textContent = '1 ticket = ' + F.dollars(cents() / 100);
  }
  async function saleRow(s, times) {
    const net = s.amount - s.undone;
    const t = times[s.block];
    const canUndo = net > 0n && t && Date.now() - t < info.limits.undoWindow * 1000;
    return '<li class="tap" data-id="' + s.id + '"><div class="ico">' + (s.method === 0 ? F.ICON.cash : s.method === 1 ? F.ICON.card : F.ICON.heart) + '</div><div class="grow"><b>' +
      F.METHODS[s.method] + (s.undone > 0n ? ' · undone ' + F.fmt(s.undone) : '') + '</b><span>' + (t ? F.timeStr(t) : '') + (canUndo ? ' · tap to undo' : '') + '</span></div><div class="amt">' + F.fmt(s.amount) + '</div></li>';
  }
  async function renderSales() {
    const times = await F.blockTimes(sales.slice(0, 40).map((s) => s.block));
    const rows = await Promise.all(sales.slice(0, 6).map((s) => saleRow(s, times)));
    $('#recent').innerHTML = rows.length ? rows.join('') : '<li class="empty">No sales yet.</li>';
    $$('#recent [data-id]').forEach((li) => (li.onclick = () => undo(BigInt(li.dataset.id), times)));
  }
  async function refresh() {
    try {
      float = await F.ticketBalance();
      $('#float').textContent = F.fmt(float);
      const role = await S.myRole();
      $('#joinNote').hidden = role === F.ROLES.BOOTH;
      S.creditCheck($('#creditWarn'));
      await loadSales();
      await renderSales();
    } catch (e) { }
  }
  async function home() { renderQuick(); F.showView('home'); refresh(); }

  // ---------------------------------------------------------------- selling
  async function sell(dollarsPaid, ticketsOverride) {
    const n = ticketsOverride != null ? ticketsOverride : ticketsFor(dollarsPaid);
    const amount = F.units(n);
    if (float !== null && amount > float) return F.alertSheet('Not enough tickets on this phone', 'This booth has ' + F.tix(float) + ' left to sell. Ask the organiser for more.');
    if (amount > BigInt(info.limits.maxSale)) return F.alertSheet('Over the sale limit', 'One sale can be up to ' + F.tix(BigInt(info.limits.maxSale)) + '. Split it into two sales.');
    const r = await F.sheet({
      title: F.tix(n) + ' for ' + F.dollars(dollarsPaid),
      html: '<p class="muted">How did they pay?</p>',
      buttons: [
        { label: F.ICON.cash.replace('<svg', '<svg class="ic"') + ' Cash', value: 0 },
        { label: F.ICON.card.replace('<svg', '<svg class="ic"') + ' Card', value: 1, style: 'secondary' },
        { label: F.ICON.heart.replace('<svg', '<svg class="ic"') + ' Compassionate reissue', value: 2, style: 'secondary' },
        { label: 'Cancel', value: null, style: 'ghost' }]
    });
    if (r.value == null) return;
    const method = r.value;
    if (method !== 2 && dollarsPaid > D.largeSaleDollars) {
      const ok = await F.confirmSheet('Check the amount', '<b>' + F.tix(n) + ' = ' + F.dollars(dollarsPaid) + '.</b> Did you receive ' + F.dollars(dollarsPaid) + '?', 'Yes, continue', 'Go back');
      if (!ok) return;
    }
    const c = await F.scan({
      title: 'Scan their ticket code', hint: 'On their phone: Fair Tickets',
      check: (p) => (p.kind === 'F' ? null : 'That\'s not a family ticket code. Ask them to open Fair Tickets.')
    });
    if (!c) return;
    const b = F.busy('Sending ' + F.tix(n) + '…');
    try {
      await F.call('fair', 'sell', [c.address, amount, method, c.group || 0]);
      b.close();
      F.track(method === 0 ? 'sale/cash' : method === 1 ? 'sale/card' : 'sale/reissue');
      await F.splash('Done!', F.tix(n) + ' sent to their phone');
      if (!c.backedUp) await F.alertSheet('Remind them to save their backup', 'Their phone hasn\'t saved a backup text yet. Ask them to tap "Save it now" in Fair Tickets.');
      refresh();
    } catch (e) {
      b.close();
      if (e.code === 'TIMEOUT') await F.alertSheet('Still going through', 'The network is slow. Their tickets should appear within a minute. Please don\'t sell them again.');
      else await F.showError(e);
      refresh();
    }
  }

  async function undo(id, times) {
    const s = sales.find((x) => x.id === id);
    if (!s) return;
    const net = s.amount - s.undone;
    const t = times[s.block];
    if (net <= 0n) return F.alertSheet('Already undone', 'This sale has already been fully undone.');
    if (!t || Date.now() - t > info.limits.undoWindow * 1000) return F.alertSheet('Too late to undo', 'Sales can only be undone for ' + Math.round(info.limits.undoWindow / 60) + ' minutes. Ask the organiser to correct it.');
    const r = await F.sheet({
      title: 'Undo this sale?',
      html: '<p>Take back tickets from this sale (' + F.METHODS[s.method] + ', ' + F.tix(s.amount) + '). No family scan is needed.</p>' +
        '<label class="field"><span>Tickets to take back</span><input class="input money" id="uAmt" type="number" inputmode="decimal" min="0" step="0.5" value="' + F.num(net) + '"></label>' +
        '<p class="small muted">If they paid too little, take back the extra. If the whole sale was a mistake, take it all back.</p>',
      buttons: [{ label: 'Undo', value: true, submit: true, style: 'danger' }, { label: 'Cancel', value: false, style: 'secondary' }],
      validate: (ov) => { const v = Number($('#uAmt', ov).value); return v > 0 && F.units(v) <= net ? null : 'Enter up to ' + F.fmt(net) + ' tickets.'; }
    });
    if (!r.value) return;
    const amt = F.units(Number($('#uAmt', r.el).value));
    const b = F.busy('Undoing…');
    try {
      await F.call('fair', 'undoSale', [id, amt]);
      b.close(); F.track('sale/undo');
      await F.splash('Undone', F.tix(amt) + ' taken back');
      refresh();
    } catch (e) { b.close(); await F.showError(e); }
  }

  $('#otherBtn').onclick = async () => {
    let mode = 'dollars';
    const r = await F.sheet({
      title: 'Other amount',
      html: '<div class="seg" id="mode"><button data-m="dollars" class="on">By money</button><button data-m="tickets">By tickets</button></div>' +
        '<label class="field"><span id="amtLabel">Money received (' + esc(F.CFG.currency) + ')</span><input class="input money" id="amt" type="number" inputmode="decimal" min="0" step="0.5" placeholder="0"></label><p class="center muted" id="amtCalc">&nbsp;</p>',
      buttons: [{ label: 'Next', value: true, submit: true }, { label: 'Cancel', value: false, style: 'secondary' }],
      onOpen: (ov) => {
        const calc = () => { const v = Number($('#amt', ov).value) || 0; $('#amtCalc', ov).textContent = v ? (mode === 'dollars' ? '= ' + F.tix(ticketsFor(v)) : '= ' + F.dollars(v * cents() / 100)) : ' '; };
        $$('#mode button', ov).forEach((b) => (b.onclick = () => { mode = b.dataset.m; $$('#mode button', ov).forEach((x) => x.classList.toggle('on', x === b)); $('#amtLabel', ov).textContent = mode === 'dollars' ? 'Money received (' + F.CFG.currency + ')' : 'Number of tickets'; calc(); }));
        $('#amt', ov).oninput = calc;
      },
      validate: (ov) => (Number($('#amt', ov).value) > 0 ? null : 'Enter an amount.')
    });
    if (!r.value) return;
    const v = Number($('#amt', r.el).value);
    if (mode === 'dollars') sell(v); else sell(Math.round(v * cents()) / 100, v);
  };

  // ---------------------------------------------------------------- totals
  async function openTotals() {
    await loadSales();
    const t = totals();
    $('#cCash').textContent = F.dollars(t.cash);
    $('#cCard').textContent = F.dollars(t.card);
    $('#cReissue').textContent = F.fmt(t.reissue);
    $('#cSales').textContent = t.n;
    const times = await F.blockTimes(sales.slice(0, 40).map((s) => s.block));
    $('#allList').innerHTML = sales.length ? (await Promise.all(sales.map((s) => saleRow(s, times)))).join('') : '<li class="empty">No sales yet.</li>';
    F.showView('totals');
  }
  $('#totalsBtn').onclick = openTotals;
  $('#closedTotals').onclick = openTotals;

  // ---------------------------------------------------------------- misc
  const showCode = () => {
    $('#myQr').innerHTML = F.qrSvg(S.myCode('booth'));
    F.showView('mycode');
    S.waitUntilAdded('booth', $('[data-view="mycode"]')).then((ok) => { if (ok && document.body.dataset.current === 'mycode') { F.splash('You\'re in!', 'This booth is ready to sell.'); home(); } });
  };
  $('#showCode').onclick = showCode;
  $$('[data-home]').forEach((b) => (b.onclick = () => (info.isOpen ? home() : F.showView('closed'))));
  $('#boothName').textContent = F.store.get('booth.name', 'Ticket booth');
  $('#settingsBtn').onclick = () => F.openSettings(
    '<button class="btn secondary" data-x="code">Show this phone\'s code</button><button class="btn secondary" data-x="name">Name this booth</button><button class="btn secondary" data-x="return">Return leftover XDC</button>',
    (ov, act) => { $('[data-x="code"]', ov).onclick = () => act('code'); $('[data-x="name"]', ov).onclick = () => act('name'); $('[data-x="return"]', ov).onclick = () => act('return'); }
  ).then(async (a) => {
    if (a === 'code') showCode();
    if (a === 'return') S.returnLeftover(null, true);
    if (a === 'name') {
      const r = await F.sheet({ title: 'Name this booth', html: '<label class="field"><input class="input" id="nm" maxlength="30" value="' + esc(F.store.get('booth.name', 'Ticket booth')) + '"></label>', buttons: [{ label: 'Save', value: true, submit: true }, { label: 'Cancel', value: false, style: 'secondary' }], validate: (ov) => ($('#nm', ov).value.trim() ? null : 'Enter a name.') });
      if (r.value) { F.store.set('booth.name', $('#nm', r.el).value.trim()); $('#boothName').textContent = F.store.get('booth.name'); }
    }
  });

  // Keep the price, limits and open state current.
  setInterval(async () => {
    try {
      const before = cents();
      info = await F.loadInfo(true);
      if (cents() !== before) { renderQuick(); F.toast('Ticket price is now ' + F.dollars(cents() / 100), 'ok'); }
      if (!info.isOpen && document.body.dataset.current !== 'closed') { F.showView('closed'); S.returnLeftover($('#returnNote')); }
    } catch (e) { }
  }, 60000);
  setInterval(() => { if (document.visibilityState === 'visible' && document.body.dataset.current === 'home') refresh(); }, 15000);

  info = await F.loadInfo(true).catch(() => info);
  if (!info.isOpen) { F.showView('closed'); S.returnLeftover($('#returnNote')); return; }
  home();
})();
