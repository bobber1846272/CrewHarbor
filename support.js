/* CrewHarbor · supportpagina: contactgegevens laden, vragen doorzoeken, bericht versturen */
(function () {
  'use strict';
  const CFG = window.CREWDECK_CONFIG || {};
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  if (window.CH_LOGO) { $('logo').innerHTML = window.CH_LOGO(30); $('logo2').innerHTML = window.CH_LOGO(28); }

  function rpc(name, args) {
    return fetch(CFG.supabaseUrl + '/rest/v1/rpc/' + name, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: CFG.supabaseKey, Authorization: 'Bearer ' + CFG.supabaseKey },
      body: JSON.stringify(args || {})
    }).then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message || 'Er ging iets mis. Probeer het opnieuw of mail ons.'); return j; });
  }

  // contactgegevens (telefoon alleen als die in Beheer is ingesteld)
  if (CFG.supabaseUrl) rpc('cd_support_info').then(d => {
    if (d.email) { $('sup-mail').href = 'mailto:' + d.email; $('sup-mail-txt').textContent = d.email; }
    if (d.phone) {
      const a = document.createElement('a'); a.className = 'sup-way'; a.href = 'tel:' + d.phone.replace(/[^\d+]/g, '');
      a.innerHTML = '<strong>Bel ons</strong><span>' + esc(d.phone) + (d.hours ? '<br>' + esc(d.hours) : '') + '</span>';
      $('sup-ways').appendChild(a);
    }
  }).catch(() => { /* standaard mailadres blijft staan */ });

  // vragen doorzoeken
  $('sup-q').addEventListener('input', e => {
    const q = e.target.value.trim().toLowerCase();
    let shown = 0;
    document.querySelectorAll('#faq-groups .faq').forEach(group => {
      let n = 0;
      group.querySelectorAll('details').forEach(d => {
        const hit = !q || d.textContent.toLowerCase().includes(q);
        d.hidden = !hit; if (hit) n++;
        d.open = !!q && hit && q.length > 2;
      });
      group.hidden = !n; group.previousElementSibling.hidden = !n; shown += n;
    });
    $('faq-none').hidden = shown > 0;
  });

  // bericht versturen
  const form = $('sup-form'), msg = $('sup-msg');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const v = k => form.elements[k].value.trim();
    const miss = [];
    if (v('name').length < 2) miss.push('je naam');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v('email'))) miss.push('een geldig e-mailadres');
    if (v('message').length < 10) miss.push('je vraag (minstens 10 tekens)');
    if (miss.length) { msg.innerHTML = '<div class="alert error" role="alert">Vul nog in: ' + esc(miss.join(', ')) + '.</div>'; return; }
    const btn = form.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Versturen…';
    try {
      await rpc('cd_support_send', { p: { name: v('name'), email: v('email').toLowerCase(), company: v('company'), phone: v('phone'), topic: v('topic'), message: v('message'), website: form.elements.website.value } });
      form.innerHTML = '<div class="done" role="status"><h3>Bedankt, ' + esc(v('name').split(' ')[0]) + '!</h3><p>We hebben je bericht ontvangen en reageren zo snel mogelijk op <strong>' + esc(v('email')) + '</strong>.</p></div>';
    } catch (err) {
      msg.innerHTML = '<div class="alert error" role="alert">' + esc(err.message) + '</div>';
      btn.disabled = false; btn.textContent = 'Versturen';
    }
  });
})();
