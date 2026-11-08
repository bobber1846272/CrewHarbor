/* CrewHarbor · diensten ruilen: aanbieden, overnemen of ruilen, goedkeuren door de planner */
'use strict';

async function loadSwaps() { try { S.swaps = await rpc('cd_swaps'); } catch (e) { S.swaps = null; } }
const SW = () => S.swaps || { open: [], mine: [], pending: [], canPlan: false };
const swShiftTxt = s => s ? dayShort(s.date) + ' ' + s.start + '–' + s.end : '';
const SW_STATUS = { open: ['Aangeboden', 'blue'], aangevraagd: ['Wacht op planner', 'orange'], goedgekeurd: ['Goedgekeurd', 'green'], afgewezen: ['Afgewezen', 'red'], ingetrokken: ['Ingetrokken', ''] };

// knopje bij je eigen dienst in "Mijn week"
function swapBtn(s) {
  if (s.date < today()) return '';
  const w = SW().mine.find(x => x.shift && same(x.shift.id, s.id) && same(x.fromId, S.me.id) && (x.status === 'open' || x.status === 'aangevraagd'));
  if (w) return '<span class="sw-state ' + w.status + '">' + (w.status === 'open' ? 'Aangeboden' : 'Wacht op planner') + '</span>';
  return '<button class="sw-btn" data-act="sw-offer" data-id="' + s.id + '">⇄ Ruilen</button>';
}

// sectie onder "Mijn week": diensten van collega's en je eigen verzoeken
function swapsSection(R) {
  const D = SW();
  const fn = id => id && typeof funcOf === 'function' ? funcOf(id, R) : null;
  const myFuture = R.shifts.filter(s => same(s.memberId, S.me.id) && s.date >= today());
  let h = '<section class="sw-sec"><div class="section-title"><h2>Diensten ruilen</h2>' + (D.open.length ? '<span class="badge blue">' + D.open.length + '</span>' : '') + '</div>' +
    '<p class="small muted" style="margin:0">Kun je een dienst niet werken? Klik bij de dienst op <strong>⇄ Ruilen</strong>. Collega’s kunnen hem dan overnemen of ruilen; de planner keurt het goed.</p>';
  if (D.open.length) {
    h += '<div class="sw-list">' + D.open.map(w => {
      const f = fn(w.shift.functionId);
      const pick = S.swPick === w.id;
      return '<div class="sw-card"><div class="sw-main">' + avatar(w.fromId, w.fromName) + '<div><strong>' + esc(swShiftTxt(w.shift)) + '</strong>' + (f ? ' <b class="func-tag">' + esc(f.name) + '</b>' : '') +
        '<div class="small muted">Van ' + esc(w.fromName) + (w.note ? ' · “' + esc(w.note) + '”' : '') + '</div></div></div>' +
        (pick ? '<div class="sw-pick"><label class="small" for="sw-my-' + w.id + '">Ruilen voor een dienst van jou</label><select class="input" id="sw-my-' + w.id + '"><option value="">Niet ruilen, alleen overnemen</option>' +
            myFuture.map(s => '<option value="' + s.id + '">' + esc(swShiftTxt(s)) + '</option>').join('') + '</select>' +
            '<div class="row"><button class="btn small primary" data-act="sw-claim" data-id="' + w.id + '">Verzoek sturen</button><button class="btn small ghost" data-act="sw-pick" data-id="">Annuleren</button></div></div>'
          : '<div class="row"><button class="btn small primary" data-act="sw-pick" data-id="' + w.id + '">Overnemen of ruilen</button></div>') + '</div>';
    }).join('') + '</div>';
  } else h += '<div class="empty small">Er worden nu geen diensten aangeboden die bij jou passen.</div>';
  const mine = D.mine;
  if (mine.length) {
    h += '<h3 class="sw-h3">Jouw ruilverzoeken</h3><div class="sw-list">' + mine.map(w => {
      const st = SW_STATUS[w.status] || [w.status, ''];
      const iFrom = same(w.fromId, S.me.id);
      const who = iFrom ? (w.toName ? (w.swapShift ? 'Ruil met ' : 'Overnemen door ') + esc(w.toName) + (w.swapShift ? ' (jij werkt ' + esc(swShiftTxt(w.swapShift)) + ')' : '') : 'Nog niemand gereageerd')
        : 'Van ' + esc(w.fromName) + (w.swapShift ? ' · jij geeft ' + esc(swShiftTxt(w.swapShift)) : '');
      const can = w.status === 'open' || w.status === 'aangevraagd';
      return '<div class="sw-card slim"><div><strong>' + esc(swShiftTxt(w.shift)) + '</strong><div class="small muted">' + who + (w.reason ? ' · ' + esc(w.reason) : '') + '</div></div>' +
        '<div class="row"><span class="badge ' + st[1] + '">' + st[0] + '</span>' + (can ? '<button class="btn small ghost" data-act="sw-cancel" data-id="' + w.id + '">' + (iFrom ? 'Intrekken' : 'Toch niet') + '</button>' : '') + '</div></div>';
    }).join('') + '</div>';
  }
  return h + '</section>';
}

