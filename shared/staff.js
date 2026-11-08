/* Fair Tickets: shared pieces for helper phones (ticket booths and stalls). */
(function () {
  'use strict';
  const F = window.Fair;
  const { $, esc } = F;

  /** First-run wizard for a helper phone. kind: 'booth' | 'stall'. */
  async function setup(kind, extraSteps = []) {
    const app = F.APPS[kind];
    if (F.myAddress()) return false;
    await F.wizard('setup', [
      {
        id: 'welcome',
        render: () => ({
          noBack: true, next: false,
          title: app.name,
          html: '<img class="appicon" src="../icons/' + app.icon + '-192.png" alt="">' +
            '<p class="center"><b>' + esc(F.state.info ? F.state.info.name : '') + '</b></p>' +
            (kind === 'booth'
              ? '<p>Sell tickets at the booth: take cash or card as usual, tap the amount, and scan the family\'s phone.</p>'
              : '<p>Take tickets at your stall: tap what they\'re buying, scan the family\'s phone, and you\'ll see a big green tick.</p>') +
            '<button class="btn huge" data-new>Set up this phone</button><button class="btn secondary" data-restore>I\'ve used this before</button>',
          onOpen: (el, d, go) => {
            $('[data-new]', el).onclick = () => { F.newAccount(); go(1); };
            $('[data-restore]', el).onclick = async () => { if (await F.restoreSheet()) { F.syncUrl(); location.reload(); } };
          }
        })
      },
      F.Steps.install(app),
      ...extraSteps,
      F.Steps.backup(),
      {
        id: 'join',
        render: () => ({
          title: 'Show this to the organiser',
          html: '<p class="muted">The organiser scans this code to add this phone as a ' + (kind === 'booth' ? 'ticket booth' : 'stall') + '. This screen moves on by itself once you\'re added.</p>' +
            '<div class="qr">' + F.qrSvg(myCode(kind)) + '</div><p class="center small muted" data-wait>Waiting for the organiser…</p>',
          next: 'Skip for now',
          onOpen: (el, d, go) => waitUntilAdded(kind, el).then((ok) => { if (ok) { F.track('staff/' + kind + '-joined'); F.splash('You\'re in!', 'The organiser has added this phone.'); go(1); } })
        })
      },
      {
        id: 'tour',
        render: () => ({
          title: 'How it works',
          html: kind === 'booth'
            ? '<ol class="steps"><li>Take the cash or card payment as usual.</li><li>Tap the amount they paid, then Cash, Card or Compassionate reissue.</li><li>Scan the code on their phone. Done.</li></ol><p class="muted">Made a mistake? Tap the sale in Recent sales and choose Undo, within 10 minutes.</p>'
            : '<ol class="steps"><li>Tap what they\'re buying.</li><li>Tap Charge and scan the code on their phone.</li><li>Check the amount, tap Charge again, and wait for the green tick.</li></ol><p class="muted">Need to give tickets back? Tap the sale in Recent and choose Refund.</p>',
          next: 'Start'
        })
      }
    ]);
    return true;
  }

  function myCode(kind) {
    const name = kind === 'booth' ? F.store.get('booth.name', 'Ticket booth') : F.store.get('stall.name', '');
    return F.Codes.staff(kind === 'booth' ? 'B' : 'S', F.myAddress(), name);
  }

  async function myRole() {
    try { return Number(await F.state.fair.role(F.myAddress())); } catch (e) { return null; }
  }

  /** Poll until the organiser adds this phone with the right role. */
  async function waitUntilAdded(kind, el) {
    const want = kind === 'booth' ? F.ROLES.BOOTH : F.ROLES.STALL;
    for (;;) {
      if (el && !el.isConnected) return false;
      const r = await myRole();
      if (r === want) return true;
      await F.sleep(3000);
    }
  }

  /** Warn when fee credit is low. */
  async function creditCheck(box) {
    try {
      const c = await F.creditBalance();
      const low = F.state.provider ? (await F.state.provider.send('eth_gasPrice', []).then((g) => BigInt(g) * 300000n * 25n)) : 0n;
      if (c < low) { box.innerHTML = '<b>Fee credit is low</b> (' + F.xdc(c) + ' XDC). Ask the organiser to top up this phone: they scan its code.'; box.hidden = false; }
      else box.hidden = true;
    } catch (e) { }
  }

  /** After the fair closes, send leftover XDC back to the organiser automatically (once). */
  async function returnLeftover(noteEl, manual) {
    try {
      const info = F.state.info;
      if (!info || info.isOpen) { if (manual) await F.alertSheet('The fair is still open', 'Leftover fee credit goes back to the organiser once the fair closes.'); return; }
      if (!manual && F.fstore.get('returned')) { if (noteEl) noteEl.innerHTML = '<p class="small muted">Leftover fee credit has been returned to the organiser.</p>'; return; }
      const bal = await F.creditBalance();
      const gp = BigInt(await F.state.provider.send('eth_gasPrice', []));
      const fee = (gp + gp / 10n) * 21000n;
      if (bal <= fee * 2n) { F.fstore.set('returned', Date.now()); if (manual) F.toast('Nothing left to return'); return; }
      await F.sendXdc(info.organiser, bal - fee * 2n);
      F.fstore.set('returned', Date.now());
      if (noteEl) noteEl.innerHTML = '<p class="small muted">Leftover fee credit (' + F.xdc(bal - fee * 2n) + ' XDC) returned to the organiser.</p>';
      if (manual) F.toast('Returned to the organiser', 'ok');
    } catch (e) { if (manual) F.showError(e); }
  }

  window.Staff = { setup, myCode, myRole, waitUntilAdded, creditCheck, returnLeftover };
})();
