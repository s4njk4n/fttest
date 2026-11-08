/* Fair Tickets: organiser app. Sets up the fair, the team, corrections, reports and closing. */
(async function () {
  'use strict';
  const F = window.Fair;
  const { $, $$, esc } = F;
  const D = F.CFG.defaults;

  $('#settingsBtn').innerHTML = F.ICON.gear;
  await F.start('organiser', { needsFair: false });

  const isMine = () => F.state.info && F.myAddress() && F.sameAddr(F.state.info.organiser, F.myAddress());

  if (!F.fairAddress() || !F.myAddress() || !isMine()) {
    if (F.fairAddress() && F.myAddress() && F.state.info && !isMine()) {
      const ok = await F.confirmSheet('This phone isn\'t this fair\'s organiser', 'This fair was set up on another phone. To manage it here, restore that phone\'s backup message. Or set up a new fair on this phone.', 'Set up a new fair', 'Restore a backup');
      if (!ok) { if (await F.restoreSheet()) { location.reload(); } return; }
      F.setFair('');
    }
    await createWizard();
    return location.reload();
  }
  F.store.del('organiser.wizard.create');
  dashboard();

  // ================================================================ create a fair
  async function xdcNeeded(d) {
    const helpers = (Number(d.booths) || 0) + (Number(d.stalls) || 0);
    return Number(F.CFG.staffCredit) * helpers + Number(F.CFG.organiserCredit);
  }
  function addXdcHtml() {
    return '<div class="qr">' + F.qrSvg(F.xdcAddr(F.myAddress())) + '</div>' +
      '<p class="mono center">' + esc(F.xdcAddr(F.myAddress())) + '</p>' +
      '<div class="grid2"><button class="btn secondary" data-copyaddr>Copy address</button><a class="btn" href="' + esc(F.CFG.buyUrl) + '" target="_blank" rel="noopener" data-buy>Buy XDC</a></div>' +
      '<p class="small muted">Buy XDC at ' + esc(F.CFG.buyName) + ' and paste this address when it asks where to send it. Or ask someone who already holds XDC to send some here.</p>';
  }
  function wireAddXdc(el) {
    const c = $('[data-copyaddr]', el); if (c) c.onclick = () => F.copyText(F.xdcAddr(F.myAddress()));
    const b = $('[data-buy]', el); if (b) b.onclick = () => F.track('fair/buy-xdc-clicked');
  }

  function createWizard() {
    const today = new Date(); const iso = today.toISOString().slice(0, 10);
    return F.wizard('create', [
      {
        id: 'welcome',
        render: (d) => ({
          noBack: true,
          title: 'Set up your fair',
          html: '<img class="appicon" src="../icons/organiser-192.png" alt="">' +
            '<p>It takes about ten minutes. You\'ll name the fair, set the ticket price, add a little XDC for network fees, and get links for your helpers and families.</p>' +
            '<div class="seg" id="netSeg"><button data-n="50" class="' + (d.net === 51 ? '' : 'on') + '">Real fair</button><button data-n="51" class="' + (d.net === 51 ? 'on' : '') + '">Practice fair</button></div>' +
            '<p class="small muted" id="netNote"></p>' +
            '<label class="check"><input type="checkbox" id="terms"' + (d.terms ? ' checked' : '') + '> <span>I\'ve read the <a href="../terms.html" target="_blank">Terms of Use</a>.</span></label>' +
            '<button class="link" data-restore>I\'ve set up a fair before (restore my backup)</button>',
          next: 'Start',
          onOpen: (el) => {
            const note = () => { $('#netNote', el).textContent = d.net === 51 ? 'Practice fairs use a test network with free pretend XDC, so you can try everything first.' : 'A real fair uses the XDC Network. You\'ll need a few dollars\' worth of XDC for network fees.'; };
            d.net = d.net || (F.network().dev ? null : 50); note();
            $$('[data-n]', el).forEach((b) => (b.onclick = () => { d.net = Number(b.dataset.n); $$('[data-n]', el).forEach((x) => x.classList.toggle('on', x === b)); note(); }));
            $('[data-restore]', el).onclick = async () => { if (await F.restoreSheet()) location.reload(); };
          },
          validate: async (el) => {
            if (!$('#terms', el).checked) return 'Please read and tick the Terms of Use.';
            d.terms = true;
            if (!F.network().dev) { F.store.set('net', d.net || 50); }
            if (!F.network().factory) return 'Fair Tickets isn\'t available on this network yet. Please try again later or contact XDC Outpost.';
            if (!F.myAddress()) F.newAccount();
            await F.connect(); F.loadWallet();
            F.track('fair/organiser-setup');
            return null;
          }
        })
      },
      {
        id: 'name',
        render: (d) => ({
          title: 'Name and date',
          html: '<label class="field"><span>Fair name</span><input class="input" id="nm" maxlength="60" placeholder="e.g. St Example\'s Spring Fair" value="' + esc(d.name || '') + '"><span class="hint">Families and helpers see this name.</span></label>' +
            '<label class="field"><span>Date of the fair</span><input class="input" id="dt" type="date" value="' + esc(d.date || iso) + '"><span class="hint">The fair closes itself at midnight at the end of this day.</span></label>',
          validate: (el) => {
            const n = $('#nm', el).value.trim(), dt = $('#dt', el).value;
            if (!n) return 'Enter the fair\'s name.';
            if (!dt) return 'Choose the date.';
            const end = new Date(dt + 'T23:59:59');
            if (end.getTime() < Date.now()) return 'Choose today or a future date.';
            d.name = n; d.date = dt; return null;
          }
        })
      },
      {
        id: 'price',
        render: (d) => ({
          title: 'Ticket price',
          html: '<label class="field"><span>Price of one ticket (' + esc(F.CFG.currency) + ')</span><input class="input money" id="pr" type="number" inputmode="decimal" min="0.05" step="0.05" value="' + (d.price || '1.00') + '"></label>' +
            '<p class="muted">Most fairs use ' + F.dollars(1) + ' a ticket. Stalls price their items in tickets.</p>',
          validate: (el) => { const v = Number($('#pr', el).value); if (!(v >= 0.05)) return 'Enter a price of at least ' + F.dollars(0.05) + '.'; d.price = v.toFixed(2); return null; }
        })
      },
      {
        id: 'tickets',
        render: (d) => ({
          title: 'How many tickets?',
          html: '<label class="field"><span>Tickets to create</span><input class="input money" id="tk" type="number" inputmode="numeric" min="100" step="100" value="' + (d.tickets || 20000) + '"><span class="hint">Make plenty: unsold tickets cost nothing. This can\'t be increased later.</span></label>',
          validate: (el) => { const v = Math.floor(Number($('#tk', el).value)); if (!(v >= 100)) return 'Create at least 100 tickets.'; d.tickets = v; return null; }
        })
      },
      {
        id: 'groups',
        render: (d) => {
          d.groups = d.groups || [];
          const rows = () => d.groups.map((g, i) => '<div class="card flat"><div class="row"><input class="input" data-gname="' + i + '" value="' + esc(g.name) + '" placeholder="House or class name"><button class="btn danger small" data-gdel="' + i + '">✕</button></div>' +
            '<div class="swatches">' + F.PALETTE.map(([n, c]) => '<button title="' + n + '" style="background:' + F.colourHex(c) + '" data-gi="' + i + '" data-c="' + c + '" class="' + (g.colour === c ? 'on' : '') + '"></button>').join('') + '</div></div>').join('');
          return {
            title: 'Houses or classes (optional)',
            html: '<p class="muted">Families pick one when they start, and a live leaderboard shows tickets bought by each. Skip this if you don\'t want it.</p><div id="glist">' + rows() + '</div><button class="btn secondary" data-gadd>Add a house or class</button>',
            next: d.groups.length ? 'Next' : 'Skip',
            onOpen: (el) => {
              const rerender = () => { $('#glist', el).innerHTML = rows(); wire(); $('[data-next]', el).textContent = d.groups.length ? 'Next' : 'Skip'; };
              function wire() {
                $$('[data-gname]', el).forEach((inp) => (inp.oninput = () => { d.groups[Number(inp.dataset.gname)].name = inp.value; }));
                $$('[data-gdel]', el).forEach((b) => (b.onclick = () => { d.groups.splice(Number(b.dataset.gdel), 1); rerender(); }));
                $$('[data-gi]', el).forEach((b) => (b.onclick = () => { d.groups[Number(b.dataset.gi)].colour = Number(b.dataset.c); rerender(); }));
              }
              wire();
              $('[data-gadd]', el).onclick = () => { if (d.groups.length >= 20) return; d.groups.push({ name: '', colour: F.PALETTE[d.groups.length % F.PALETTE.length][1] }); rerender(); };
            },
            validate: () => { d.groups = d.groups.filter((g) => g.name.trim()).map((g) => ({ name: g.name.trim().slice(0, 30), colour: g.colour })); return null; }
          };
        }
      },
      {
        id: 'limits',
        render: (d) => {
          d.limits = d.limits || { maxSale: D.maxSaleTickets, maxCharge: D.maxChargeTickets, undoMin: D.undoMinutes };
          return {
            title: 'Safety limits',
            html: '<p class="muted">These keep mistakes small. The defaults suit most fairs, and you can change them later.</p>' +
              '<label class="field"><span>Most tickets in one booth sale</span><input class="input" id="ms" type="number" min="1" value="' + d.limits.maxSale + '"></label>' +
              '<label class="field"><span>Most tickets in one stall charge</span><input class="input" id="mc" type="number" min="1" value="' + d.limits.maxCharge + '"></label>' +
              '<label class="field"><span>Minutes a booth can undo a sale</span><input class="input" id="um" type="number" min="1" max="120" value="' + d.limits.undoMin + '"></label>',
            validate: (el) => {
              const ms = Number($('#ms', el).value), mc = Number($('#mc', el).value), um = Number($('#um', el).value);
              if (!(ms > 0 && mc > 0 && um > 0)) return 'Each limit must be more than zero.';
              d.limits = { maxSale: ms, maxCharge: mc, undoMin: Math.min(120, um) }; return null;
            }
          };
        }
      },
      {
        id: 'helpers',
        render: (d) => ({
          title: 'How many helper phones?',
          html: '<p class="muted">This works out how much XDC to add. Each helper phone gets ' + esc(F.CFG.staffCredit) + ' XDC for network fees, and what\'s left comes back after the fair.</p>' +
            '<div class="grid2"><label class="field"><span>Ticket booths</span><input class="input money" id="bo" type="number" min="1" value="' + (d.booths || 1) + '"></label><label class="field"><span>Stalls</span><input class="input money" id="st" type="number" min="0" value="' + (d.stalls != null ? d.stalls : 10) + '"></label></div>',
          validate: (el) => { d.booths = Math.max(1, Math.floor(Number($('#bo', el).value) || 1)); d.stalls = Math.max(0, Math.floor(Number($('#st', el).value) || 0)); return null; }
        })
      },
      {
        id: 'xdc',
        render: async (d) => {
          const need = await xdcNeeded(d);
          return {
            title: 'Add XDC for network fees',
            html: '<p>Send about <b>' + need + ' XDC</b> to this fair\'s organiser account. That\'s usually a few dollars\' worth, and most of it comes back after the fair.</p>' +
              (F.isPractice() ? '<div class="notice info">Practice fair: get free test XDC from the <a href="https://faucet.apothem.network" target="_blank" rel="noopener">Apothem faucet</a> and paste this address there.</div>' : '') +
              addXdcHtml() + '<div class="card flat center"><div class="muted small">Received so far</div><div style="font-size:1.6rem;font-weight:600" id="got">…</div></div>',
            next: 'Continue',
            onOpen: (el) => {
              wireAddXdc(el);
              const tick = async () => { if (!el.isConnected || !$('#got', el)) return; try { $('#got', el).textContent = F.xdc(await F.creditBalance()) + ' XDC'; } catch (e) { } setTimeout(tick, 4000); };
              tick();
            },
            validate: async () => {
              const bal = await F.creditBalance().catch(() => 0n);
              if (bal < F.ethers.parseEther('1')) return 'Waiting for XDC to arrive. It usually takes under a minute after sending.';
              if (bal < F.ethers.parseEther(String(need))) {
                const ok = await F.confirmSheet('Less than suggested', 'You have ' + F.xdc(bal) + ' XDC. That\'s enough to start, but you may need more to load all your helper phones.', 'Continue anyway', 'Wait for more');
                return ok ? null : ' ';
              }
              return null;
            }
          };
        }
      },
      {
        id: 'create',
        render: (d) => ({
          title: 'Ready to create your fair',
          html: '<div class="card flat"><b>' + esc(d.name) + '</b><br><span class="muted">' + esc(new Date(d.date + 'T12:00:00').toLocaleDateString()) + ' · ' + F.dollars(d.price) + ' a ticket · ' + Number(d.tickets).toLocaleString() + ' tickets' + (d.groups && d.groups.length ? ' · ' + d.groups.length + ' houses or classes' : '') + '</span></div>' +
            '<p>Your fair\'s tickets live on the XDC Network, a public ledger. That\'s what keeps Fair Tickets free, keeps your totals exact, and lets anyone check them. No family\'s personal details are ever recorded.</p>',
          next: 'Create my fair',
          validate: async () => {
            if (F.fairAddress() && F.state.info && F.sameAddr(F.state.info.organiser, F.myAddress())) return null;
            const b = F.busy('Creating your fair…');
            try {
              const end = Math.floor(new Date(d.date + 'T23:59:59').getTime() / 1000);
              const limits = { maxSale: F.units(d.limits.maxSale), maxCharge: F.units(d.limits.maxCharge), chargesPerMinute: D.chargesPerMinute, undoWindow: d.limits.undoMin * 60, codeWindow: D.codeWindow };
              const r = await F.call('factory', 'createFair', [d.name, F.units(d.tickets), Math.round(Number(d.price) * 100), limits, end, (d.groups || []).map((g) => g.name), (d.groups || []).map((g) => g.colour)], 0n, 6000000n);
              const ev = r.logs.map((l) => { try { return F.factoryIface.parseLog(l); } catch (e) { return null; } }).find((x) => x && x.name === 'FairCreated');
              if (!ev) throw new F.Friendly('Fair not found', 'The fair was created but couldn\'t be read back. Check your connection and reopen the app.');
              F.setFair(ev.args.fair);
              await F.connect(); F.loadWallet(); await F.loadInfo(true);
              F.track('fair/created');
              b.close();
              return null;
            } catch (e) { b.close(); return F.friendly(e).message; }
          }
        })
      },
      F.Steps.backup(),
      {
        id: 'invite',
        render: () => ({
          title: 'Invite your helpers',
          html: '<p>Send each helper the right link. When they open it, their phone shows a code: scan it from your dashboard to add them.</p>' + linkBlock('Ticket booth helpers', 'booth') + linkBlock('Stall helpers', 'stall') + linkBlock('Families', 'family'),
          next: 'Go to my dashboard',
          onOpen: (el) => wireLinks(el)
        })
      }
    ], { net: F.network().dev ? null : F.store.get('net', 50) });
  }

  // ================================================================ links
  function linkBlock(label, role) {
    const url = F.appUrl(role);
    return '<div class="card flat"><div class="row"><b class="grow">' + esc(label) + '</b></div><p class="mono">' + esc(url) + '</p>' +
      '<div class="grid3"><button class="btn secondary small" data-copy="' + esc(url) + '">Copy</button><button class="btn secondary small" data-share="' + esc(url) + '" data-label="' + esc(label) + '">Share</button><button class="btn secondary small" data-qr="' + esc(url) + '">QR code</button></div></div>';
  }
  function wireLinks(el) {
    $$('[data-copy]', el).forEach((b) => (b.onclick = () => F.copyText(b.dataset.copy)));
    $$('[data-share]', el).forEach((b) => (b.onclick = async () => { if (navigator.share) { try { await navigator.share({ title: F.state.info.name + ': ' + b.dataset.label, url: b.dataset.share }); } catch (e) { } } else F.copyText(b.dataset.share); }));
    $$('[data-qr]', el).forEach((b) => (b.onclick = () => F.sheet({ title: 'Scan to open', html: '<div class="qr">' + F.qrSvg(b.dataset.qr) + '</div>', buttons: [{ label: 'Close', value: null, style: 'secondary' }] })));
  }
  function openLinks() {
    $('#linkList').innerHTML = linkBlock('Ticket booth helpers', 'booth') + linkBlock('Stall helpers', 'stall') + linkBlock('Families', 'family') + linkBlock('Live tally screen (for a TV or monitor)', 'tally') +
      '<button class="btn" data-poster>Print the family poster</button>' +
      '<div class="card flat"><b>Parent newsletter note</b><p class="small" id="newsNote"></p><button class="btn secondary small" data-copynews>Copy note</button></div>';
    const note = 'This year ' + F.state.info.name + ' uses Fair Tickets: phone tickets instead of paper. Bring a charged phone, open this link before the day (' + F.appUrl('family') + '), and tap Get started. Buy tickets at the ticket booth with cash or card, then show your code at any stall. No app download or sign-up needed.';
    $('#newsNote').textContent = note;
    $('[data-copynews]').onclick = () => F.copyText(note);
    wireLinks($('#linkList'));
    $('[data-poster]').onclick = poster;
    F.showView('links');
  }
  function poster() {
    const url = F.appUrl('family');
    $('#posterBody').innerHTML = '<div style="max-width:720px;margin:0 auto;text-align:center;padding:20px">' +
      '<h1 style="font-size:2.6rem;margin:0 0 6px">' + esc(F.state.info.name) + '</h1><p style="font-size:1.3rem;color:var(--mist);margin:0 0 20px">Tickets are on your phone today</p>' +
      '<div class="qr" style="max-width:420px">' + F.qrSvg(url) + '</div>' +
      '<ol style="text-align:left;font-size:1.25rem;max-width:520px;margin:20px auto;line-height:1.7"><li>Scan this code with your phone\'s camera.</li><li>Tap <b>Get started</b>. No app download or sign-up.</li><li>Buy tickets at the <b>ticket booth</b> with cash or card.</li><li>Show your code at any <b>stall</b>.</li></ol>' +
      '<p style="margin-top:30px;color:var(--mist)">' + F.BEACON.replace('class="mark"', 'style="width:22px;height:22px;vertical-align:-5px"') + ' Fair Tickets by XDC Outpost · xdcoutpost.xyz</p></div>';
    F.showView('poster');
  }
  $$('[data-links]').forEach((b) => (b.onclick = openLinks));

  // ================================================================ dashboard
  let team = [];
  async function dashboard() {
    const info = F.state.info;
    $('#tallyBtn').href = F.appUrl('tally');
    $('#priceLine').textContent = '1 ticket = ' + F.dollars(info.cents / 100);
    const notes = [];
    if (!info.isOpen) notes.push('<div class="notice warn"><b>This fair has closed.</b> Reports and downloads stay available. Helper phones return their leftover XDC when next opened.</div>');
    if (!F.hasBackedUp()) notes.push('<div class="notice warn"><b>Save your backup.</b> It\'s the only way to manage this fair from another phone.<div><button class="btn small" id="bkNow">Save it now</button></div></div>');
    $('#statusNote').innerHTML = notes.join('');
    const bk = $('#bkNow'); if (bk) bk.onclick = async () => { await F.backupSheet(); dashboard(); };
    $('#closeBtn').hidden = !info.isOpen; $('#addHelperBtn').hidden = !info.isOpen; $('#fixBtn').hidden = !info.isOpen; $('#fairSettingsBtn').hidden = !info.isOpen;
    F.showView('dash');
    try {
      const [x, t] = await Promise.all([F.creditBalance(), F.ticketBalance()]);
      $('#xdcBal').textContent = F.xdc(x); $('#orgTix').textContent = F.fmt(t);
    } catch (e) { }
    await renderTeam();
  }
  async function renderTeam() {
    try { team = (await F.staffList()).filter((m) => m.role !== F.ROLES.NONE); } catch (e) { }
    const rows = await Promise.all(team.map(async (m) => {
      let t = null, x = null;
      try { [t, x] = await Promise.all([F.ticketBalance(m.address), F.creditBalance(m.address)]); } catch (e) { }
      return '<li class="tap" data-m="' + m.address + '"><div class="ico">' + (m.role === F.ROLES.BOOTH ? F.ICON.ticket : F.ICON.bag) + '</div><div class="grow"><b>' + esc(m.name || (m.role === 1 ? 'Ticket booth' : 'Stall')) + (m.featured ? ' ★' : '') + '</b><span>' +
        (m.role === F.ROLES.BOOTH ? 'Ticket booth' : 'Stall') + (x !== null ? ' · ' + F.xdc(x) + ' XDC' : '') + '</span></div><div class="amt">' + (t !== null ? F.fmt(t) : '…') + '<div class="small muted" style="font-weight:400">tickets</div></div></li>';
    }));
    $('#team').innerHTML = rows.length ? rows.join('') : '<li class="empty">No helpers yet. Send them their links, then tap Add a helper.</li>';
    $$('#team [data-m]').forEach((li) => (li.onclick = () => memberActions(team.find((m) => F.sameAddr(m.address, li.dataset.m)))));
  }

  async function act(label, fn, after) {
    const b = F.busy(label);
    try { await fn(); b.close(); if (after) await after(); } catch (e) { b.close(); await F.showError(e); }
    dashboard();
  }

  $('#addHelperBtn').onclick = async () => {
    const c = await F.scan({ title: 'Scan the helper\'s phone', hint: 'They open their link and show the code', check: (p) => (p.kind === 'B' || p.kind === 'S' ? null : 'That\'s not a helper\'s code. Ask them to open the booth or stall link.') });
    if (!c) return;
    const isBooth = c.kind === 'B';
    const r = await F.sheet({
      title: isBooth ? 'Add a ticket booth' : 'Add a stall',
      html: '<label class="field"><span>Name</span><input class="input" id="hn" maxlength="30" value="' + esc(c.name || (isBooth ? 'Ticket booth' : '')) + '" placeholder="e.g. Cake Stall"></label>' +
        (isBooth ? '<label class="field"><span>Tickets to load for selling</span><input class="input" id="ht" type="number" min="0" value="2000"></label>' : '<label class="check"><input type="checkbox" id="hf"> <span>Show this stall on the live tally (good for a donation stall)</span></label>') +
        '<label class="field"><span>XDC for its network fees</span><input class="input" id="hx" type="number" min="0" step="0.5" value="' + esc(F.CFG.staffCredit) + '"></label>',
      buttons: [{ label: 'Add', value: true, submit: true }, { label: 'Cancel', value: false, style: 'secondary' }],
      validate: (ov) => ($('#hn', ov).value.trim() ? null : 'Enter a name.')
    });
    if (!r.value) return;
    const name = $('#hn', r.el).value.trim();
    const tickets = isBooth ? F.units(Math.max(0, Number($('#ht', r.el).value) || 0)) : 0n;
    const featured = !isBooth && $('#hf', r.el).checked;
    const value = F.ethers.parseEther(String(Math.max(0, Number($('#hx', r.el).value) || 0)));
    await act('Adding ' + name + '…', () => F.call('fair', 'setStaff', [c.address, isBooth ? 1 : 2, name, featured, tickets], value), () => F.splash('Added', name + ' is ready'));
  };

  async function memberActions(m) {
    if (!m) return;
    const isBooth = m.role === F.ROLES.BOOTH;
    const r = await F.sheet({
      title: m.name || (isBooth ? 'Ticket booth' : 'Stall'),
      html: '<p class="mono small">' + esc(F.xdcAddr(m.address)) + '</p>',
      buttons: (isBooth ? [{ label: 'Load more tickets', value: 'load' }, { label: 'Take tickets back', value: 'recall', style: 'secondary' }] : [{ label: m.featured ? 'Hide from live tally' : 'Show on live tally', value: 'feature', style: 'secondary' }])
        .concat([{ label: 'Top up XDC', value: 'topup', style: 'secondary' }, { label: 'Rename', value: 'rename', style: 'secondary' }, { label: 'Remove from the team', value: 'remove', style: 'danger' }, { label: 'Close', value: null, style: 'ghost' }])
    });
    const a = r.value; if (!a) return;
    const ask = async (title, label, val) => { const s = await F.sheet({ title, html: '<label class="field"><span>' + label + '</span><input class="input money" id="v" type="number" min="0" step="0.5" value="' + val + '"></label>', buttons: [{ label: 'OK', value: true, submit: true }, { label: 'Cancel', value: false, style: 'secondary' }], validate: (ov) => (Number($('#v', ov).value) > 0 ? null : 'Enter an amount.') }); return s.value ? Number($('#v', s.el).value) : null; };
    if (a === 'load') { const v = await ask('Load more tickets', 'Tickets', 1000); if (v) await act('Loading…', () => F.call('fair', 'allocate', [m.address, F.units(v)])); }
    if (a === 'recall') { const v = await ask('Take tickets back', 'Tickets', 100); if (v) await act('Taking back…', () => F.call('fair', 'correct', [m.address, F.state.info.organiser, F.units(v), 'Taken back from booth'])); }
    if (a === 'topup') { const v = await ask('Top up XDC', 'XDC', F.CFG.staffCredit); if (v) await act('Sending…', () => F.sendXdc(m.address, F.ethers.parseEther(String(v)))); }
    if (a === 'feature') await act('Saving…', () => F.call('fair', 'setStaff', [m.address, m.role, m.name, !m.featured, 0n]));
    if (a === 'rename') {
      const s = await F.sheet({ title: 'Rename', html: '<label class="field"><input class="input" id="nn" maxlength="30" value="' + esc(m.name) + '"></label>', buttons: [{ label: 'Save', value: true, submit: true }, { label: 'Cancel', value: false, style: 'secondary' }], validate: (ov) => ($('#nn', ov).value.trim() ? null : 'Enter a name.') });
      if (s.value) await act('Saving…', () => F.call('fair', 'setStaff', [m.address, m.role, $('#nn', s.el).value.trim(), m.featured, 0n]));
    }
    if (a === 'remove' && await F.confirmSheet('Remove ' + esc(m.name) + '?', 'The phone stops working for this fair straight away.' + (isBooth ? ' Take its unsold tickets back first if you need them.' : ''), 'Remove', 'Cancel', true))
      await act('Removing…', () => F.call('fair', 'setStaff', [m.address, 0, m.name, false, 0n]));
  }

  // ================================================================ XDC
  $('#addXdcBtn').onclick = () => F.sheet({ title: 'Add XDC', html: '<p class="muted">Send XDC to this address. It covers network fees for you and your helper phones.</p>' + addXdcHtml(), buttons: [{ label: 'Done', value: null, style: 'secondary' }], onOpen: wireAddXdc }).then(dashboard);
  $('#sendXdcBtn').onclick = async () => {
    const bal = await F.creditBalance();
    const r = await F.sheet({
      title: 'Send XDC to another wallet',
      html: '<p class="muted">Keep it here for next year\'s fair, or send it to your own wallet or an exchange.</p>' +
        '<label class="field"><span>Send to (xdc… or 0x… address)</span><textarea class="input mono" id="to" rows="2" style="min-height:0"></textarea></label><button class="btn secondary small" data-scanaddr>Scan an address</button>' +
        '<label class="field" style="margin-top:12px"><span>Amount (XDC)</span><input class="input" id="amt" type="number" min="0" step="0.01" placeholder="0"><span class="hint">You have ' + F.xdc(bal) + ' XDC. <button class="link" data-all>Send all</button></span></label>' +
        '<p class="small muted">Send a small test amount first. Exchanges must accept XDC on the XDC Network.</p>',
      buttons: [{ label: 'Next', value: true, submit: true }, { label: 'Cancel', value: false, style: 'secondary' }],
      onOpen: (ov) => {
        $('[data-all]', ov).onclick = (e) => { e.preventDefault(); const keep = F.ethers.parseEther('0.01'); $('#amt', ov).value = bal > keep ? F.ethers.formatEther(bal - keep) : '0'; };
        $('[data-scanaddr]', ov).onclick = async () => { const c = await F.scan({ title: 'Scan the address', check: (p) => (p.kind === 'A' ? null : 'That\'s not a wallet address.') }); if (c) $('#to', ov).value = F.xdcAddr(c.address); };
      },
      validate: (ov) => { if (!F.isAddr($('#to', ov).value.trim())) return 'Enter a valid xdc… or 0x… address.'; const v = Number($('#amt', ov).value); if (!(v > 0)) return 'Enter an amount.'; if (F.ethers.parseEther(String(v)) > bal) return 'That\'s more than you have.'; return null; }
    });
    if (!r.value) return;
    const to = F.normAddr($('#to', r.el).value.trim()); const amt = F.ethers.parseEther(String(Number($('#amt', r.el).value)));
    const ok = await F.confirmSheet('Send ' + F.xdc(amt) + ' XDC?', 'To:<br><b class="mono" style="font-size:1.05rem">' + esc(F.xdcAddr(to)) + '</b><br><br>Check the address carefully. Sent XDC can\'t be taken back.', 'Send', 'Cancel');
    if (ok) await act('Sending…', () => F.sendXdc(to, amt), () => F.splash('Sent', F.xdc(amt) + ' XDC'));
  };

  // ================================================================ fix a family's tickets
  $('#fixBtn').onclick = async () => {
    const c = await F.scan({ title: 'Scan the family\'s ticket code', hint: 'Or paste their phone\'s address', check: (p) => (p.kind === 'F' || p.kind === 'A' ? null : 'That\'s not a family ticket code.') });
    if (!c) return;
    const b = F.busy('Looking up…');
    let bal, grp, rows, times;
    try { [bal, grp, rows] = await Promise.all([F.ticketBalance(c.address), F.state.fair.groupOf(c.address), F.activityFor(c.address)]); times = await F.blockTimes(rows.slice(0, 40).map((x) => x.block)); }
    catch (e) { b.close(); return F.showError(e); }
    b.close();
    const g = F.groupById(Number(grp));
    const r = await F.sheet({
      title: 'This family',
      html: '<div class="stats"><div class="stat"><b>' + F.fmt(bal) + '</b><span>tickets now</span></div><div class="stat"><b>' + esc(g ? g.name : 'None') + '</b><span>house or class</span></div></div>' +
        '<ul class="list" style="margin-top:12px">' + (rows.length ? rows.slice(0, 30).map((x) => '<li><div class="grow"><b>' + esc(x.title) + '</b><span>' + (times[x.block] ? F.timeStr(times[x.block]) : '') + '</span></div><div class="amt ' + (x.incoming ? 'plus' : '') + '">' + (x.incoming ? '+' : '−') + F.fmt(x.amount) + '</div></li>').join('') : '<li class="empty">No activity yet.</li>') + '</ul>',
      buttons: [{ label: 'Give them tickets', value: 'give' }, { label: 'Take tickets back', value: 'take', style: 'secondary' }]
        .concat(F.state.info.groups.length ? [{ label: 'Change house or class', value: 'group', style: 'secondary' }] : []).concat([{ label: 'Close', value: null, style: 'ghost' }])
    });
    if (r.value === 'give' || r.value === 'take') {
      const s = await F.sheet({
        title: r.value === 'give' ? 'Give them tickets' : 'Take tickets back',
        html: '<label class="field"><span>Tickets</span><input class="input money" id="v" type="number" min="0" step="0.5"></label><label class="field"><span>Reason (kept in the fair\'s records)</span><input class="input" id="why" maxlength="60" placeholder="e.g. Charged twice by mistake"></label>',
        buttons: [{ label: 'Save', value: true, submit: true }, { label: 'Cancel', value: false, style: 'secondary' }],
        validate: (ov) => (Number($('#v', ov).value) > 0 ? ($('#why', ov).value.trim() ? null : 'Add a short reason.') : 'Enter how many tickets.')
      });
      if (!s.value) return;
      const amt = F.units(Number($('#v', s.el).value)), why = $('#why', s.el).value.trim();
      const org = F.state.info.organiser;
      await act('Saving…', () => F.call('fair', 'correct', r.value === 'give' ? [org, c.address, amt, why] : [c.address, org, amt, why]), () => F.splash('Done', F.tix(amt) + (r.value === 'give' ? ' given' : ' taken back')));
    }
    if (r.value === 'group') {
      const s = await F.sheet({ title: 'House or class', html: F.state.info.groups.map((x) => '<button class="group-btn" data-g="' + x.id + '"><span class="swatch" style="background:' + x.colour + '"></span>' + esc(x.name) + '</button>').join(''), buttons: [{ label: 'Cancel', value: null, style: 'secondary' }],
        onOpen: (ov) => $$('[data-g]', ov).forEach((bt) => (bt.onclick = () => { ov.dataset.pick = bt.dataset.g; $('.sheet-btns .btn', ov).click(); })) });
      const pick = Number(s.el.dataset.pick || 0);
      if (pick) await act('Saving…', () => F.call('fair', 'setFamilyGroup', [c.address, pick]));
    }
  };

  // ================================================================ settings for the fair
  $('#fairSettingsBtn').onclick = async () => {
    const info = F.state.info;
    const dt = info.autoCloseAt ? new Date(info.autoCloseAt * 1000) : null;
    const dStr = dt ? new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : '';
    const r = await F.sheet({
      title: 'Fair settings',
      html: '<label class="field"><span>Fair name</span><input class="input" id="sn" maxlength="60" value="' + esc(info.name) + '"></label>' +
        '<label class="field"><span>Ticket price (' + esc(F.CFG.currency) + ')</span><input class="input" id="sp" type="number" min="0.05" step="0.05" value="' + (info.cents / 100).toFixed(2) + '"></label>' +
        '<label class="field"><span>Closes at midnight at the end of</span><input class="input" id="sd" type="date" value="' + dStr + '"></label>' +
        '<label class="field"><span>Most tickets in one booth sale</span><input class="input" id="ms" type="number" min="1" value="' + F.num(BigInt(info.limits.maxSale)) + '"></label>' +
        '<label class="field"><span>Most tickets in one stall charge</span><input class="input" id="mc" type="number" min="1" value="' + F.num(BigInt(info.limits.maxCharge)) + '"></label>' +
        '<label class="field"><span>Minutes a booth can undo a sale</span><input class="input" id="um" type="number" min="1" max="120" value="' + Math.round(info.limits.undoWindow / 60) + '"></label>' +
        (info.groups.length ? '<p class="small muted">Houses: ' + info.groups.map((g) => esc(g.name)).join(', ') + '. <button class="link" data-groups>Add or rename</button></p>' : '<p class="small muted"><button class="link" data-groups>Add houses or classes</button></p>'),
      buttons: [{ label: 'Save', value: true, submit: true }, { label: 'Cancel', value: false, style: 'secondary' }],
      onOpen: (ov) => { $('[data-groups]', ov).onclick = (e) => { e.preventDefault(); ov.dataset.groups = '1'; $$('.sheet-btns .btn', ov)[1].click(); }; },
      validate: (ov) => (Number($('#sp', ov).value) >= 0.05 && Number($('#ms', ov).value) > 0 && Number($('#mc', ov).value) > 0 && Number($('#um', ov).value) > 0 ? null : 'Check the values.')
    });
    if (r.el.dataset.groups) return editGroups();
    if (!r.value) return;
    const name = $('#sn', r.el).value.trim() || info.name, cents = Math.round(Number($('#sp', r.el).value) * 100);
    const d = $('#sd', r.el).value; const close = d ? Math.floor(new Date(d + 'T23:59:59').getTime() / 1000) : 0;
    const lim = { maxSale: F.units(Number($('#ms', r.el).value)), maxCharge: F.units(Number($('#mc', r.el).value)), chargesPerMinute: info.limits.chargesPerMinute, undoWindow: Math.round(Number($('#um', r.el).value)) * 60, codeWindow: info.limits.codeWindow };
    await act('Saving…', async () => {
      if (name !== info.name || cents !== info.cents || close !== info.autoCloseAt) await F.call('fair', 'setSettings', [name, cents, close]);
      if (lim.maxSale !== BigInt(info.limits.maxSale) || lim.maxCharge !== BigInt(info.limits.maxCharge) || lim.undoWindow !== info.limits.undoWindow) await F.call('fair', 'setLimits', [lim]);
      await F.loadInfo(true);
    }, () => F.toast('Saved', 'ok'));
  };
  async function editGroups() {
    const groups = F.state.info.groups.map((g) => ({ name: g.name, colour: parseInt(g.colour.slice(1), 16), locked: true }));
    const render = () => groups.map((g, i) => '<div class="card flat"><input class="input" data-gname="' + i + '" value="' + esc(g.name) + '" placeholder="Name"><div class="swatches">' + F.PALETTE.map(([n, c]) => '<button title="' + n + '" style="background:' + F.colourHex(c) + '" data-gi="' + i + '" data-c="' + c + '" class="' + (g.colour === c ? 'on' : '') + '"></button>').join('') + '</div></div>').join('');
    const r = await F.sheet({
      title: 'Houses or classes', html: '<p class="small muted">Existing ones can be renamed but not removed.</p><div id="gl">' + render() + '</div><button class="btn secondary" data-add>Add one</button>',
      buttons: [{ label: 'Save', value: true, submit: true }, { label: 'Cancel', value: false, style: 'secondary' }],
      onOpen: (ov) => {
        const wire = () => { $$('[data-gname]', ov).forEach((inp) => (inp.oninput = () => { groups[Number(inp.dataset.gname)].name = inp.value; })); $$('[data-gi]', ov).forEach((b) => (b.onclick = () => { groups[Number(b.dataset.gi)].colour = Number(b.dataset.c); $('#gl', ov).innerHTML = render(); wire(); })); };
        wire(); $('[data-add]', ov).onclick = () => { groups.push({ name: '', colour: F.PALETTE[groups.length % F.PALETTE.length][1] }); $('#gl', ov).innerHTML = render(); wire(); };
      },
      validate: () => (groups.every((g) => g.name.trim()) ? null : 'Every house or class needs a name.')
    });
    if (!r.value) return;
    await act('Saving…', async () => { await F.call('fair', 'setGroups', [groups.map((g) => g.name.trim()), groups.map((g) => g.colour)]); await F.loadInfo(true); }, () => F.toast('Saved', 'ok'));
  }

  // ================================================================ close
  $('#closeBtn').onclick = async () => {
    const ok = await F.confirmSheet('Close the fair?', 'This stops all sales and charges for good. Reports and downloads stay available, and helper phones return their leftover XDC.', 'Close the fair', 'Cancel', true);
    if (ok) await act('Closing…', () => F.call('fair', 'close', []), async () => { F.track('fair/closed'); await F.loadInfo(true); await F.splash('Closed', 'Thanks for running ' + F.state.info.name + '!'); });
  };

  // ================================================================ report + CSV
  async function report() {
    $('#repBody').innerHTML = '<div class="card center"><div class="spinner"></div><p id="repProg">Adding everything up…</p></div>';
    F.showView('report');
    let logs;
    try { logs = await F.logCache('all', []).update((p) => { const el = $('#repProg'); if (el) el.textContent = 'Adding everything up… ' + Math.round(p * 100) + '%'; }); }
    catch (e) { $('#repBody').innerHTML = '<div class="notice bad">Couldn\'t load the totals. Check the connection and try again.</div>'; return; }
    const info = F.state.info;
    const ev = logs.filter((l) => l.topics[0] !== F.T.Transfer).map((l) => { try { return F.parse(l); } catch (e) { return null; } }).filter(Boolean);
    const staff = {}; ev.filter((e) => e.name === 'StaffSet').forEach((e) => (staff[e.args.phone.toLowerCase()] = { name: e.args.label, role: Number(e.args.role) || (staff[e.args.phone.toLowerCase()] || {}).role }));
    const nameOf = (a) => (staff[a.toLowerCase()] || {}).name || F.xdcAddr(a).slice(0, 10) + '…';
    const sales = {}; const booths = {}; const stalls = {}; const groups = {}; const families = new Map();
    const fam = (a) => { const k = a.toLowerCase(); if (!families.has(k)) families.set(k, 'Family ' + (families.size + 1)); return families.get(k); };
    let reissued = 0n, corrections = [];
    for (const e of ev) {
      if (e.name === 'Sold') {
        const k = e.args.booth.toLowerCase(); booths[k] = booths[k] || { cash: 0n, card: 0n, reissue: 0n, n: 0 };
        const m = Number(e.args.method); const key = m === 0 ? 'cash' : m === 1 ? 'card' : 'reissue';
        booths[k][key] += e.args.amount; booths[k].n++;
        sales[e.args.id.toString()] = { booth: k, method: key, group: Number(e.args.group) };
        if (m !== 2) groups[Number(e.args.group)] = (groups[Number(e.args.group)] || 0n) + e.args.amount; else reissued += e.args.amount;
        fam(e.args.family);
      }
      if (e.name === 'SaleUndone') { const s = sales[e.args.id.toString()]; if (s) { booths[s.booth][s.method] -= e.args.amount; if (s.method !== 'reissue') groups[s.group] = (groups[s.group] || 0n) - e.args.amount; else reissued -= e.args.amount; } }
      if (e.name === 'Charged') { const k = e.args.stall.toLowerCase(); stalls[k] = stalls[k] || { taken: 0n, refunded: 0n, n: 0 }; stalls[k].taken += e.args.amount; stalls[k].n++; fam(e.args.family); }
      if (e.name === 'Refunded') { const k = e.args.stall.toLowerCase(); stalls[k].refunded += e.args.amount; }
      if (e.name === 'Corrected') corrections.push(e);
    }
    const money = (u) => F.dollars(F.num(u) * info.cents / 100);
    let soldPaid = 0n; Object.values(booths).forEach((b) => (soldPaid += b.cash + b.card));
    let spent = 0n; Object.values(stalls).forEach((s) => (spent += s.taken - s.refunded));
    const html = [];
    html.push('<div class="card"><h2>' + esc(info.name) + '</h2><div class="stats">' +
      '<div class="stat"><b>' + money(soldPaid) + '</b><span>ticket sales (cash and card)</span></div>' +
      '<div class="stat"><b>' + F.fmt(soldPaid) + '</b><span>tickets sold</span></div>' +
      '<div class="stat"><b>' + F.fmt(spent) + '</b><span>tickets used at stalls</span></div>' +
      '<div class="stat"><b>' + families.size + '</b><span>family phones</span></div></div>' +
      '<p class="small muted" style="margin-top:10px">Compassionate reissues: ' + F.fmt(reissued) + ' tickets ($0 collected). Unspent tickets on family phones: ' + F.fmt(soldPaid + reissued - spent) + ', already part of what was raised.</p>' +
      '<div class="grid2" style="margin-top:12px"><button class="btn secondary" data-csv="summary">Download summary (CSV)</button><button class="btn secondary" data-csv="activity">Download activity (CSV)</button></div></div>');
    html.push('<div class="card"><h3>Ticket booths</h3><div class="table-wrap"><table class="data"><tr><th>Booth</th><th class="num">Cash</th><th class="num">Card</th><th class="num">Reissued</th><th class="num">Sales</th></tr>' +
      Object.entries(booths).map(([k, b]) => '<tr><td>' + esc(nameOf(k)) + '</td><td class="num">' + money(b.cash) + '</td><td class="num">' + money(b.card) + '</td><td class="num">' + F.fmt(b.reissue) + '</td><td class="num">' + b.n + '</td></tr>').join('') + '</table></div><p class="small muted">Each booth\'s cash should match its tin. Undone sales are already taken off.</p></div>');
    html.push('<div class="card"><h3>Stalls</h3><div class="table-wrap"><table class="data"><tr><th>Stall</th><th class="num">Tickets taken</th><th class="num">Refunded</th><th class="num">Sales</th></tr>' +
      Object.entries(stalls).sort((a, b) => (b[1].taken - b[1].refunded > a[1].taken - a[1].refunded ? 1 : -1)).map(([k, s]) => '<tr><td>' + esc(nameOf(k)) + '</td><td class="num">' + F.fmt(s.taken - s.refunded) + '</td><td class="num">' + F.fmt(s.refunded) + '</td><td class="num">' + s.n + '</td></tr>').join('') + '</table></div></div>');
    if (info.groups.length) html.push('<div class="card"><h3>Houses and classes</h3>' + info.groups.map((g) => '<div class="bar-row"><div class="lbl"><span>' + esc(g.name) + '</span><span>' + F.fmt(groups[g.id] || 0n) + ' tickets</span></div><div class="track"><div class="fill" style="background:' + g.colour + ';width:' + (soldPaid > 0n ? Number((groups[g.id] || 0n) * 100n / soldPaid) : 0) + '%"></div></div></div>').join('') + '</div>');
    if (corrections.length) html.push('<div class="card"><h3>Corrections</h3><ul class="list">' + corrections.map((c) => '<li><div class="grow"><b>' + esc(c.args.reason) + '</b><span>' + F.fmt(c.args.amount) + ' tickets</span></div></li>').join('') + '</ul></div>');
    $('#repBody').innerHTML = '<button class="btn ghost small" data-dash>← Back</button>' + html.join('');
    $$('#repBody [data-dash]').forEach((b) => (b.onclick = dashboard));
    $$('[data-csv]').forEach((b) => (b.onclick = () => downloadCsv(b.dataset.csv, { booths, stalls, groups, ev, nameOf, fam, money, info })));
  }
  async function downloadCsv(kind, d) {
    const rows = [];
    const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const n2 = (u) => F.num(u).toFixed(2);
    if (kind === 'summary') {
      rows.push(['Type', 'Name', 'Tickets', 'Refunded or undone', 'Cash', 'Card', 'Reissued tickets', 'Sales']);
      for (const [k, b] of Object.entries(d.booths)) rows.push(['Booth', d.nameOf(k), n2(b.cash + b.card + b.reissue), '', d.money(b.cash), d.money(b.card), n2(b.reissue), b.n]);
      for (const [k, s] of Object.entries(d.stalls)) rows.push(['Stall', d.nameOf(k), n2(s.taken - s.refunded), n2(s.refunded), '', '', '', s.n]);
      for (const g of d.info.groups) rows.push(['House or class', g.name, n2(d.groups[g.id] || 0n), '', '', '', '', '']);
    } else {
      const b = F.busy('Preparing download…');
      const blocks = [...new Set(d.ev.map((e) => e.block))];
      let times = {};
      for (let i = 0; i < blocks.length; i += 40) { times = await F.blockTimes(blocks.slice(i, i + 40)); }
      b.close();
      rows.push(['Time', 'Type', 'Booth or stall', 'Family', 'House or class', 'Tickets', 'Method', 'Reason']);
      for (const e of d.ev) {
        const t = times[e.block] ? new Date(times[e.block]).toLocaleString() : 'block ' + e.block;
        if (e.name === 'Sold') rows.push([t, 'Sale', d.nameOf(e.args.booth), d.fam(e.args.family), (F.groupById(Number(e.args.group)) || {}).name || '', n2(e.args.amount), F.METHODS[Number(e.args.method)], '']);
        if (e.name === 'SaleUndone') rows.push([t, 'Sale undone', d.nameOf(e.args.booth), d.fam(e.args.family), '', n2(e.args.amount), '', '']);
        if (e.name === 'Charged') rows.push([t, 'Stall charge', d.nameOf(e.args.stall), d.fam(e.args.family), '', n2(e.args.amount), '', '']);
        if (e.name === 'Refunded') rows.push([t, 'Refund', d.nameOf(e.args.stall), d.fam(e.args.family), '', n2(e.args.amount), '', '']);
        if (e.name === 'Corrected') rows.push([t, 'Correction', '', '', '', n2(e.args.amount), '', e.args.reason]);
      }
    }
    rows.push([]); rows.push(['Made with Fair Tickets by XDC Outpost', 'https://xdcoutpost.xyz/Fair_Tickets/']);
    const csv = rows.map((r) => r.map(q).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
    a.download = (d.info.name.replace(/[^\w]+/g, '-') + '-' + kind + '.csv').toLowerCase();
    document.body.appendChild(a); a.click(); a.remove();
    F.track('report/csv');
  }

  // ================================================================ buttons
  $('#linksBtn').onclick = openLinks;
  $('#reportBtn').onclick = report;
  $$('[data-dash]').forEach((b) => (b.onclick = dashboard));
  $('#settingsBtn').onclick = () => F.openSettings('<button class="btn secondary" data-x="new">Set up a new fair</button>', (ov, actn) => ($('[data-x="new"]', ov).onclick = () => actn('new'))).then(async (a) => {
    if (a === 'new' && await F.confirmSheet('Set up a new fair?', 'This phone stops showing the current fair (nothing is deleted, and your backup message still opens it). Your XDC stays with you for the new fair.', 'Continue', 'Cancel')) { F.setFair(''); location.reload(); }
  });
  setInterval(() => { if (document.visibilityState === 'visible' && document.body.dataset.current === 'dash') renderTeam(); }, 30000);
})();