// balk voor planners boven het rooster
function swapPendingBar() {
  const P = SW().pending; if (!P.length) return '';
  return '<div class="sw-bar"><span><strong>' + P.length + (P.length === 1 ? ' ruilverzoek' : ' ruilverzoeken') + '</strong> wacht' + (P.length === 1 ? '' : 'en') + ' op jouw goedkeuring.</span><button class="btn small primary" data-act="sw-review">Bekijken</button></div>';
}
function swapReviewModal(R) {
  const P = SW().pending;
  const fn = id => id && typeof funcOf === 'function' ? funcOf(id, R) : null;
  return '<section class="card stack" style="gap:14px;max-width:none"><div class="item-top"><h2 style="margin:0">Ruilverzoeken</h2><button class="icon-btn" data-act="sw-review-x" aria-label="Sluiten">' + ICON.x + '</button></div>' +
    (P.length ? P.map(w => { const f = fn(w.shift.functionId);
      return '<div class="sw-rev"><div class="sw-rev-flow"><div>' + avatar(w.fromId, w.fromName) + '<strong>' + esc(w.fromName) + '</strong><span class="small muted">geeft ' + esc(swShiftTxt(w.shift)) + (f ? ' · ' + esc(f.name) : '') + '</span></div>' +
        '<span class="sw-arrow" aria-hidden="true">' + (w.swapShift ? '⇄' : '→') + '</span>' +
        '<div>' + avatar(w.toId, w.toName) + '<strong>' + esc(w.toName) + '</strong><span class="small muted">' + (w.swapShift ? 'geeft ' + esc(swShiftTxt(w.swapShift)) : 'neemt over') + '</span></div></div>' +
        (w.note ? '<p class="small muted" style="margin:0">“' + esc(w.note) + '”</p>' : '') +
        (S.swReject === w.id ? '<div class="row"><input class="input" id="sw-reason" maxlength="300" placeholder="Reden (optioneel)" style="flex:1"><button class="btn small ghost" data-act="sw-reject" data-id="">Annuleren</button><button class="btn small danger" data-act="sw-no" data-id="' + w.id + '">Afwijzen</button></div>'
          : '<div class="row"><button class="btn small" data-act="sw-reject" data-id="' + w.id + '">Afwijzen…</button><button class="btn small primary" data-act="sw-yes" data-id="' + w.id + '">Goedkeuren</button></div>') + '</div>'; }).join('')
      : '<p style="margin:0">Alles is afgehandeld. 🎉</p>') + '</section>';
}
function swapOfferModal(R) {
  const s = R.shifts.find(x => same(x.id, S.swOffer)); if (!s) return '';
  return '<section class="card stack" style="gap:14px;max-width:none"><div class="item-top"><h2 style="margin:0">Dienst aanbieden</h2><button class="icon-btn" data-act="sw-offer-x" aria-label="Sluiten">' + ICON.x + '</button></div>' +
    '<p style="margin:0">Je biedt <strong>' + esc(swShiftTxt(s)) + '</strong> aan. Collega’s die deze dienst mogen werken, kunnen hem overnemen of ruilen voor een dienst van hen. Tot de planner het goedkeurt, blijft het jouw dienst.</p>' +
    '<div class="field"><label for="sw-note">Bericht aan je collega’s <span class="opt">(optioneel)</span></label><input class="input" id="sw-note" maxlength="200" placeholder="Bijv. ik heb een verjaardag"></div>' +
    '<div class="row"><button class="btn primary" data-act="sw-offer-go" data-id="' + s.id + '">Aanbieden</button><button class="btn ghost" data-act="sw-offer-x">Annuleren</button></div></section>';
}

document.getElementById('app').addEventListener('click', async e => {
  const el = e.target.closest('[data-act^="sw-"]'); if (!el || el.disabled) return;
  const act = el.dataset.act, id = el.dataset.id ? Number(el.dataset.id) : null;
  const done = async msg => { await loadSwaps(); if (typeof roReload === 'function') await roReload(); else render(); if (msg) toast(msg); };
  try {
    switch (act) {
      case 'sw-offer': S.swOffer = id; render(); setTimeout(() => { const i = document.getElementById('sw-note'); if (i) i.focus(); }, 30); return;
      case 'sw-offer-x': S.swOffer = null; render(); return;
      case 'sw-offer-go': el.disabled = true; await rpc('cd_swap_offer', { p_shift: id, p_note: (document.getElementById('sw-note') || {}).value || '' }); S.swOffer = null; await done('Dienst aangeboden. Je krijgt een melding als iemand reageert.'); return;
      case 'sw-pick': S.swPick = id || null; render(); return;
      case 'sw-claim': {
        const sel = document.getElementById('sw-my-' + id); const my = sel && sel.value ? Number(sel.value) : null;
        el.disabled = true; await rpc('cd_swap_claim', { p_id: id, p_my_shift: my }); S.swPick = null;
        await done('Verzoek verstuurd. De planner keurt het goed.'); return;
      }
      case 'sw-cancel': if (!confirm('Dit ruilverzoek intrekken?')) return; await rpc('cd_swap_cancel', { p_id: id }); await done('Ingetrokken.'); return;
      case 'sw-review': S.swReview = true; render(); return;
      case 'sw-review-x': S.swReview = false; S.swReject = null; render(); return;
      case 'sw-reject': S.swReject = id || null; render(); if (id) setTimeout(() => { const i = document.getElementById('sw-reason'); if (i) i.focus(); }, 30); return;
      case 'sw-yes': el.disabled = true; await rpc('cd_swap_decide', { p_id: id, p_ok: true, p_reason: null }); await done('Goedgekeurd. Het rooster is aangepast en beide collega’s krijgen een melding.'); return;
      case 'sw-no': el.disabled = true; await rpc('cd_swap_decide', { p_id: id, p_ok: false, p_reason: (document.getElementById('sw-reason') || {}).value || '' }); S.swReject = null; await done('Afgewezen.'); return;
    }
  } catch (err) { toast(err.message, true); el.disabled = false; }
});
