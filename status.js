/* CrewHarbor · statuspagina: live controles + meldingen uit Beheer */
(function () {
  'use strict';
  const CFG = window.CREWDECK_CONFIG || {};
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  if (window.CH_LOGO) { $('logo').innerHTML = window.CH_LOGO(30); $('logo2').innerHTML = window.CH_LOGO(28); }

  const COMP = [
    { id: 'website', name: 'Website', desc: 'crewharbor.nl' },
    { id: 'app', name: 'App en inloggen', desc: 'De CrewHarbor-app in je browser' },
    { id: 'api', name: 'Database en gegevens', desc: 'Je roosters, uren en verzoeken' },
    { id: 'prikklok', name: 'Prikklok', desc: 'In- en uitklokken en pakketten' },
    { id: 'mail', name: 'Mail', desc: 'Uitnodigingen en meldingen per mail' }
  ];
  const LEVEL = { verstoring: ['Verstoring', 'part'], storing: ['Storing', 'down'], onderhoud: ['Onderhoud', 'maint'] };
  const RANK = { ok: 0, maint: 1, part: 2, down: 3 };
  const headers = { 'Content-Type': 'application/json', apikey: CFG.supabaseKey, Authorization: 'Bearer ' + CFG.supabaseKey };
  const timed = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('timeout')), ms))]);
  async function check(fn) { const t0 = performance.now(); try { const ok = await timed(fn(), 8000); return { ok: !!ok, ms: Math.round(performance.now() - t0) }; } catch (e) { return { ok: false, ms: null }; } }
  const tests = {
    website: () => fetch('site.css?check=' + Date.now(), { cache: 'no-store' }).then(r => r.ok),
    app: () => fetch('app/config.js?check=' + Date.now(), { cache: 'no-store' }).then(r => r.ok),
    api: () => fetch(CFG.supabaseUrl + '/rest/v1/rpc/cd_status', { method: 'POST', headers, body: '{}' }).then(r => r.ok ? r.json() : null).then(d => { if (d) data = d; return !!d; }),
    prikklok: () => fetch(CFG.supabaseUrl + '/functions/v1/crewdeck', { method: 'POST', headers, body: JSON.stringify({ action: 'plans' }) }).then(r => r.ok)
  };
  let data = null, live = {};

  const fmt = t => new Date(t).toLocaleString('nl-NL', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  const DAY = 86400000;
  function dayLevel(comp, dayStart) {
    let lv = 'ok';
    (data ? data.incidents : []).forEach(i => {
      if (!i.components.includes(comp)) return;
      const a = new Date(i.startedAt).getTime(), b = i.resolvedAt ? new Date(i.resolvedAt).getTime() : Date.now();
      if (a < dayStart + DAY && b > dayStart) { const l = (LEVEL[i.level] || [0, 'part'])[1]; if (RANK[l] > RANK[lv]) lv = l; }
    });
    return lv;
  }
  function uptime(comp) {
    const from = Date.now() - 90 * DAY; let down = 0;
    (data ? data.incidents : []).forEach(i => {
      if (!i.components.includes(comp) || i.level === 'onderhoud') return;
      const a = Math.max(from, new Date(i.startedAt).getTime()), b = i.resolvedAt ? new Date(i.resolvedAt).getTime() : Date.now();
      if (b > a) down += (b - a) * (i.level === 'storing' ? 1 : 0.5);
    });
    return Math.max(0, 100 - down / (90 * DAY) * 100);
  }
  function now(comp) {
    const open = (data ? data.incidents : []).filter(i => !i.resolvedAt && i.components.includes(comp));
    let lv = 'ok'; open.forEach(i => { const l = (LEVEL[i.level] || [0, 'part'])[1]; if (RANK[l] > RANK[lv]) lv = l; });
    if (live[comp] && !live[comp].ok) lv = 'down';
    return lv;
  }
  const LABEL = { ok: 'Werkt', part: 'Verstoring', down: 'Storing', maint: 'Onderhoud' };

  function render() {
    const today0 = new Date(); today0.setHours(0, 0, 0, 0);
    $('st-list').innerHTML = COMP.map(c => {
      const lv = now(c.id), L = live[c.id];
      const bars = Array.from({ length: 90 }, (_, k) => { const ds = today0.getTime() - (89 - k) * DAY; const l = dayLevel(c.id, ds);
        return '<i class="' + l + '" title="' + esc(new Date(ds).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' }) + ': ' + LABEL[l]) + '"></i>'; }).join('');
      return '<div class="st-row"><div class="st-top"><div><strong>' + esc(c.name) + '</strong><span class="small muted">' + esc(c.desc) + '</span></div>' +
        '<div class="st-now ' + lv + '"><span class="st-dot ' + lv + '"></span>' + LABEL[lv] + (L && L.ok && L.ms != null ? '<small>' + L.ms + ' ms</small>' : '') + '</div></div>' +
        '<div class="st-bars" aria-hidden="true">' + bars + '</div><div class="st-foot"><span>90 dagen geleden</span><span>' + uptime(c.id).toFixed(2).replace('.', ',') + '% beschikbaar</span><span>Vandaag</span></div></div>';
    }).join('');
    const worst = COMP.reduce((w, c) => { const l = now(c.id); return RANK[l] > RANK[w] ? l : w; }, 'ok');
    const msg = { ok: 'Alles werkt zoals het hoort', part: 'Een deel werkt minder goed', down: 'Er is een storing', maint: 'Er wordt onderhoud gedaan' }[worst];
    $('st-banner').className = 'st-banner ' + worst;
    $('st-banner').innerHTML = '<span class="st-dot ' + worst + '"></span><span>' + msg + '</span>';
    $('st-checked').textContent = 'Laatst gecontroleerd om ' + new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + '. Deze pagina controleert elke minuut opnieuw.';
    const inc = data ? data.incidents : [];
    $('st-inc').innerHTML = !data ? '<p class="muted">De meldingen konden niet geladen worden.</p>'
      : inc.length ? inc.map(i => '<article class="st-card' + (i.resolvedAt ? '' : ' open') + '"><div class="st-card-top"><strong>' + esc(i.title) + '</strong><span class="st-badge ' + (i.resolvedAt ? 'ok' : (LEVEL[i.level] || [0, 'part'])[1]) + '">' + (i.resolvedAt ? 'Opgelost' : (LEVEL[i.level] || [i.level])[0]) + '</span></div>' +
          '<p class="small muted">' + esc(fmt(i.startedAt)) + (i.resolvedAt ? ' – ' + esc(fmt(i.resolvedAt)) : ' · nog bezig') + ' · ' + esc(i.components.map(c => (COMP.find(x => x.id === c) || { name: c }).name).join(', ')) + '</p>' +
          (i.updates.length ? '<ol class="st-tl">' + i.updates.slice().reverse().map(u => '<li><span class="small muted">' + esc(fmt(u.at)) + '</span><p>' + esc(u.text) + '</p></li>').join('') + '</ol>' : '') + '</article>').join('')
      : '<p class="st-none">Geen storingen in de afgelopen 90 dagen.</p>';
  }
  async function run() {
    $('st-again').disabled = true;
    const ids = Object.keys(tests); const res = await Promise.all(ids.map(k => check(tests[k])));
    ids.forEach((k, i) => { live[k] = res[i]; });
    render(); $('st-again').disabled = false;
  }
  $('st-again').addEventListener('click', run);
  render(); run(); setInterval(run, 60000);
})();
