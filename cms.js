/* CrewHarbor · teksten van de website
   - Laadt aangepaste teksten (Beheer) en zet ze op de pagina.
   - Bewerkmodus: open een pagina met ?bewerken (ingelogd in Beheer). Klik op een tekst om hem te wijzigen,
     voeg items toe of haal ze weg, en sla op. Elementen met data-e zijn tekst, data-list zijn lijsten. */
(function () {
  'use strict';
  const CFG = window.CREWDECK_CONFIG || {};
  const PAGE = document.body.dataset.page || 'home';
  const EDIT = /[?&]bewerken\b/.test(location.search);
  const CK = p => 'ch-cms-' + p;
  const isG = k => /^g\d/.test(k);

  // ---------- veilig maken: alleen eenvoudige opmaak ----------
  const TAGS = new Set(['A', 'B', 'STRONG', 'I', 'EM', 'BR', 'SPAN', 'SMALL', 'SUP', 'SUB', 'U', 'P', 'H2', 'H3', 'H4', 'LI', 'DIV', 'ARTICLE', 'DETAILS', 'SUMMARY', 'UL', 'OL']);
  const okHref = h => /^(https?:\/\/|mailto:|tel:|#|\.\/|\.\.\/|app\/|[a-z0-9._-]+\.html)/i.test(h || '') && !/^\s*javascript:/i.test(h || '');
  const okStyle = s => /^\s*(--[a-z0-9-]+\s*:\s*[#0-9a-zA-Z%.,() -]+;?\s*)+$/.test(s || '');
  function clean(html) {
    const doc = new DOMParser().parseFromString('<div>' + String(html || '') + '</div>', 'text/html');
    const walk = el => [...el.childNodes].forEach(n => {
      if (n.nodeType === 3) return;
      if (n.nodeType !== 1 || !TAGS.has(n.tagName)) { if (n.nodeType === 1) { walk(n); n.replaceWith(...n.childNodes); } else n.remove(); return; }
      [...n.attributes].forEach(a => {
        const k = a.name.toLowerCase(), v = a.value;
        const keep = k === 'class' ? true : k === 'href' ? okHref(v) : k === 'style' ? okStyle(v) : ['data-e', 'data-list', 'aria-hidden', 'rel'].includes(k) || (k === 'target' && v === '_blank');
        if (!keep) n.removeAttribute(a.name);
        if (k === 'class') { const c = v.split(/\s+/).filter(x => x && !/^cms-/.test(x)).join(' '); if (c) n.setAttribute('class', c); else n.removeAttribute('class'); }
      });
      walk(n);
    });
    const root = doc.body.firstChild; walk(root); return root.innerHTML;
  }

  // ---------- origineel bewaren ----------
  const ORIG = { t: {}, href: {}, l: {} };
  const itemsOf = box => [...box.children].filter(c => !c.classList.contains('addons-l') && !c.classList.contains('cms-ui'));
  document.querySelectorAll('[data-e]').forEach(el => { ORIG.t[el.dataset.e] = el.innerHTML; if (el.tagName === 'A') ORIG.href[el.dataset.e] = el.getAttribute('href'); });
  document.querySelectorAll('[data-list]').forEach(box => { ORIG.l[box.dataset.list] = itemsOf(box).map(c => c.outerHTML); });

  // ---------- toepassen ----------
  function restore() {
    document.querySelectorAll('[data-list]').forEach(box => setItems(box, ORIG.l[box.dataset.list] || []));
    document.querySelectorAll('[data-e]').forEach(el => {
      const k = el.dataset.e; if (k in ORIG.t && el.innerHTML !== ORIG.t[k]) el.innerHTML = ORIG.t[k];
      if (el.tagName === 'A' && ORIG.href[k] != null) el.setAttribute('href', ORIG.href[k]);
      el.classList.remove('cms-hidden'); el.hidden = false;
    });
  }
  function setItems(box, list) {
    const cur = itemsOf(box);
    if (cur.length === list.length && cur.every((c, i) => c.outerHTML === list[i])) return;
    cur.forEach(c => c.remove());
    const tmp = document.createElement('div'); tmp.innerHTML = list.join('');
    [...tmp.children].forEach(c => { if (c.classList.contains('rv')) c.classList.add('in'); box.appendChild(c); });
  }
  function apply(D) {
    (D || []).forEach(d => {
      if (!d) return;
      Object.keys(d.l || {}).forEach(k => { const box = document.querySelector('[data-list="' + k + '"]'); if (box && Array.isArray(d.l[k])) setItems(box, d.l[k].map(clean)); });
    });
    (D || []).forEach(d => {
      if (!d) return;
      Object.keys(d.t || {}).forEach(k => {
        document.querySelectorAll('[data-e="' + k + '"]').forEach(el => {
          const v = d.t[k]; const h = typeof v === 'string' ? v : (v && v.h);
          if (h != null) { const c = clean(h); if (el.innerHTML !== c) el.innerHTML = c; }
          if (v && v.href && el.tagName === 'A' && okHref(v.href)) el.setAttribute('href', v.href);
        });
      });
      (d.h || []).forEach(k => document.querySelectorAll('[data-e="' + k + '"]').forEach(el => { el.classList.add('cms-hidden'); if (!EDIT) el.hidden = true; }));
    });
    document.dispatchEvent(new Event('cms'));
  }
  const read = p => { try { return JSON.parse(localStorage.getItem(CK(p)) || 'null'); } catch (e) { return null; } };
  const write = (p, v) => { try { localStorage.setItem(CK(p), JSON.stringify(v || {})); } catch (e) { /* */ } };
  const cached = [read('global'), read(PAGE)];
  if (cached[0] || cached[1]) apply(cached);
  const done = () => document.documentElement.classList.remove('cms-wait');
  setTimeout(done, 900);
  function fetchPage(p) {
    return fetch(CFG.supabaseUrl + '/rest/v1/rpc/cd_public_site', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: CFG.supabaseKey, Authorization: 'Bearer ' + CFG.supabaseKey }, body: JSON.stringify({ p_page: p }) })
      .then(r => r.ok ? r.json() : null).catch(() => null);
  }
  Promise.all([fetchPage('global'), fetchPage(PAGE)]).then(fresh => {
    const same = JSON.stringify(fresh.map(x => x || {})) === JSON.stringify(cached.map(x => x || {}));
    if (fresh[0] !== null) write('global', fresh[0]); if (fresh[1] !== null) write(PAGE, fresh[1]);
    if (!same && !EDIT) { restore(); apply(fresh); }
    done();
    if (EDIT) startEdit(fresh);
  });

  // ======================================================================
  // Bewerkmodus
  // ======================================================================
  function loadScript(src) { return new Promise((ok, bad) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = bad; document.head.appendChild(s); }); }
  function bar(html) {
    let b = document.getElementById('cms-bar');
    if (!b) { b = document.createElement('div'); b.id = 'cms-bar'; b.className = 'cms-ui cms-bar'; document.body.appendChild(b); }
    b.innerHTML = html; return b;
  }
  async function startEdit(fresh) {
    document.documentElement.classList.add('cms-edit');
    bar('<span>Bewerkmodus laden…</span>');
    let sb;
    try {
      await loadScript('app/vendor/supabase.js');
      sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, { auth: { storageKey: 'crewdeck-admin-auth', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
      const { data: s } = await sb.auth.getSession();
      if (!s.session) throw new Error('login: geen sessie');
      const { error } = await sb.rpc('cd_admin_whoami'); if (error) throw new Error('login: ' + error.message);
    } catch (e) {
      if (window.console) console.warn('cms', e);
      bar('<span><b>Bewerkmodus</b> · log eerst in bij CrewHarbor Beheer, dan kun je hier teksten aanpassen.</span><a class="cms-btn" href="app/admin.html">Naar Beheer</a><a class="cms-btn ghost" href="' + location.pathname + '">Stoppen</a>');
      return;
    }
    // huidige opgeslagen staat toepassen (ook verborgen dingen tonen we gestreept); alle vragen openklappen
    restore(); apply(fresh);
    document.querySelectorAll('details').forEach(d => { d.open = true; });
    let dirty = false;
    const mark = () => { dirty = true; const n = document.getElementById('cms-save'); if (n) { n.disabled = false; n.textContent = 'Opslaan'; } };
    const base = { global: fresh[0] || {}, page: fresh[1] || {} };
    const hidden = new Set([...(base.global.h || []), ...(base.page.h || [])]);
    const hrefs = {}; [base.global, base.page].forEach(d => Object.keys(d.t || {}).forEach(k => { const v = d.t[k]; if (v && v.href) hrefs[k] = v.href; }));

    // teksten bewerkbaar
    const prep = root => root.querySelectorAll('[data-e]').forEach(el => {
      if (el.closest('.cms-ui')) return;
      el.contentEditable = 'true'; el.spellcheck = true; el.classList.add('cms-ed');
      if (hidden.has(el.dataset.e)) el.classList.add('cms-hidden');
    });
    prep(document);
    document.addEventListener('input', e => { if (e.target.closest && e.target.closest('[data-e]')) mark(); }, true);
    document.addEventListener('paste', e => {
      const el = e.target.closest && e.target.closest('[data-e]'); if (!el) return;
      e.preventDefault(); const t = (e.clipboardData || window.clipboardData).getData('text/plain'); document.execCommand('insertText', false, t);
    }, true);
    document.addEventListener('keydown', e => {
      const el = e.target.closest && e.target.closest('[data-e]'); if (!el) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey || /^(P|LI|H1|H2)$/.test(el.tagName)) document.execCommand('insertLineBreak'); else el.blur();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
    }, true);
    // links en knoppen doen niets in de bewerkmodus (behalve onze eigen knoppen)
    document.addEventListener('click', e => {
      const a = e.target.closest('a,button,summary'); if (!a || a.closest('.cms-ui')) return;
      if (a.closest('[data-e]') || a.matches('[data-e]') || a.tagName === 'A') { if (a.tagName !== 'SUMMARY' || a.matches('[data-e]')) e.preventDefault(); }
    }, true);

    // klein menu bij het actieve element
    const tip = document.createElement('div'); tip.className = 'cms-ui cms-tip'; tip.hidden = true; document.body.appendChild(tip);
    let cur = null;
    const showTip = el => {
      cur = el; const k = el.dataset.e; const r = el.getBoundingClientRect();
      tip.innerHTML = '<button data-cms="hide">' + (el.classList.contains('cms-hidden') ? '👁 Tonen' : '🚫 Verbergen') + '</button>' +
        (el.tagName === 'A' && !isG(k) ? '<button data-cms="link">🔗 Link</button>' : '') + '<button data-cms="orig">↺ Origineel</button>';
      tip.hidden = false; tip.style.top = (window.scrollY + (r.top < 90 ? r.bottom + 6 : r.top - 40)) + 'px'; tip.style.left = (window.scrollX + Math.max(8, r.left)) + 'px';
    };
    document.addEventListener('focusin', e => { const el = e.target.closest && e.target.closest('[data-e]'); if (el && !el.closest('.cms-ui')) showTip(el); });
    tip.addEventListener('mousedown', e => e.preventDefault());
    tip.addEventListener('click', e => {
      const b = e.target.closest('[data-cms]'); if (!b || !cur) return; const k = cur.dataset.e;
      if (b.dataset.cms === 'hide') { cur.classList.toggle('cms-hidden'); if (cur.classList.contains('cms-hidden')) hidden.add(k); else hidden.delete(k); }
      if (b.dataset.cms === 'orig') { if (k in ORIG.t) cur.innerHTML = ORIG.t[k]; if (cur.tagName === 'A' && ORIG.href[k] != null) { cur.setAttribute('href', ORIG.href[k]); delete hrefs[k]; } cur.classList.remove('cms-hidden'); hidden.delete(k); }
      if (b.dataset.cms === 'link') { const v = prompt('Waar moet deze link naartoe? (bijv. https://…, #prijzen, support.html of mailto:…)', cur.getAttribute('href') || ''); if (v == null) return; if (!okHref(v.trim())) { alert('Dit adres kan niet. Begin met https://, #, mailto: of een paginanaam zoals support.html.'); return; } cur.setAttribute('href', v.trim()); hrefs[k] = v.trim(); }
      mark(); showTip(cur);
    });

    // lijsten: toevoegen, weghalen, verplaatsen
    const listUi = box => {
      itemsOf(box).forEach(it => {
        if (it.querySelector(':scope > .cms-item-ui')) return;
        it.classList.add('cms-item');
        const u = document.createElement('span'); u.className = 'cms-ui cms-item-ui';
        u.innerHTML = '<button data-li="up" title="Naar voren">↑</button><button data-li="down" title="Naar achteren">↓</button><button data-li="dup" title="Dupliceren">⧉</button><button data-li="del" title="Weghalen">✕</button>';
        it.prepend(u);
      });
      if (!box.nextElementSibling || !box.nextElementSibling.classList.contains('cms-add')) {
        const add = document.createElement('button'); add.className = 'cms-ui cms-add'; add.type = 'button'; add.textContent = '+ Item toevoegen aan deze lijst';
        add.addEventListener('click', () => { const last = itemsOf(box).pop(); if (last) { dup(last, true); } });
        box.after(add);
      }
    };
    const rekey = node => node.querySelectorAll('[data-e]').forEach(el => { el.dataset.e = el.dataset.e.replace(/x[a-z0-9]+$/, '') + 'x' + Math.random().toString(36).slice(2, 6); });
    function dup(it, atEnd) {
      const c = it.cloneNode(true); rekey(c); c.querySelectorAll('.cms-item-ui').forEach(x => x.remove()); c.classList.remove('cms-item');
      if (atEnd) it.parentNode.appendChild(c); else it.after(c);
      prep(c); listUi(c.parentNode); mark();
      const f = c.querySelector('[data-e]'); if (f) f.focus();
    }
    document.querySelectorAll('[data-list]').forEach(listUi);
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-li]'); if (!b) return; e.preventDefault(); e.stopPropagation();
      const it = b.closest('.cms-item'); const box = it.parentNode;
      if (b.dataset.li === 'del') { if (itemsOf(box).length <= 1) { alert('Een lijst moet minstens één item hebben. Verberg de tekst als je hem niet wilt tonen.'); return; } it.remove(); }
      if (b.dataset.li === 'dup') dup(it);
      if (b.dataset.li === 'up') { const p = it.previousElementSibling; if (p && !p.classList.contains('addons-l') && !p.classList.contains('cms-ui')) box.insertBefore(it, p); }
      if (b.dataset.li === 'down') { const n = it.nextElementSibling; if (n) box.insertBefore(n, it); }
      mark();
    }, true);

    // opslaan
    const ser = el => { const c = el.cloneNode(true); c.querySelectorAll('.cms-ui').forEach(x => x.remove()); [c, ...c.querySelectorAll('*')].forEach(x => { x.removeAttribute('contenteditable'); x.removeAttribute('spellcheck'); x.classList.remove('cms-ed', 'cms-item', 'cms-hidden', 'in'); if (!x.getAttribute('class')) x.removeAttribute('class'); }); return clean(c.outerHTML); };
    const inner = el => { const c = el.cloneNode(true); c.querySelectorAll('.cms-ui').forEach(x => x.remove()); return clean(c.innerHTML); };
    async function save() {
      const out = { global: { t: {}, h: [], l: {} }, page: { t: {}, h: [], l: {} } };
      const origItems = {}; Object.keys(ORIG.l).forEach(k => { origItems[k] = ORIG.l[k].map(h => { const d = document.createElement('div'); d.innerHTML = h; return ser(d.firstElementChild); }); });
      document.querySelectorAll('[data-list]').forEach(box => {
        const k = box.dataset.list; const now = itemsOf(box).map(ser);
        if (JSON.stringify(now) !== JSON.stringify(origItems[k] || [])) out.page.l[k] = now;
      });
      document.querySelectorAll('[data-e]').forEach(el => {
        if (el.closest('.cms-ui')) return;
        const k = el.dataset.e; const h = inner(el); const o = k in ORIG.t ? clean(ORIG.t[k]) : null;
        const tgt = isG(k) ? out.global : out.page;
        const href = el.tagName === 'A' && hrefs[k] && hrefs[k] !== ORIG.href[k] ? hrefs[k] : null;
        if (h !== o || href) tgt.t[k] = href ? { h, href } : h;
        if (el.classList.contains('cms-hidden')) tgt.h.push(k);
      });
      const empty = d => !Object.keys(d.t).length && !d.h.length && !Object.keys(d.l).length;
      const btn = document.getElementById('cms-save'); if (btn) { btn.disabled = true; btn.textContent = 'Opslaan…'; }
      try {
        for (const [p, d] of [['global', out.global], [PAGE, out.page]]) {
          const { data, error } = await sb.rpc('cd_admin_site_save', { p_page: p, p: empty(d) ? {} : d });
          if (error) throw new Error(error.message);
          write(p, data || {});
        }
        dirty = false; if (btn) btn.textContent = '✓ Opgeslagen';
        msg('Opgeslagen. De website laat het nu voor iedereen zien.');
      } catch (err) { if (btn) { btn.disabled = false; btn.textContent = 'Opslaan'; } msg('Opslaan mislukt: ' + err.message, true); }
    }
    function msg(t, bad) { const m = document.getElementById('cms-msg'); if (m) { m.textContent = t; m.className = 'cms-msg' + (bad ? ' bad' : ''); clearTimeout(msg.t); msg.t = setTimeout(() => { m.textContent = ''; }, 5000); } }
    const PAGES = [['index.html', 'Home'], ['prijzen.html', 'Prijzen'], ['support.html', 'Support'], ['status.html', 'Status']];
    bar('<span class="cms-title">✏️ <b>Bewerkmodus</b></span><span class="cms-hint">Klik op een tekst om hem te wijzigen. Menu en voettekst gelden voor alle pagina’s.</span>' +
      '<select id="cms-page" aria-label="Pagina">' + PAGES.map(p => '<option value="' + p[0] + '"' + (location.pathname.endsWith(p[0]) || (p[0] === 'index.html' && PAGE === 'home') ? ' selected' : '') + '>' + p[1] + '</option>').join('') + '</select>' +
      '<span id="cms-msg" class="cms-msg" role="status" aria-live="polite"></span>' +
      '<button class="cms-btn ghost" id="cms-reset">Pagina terugzetten</button><a class="cms-btn ghost" id="cms-stop" href="' + location.pathname + '">Stoppen</a><button class="cms-btn" id="cms-save" disabled>Opgeslagen</button>');
    document.getElementById('cms-save').addEventListener('click', save);
    document.getElementById('cms-page').addEventListener('change', e => { if (dirty && !confirm('Je hebt niet-opgeslagen wijzigingen. Toch naar een andere pagina?')) { e.target.value = PAGES.find(p => location.pathname.endsWith(p[0]))?.[0] || 'index.html'; return; } location.href = e.target.value + '?bewerken'; });
    document.getElementById('cms-stop').addEventListener('click', e => { if (dirty && !confirm('Je hebt niet-opgeslagen wijzigingen. Toch stoppen?')) e.preventDefault(); });
    document.getElementById('cms-reset').addEventListener('click', async () => {
      if (!confirm('Alle aanpassingen op deze pagina terugzetten naar de originele tekst? (Menu en voettekst blijven zoals ze zijn.)')) return;
      const { error } = await sb.rpc('cd_admin_site_save', { p_page: PAGE, p: {} });
      if (error) { msg(error.message, true); return; }
      write(PAGE, {}); location.reload();
    });
    window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
  }
})();
