/* CrewHarbor · website: pakketten laden, prijs uitrekenen, aanvraag versturen */
(function () {
  'use strict';
  const CFG = window.CREWDECK_CONFIG || {};
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const eur = (c, dec) => '€ ' + (c / 100).toLocaleString('nl-NL', { minimumFractionDigits: dec === false && c % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 });

  if (window.CH_LOGO) { $('logo').innerHTML = window.CH_LOGO(30); $('logo2').innerHTML = window.CH_LOGO(28); }

  // reserve-pakketten als de server even niet bereikbaar is (worden vervangen door de echte prijzen)
  let PLANS = [
    { id: 'start', name: 'Start', tagline: 'Voor kleine teams die overzicht willen.', monthCents: 3000, minMembers: 1, maxMembers: 10, fixed: true, discountPct: 0, features: [], addonCents: { payroll: 1000, phone: 1000, locations: 1500 }, highlights: ['Terugbelverzoeken en taken', 'Uren, in- en uitklokken en prikklok', 'Rooster, verlof en beschikbaarheid', 'Kennisbank en documenten', 'Meldingen per mail'] },
    { id: 'team', name: 'Team', tagline: 'Alles voor een groeiend team, met export naar je salarisadministratie.', monthCents: 23750, minMembers: 11, maxMembers: 50, fixed: true, discountPct: 5, features: ['payroll', 'phone'], addonCents: { locations: 7125 }, highlights: ['Alles uit Start', 'Salarisexport (Excel, Nmbrs, Loket.nl, AFAS)', 'Koppeling met 3CX-telefonie'], popular: true },
    { id: 'bedrijf', name: 'Bedrijf', tagline: 'Voor bedrijven met meerdere vestigingen.', monthCents: 29835, minMembers: 51, maxMembers: null, fixed: false, discountPct: 10, features: ['payroll', 'phone', 'locations'], addonCents: {}, highlights: ['Alles uit Team', 'Meerdere vestigingen met eigen rooster en prikklok', 'Hulp bij het overstappen'] }
  ];
  const EXTRA = { payroll: 'Salarisexport', phone: '3CX-telefonie', locations: 'Meerdere vestigingen' };
  const fitsN = (p, n) => n >= (p.minMembers || 1) && (!p.maxMembers || n <= p.maxMembers);
  // pakket zonder bovengrens: prijs per medewerker boven de ondergrens
  const monthFor = (p, n) => p.fixed || !p.maxMembers && n <= (p.minMembers || 1) ? p.monthCents : Math.round(p.monthCents / (p.minMembers || 1) * n);
  let chosen = new URLSearchParams(location.search).get('pakket') || 'team';

  function api(action, body) {
    return fetch(CFG.supabaseUrl + '/functions/v1/crewdeck', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: CFG.supabaseKey, Authorization: 'Bearer ' + CFG.supabaseKey },
      body: JSON.stringify(Object.assign({ action }, body || {}))
    }).then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Er ging iets mis. Probeer het opnieuw.'); return j; });
  }

  // jaarlijks betalen: hoeveel maanden gratis
  function yearNote(ym) {
    const f = 12 - (Number(ym) || 12);
    document.querySelectorAll('.year-free').forEach(el => { el.textContent = f > 0 ? '(per jaar krijg je ' + String(f).replace('.', ',') + (f === 1 ? ' maand' : ' maanden') + ' gratis)' : ''; });
  }
  // max van de schuif: in te stellen in Beheer (daarboven = maatwerk)
  let MAX = 150;
  let STOPS = [];
  function buildStops() {
    const a = [];
    const add = (from, to, step) => { for (let i = from; i <= Math.min(to, MAX); i += step) if (!a.includes(i)) a.push(i); };
    add(1, 20, 1); add(25, 100, 5); add(110, 200, 10); add(225, 500, 25); add(550, 1000, 50); add(1100, 5000, 100);
    if (a[a.length - 1] !== MAX) a.push(MAX);
    a.push(MAX + 1);
    STOPS = a;
  }
  const idxFor = n => { let best = 0; STOPS.forEach((v, i) => { if (Math.abs(v - n) < Math.abs(STOPS[best] - n)) best = i; }); return best; };
  const curN = () => STOPS[Number($('calc-n').value)] || 1;
  const rangeTxt = p => p.maxMembers ? (p.minMembers > 1 ? p.minMembers + ' tot ' + p.maxMembers : 'tot ' + p.maxMembers) + ' medewerkers' : p.minMembers + ' tot ' + MAX + ' medewerkers';
  function setupSlider(keepN) {
    buildStops();
    const r = $('calc-n'); r.max = STOPS.length - 1; r.value = idxFor(keepN || 10);
    const ticks = [1, 10, 25, 50, 100, 250, 500, 1000, 2500].filter(v => v < MAX * 0.8 || v === 1);
    const show = ticks.length > 5 ? [ticks[0]].concat(ticks.slice(-4)) : ticks;
    $('calc-ticks').innerHTML = show.concat([MAX + 1]).map(v => '<span style="left:' + (idxFor(v) / (STOPS.length - 1) * 100) + '%">' + (v > MAX ? MAX + '+' : v) + '</span>').join('');
    paintSlider();
  }
  function paintSlider() {
    const r = $('calc-n'); const pct = r.value / r.max * 100; const n = curN();
    r.style.setProperty('--p', pct + '%');
    r.setAttribute('aria-valuetext', n > MAX ? 'meer dan ' + MAX + ' medewerkers' : n + ' medewerker' + (n === 1 ? '' : 's'));
  }
  function bestPlan(n) { return n > MAX ? null : PLANS.find(p => fitsN(p, n)) || null; }

  // kaarten één keer opbouwen; de schuif zet alleen 'past bij jou' en bladert erheen
  function cardsHtml() {
    return PLANS.map(p => {
      const extras = Object.keys(EXTRA).filter(k => !(p.features || []).includes(k) && (p.addonCents || {})[k]);
      return '<article class="plan" data-id="' + esc(p.id) + '"><span class="tag"></span>' +
        '<div><h3>' + esc(p.name) + '</h3><p class="range">' + esc(rangeTxt(p)) + '</p></div>' +
        '<div class="price"><strong>' + (p.fixed ? '' : '<small>vanaf </small>') + eur(p.monthCents, false) + '</strong><span>per maand</span>' +
          (Number(p.discountPct) > 0 ? '<em class="disc">' + String(p.discountPct).replace(/\.0+$/, '').replace('.', ',') + '% korting</em>' : '') + '</div>' +
        '<p class="tagline">' + esc(p.tagline) + '</p>' +
        '<ul>' + (p.highlights || []).map(h => '<li>' + esc(h) + '</li>').join('') + '</ul>' +
        (extras.length ? '<div class="extras">Los erbij te nemen:' + extras.map(k => '<span>' + esc(EXTRA[k]) + ' <b>+' + eur(p.addonCents[k], false) + ' p.m.</b></span>').join('') + '</div>' : '') +
        '<a class="btn outline" href="#aanvragen" data-plan="' + esc(p.id) + '">Kies ' + esc(p.name) + '</a></article>';
    }).join('') +
      '<article class="plan custom" data-id="maatwerk"><span class="tag"></span>' +
        '<div><h3>Maatwerk</h3><p class="range">Meer dan ' + MAX + ' medewerkers, of speciale wensen</p></div>' +
        '<div class="price"><strong>Op aanvraag</strong><span>prijs in overleg</span></div>' +
        '<p class="tagline">Voor grote organisaties of als je iets nodig hebt dat niet in een pakket zit.</p>' +
        '<ul><li>Alles uit het grootste pakket</li><li>Prijs en afspraken op maat</li><li>Persoonlijke hulp bij de start</li><li>Betalen per factuur mogelijk</li></ul>' +
        '<a class="btn outline" href="#aanvragen" data-plan="maatwerk">Vraag maatwerk aan</a></article>';
  }
  function renderCards() {
    $('plans').innerHTML = cardsHtml();
    $('plans-dots').innerHTML = PLANS.concat([{ id: 'maatwerk', name: 'Maatwerk' }]).map(p => '<button type="button" data-go="' + esc(p.id) + '" aria-label="Naar ' + esc(p.name) + '"></button>').join('');
    fillSelect(); updateFit(false);
  }
  function fillSelect() {
    $('a-plan').innerHTML = PLANS.map(p => '<option value="' + esc(p.id) + '"' + (p.id === chosen ? ' selected' : '') + '>' + esc(p.name) + ' (' + esc(rangeTxt(p)) + ', ' + (p.fixed ? '' : 'vanaf ') + eur(p.monthCents, false) + ' p.m.)</option>').join('') +
      '<option value="maatwerk"' + (chosen === 'maatwerk' ? ' selected' : '') + '>Maatwerk (prijs op aanvraag)</option>' +
      '<option value=""' + (!PLANS.some(p => p.id === chosen) && chosen !== 'maatwerk' ? ' selected' : '') + '>Weet ik nog niet</option>';
  }
  function scrollToCard(id, smooth) {
    const box = $('plans'); const card = box.querySelector('[data-id="' + id + '"]'); if (!card) return;
    const left = card.offsetLeft - (box.clientWidth - card.offsetWidth) / 2;
    box.scrollTo({ left: Math.max(0, left), behavior: smooth ? 'smooth' : 'auto' });
  }
  function updateFit(smooth) {
    const n = curN(); const best = bestPlan(n); const fitId = n > MAX ? 'maatwerk' : best ? best.id : null;
    $('calc-out').innerHTML = n > MAX
      ? '<span class="calc-big">Meer dan ' + MAX + ' medewerkers?</span><span>Dan maken we een prijs op maat. <a href="#aanvragen" data-plan="maatwerk">Vraag maatwerk aan</a></span>'
      : best ? '<span class="calc-n">' + n + ' medewerker' + (n === 1 ? '' : 's') + '</span><span class="calc-label">Daar past het pakket <strong>' + esc(best.name) + '</strong> bij</span>'
      : '<span class="calc-label">Kies hieronder een pakket.</span>';
    $('plans').querySelectorAll('.plan').forEach(el => {
      const id = el.dataset.id; const fits = id === fitId; const p = PLANS.find(x => x.id === id);
      el.classList.toggle('fits', fits); el.classList.toggle('dim', !!fitId && !fits);
      const tag = el.querySelector('.tag'); const t = fits ? 'Past bij jou' : p && p.popular && !fitId ? 'Meest gekozen' : '';
      tag.textContent = t; tag.hidden = !t;
      const btn = el.querySelector('.btn'); btn.classList.toggle('primary', fits); btn.classList.toggle('outline', !fits);
    });
    $('plans-dots').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.go === fitId));
    if (fitId) scrollToCard(fitId, smooth);
  }

  buildStops(); renderCards(); setupSlider(10); updateFit(false);
  let raf = 0;
  $('calc-n').addEventListener('input', () => { paintSlider(); cancelAnimationFrame(raf); raf = requestAnimationFrame(() => updateFit(true)); });
  const stepBy = dir => { const box = $('plans'); const c = box.querySelector('.plan'); box.scrollBy({ left: dir * (c ? c.offsetWidth + 18 : 300), behavior: 'smooth' }); };
  $('plans-prev').addEventListener('click', () => stepBy(-1));
  $('plans-next').addEventListener('click', () => stepBy(1));
  const arrows = () => { const b = $('plans'); $('plans-prev').disabled = b.scrollLeft < 4; $('plans-next').disabled = b.scrollLeft + b.clientWidth > b.scrollWidth - 4; };
  $('plans').addEventListener('scroll', arrows, { passive: true }); window.addEventListener('resize', arrows); arrows();
  document.addEventListener('click', e => {
    const g = e.target.closest('[data-go]'); if (g) { scrollToCard(g.dataset.go, true); return; }
    const a = e.target.closest('[data-plan]'); if (!a) return;
    chosen = a.dataset.plan; fillSelect();
    if (chosen === 'maatwerk') { const em = $('a-emp'); if (em && curN() > MAX) em.value = MAX >= 500 ? 'Meer dan 500' : '151–500'; }
    setTimeout(() => $('a-company').focus(), 400);
  });
  $('a-plan').addEventListener('change', e => { chosen = e.target.value; });
  const rpc = name => fetch(CFG.supabaseUrl + '/rest/v1/rpc/' + name, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: CFG.supabaseKey, Authorization: 'Bearer ' + CFG.supabaseKey }, body: '{}' }).then(r => r.ok ? r.json() : null);
  if (CFG.supabaseUrl) {
    Promise.all([api('plans').catch(() => null), rpc('cd_public_pricing').catch(() => null)]).then(([d, pr]) => {
      const n = curN();
      if (pr && Number(pr.customFrom) > 0) MAX = Number(pr.customFrom);
      if (pr) yearNote(pr.yearMonths);
      if (d && d.plans && d.plans.length) PLANS = d.plans;
      renderCards(); setupSlider(Math.min(n, MAX)); updateFit(false); arrows();
    });
  }

  // aanvraag
  const form = $('ask'), msg = $('ask-msg');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const v = k => form.elements[k].value.trim();
    const miss = [];
    if (v('company').length < 2) miss.push('bedrijfsnaam');
    if (v('contactName').length < 2) miss.push('je naam');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v('email'))) miss.push('een geldig e-mailadres');
    if (miss.length) { msg.innerHTML = '<div class="alert error" role="alert">Vul nog in: ' + esc(miss.join(', ')) + '.</div>'; return; }
    const btn = form.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Versturen…';
    try {
      await api('request', { company: v('company'), contactName: v('contactName'), email: v('email').toLowerCase(), phone: v('phone'), employees: v('employees'),
        plan: v('plan'), message: v('message'), website: form.elements.website.value });
      form.innerHTML = '<div class="done" role="status"><h3>Bedankt, ' + esc(v('contactName').split(' ')[0]) + '!</h3><p>We hebben je aanvraag ontvangen. Zodra ' + esc(v('company')) +
        ' klaarstaat, krijg je op <strong>' + esc(v('email')) + '</strong> een mail om je wachtwoord te kiezen.</p><p class="fine">Niets ontvangen binnen twee werkdagen? Kijk ook in je spammap.</p></div>';
    } catch (err) {
      msg.innerHTML = '<div class="alert error" role="alert">' + esc(err.message) + '</div>';
      btn.disabled = false; btn.textContent = 'Aanvragen';
    }
  });
})();
