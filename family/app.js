/* Fair Tickets: family app. Shows the rotating ticket code, tickets left and recent activity. */
(async function () {
  'use strict';
  const F = window.Fair;
  const { $, $$, esc } = F;

  F.$('#settingsBtn').innerHTML = F.ICON.gear;
  await F.start('family');

  // Only fairs created by Fair Tickets are accepted.
  if ((await F.isOfficial()) === false) { F.showView('unofficial'); return; }

  const info = F.state.info;
  const fresh = !F.myAddress();

  // ---------------------------------------------------------------- first-run wizard
  if (fresh) {
    await F.wizard('setup', [
      {
        id: 'welcome',
        render: () => ({
          noBack: true, next: false,
          title: 'Your fair tickets, on your phone',
          html: '<img class="appicon" src="../icons/family-192.png" alt="">' +
            '<p class="center"><b>' + esc(info ? info.name : '') + '</b></p>' +
            '<p>Buy tickets at the ticket booth with cash or card, then show your code at any stall. No paper to lose.</p>' +
            '<button class="btn huge" data-new>Get started</button><button class="btn secondary" data-restore>I\'ve used this before</button>' +
            '<p class="small muted">No app download and no sign-up. Please don\'t use a private or incognito tab, as it forgets your tickets when closed.</p>',
          onOpen: (el, data, go) => {
            $('[data-new]', el).onclick = () => { F.newAccount(); F.track('family/setup'); go(1); };
            $('[data-restore]', el).onclick = async () => { if (await F.restoreSheet()) { F.syncUrl(); location.reload(); } };
          }
        })
      },
      {
        id: 'group', skip: () => !info || !info.groups.length,
        render: (data) => ({
          title: 'Which house or class are you supporting?',
          html: '<p class="muted">Your tickets count towards their total on the leaderboard.</p>' +
            info.groups.map((g) => '<button class="group-btn' + (data.group === g.id ? ' on' : '') + '" data-g="' + g.id + '"><span class="swatch" style="background:' + g.colour + '"></span>' + esc(g.name) + '</button>').join('') +
            '<button class="link" data-none>Skip this</button>',
          next: 'Continue',
          onOpen: (el, d, go) => {
            $$('[data-g]', el).forEach((b) => (b.onclick = () => { d.group = Number(b.dataset.g); $$('[data-g]', el).forEach((x) => x.classList.toggle('on', x === b)); }));
            $('[data-none]', el).onclick = () => { d.group = 0; go(1); };
          }
        })
      },
      F.Steps.backup(),
      {
        id: 'done',
        render: () => ({ title: 'You\'re all set', html: '<p>Show your ticket code at the <b>ticket booth</b> to buy tickets. Then show it at any <b>stall</b> to use them.</p><p class="muted">The code changes every 30 seconds, so a photo of it won\'t work for anyone else.</p>', next: 'Show my ticket code' })
      }
    ]).then((data) => { if (data.group != null) F.fstore.set('group', data.group); });
  }

  // ---------------------------------------------------------------- state
  let balance = null;
  let group = F.fstore.get('group', 0) || 0;
  try { const g = Number(await F.state.fair.groupOf(F.myAddress())); if (g) { group = g; F.fstore.set('group', g); } } catch (e) { }
  let rows = [];

  function renderBalance() {
    if (balance === null) return;
    $('#bal').textContent = F.fmt(balance);
    $('#balUnit').textContent = F.ticketWord(balance);
    const low = F.CFG.defaults.lowTickets;
    $('#lowNote').hidden = !(F.num(balance) < low && rows.length > 0);
    const g = F.groupById(group);
    $('#groupPill').hidden = !g;
    if (g) $('#groupPill').innerHTML = '<span class="pill"><span class="swatch" style="background:' + g.colour + '"></span>' + esc(g.name) + '</span>';
  }
  function row(r, times) {
    const t = times[r.block];
    return '<li><div class="ico">' + (r.incoming ? F.ICON.ticket : F.ICON.bag) + '</div><div class="grow"><b>' + esc(r.title) + '</b><span>' + (t ? F.timeStr(t) : '') + '</span></div>' +
      '<div class="amt ' + (r.incoming ? 'plus' : 'minus') + '">' + (r.incoming ? '+' : '−') + F.fmt(r.amount) + '</div></li>';
  }
  async function renderHistory() {
    const times = await F.blockTimes(rows.slice(0, 40).map((r) => r.block));
    $('#recent').innerHTML = rows.length ? rows.slice(0, 5).map((r) => row(r, times)).join('') : '<li class="empty">Nothing yet. Show your code at the ticket booth to get started.</li>';
    $('#allBtn').hidden = rows.length <= 5;
    $('#allList').innerHTML = rows.length ? rows.map((r) => row(r, times)).join('') : '<li class="empty">Nothing yet.</li>';
    if ($('#closedList')) $('#closedList').innerHTML = $('#allList').innerHTML;
  }
  async function refreshHistory() { try { rows = await F.activityFor(F.myAddress()); await renderHistory(); } catch (e) { } }

  // ---------------------------------------------------------------- rotating code
  let codeTimer = null, codeExpires = 0;
  async function drawCode() {
    try {
      const c = await F.makeFamilyCode(group, F.hasBackedUp() ? 'b' : '');
      $('#qr').innerHTML = F.qrSvg(c.text);
      codeExpires = c.time + 30;
    } catch (e) { $('#qr').innerHTML = '<p class="center muted">Can\'t show your code right now.</p>'; }
  }
  function tickCode() {
    const left = codeExpires - F.chainNow();
    const bar = $('#qrTimer'); if (bar) bar.style.width = Math.max(0, Math.min(100, (left / 30) * 100)) + '%';
    if (left <= 0) drawCode();
  }

  // ---------------------------------------------------------------- views
  async function home() {
    $('#backupNag').hidden = F.hasBackedUp();
    const p = F.platform();
    $('#installTip').hidden = !(p.mobile && !p.inApp && !F.isStandalone() && F.hasBackedUp() && !F.store.get('family.installTipDone') && rows.length);
    renderBalance();
    F.showView('home');
    await drawCode();
    clearInterval(codeTimer); codeTimer = setInterval(tickCode, 1000);
  }
  async function closed() {
    clearInterval(codeTimer);
    const left = balance || 0n;
    $('#closedMsg').textContent = left > 0n
      ? 'Your ' + F.tix(left) + ' left over stay with ' + info.name + ' as part of what was raised. Thank you for supporting the fair!'
      : 'Thank you for supporting ' + info.name + '!';
    const g = F.groupById(group);
    $('#closedGroup').innerHTML = g ? '<span class="pill"><span class="swatch" style="background:' + g.colour + '"></span>You supported ' + esc(g.name) + '</span>' : '';
    $('#tallyLink').href = F.appUrl('tally');
    F.showView('closed');
  }

  // ---------------------------------------------------------------- watch for changes
  async function poll(first) {
    try {
      const b = await F.ticketBalance();
      if (balance !== null && b !== balance) {
        const diff = b - balance;
        await refreshHistory();
        if (diff > 0n) {
          const r = rows[0];
          F.splash('+' + F.tix(diff), r && r.title ? r.title : 'Tickets received');
          if (!group) { try { const g = Number(await F.state.fair.groupOf(F.myAddress())); if (g) { group = g; F.fstore.set('group', g); } } catch (e) { } }
        } else {
          const r = rows[0];
          F.chime(true);
          F.toast('−' + F.tix(-diff) + (r ? ' · ' + r.title : ''), 'ok');
        }
        drawCode(); // a fresh code after every change
      }
      balance = b;
      renderBalance();
      if (first) await refreshHistory();
    } catch (e) { }
  }
  await poll(true);

  try { await F.loadInfo(true); } catch (e) { }
  if (!F.state.info.isOpen) { await closed(); return; }
  await home();

  setInterval(async () => {
    if (document.visibilityState !== 'visible') return;
    await poll(false);
  }, 4000);
  setInterval(async () => {
    try { await F.loadInfo(true); if (!F.state.info.isOpen) closed(); } catch (e) { }
  }, 60000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { F.syncClock(); drawCode(); poll(false); } });

  // ---------------------------------------------------------------- buttons
  $('#settingsBtn').onclick = () => F.openSettings();
  $('#backupNow').onclick = async () => { await F.backupSheet(); home(); };
  $('#allBtn').onclick = () => F.showView('history');
  $$('[data-home]').forEach((b) => (b.onclick = home));
  $('#installTipX').onclick = () => { F.store.set('family.installTipDone', Date.now()); $('#installTip').hidden = true; };
  $('#installTipGo').onclick = () => F.sheet({
    title: 'Add to your home screen',
    html: '<p class="muted">Optional. It just makes the app quicker to find today.' + (F.platform().ios ? ' On iPhone the home-screen app starts empty: open it, then tap the link in your backup text to bring your tickets across.' : '') + '</p>' + F.installHow(F.APPS.family),
    buttons: [{ label: 'Close', value: null, style: 'secondary' }],
    onOpen: (ov) => F.wireNativeInstall(ov, () => { ov.remove(); F.toast('Added!', 'ok'); })
  });
})();
