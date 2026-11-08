/* Fair Tickets: stall app. Charges a family's ticket code and refunds its own charges. */
(async function () {
  'use strict';
  const F = window.Fair, S = window.Staff;
  const { $, $$, esc } = F;

  $('#settingsBtn').innerHTML = F.ICON.gear;
  await F.start('stall', { fairHint: 'Open the stall link the organiser sent you, or scan the fair\'s QR code.' });
  if ((await F.isOfficial()) === false) { F.alertSheet('Not an official fair', 'This link wasn\'t made by Fair Tickets. Ask the organiser for the right link.'); return; }

  const stallName = () => F.store.get('stall.name', '');
  await S.setup('stall', [{
    id: 'name',
    render: () => ({
      title: 'What\'s your stall called?',
      html: '<p class="muted">Families see this name when you charge them.</p><label class="field"><input class="input" id="nm" maxlength="30" placeholder="e.g. Cake Stall" value="' + esc(stallName()) + '"></label>',
      validate: (el) => { const v = $('#nm', el).value.trim(); if (!v) return 'Enter your stall\'s name.'; F.store.set('stall.name', v); return null; }
    })
  }]);
  F.keepAwake();

  let info = F.state.info;
  let items = F.store.get('stall.items', []);
  let cart = {};
  const me = () => F.myAddress();
  let charges = []; // { id, family, amount, block, refunded }

  // ---------------------------------------------------------------- data
  async function loadCharges() {
    const t = F.topicAddr(me());
    const [ch, rf] = await Promise.all([
      F.logCache('stall.charged.' + me().toLowerCase(), [F.T.Charged, null, t]).update(),
      F.logCache('stall.refunded.' + me().toLowerCase(), [F.T.Refunded, null, t]).update()
    ]);
    const r = {};
    rf.map(F.parse).forEach((e) => { const id = e.args.id.toString(); r[id] = (r[id] || 0n) + e.args.amount; });
    charges = ch.map(F.parse).map((e) => ({ id: e.args.id, family: e.args.family, amount: e.args.amount, block: e.block, refunded: r[e.args.id.toString()] || 0n }));
    charges.sort((a, b) => b.block - a.block);
  }

  // ---------------------------------------------------------------- selling screen
  const cartTotal = () => Object.entries(cart).reduce((s, [i, q]) => s + (items[i] ? items[i].price * q : 0), 0);
  const cartLabel = () => Object.entries(cart).filter(([i, q]) => q > 0 && items[i]).map(([i, q]) => q + '× ' + items[i].name).join(', ');
  function renderSell() {
    $('#noItems').hidden = items.length > 0;
    $('#items').innerHTML = items.map((it, i) => '<button class="item-btn" data-i="' + i + '"><span class="nm">' + esc(it.name) + '</span><span class="pr">' + F.tix(it.price) + '</span>' + (cart[i] ? '<span class="qty">' + cart[i] + '</span>' : '') + '</button>').join('');
    $$('#items [data-i]').forEach((b) => (b.onclick = () => { const i = b.dataset.i; cart[i] = (cart[i] || 0) + 1; renderSell(); }));
    const lines = Object.entries(cart).filter(([i, q]) => q > 0 && items[i]);
    $('#cartCard').hidden = !lines.length;
    $('#cart').innerHTML = lines.map(([i, q]) => '<li><div class="grow"><b>' + esc(items[i].name) + '</b><span>' + F.tix(items[i].price) + ' each</span></div><button class="btn secondary small" data-minus="' + i + '">−</button><b style="min-width:26px;text-align:center">' + q + '</b><button class="btn secondary small" data-plus="' + i + '">+</button></li>').join('');
    $$('[data-minus]').forEach((b) => (b.onclick = () => { const i = b.dataset.minus; cart[i]--; if (cart[i] <= 0) delete cart[i]; renderSell(); }));
    $$('[data-plus]').forEach((b) => (b.onclick = () => { cart[b.dataset.plus]++; renderSell(); }));
    const t = cartTotal();
    $('#cartTotal').textContent = F.tix(t);
    $('#chargeBtn').disabled = !(t > 0);
    $('#chargeBtn').innerHTML = t > 0 ? F.ICON.camera + ' Charge ' + esc(F.tix(t)) : 'Tap items to start a sale';
  }
  async function renderRecent() {
    const times = await F.blockTimes(charges.slice(0, 40).map((c) => c.block));
    const row = (c) => { const t = times[c.block]; return '<li class="tap" data-id="' + c.id + '"><div class="ico">' + F.ICON.bag + '</div><div class="grow"><b>Sale' + (c.refunded > 0n ? ' · refunded ' + F.fmt(c.refunded) : '') + '</b><span>' + (t ? F.timeStr(t) : '') + ' · tap to refund</span></div><div class="amt">' + F.fmt(c.amount) + '</div></li>'; };
    $('#recent').innerHTML = charges.length ? charges.slice(0, 6).map(row).join('') : '<li class="empty">No sales yet.</li>';
    $('#allList').innerHTML = charges.length ? charges.map(row).join('') : '<li class="empty">No sales yet.</li>';
    $$('[data-id]').forEach((li) => (li.onclick = () => refund(BigInt(li.dataset.id))));
  }
  async function refresh() {
    try {
      const role = await S.myRole();
      $('#joinNote').hidden = role === F.ROLES.STALL;
      S.creditCheck($('#creditWarn'));
      await loadCharges(); await renderRecent();
    } catch (e) { }
  }
  function sell() { renderSell(); F.showView('sell'); refresh(); }

  // ---------------------------------------------------------------- charging
  async function charge(n, label) {
    if (!(n > 0)) return;
    const amount = F.units(n);
    if (amount > BigInt(info.limits.maxCharge)) return F.alertSheet('Over the charge limit', 'One charge can be up to ' + F.tix(BigInt(info.limits.maxCharge)) + '. Split it into two charges.');
    const c = await F.scan({
      title: 'Scan their ticket code', hint: F.tix(n) + (label ? ' · ' + label : ''),
      check: (p) => (p.kind !== 'F' ? 'That\'s not a family ticket code. Ask them to open Fair Tickets.' : F.checkFamilyCode(p))
    });
    if (!c) return;
    let bal = null;
    try { bal = await F.ticketBalance(c.address); } catch (e) { }
    if (bal !== null && bal < amount) return F.alertSheet('Not enough tickets', 'They have ' + F.tix(bal) + '. They can buy more at the ticket booth.');
    const ok = await F.confirmSheet('Charge ' + F.tix(n) + '?', (label ? esc(label) + '<br>' : '') + (bal !== null ? 'They\'ll have <b>' + F.tix(bal - amount) + '</b> left.' : ''), 'Charge ' + F.tix(n), 'Cancel');
    if (!ok) return;
    const b = F.busy('Charging…');
    try {
      await F.call('fair', 'charge', [c.address, c.codeTime, c.nonce, c.group, c.r, c.vs, amount]);
      b.close(); F.track('charge/done');
      cart = {};
      await F.splash('PAID', F.tix(n) + (label ? ' · ' + label : ''), true, 2200);
      sell();
    } catch (e) {
      b.close();
      if (e.code === 'TIMEOUT') await F.alertSheet('Still going through', 'The network is slow. Watch for it in Recent before charging again.');
      else await F.showError(e);
      refresh();
    }
  }
  $('#chargeBtn').onclick = () => charge(cartTotal(), cartLabel());
  $('#clearBtn').onclick = () => { cart = {}; renderSell(); };
  $('#customBtn').onclick = async () => {
    const r = await F.sheet({
      title: 'Type an amount',
      html: '<label class="field"><span>Tickets to charge</span><input class="input money" id="amt" type="number" inputmode="decimal" min="0" step="0.5" placeholder="0"></label>',
      buttons: [{ label: 'Charge', value: true, submit: true }, { label: 'Cancel', value: false, style: 'secondary' }],
      validate: (ov) => (Number($('#amt', ov).value) > 0 ? null : 'Enter how many tickets.')
    });
    if (r.value) charge(Number($('#amt', r.el).value), '');
  };

  // ---------------------------------------------------------------- refunds
  async function refund(id) {
    const c = charges.find((x) => x.id === id);
    if (!c) return;
    const left = c.amount - c.refunded;
    if (left <= 0n) return F.alertSheet('Already refunded', 'This sale has already been fully refunded.');
    const r = await F.sheet({
      title: 'Give a refund',
      html: '<p class="muted">Tickets go straight back to the phone that paid. No scan needed.</p><label class="field"><span>Tickets to refund</span><input class="input money" id="rf" type="number" inputmode="decimal" min="0" step="0.5" value="' + F.num(left) + '"></label>',
      buttons: [{ label: 'Refund', value: true, submit: true }, { label: 'Cancel', value: false, style: 'secondary' }],
      validate: (ov) => { const v = Number($('#rf', ov).value); return v > 0 && F.units(v) <= left ? null : 'Enter up to ' + F.fmt(left) + ' tickets.'; }
    });
    if (!r.value) return;
    const amt = F.units(Number($('#rf', r.el).value));
    const b = F.busy('Refunding…');
    try { await F.call('fair', 'refund', [id, amt]); b.close(); F.track('charge/refund'); await F.splash('Refunded', F.tix(amt) + ' returned'); refresh(); }
    catch (e) { b.close(); await F.showError(e); }
  }

  // ---------------------------------------------------------------- items editor
  function renderMenu() {
    $('#menuList').innerHTML = items.length ? items.map((it, i) => '<li><div class="grow"><b>' + esc(it.name) + '</b><span>' + F.tix(it.price) + '</span></div><button class="btn secondary small" data-up="' + i + '"' + (i === 0 ? ' disabled' : '') + '>↑</button><button class="btn danger small" data-del="' + i + '">Remove</button></li>').join('') : '<li class="empty">No items yet.</li>';
    $$('[data-del]').forEach((b) => (b.onclick = () => { items.splice(Number(b.dataset.del), 1); save(); }));
    $$('[data-up]').forEach((b) => (b.onclick = () => { const i = Number(b.dataset.up); [items[i - 1], items[i]] = [items[i], items[i - 1]]; save(); }));
  }
  function save() { F.store.set('stall.items', items); cart = {}; renderMenu(); }
  $('#addItem').onclick = () => {
    const name = $('#newName').value.trim();
    const price = Math.round(Number($('#newPrice').value) * 100) / 100;
    if (!name) return F.toast('Enter the item name', 'bad');
    if (!(price > 0)) return F.toast('Enter a price in tickets', 'bad');
    items.push({ name, price }); $('#newName').value = ''; $('#newPrice').value = ''; save(); F.toast('Added ' + name, 'ok');
  };
  const openMenu = () => { renderMenu(); F.showView('menu'); };
  $('#menuBtn').onclick = openMenu; $('#addFirst').onclick = openMenu;

  // ---------------------------------------------------------------- today
  async function openToday() {
    await loadCharges();
    const taken = charges.reduce((s, c) => s + c.amount, 0n), refunded = charges.reduce((s, c) => s + c.refunded, 0n);
    $('#sTaken').textContent = F.fmt(taken - refunded);
    $('#sCount').textContent = charges.length;
    $('#sRefunded').textContent = F.fmt(refunded);
    $('#sHeld').textContent = '…';
    await renderRecent();
    F.showView('today');
    try { $('#sHeld').textContent = F.fmt(await F.ticketBalance()); } catch (e) { $('#sHeld').textContent = '?'; }
  }
  $('#todayBtn').onclick = openToday; $('#closedToday').onclick = openToday;

  // ---------------------------------------------------------------- misc
  const showCode = () => {
    $('#myQr').innerHTML = F.qrSvg(S.myCode('stall'));
    F.showView('mycode');
    S.waitUntilAdded('stall', $('[data-view="mycode"]')).then((ok) => { if (ok && document.body.dataset.current === 'mycode') { F.splash('You\'re in!', 'Your stall is ready.'); sell(); } });
  };
  $('#showCode').onclick = showCode;
  $$('[data-sell]').forEach((b) => (b.onclick = () => (info.isOpen ? sell() : F.showView('closed'))));
  $('#stallName').textContent = stallName() || 'Fair Stall';
  $('#settingsBtn').onclick = () => F.openSettings(
    '<button class="btn secondary" data-x="code">Show this phone\'s code</button><button class="btn secondary" data-x="name">Change stall name</button><button class="btn secondary" data-x="return">Return leftover XDC</button>',
    (ov, act) => { $('[data-x="code"]', ov).onclick = () => act('code'); $('[data-x="name"]', ov).onclick = () => act('name'); $('[data-x="return"]', ov).onclick = () => act('return'); }
  ).then(async (a) => {
    if (a === 'code') showCode();
    if (a === 'return') S.returnLeftover(null, true);
    if (a === 'name') {
      const r = await F.sheet({ title: 'Stall name', html: '<p class="muted">Ask the organiser to update it too, so families see the new name.</p><label class="field"><input class="input" id="nm" maxlength="30" value="' + esc(stallName()) + '"></label>', buttons: [{ label: 'Save', value: true, submit: true }, { label: 'Cancel', value: false, style: 'secondary' }], validate: (ov) => ($('#nm', ov).value.trim() ? null : 'Enter a name.') });
      if (r.value) { F.store.set('stall.name', $('#nm', r.el).value.trim()); $('#stallName').textContent = stallName(); }
    }
  });

  setInterval(async () => {
    try { info = await F.loadInfo(true); if (!info.isOpen && document.body.dataset.current !== 'closed') { F.showView('closed'); S.returnLeftover($('#returnNote')); } } catch (e) { }
  }, 60000);
  setInterval(() => { if (document.visibilityState === 'visible' && document.body.dataset.current === 'sell') refresh(); }, 15000);

  info = await F.loadInfo(true).catch(() => info);
  if (!info.isOpen) { F.showView('closed'); S.returnLeftover($('#returnNote')); return; }
  sell();
  if (!items.length && !F.store.get('stall.menuSeen')) { F.store.set('stall.menuSeen', 1); openMenu(); }
})();
