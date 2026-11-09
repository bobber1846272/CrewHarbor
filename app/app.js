/* CrewHarbor — webapp
 * Praat met de database via gecontroleerde functies (public.cd_*) en met de logindienst (edge function "crewdeck").
 * Geen externe bibliotheken behalve de meegeleverde Supabase-client (vendor/supabase.js).
 */
'use strict';

const CFG = window.CREWDECK_CONFIG || {};
const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
  auth: { storageKey: 'crewdeck-auth', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
});
window.CHMFA.use(sb);
const $app = document.getElementById('app');

const PERM_GROUPS = [
  ['Terugbellen', [['callbacks.create', 'Verzoeken aanmaken'], ['callbacks.assign', 'Toewijzen aan collega’s'], ['callbacks.view_all', 'Verzoeken van collega’s zien'],
    ['callbacks.edit_all', 'Verzoeken van collega’s bewerken'], ['callbacks.delete', 'Verzoeken verwijderen']]],
  ['Taken', [['tasks.create', 'Taken aanmaken'], ['tasks.assign', 'Taken aan anderen geven'], ['tasks.view_all', 'Taken van collega’s zien'],
    ['tasks.edit_all', 'Taken van collega’s bewerken'], ['tasks.delete', 'Taken verwijderen'], ['tasks.archive', 'Taakarchief: afgeronde taken van iedereen bekijken en aanpassen']]],
  ['Uren', [['hours.view_all', 'Uren van iedereen zien'], ['hours.approve', 'Uren en verlof goedkeuren'], ['hours.plan', 'Rooster plannen'], ['hours.kiosk', 'Prikklok instellen'], ['hours.kiosk_exit', 'Prikklok verlaten met eigen code'], ['hours.clocked', 'Zien wie ingeklokt is en sinds hoe laat'], ['hours.leave_balance', 'Verlofsaldo van medewerkers instellen']]],
  ['Kennis & documenten', [['kb.edit', 'Kennisbank bewerken'], ['docs.upload', 'Documenten uploaden'], ['docs.manage', 'Mappen en documenten beheren']]],
  ['Teamleiding', [['team.board', 'Teambord'], ['reports.view', 'Cijfers'], ['phone.view', 'Telefonie bekijken'], ['audit.view', 'Logboek']]],
  ['Beheer', [['members.manage', 'Medewerkers beheren'], ['roles.manage', 'Rollen en rechten beheren'], ['org.manage', 'Bedrijfsinstellingen']]]
];
const REPEATS = { none: 'Niet herhalen', werkdag: 'Elke werkdag', dag: 'Elke dag', week: 'Elke week' };
const TIMEZONES = ['Europe/Amsterdam', 'Europe/Brussels', 'Europe/Berlin', 'Europe/London', 'Europe/Paris', 'America/Paramaribo', 'America/Curacao', 'Asia/Jakarta'];

const S = {
  me: null, org: null, perms: new Set(), roleName: '',
  authError: null, regInfo: null, requestSent: null,
  counts: { mine: 0, pool: 0, tasks: 0 }, myCbs: [], poolCbs: [], myTasks: [], weekStats: null,
  seen: null, quiet: false, colleagues: [],
  cbTab: 'mine', cbList: [], cbSel: null, cbQ: '', cbResults: null,
  tView: 'mine', tasks: [], tWho: 'ALL', showArchive: false, searchOpen: false, q: '', results: null,
  team: null, stats: null, statDays: 7, log: null, logUser: '', logQ: '',
  members: [], roles: null, mSel: null, mNew: false, shownCode: null, rSel: null, rNew: false,
  F: null, T: null, edit: null, dup: null,
  nowWeek: null, running: null, pendingCount: 0,
  hours: null, hWeek: null, hMember: null, hKeep: false, hEdit: null,
  roster: null, rosterWeek: null, shiftEdit: null,
  pending: null, pOff: {}, rejectFor: null,
  report: null, repPeriod: 'maand', repFrom: null, repTo: null,
  phone: null, phStatus: null, phPeriod: 'week', phSyncing: false, phSyncedAt: 0, phEdit: false, phDisc: false,
  kb: null, kbQ: '', kbCat: '', kbSel: null, kbArticle: null, kbEdit: null,
  docs: null, docFolder: null, folderEdit: null, uploading: null,
  mTab: 'actief', offboard: null, kiosks: null, kioskName: '',
  rosterView: null, rosterMonth: null, rosterWho: '', rosterCompare: false, tplModal: false, tplEdit: null,
  abs: null, absForm: null, absReject: null, absPending: 0, av: null, avRoster: null, avMonth: null, avSel: {}, avEdit: null,
  notif: null, notifSeen: null, notifUnreadIds: null
};
const K = { info: null, error: null, sel: null, code: '', busy: false, result: null, q: '', last: 0, taps: [], exit: null };
const kioskToken = () => { try { return localStorage.getItem('crewdeck-kiosk') || ''; } catch (e) { return ''; } };
const can = p => S.perms.has(p);
const same = (a, b) => a != null && b != null && String(a) === String(b);

// ---------- hulpjes ----------
function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function initials(name) {
  const p = String(name || '?').trim().split(/\s+/);
  return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : (p[0][1] || ''))).toUpperCase();
}
const COLORS = ['#334155', '#1D6E7B', '#1D4ED8', '#7A2E8E', '#9A3412', '#166534', '#9F1239', '#0E7490'];
function colorFor(id) { let h = 0; String(id).split('').forEach(c => { h = (h * 31 + c.charCodeAt(0)) >>> 0; }); return COLORS[h % COLORS.length]; }
function avatar(id, name, cls) { const ph = S.photos && S.photos[id]; if (ph) return '<span class="avatar photo ' + (cls || '') + '" title="' + esc(name) + '"><img src="' + esc(ph) + '" alt=""></span>'; return '<span class="avatar ' + (cls || '') + '" style="background:' + colorFor(id) + '" title="' + esc(name) + '">' + esc(initials(name)) + '</span>'; }
function pad(n) { return String(n).padStart(2, '0'); }
function toLocalInput(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
function isoToInput(v) { if (!v) return ''; const d = new Date(v); return isNaN(d) ? '' : toLocalInput(d); }
function inputToIso(v) { if (!v) return null; const d = new Date(v); return isNaN(d) ? null : d.toISOString(); }
function defaultDue(hours) { const d = new Date(Date.now() + hours * 3600000); d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0); return toLocalInput(d); }
const DAYS = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
const DAYS_FULL = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
const MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
function hm(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
function sameDay(a, b) { return a.toDateString() === b.toDateString(); }
function fmtDate(v) {
  if (!v) return '';
  const d = new Date(v); if (isNaN(d)) return '';
  const now = new Date(); const y = new Date(now); y.setDate(now.getDate() - 1);
  if (sameDay(d, now)) return 'vandaag ' + hm(d);
  if (sameDay(d, y)) return 'gisteren ' + hm(d);
  return DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + (d.getFullYear() !== now.getFullYear() ? ' ' + d.getFullYear() : '') + ' ' + hm(d);
}
function humanMin(min) {
  if (min == null) return '–';
  if (min < 60) return Math.round(min) + ' min';
  const h = min / 60;
  if (h < 24) return (h < 10 ? h.toFixed(1).replace('.', ',') : Math.round(h)) + ' uur';
  const d = Math.floor(h / 24); return d + ' dag' + (d > 1 ? 'en' : '');
}
function dueBadge(v, kind) {
  if (!v) return '<span class="badge">' + (kind === 'bel' ? 'Geen tijd' : 'Geen deadline') + '</span>';
  const d = new Date(v); if (isNaN(d)) return '';
  const diff = Math.round((d - Date.now()) / 60000);
  const now = new Date(); const tm = new Date(now); tm.setDate(now.getDate() + 1);
  if (diff < 0) return '<span class="badge red">Te laat · ' + humanMin(-diff) + '</span>';
  if (diff <= 60) return '<span class="badge orange">' + (kind === 'bel' ? 'Bel vóór ' : 'Vóór ') + hm(d) + '</span>';
  if (sameDay(d, now)) return '<span class="badge green">Vandaag ' + hm(d) + '</span>';
  if (sameDay(d, tm)) return '<span class="badge">Morgen ' + hm(d) + '</span>';
  return '<span class="badge">' + DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + hm(d) + '</span>';
}
function isLate(v) { return v && new Date(v) < new Date(); }
function within(v, min) { if (!v) return false; const diff = (new Date(v) - Date.now()) / 60000; return diff >= 0 && diff <= min; }
function cbTitle(c) { return c.type === 'particulier' ? c.name : c.company; }
function canEditCb(c) { return can('callbacks.edit_all') || same(c.createdBy, S.me.id) || same(c.assignee, S.me.id); }
function canEditTask(t) { return can('tasks.edit_all') || same(t.createdBy, S.me.id); }
const settings = () => (S.org && S.org.settings) || {};

let toastTimer;
function toast(msg, isError) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'show' + (isError ? ' error' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = ''; }, 3800);
}

// ---------- verbinding ----------
function cleanErr(m) { return String(m || 'Er ging iets mis.').replace(/^.*?ERROR:\s*/, ''); }
async function rpc(name, args) {
  const { data, error } = await sb.rpc(name, args || {});
  if (error) {
    if (error.code === '28000' || error.code === 'PGRST301' || /JWT expired|invalid JWT/i.test(error.message)) {
      await loggedOut('Je sessie is verlopen of je account is gedeactiveerd. Log opnieuw in.');
    }
    const err = new Error(cleanErr(error.message)); err.code = error.code; throw err;
  }
  if (typeof scheduleFlush === 'function') scheduleFlush(name);
  return data;
}
async function svc(action, body) {
  const { data: { session } } = await sb.auth.getSession();
  let res;
  try {
    res = await fetch(CFG.supabaseUrl + '/functions/v1/crewdeck', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: CFG.supabaseKey, Authorization: 'Bearer ' + (session ? session.access_token : CFG.supabaseKey) },
      body: JSON.stringify(Object.assign({ action }, body || {}))
    });
  } catch (e) { throw new Error('Geen verbinding met de server.'); }
  let data = {};
  try { data = await res.json(); } catch (e) { /* leeg */ }
  if (!res.ok) throw new Error(data.error || 'Er ging iets mis.');
  return data;
}
async function loggedOut(msg) {
  try { await sb.auth.signOut({ scope: 'local' }); } catch (e) { /* */ }
  S.me = null; S.seen = null; S.perms = new Set(); S.authError = msg || null;
  S.mfa = null;
  if (!AC_PUBLIC.includes(route())) location.hash = '#/login';
  render();
}
async function loadPhotos(force) {
  const key = 'crewdeck-photos-' + (S.org && S.org.id);
  if (!S.me.avatarsAt) { S.photos = {}; return; }
  if (!force) { try { const c = JSON.parse(localStorage.getItem(key) || 'null'); if (c && c.at === S.me.avatarsAt) { S.photos = c.photos || {}; return; } } catch (e) { /* */ } }
  try { const d = await rpc('cd_avatars'); S.photos = d.photos || {}; try { localStorage.setItem(key, JSON.stringify(d)); } catch (e) { /* vol */ } } catch (e) { S.photos = S.photos || {}; }
}
async function loadSession() {
  const s = await rpc('cd_session');
  S.me = s.member; S.org = s.org; S.perms = new Set(s.perms); S.roleName = s.member.roleName;
  await loadPhotos();
  if (typeof loadBusiness === 'function' && !S.loc) await loadBusiness();
}

const ICON = {
  plus: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  search: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  x: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  box: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4"/></svg>',
  edit: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m14 6 4 4"/></svg>',
  trash: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  repeat: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-2px"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/></svg>',
  lock: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  bell: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21a2 2 0 0 0 4 0"/></svg>',
  shield: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/></svg>',
  alert: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#B42318" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex:none;margin-top:1px"><circle cx="12" cy="12" r="10"/><path d="M12 7v6M12 16.5v.5"/></svg>',
  warn: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#B54708" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex:none;margin-top:1px"><path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17v.5"/></svg>',
  check: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#067647" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex:none"><path d="M5 12l5 5L20 7"/></svg>',
  left: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',
  right: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
  chev: '<svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
  download: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
  upload: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20V9M7 14l5-5 5 5M5 4h14"/></svg>',
  pin: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-2px"><path d="M12 17v5M8 3h8l-1 6 3 4H6l3-4z"/></svg>',
  file: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5"/></svg>',
  folder: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  tick: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#7FC4CF" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>'
};
const NI = (() => {
  const i = d => '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  return {
    overzicht: i('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'),
    terugbellen: i('<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>'),
    taken: i('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m8 12 3 3 5-6"/>'),
    uren: i('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    rooster: i('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
    goedkeuren: i('<path d="M20 6 9 17l-5-5"/>'),
    urenoverzicht: i('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
    telefonie: i('<path d="M4 4h3.5l1.5 4-2 1.2a9 9 0 0 0 4 4L12.2 11l4 1.5V16a1.5 1.5 0 0 1-1.5 1.5A12.5 12.5 0 0 1 2.5 5.5 1.5 1.5 0 0 1 4 4"/><path d="M17 3v6M20 5v4M14 6v3"/>'),
    meldingen: i('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21a2 2 0 0 0 4 0"/>'),
    beschikbaar: i('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="m9 15 2 2 4-4"/>'),
    verlof: i('<path d="M12 3v2M5.6 5.6 7 7M3 12h2M19 12h2M17 7l1.4-1.4"/><path d="M8 14a4 4 0 0 1 8 0"/><path d="M3 18h18M6 21h12"/>'),
    prikklok: i('<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01M9 6h6M9 10h6"/>'),
    kennisbank: i('<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/><path d="M9 7h6"/>'),
    documenten: i('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
    team: i('<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="11" rx="1.5"/><rect x="17" y="4" width="4" height="7" rx="1.5"/>'),
    cijfers: i('<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>'),
    dashboard: i('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'),
    logboek: i('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'),
    mensen: i('<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M16 4a4 4 0 0 1 0 8M22 21a6 6 0 0 0-4-5.6"/>'),
    rollen: i('<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>'),
    instellingen: i('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>')
  };
})();
const LOGO = size => '<span class="logo">' + window.CH_LOGO(size) + '</span>'; // zie logo.js

// ---------- meldingen ----------
const prefs = (() => { try { return JSON.parse(localStorage.getItem('crewdeck-prefs') || '{}'); } catch (e) { return {}; } })();
function savePrefs() { try { localStorage.setItem('crewdeck-prefs', JSON.stringify(prefs)); } catch (e) { /* */ } }
if (prefs.sound === undefined) prefs.sound = true;
let audioCtx = null;
function unlockAudio() { if (audioCtx) return; try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { audioCtx = null; } }
document.addEventListener('pointerdown', unlockAudio, { once: true });
function beep() {
  if (!prefs.sound || !audioCtx) return;
  try {
    const t = audioCtx.currentTime;
    [[880, 0], [1175, 0.16]].forEach(([f, d]) => {
      const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(0.25, t + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.25);
      o.connect(g).connect(audioCtx.destination); o.start(t + d); o.stop(t + d + 0.3);
    });
  } catch (e) { /* */ }
}
const canSysNotify = () => 'Notification' in window && window.isSecureContext;
const APP = window.CrewdeckApp || null; // de Android-app geeft deze brug mee
if (APP) document.documentElement.classList.add('in-app');
function notify(title, body) {
  beep(); toast(title + (body ? ': ' + body : ''));
  if (APP && document.hidden) { try { APP.notify(title, body || ''); } catch (e) { /* */ } }
  if (canSysNotify() && Notification.permission === 'granted' && document.hidden) { try { new Notification(title, { body, icon: 'icon.svg' }); } catch (e) { /* */ } }
}
function updateTitle() {
  const n = S.counts.mine + S.counts.tasks + (S.notif ? S.notif.unread : 0);
  document.title = (n ? '(' + n + ') ' : '') + 'CrewHarbor' + (S.org ? ' · ' + S.org.name : '');
}

// ---------- routes ----------
const ROUTES = ['overzicht', 'terugbellen', 'verzoek', 'taken', 'taak', 'uren', 'rooster', 'goedkeuren', 'urenoverzicht', 'prikklok', 'klok', 'verlof', 'beschikbaar', 'meldingen', 'kennisbank', 'documenten',
  'team', 'dashboard', 'cijfers', 'telefonie', 'logboek', 'mensen', 'rollen', 'instellingen', 'login', 'registreren', 'vergeten', 'wachtwoord', 'email'];
const ROUTE_PERM = { team: 'team.board', cijfers: 'reports.view', telefonie: 'phone.view', logboek: 'audit.view', instellingen: null, goedkeuren: 'hours.approve', urenoverzicht: 'hours.view_all', prikklok: 'hours.kiosk',
  mensen: ['members.manage', 'roles.manage'], rollen: ['members.manage', 'roles.manage'] };
function route() { const h = location.hash.replace(/^#\/?/, '').split('?')[0]; return ROUTES.includes(h) ? h : (S.me ? 'overzicht' : (kioskToken() ? 'klok' : 'login')); }
function go(r) { if (location.hash === '#/' + r) onRoute(); else location.hash = '#/' + r; }
window.addEventListener('hashchange', onRoute);
function allowed(r) {
  if (r === 'dashboard') return !!(S.me && (S.me.isOwner || can('reports.view')));
  if (r === 'telefonie' && typeof hasFeature === 'function' && !hasFeature('phone')) return false;
  const p = ROUTE_PERM[r];
  if (!p) return true;
  return Array.isArray(p) ? p.some(can) : can(p);
}

async function onRoute() {
  const r = route();
  if (r === 'klok') { await loadKiosk(); render(); return; }
  if (r === 'wachtwoord' || r === 'email') { await loadToken(); render(); return; }
  if (!S.me) {
    if ((r === 'registreren' || r === 'login') && !S.regInfo) { try { S.regInfo = await svc('register-info'); } catch (e) { S.regInfo = { open: false }; } }
    if (!AC_PUBLIC.includes(r)) { location.hash = '#/login'; return; }
    render(); return;
  }
  if (AC_PUBLIC.includes(r)) { go('overzicht'); return; }
  if (APP && typeof loadMobile === 'function') { try { await loadMobile(); } catch (e) { toast(e.message, true); } render(); return; }
  if (!allowed(r)) { go('overzicht'); return; }
  if (r === 'uren' && !S.hKeep) { S.hMember = null; }
  S.hKeep = false;
  if (r !== 'uren') S.hEdit = null;
  if (r !== 'rooster') S.shiftEdit = null;
  if (r !== 'verlof') { S.absForm = null; S.absReject = null; }
  if (r !== 'beschikbaar') S.avSel = {};
  if (r !== 'documenten') S.folderEdit = null;
  try {
    if (r === 'verzoek' || r === 'taak') {
      await loadColleagues();
      const edit = S.edit; S.edit = null; S.dup = null;
      if (r === 'verzoek') {
        S.F = newCallbackForm();
        if (edit && edit.kind === 'cb') {
          const c = await rpc('cd_callback_get', { p_id: edit.id });
          Object.assign(S.F, { editId: c.id, type: c.type, company: c.company || '', contact: c.contact || '', name: c.name || '', phone: c.phone || '',
            email: c.email || '', order: c.order || '', category: c.category, priority: c.priority, dueAt: isoToInput(c.dueAt), note: c.note || '',
            assign: same(c.assignee, S.me.id) ? 'me' : (c.assignee ? 'colleague' : 'pool'), colleague: c.assignee && !same(c.assignee, S.me.id) ? String(c.assignee) : '' });
        }
      } else {
        S.T = newTaskForm();
        if (edit && edit.kind === 'task') {
          const t = await rpc('cd_task_get', { p_id: edit.id });
          const sel = {}; t.assignees.forEach(a => { sel[a.id] = true; });
          Object.assign(S.T, { editId: t.id, title: t.title, desc: t.desc || '', dueAt: isoToInput(t.dueAt), priority: t.priority, sel, mode: t.mode, repeat: t.repeat || 'none' });
        }
      }
    }
    await loadRoute();
  } catch (e) { toast(e.message, true); }
  S.quiet = false;
  render();
  window.scrollTo(0, 0);
}

async function loadRoute() {
  if (typeof isMobileApp === 'function' && isMobileApp()) return loadMobile();
  const r = route();
  const jobs = [loadCounts(), loadPresence()];
  if (r === 'overzicht' && can('reports.view')) jobs.push(rpc('cd_stats', { p_days: 7 }).then(s => { S.weekStats = s; }));
  if (r === 'terugbellen') jobs.push(loadCallbacks(), loadColleagues());
  if (r === 'taken') jobs.push(loadTasks());
  if (r === 'team') jobs.push(rpc('cd_team_board').then(d => { S.team = d; }));
  if (r === 'dashboard' && typeof loadDashboard === 'function') jobs.push(loadDashboard());
  if (r === 'cijfers') jobs.push(rpc('cd_stats', { p_days: S.statDays }).then(d => { S.stats = d; }));
  if (r === 'logboek') jobs.push(loadLog(), loadColleagues());
  if (r === 'mensen' || r === 'rollen') jobs.push(loadPeople());
  if (r === 'mensen') jobs.push(rpc('cd_units').then(d => { S.units = d; }).catch(() => { S.units = null; }));
  if (r === 'uren') jobs.push(loadHours());
  if (r === 'rooster') jobs.push(loadRoster());
  if (r === 'rooster' && typeof loadSwaps === 'function') jobs.push(loadSwaps());
  if (r === 'goedkeuren') jobs.push(rpc('cd_hours_pending').then(d => { S.pending = d; }));
  if (r === 'urenoverzicht') jobs.push(loadReport());
  if (r === 'telefonie') jobs.push(loadPhone());
  if (r === 'instellingen') jobs.push(loadSecurity());
  if (r === 'instellingen' && S.me && S.me.isOwner) jobs.push(rpc('cd_pin_windows').then(d => { S.pinWin = d; }).catch(() => { S.pinWin = null; }));
  if (typeof loadBizRoute === 'function') jobs.push(loadBizRoute(r));
  if (r === 'instellingen' && can('org.manage')) jobs.push(rpc('cd_phone_status').then(d => { S.phStatus = d; }).catch(() => { S.phStatus = null; }));
  if (r === 'prikklok') jobs.push(rpc('cd_kiosks').then(d => { S.kiosks = d; }));
  if (r === 'verlof') jobs.push(loadAbsences());
  if (r === 'beschikbaar') jobs.push(loadAvailability());
  if (r === 'kennisbank') jobs.push(loadKb());
  if (r === 'documenten') jobs.push(loadDocs());
  await Promise.all(jobs);
  if (r === 'meldingen' && S.notif) {
    S.notifUnreadIds = new Set(S.notif.items.filter(n => !n.read).map(n => n.id));
    if (S.notif.unread) { await rpc('cd_notifications_read'); S.notif.unread = 0; S.notif.items.forEach(n => { n.read = true; }); }
  }
}
async function loadCounts() {
  const [a, b, c, w, p] = await Promise.all([rpc('cd_callbacks', { p_scope: 'mine' }), rpc('cd_callbacks', { p_scope: 'pool' }), rpc('cd_tasks', { p_scope: 'mine' }),
    rpc('cd_hours_week', { p_member: null, p_week: null }), can('hours.approve') ? rpc('cd_hours_pending') : Promise.resolve([])]);
  S.nowWeek = w; S.running = w.running; S.pendingCount = p.length;
  try {
    const [nt, pl] = await Promise.all([rpc('cd_notifications'), can('hours.approve') ? rpc('cd_absences', { p_scope: 'pending' }) : Promise.resolve([])]);
    S.absPending = pl.length;
    const fresh = nt.items.filter(n => !n.read && S.notifSeen && !S.notifSeen.has(n.id));
    if (fresh.length && !S.quiet) notify(fresh.length === 1 ? 'Nieuwe melding' : fresh.length + ' nieuwe meldingen', fresh.slice(0, 2).map(n => n.text).join(' · '));
    S.notifSeen = new Set(nt.items.map(n => n.id)); S.notif = nt;
  } catch (e) { /* meldingen zijn niet kritisch */ }
  const openTasks = c.filter(t => !t.done && !t.mineDone && !t.archived);
  S.myCbs = a; S.poolCbs = b; S.myTasks = c;
  S.counts = { mine: a.length, pool: b.length, tasks: openTasks.length };
  if (S.seen && !S.quiet) {
    const newCb = a.filter(x => !S.seen.cb.includes(x.id) && !same(x.createdBy, S.me.id));
    const newTk = openTasks.filter(x => !S.seen.task.includes(x.id) && !same(x.createdBy, S.me.id));
    if (newCb.length) notify(newCb.length === 1 ? 'Nieuw terugbelverzoek voor jou' : newCb.length + ' nieuwe terugbelverzoeken', newCb.map(cbTitle).join(', '));
    if (newTk.length) notify(newTk.length === 1 ? 'Nieuwe taak voor jou' : newTk.length + ' nieuwe taken', newTk.map(t => t.title).join(', '));
  }
  S.seen = { cb: [...new Set([...(S.seen ? S.seen.cb : []), ...a.map(x => x.id)])], task: [...new Set([...(S.seen ? S.seen.task : []), ...openTasks.map(x => x.id)])] };
  updateTitle();
}
async function loadColleagues() { S.colleagues = await rpc('cd_colleagues'); }
async function loadCallbacks() {
  if (S.cbTab === 'all' && !can('callbacks.view_all')) S.cbTab = 'mine';
  S.cbList = await rpc('cd_callbacks', { p_scope: S.cbTab });
  if (S.cbQ.trim().length >= 2) S.cbResults = await rpc('cd_callback_search', { p_q: S.cbQ.trim() });
  const list = S.cbResults && S.cbQ.trim().length >= 2 ? S.cbResults : S.cbList;
  if (!list.some(c => same(c.id, S.cbSel))) S.cbSel = list.length ? list[0].id : null;
}
async function loadTasks() {
  if ((S.tView === 'all' && !can('tasks.view_all')) || (S.tView === 'archive' && !can('tasks.archive'))) S.tView = 'mine';
  S.tasks = await rpc('cd_tasks', { p_scope: S.tView });
}
async function loadLog() { S.log = await rpc('cd_audit', { p_member: S.logUser || null, p_q: S.logQ.trim() || null }); }
async function loadPeople() {
  const [m, r] = await Promise.all([rpc('cd_members'), rpc('cd_roles')]);
  S.members = m; S.roles = r;
}

// ---------- render ----------
function render() {
  const r = route();
  if (APP && APP.keepAwake) { try { APP.keepAwake(r === 'klok'); } catch (e) { /* */ } }
  if (r === 'klok') { document.title = 'Prikklok · CrewHarbor'; $app.innerHTML = viewKiosk(); return; }
  if (S.mfa) { document.title = 'Tweestapsverificatie · CrewHarbor'; $app.innerHTML = viewMfa(); return; }
  if (r === 'wachtwoord' || r === 'email') { document.title = 'CrewHarbor'; $app.innerHTML = viewToken(); return; }
  if (!S.me) {
    document.title = 'CrewHarbor';
    $app.innerHTML = r === 'registreren' ? viewRegister() : r === 'vergeten' ? viewForgot() : viewLoginEmail();
    return;
  }
  if (typeof needWizard === 'function' && needWizard()) { document.title = 'Welkom · CrewHarbor'; $app.innerHTML = viewWizard(); return; }
  if (APP && typeof viewMobile === 'function') { $app.innerHTML = viewMobile(); updateTitle(); return; }
  const views = { overzicht: viewHome, terugbellen: viewCallbacks, verzoek: viewCallbackForm, taken: viewTasks, taak: viewTaskForm, team: viewTeam,
    dashboard: typeof viewDashboard === 'function' ? viewDashboard : viewHome, cijfers: viewStats, logboek: viewLog, mensen: viewMembers, rollen: viewRoles, instellingen: viewSettings,
    uren: viewHours, rooster: viewRoster, prikklok: viewKioskAdmin, verlof: viewAbsence, beschikbaar: viewAvailability, meldingen: viewNotifications, goedkeuren: viewApprove, urenoverzicht: viewReport, telefonie: viewPhone, kennisbank: viewKb, documenten: viewDocs };
  // scrollpositie bewaren bij opnieuw tekenen van dezelfde pagina (bijv. na slepen in het rooster)
  const keep = S.lastRoute === r ? ['.roster-scroll', '.nav', '.pres-panel', '.tl', '.month-grid'].map(q => { const el = document.querySelector(q); return el ? [q, el.scrollTop, el.scrollLeft] : null; }).filter(Boolean) : [];
  const wy = window.scrollY, wx = window.scrollX;
  $app.innerHTML = '<div class="shell">' + viewNav(r) + '<main class="main' + (r === 'team' || r === 'rooster' ? ' wide' : '') + '" id="main">' + (views[r] || viewHome)() + '</main>' + viewPresence() + '</div>';
  keep.forEach(([q, t, l]) => { const el = document.querySelector(q); if (el) { el.scrollTop = t; el.scrollLeft = l; } });
  if (S.lastRoute === r && (window.scrollY !== wy || window.scrollX !== wx)) window.scrollTo(wx, wy);
  S.lastRoute = r;
  updateTitle();
}
function renderKeepFocus() {
  const a = document.activeElement; const id = a && a.id;
  const pos = a && typeof a.selectionStart === 'number' ? a.selectionStart : null;
  render();
  if (id) { const el = document.getElementById(id); if (el) { el.focus(); if (pos != null) try { el.setSelectionRange(pos, pos); } catch (e) { /* */ } } }
}

// ----- inloggen & registreren -----
function brandPanel(title, sub) {
  return '<section class="login-brand">' +
    '<div>' + LOGO(36) + '</div>' +
    '<div><h1>' + title + '</h1><p>' + sub + '</p>' +
    '<ul class="feature-list">' +
      ['Terugbelverzoeken en taken op één plek', 'Uren, in- en uitklokken en roosters', 'Kennisbank en documenten met rechten per map', 'Rollen, teambord, cijfers en een volledig logboek']
        .map(t => '<li>' + ICON.tick + '<span>' + t + '</span></li>').join('') + '</ul></div>' +
    '<div class="spark"><span>Een product van <strong>Spark Apps</strong></span></div></section>';
}
function viewLogin() {
  const last = (() => { try { return localStorage.getItem('crewdeck-company') || ''; } catch (e) { return ''; } })();
  return '<div class="login">' + brandPanel('De vaste haven voor je team.', 'Inloggen met je bedrijfscode, naam en persoonlijke code.') +
    '<section class="login-main"><form class="login-card" data-form="login" novalidate>' +
      '<div><h2>Inloggen met een code</h2><p class="muted" style="margin:6px 0 0;font-size:14px">De oude manier. Na het inloggen koppel je bij Instellingen je e-mailadres.</p></div>' +
      (S.authError ? '<div class="alert error" role="alert">' + ICON.alert + '<span>' + esc(S.authError) + '</span></div>' : '') +
      '<div class="field"><label for="l-company">Bedrijfscode</label><input class="input" id="l-company" name="company" autocomplete="organization" autocapitalize="none" spellcheck="false" value="' + esc(last) + '" required></div>' +
      '<div class="field"><label for="l-name">Naam</label><input class="input" id="l-name" name="name" autocomplete="username" required></div>' +
      '<div class="field"><label for="l-code">Code</label><input class="input code-input" id="l-code" name="code" type="password" inputmode="numeric" autocomplete="current-password" required></div>' +
      '<button class="btn primary" type="submit" id="l-submit">Inloggen</button>' +
      '<p class="switch"><button type="button" class="linkbtn" data-act="ac-back">Inloggen met e-mailadres</button></p>' +
    '</form></section></div>';
}
function viewRegister() {
  const info = S.regInfo || { open: false };
  let form;
  if (info.request) {
    if (S.requestSent) {
      form = '<div class="login-card" style="max-width:460px"><h2>Aanvraag ontvangen</h2>' +
        '<div class="alert info"><span>Bedankt! We nemen je aanvraag zo snel mogelijk in behandeling. Zodra je bedrijf klaarstaat, krijg je op <strong>' + esc(S.requestSent) + '</strong> een mail om je wachtwoord te kiezen.</span></div>' +
        '<p class="switch"><a href="#/login">Terug naar inloggen</a></p></div>';
    } else {
      form = '<form class="login-card" data-form="request" novalidate style="max-width:460px">' +
        '<div><h2>CrewHarbor aanvragen</h2><p class="muted" style="margin:6px 0 0;font-size:14px">Wij zetten je bedrijf klaar. Daarna krijg je een mail om je wachtwoord te kiezen.</p></div>' +
        (S.authError ? '<div class="alert error" role="alert">' + ICON.alert + '<span>' + esc(S.authError) + '</span></div>' : '') +
        '<div class="field"><label for="q-company">Bedrijfsnaam</label><input class="input" id="q-company" name="company" autocomplete="organization" required></div>' +
        '<div class="field"><label for="q-name">Jouw naam</label><input class="input" id="q-name" name="contactName" autocomplete="name" required></div>' +
        '<div class="field"><label for="q-email">E-mailadres</label><input class="input" id="q-email" name="email" type="email" autocomplete="email" required></div>' +
        '<div class="grid2"><div class="field"><label for="q-phone">Telefoon <span class="muted">(optioneel)</span></label><input class="input" id="q-phone" name="phone" type="tel" autocomplete="tel"></div>' +
        '<div class="field"><label for="q-emp">Aantal medewerkers</label><select class="input" id="q-emp" name="employees"><option value="">Kies…</option>' +
          ['1-5', '6-15', '16-50', '51-100', '100+'].map(o => '<option>' + o + '</option>').join('') + '</select></div></div>' +
        '<div class="field"><label for="q-msg">Toelichting <span class="muted">(optioneel)</span></label><textarea class="input" id="q-msg" name="message" rows="3" placeholder="Waarvoor wil je CrewHarbor gebruiken?"></textarea></div>' +
        '<div class="honeypot" aria-hidden="true"><label for="q-web">Website</label><input id="q-web" name="website" tabindex="-1" autocomplete="off"></div>' +
        '<button class="btn primary" type="submit" id="q-submit">Aanvraag versturen</button>' +
        '<p class="switch">Al een account? <a href="#/login">Inloggen</a></p></form>';
    }
    return '<div class="login">' + brandPanel('Begin met CrewHarbor.', 'Vraag CrewHarbor aan voor je bedrijf. Wij zetten alles voor je klaar.') + '<section class="login-main">' + form + '</section></div>';
  }
  if (!info.open) {
    form = '<div class="login-card"><h2>Registreren</h2><div class="alert info"><span>Op deze server kunnen geen nieuwe bedrijven worden aangemaakt. Vraag je beheerder om een account.</span></div>' +
      '<p class="switch"><a href="#/login">Terug naar inloggen</a></p></div>';
  } else {
    form = '<form class="login-card" data-form="register" novalidate style="max-width:460px">' +
      '<div><h2>' + (info.firstSetup ? 'CrewHarbor inrichten' : 'Bedrijf registreren') + '</h2><p class="muted" style="margin:6px 0 0;font-size:14px">Je wordt eigenaar van het account en hebt altijd alle rechten.</p></div>' +
      (S.authError ? '<div class="alert error" role="alert">' + ICON.alert + '<span>' + esc(S.authError) + '</span></div>' : '') +
      '<div class="field"><label for="r-org">Bedrijfsnaam</label><input class="input" id="r-org" name="orgName" autocomplete="organization" required></div>' +
      '<div class="field"><label for="r-slug">Bedrijfscode</label><input class="input" id="r-slug" name="slug" autocapitalize="none" spellcheck="false" pattern="[a-z0-9][a-z0-9-]{2,29}" required aria-describedby="r-slug-h">' +
        '<span class="small muted" id="r-slug-h">Een korte naam voor je bedrijf. 3 tot 30 tekens: kleine letters, cijfers en -</span></div>' +
      '<div class="field"><label for="r-name">Jouw naam</label><input class="input" id="r-name" name="ownerName" autocomplete="name" required></div>' +
      '<div class="field"><label for="r-email">E-mailadres</label><input class="input" id="r-email" name="email" type="email" autocomplete="username" autocapitalize="none" spellcheck="false" required></div>' +
      '<div class="field"><label for="r-pass">Kies een wachtwoord</label><input class="input" id="r-pass" name="password" type="password" autocomplete="new-password" required aria-describedby="r-pass-h">' +
        '<span class="small muted" id="r-pass-h">Minstens 10 tekens.</span></div>' +
      '<div class="honeypot" aria-hidden="true"><label for="r-web">Website</label><input id="r-web" name="website" tabindex="-1" autocomplete="off"></div>' +
      '<button class="btn primary" type="submit" id="r-submit">' + (info.firstSetup ? 'Inrichten' : 'Bedrijf aanmaken') + '</button>' +
      '<p class="switch">Al een account? <a href="#/login">Inloggen</a></p></form>';
  }
  return '<div class="login">' + brandPanel('Begin vandaag met CrewHarbor.', 'In één minuut staat je bedrijf klaar. Daarna voeg je je team toe.') + '<section class="login-main">' + form + '</section></div>';
}

// eigenaar: eigen uren, beschikbaarheid en verlof staan standaard uit (aan te zetten bij Instellingen → Mijn account)
function selfOn(k) { return !S.me || !S.me.isOwner || !!(S.me.uiPrefs || {})[k]; }
// ----- navigatie (groepen die je kunt in- en uitklappen) -----
function navGroups() {
  const G = [
    { id: 'werk', label: 'Werk', items: [['meldingen', 'Meldingen', S.notif ? S.notif.unread : 0], ['terugbellen', 'Terugbellen', S.counts.mine], ['taken', 'Taken', S.counts.tasks]] },
    { id: 'planning', label: 'Planning', items: [['rooster', 'Rooster', S.swaps && S.swaps.pending ? S.swaps.pending.length : 0], selfOn('selfAvail') ? ['beschikbaar', 'Beschikbaarheid'] : null, selfOn('selfLeave') || can('hours.approve') ? ['verlof', selfOn('selfLeave') ? 'Verlof & ziek' : 'Verlof', S.absPending] : null] },
    { id: 'uren', label: 'Uren', items: [selfOn('selfHours') ? ['uren', 'Mijn uren', 0, S.running ? 'live' : ''] : null,
      can('hours.approve') ? ['goedkeuren', 'Goedkeuren', S.pendingCount] : null, can('hours.view_all') ? ['urenoverzicht', 'Urenoverzicht'] : null, can('hours.kiosk') ? ['prikklok', 'Prikklok'] : null] },
    { id: 'kennis', label: 'Kennis', items: [['kennisbank', 'Kennisbank'], ['documenten', 'Documenten']] },
    { id: 'leiding', label: 'Teamleiding', items: [S.me && (S.me.isOwner || can('reports.view')) ? ['dashboard', 'Dashboard'] : null, can('team.board') ? ['team', 'Teambord'] : null, can('reports.view') ? ['cijfers', 'Cijfers'] : null, can('phone.view') ? ['telefonie', 'Telefonie'] : null, can('audit.view') ? ['logboek', 'Logboek'] : null] },
    { id: 'beheer', label: 'Beheer', items: [can('members.manage') || can('roles.manage') ? ['mensen', 'Mensen'] : null,
      can('members.manage') || can('roles.manage') ? ['rollen', 'Rollen & rechten'] : null, ['instellingen', 'Instellingen']] }
  ];
  G.forEach(g => { g.items = g.items.filter(Boolean); });
  return G.filter(g => g.items.length);
}
function viewNav(r) {
  const cur = r === 'verzoek' ? 'terugbellen' : r === 'taak' ? 'taken' : r;
  const opened = prefs.navOpen || {};
  const link = ([to, label, count, flag]) => '<a href="#/' + to + '" class="' + (cur === to ? 'active' : '') + '"' + (cur === to ? ' aria-current="page"' : '') + '>' +
    '<span class="nav-label">' + NI[to] + '<span>' + esc(label) + '</span></span>' +
    (flag === 'live' ? '<span class="live-dot" title="Je bent ingeklokt"></span>' : count ? '<span class="nav-count">' + count + '</span>' : '') + '</a>';
  const groups = navGroups().map(g => {
    const hasActive = g.items.some(i => i[0] === cur);
    const open = hasActive || !!opened[g.id];
    const sum = g.items.reduce((a, i) => a + (i[2] || 0), 0);
    return '<div class="nav-group' + (open ? ' open' : '') + '">' +
      '<button class="nav-group-btn" data-act="nav-group" data-v="' + g.id + '" aria-expanded="' + open + '" aria-controls="ng-' + g.id + '"' + (hasActive ? ' data-locked="1"' : '') + '>' +
        '<span>' + g.label + '</span><span class="nav-group-end">' + (!open && sum ? '<span class="nav-count">' + sum + '</span>' : '') + ICON.chev + '</span></button>' +
      '<div class="nav-group-items" id="ng-' + g.id + '">' + g.items.map(link).join('') + '</div></div>';
  }).join('');
  return '<nav class="nav" aria-label="Hoofdmenu">' +
    '<div class="nav-top"><div class="nav-brand">' + LOGO(26) + '<div class="nav-org">' + esc(S.org.name) + '</div></div>' +
    '<button class="menu-btn" data-act="menu" aria-expanded="false" aria-controls="nav-links">Menu</button></div>' +
    '<div class="nav-links" id="nav-links"><div class="nav-home">' + link(['overzicht', 'Overzicht']) + '</div>' + groups + '</div>' +
    '<div class="nav-user">' +
      (S.running ? '<a class="nav-clock" href="#/uren">' + '<span class="live-dot"></span>Ingeklokt sinds ' + esc(S.running.start) + '</a>' : '') +
      '<a class="nav-user-row" href="#/instellingen" data-act="go-account" title="Mijn account">' + avatar(S.me.id, S.me.name) +
      '<div><strong style="font-size:13px">' + esc(S.me.name) + '</strong><small>' + esc(S.roleName) + ' · Mijn account</small></div></a>' +
      '<button class="link-btn" data-act="sound" aria-pressed="' + !!prefs.sound + '">' + ICON.bell + ' Geluid bij nieuw werk: ' + (prefs.sound ? 'aan' : 'uit') + '</button>' +
      (canSysNotify() && Notification.permission === 'default' ? '<button class="link-btn" data-act="notif-allow">Pop-upmeldingen aanzetten</button>' : '') +
      '<button class="link-btn" data-act="logout">Uitloggen</button></div></nav>';
}

// ----- overzicht -----
function viewHome() {
  const h = new Date().getHours();
  const groet = h < 12 ? 'Goedemorgen' : h < 18 ? 'Goedemiddag' : 'Goedenavond';
  const late = S.myCbs.filter(c => isLate(c.dueAt)).length;
  const openTasks = S.myTasks.filter(t => !t.done && !t.mineDone && !t.archived);
  let html = '<header class="page-head"><div class="hello"><h1>' + groet + ', ' + esc(S.me.name.split(' ')[0]) + '</h1>' +
    '<p>' + DAYS_FULL[new Date().getDay()] + ' ' + new Date().getDate() + ' ' + MONTHS[new Date().getMonth()] + ' · ' + esc(S.org.name) + '</p></div>' +
    '<div class="actions">' + (can('callbacks.create') ? '<a class="btn" href="#/verzoek">' + ICON.plus + 'Terugbelverzoek</a>' : '') +
    (can('tasks.create') ? '<a class="btn primary" href="#/taak">' + ICON.plus + 'Taak</a>' : '') + '</div></header>';
  if (typeof billingBanner === 'function') html += billingBanner();
  html += '<div class="stats">' + stat('Mijn verzoeken', S.counts.mine) + stat('Daarvan te laat', late, late ? 'var(--red)' : null) +
    stat('Mijn open taken', S.counts.tasks) + stat('In de open pool', S.counts.pool, 'var(--blue)') + '</div>';
  const row = (href, title, badge) => '<a class="mini-row" href="' + href + '"><span>' + esc(title) + '</span>' + badge + '</a>';
  html += '<div class="cards">';
  if (selfOn('selfHours')) html += homeHoursCard();
  html += '<section class="card"><h2>Eerst terugbellen</h2>' + (S.myCbs.length ? '<div class="mini-list">' +
    S.myCbs.slice(0, 5).map(c => row('#/terugbellen', cbTitle(c), dueBadge(c.dueAt, 'bel'))).join('') + '</div>' : '<p class="muted small">Geen open verzoeken. Lekker bezig!</p>') +
    '<p style="margin:12px 0 0"><a class="more" href="#/terugbellen">Alle verzoeken</a></p></section>';
  html += '<section class="card"><h2>Mijn taken</h2>' + (openTasks.length ? '<div class="mini-list">' +
    openTasks.slice(0, 5).map(t => row('#/taken', t.title, dueBadge(t.dueAt, 'taak'))).join('') + '</div>' : '<p class="muted small">Niets meer te doen.</p>') +
    '<p style="margin:12px 0 0"><a class="more" href="#/taken">Alle taken</a></p></section>';
  if (S.poolCbs.length) {
    html += '<section class="card"><h2>Open pool</h2><div class="mini-list">' + S.poolCbs.slice(0, 5).map(c => row('#/terugbellen', cbTitle(c), dueBadge(c.dueAt, 'bel'))).join('') +
      '</div><p style="margin:12px 0 0"><a class="more" href="#/terugbellen" data-act="go-pool">Bekijk en pak op</a></p></section>';
  }
  if (S.weekStats) {
    const T = S.weekStats.totals;
    html += '<section class="card"><h2>Team deze week</h2><dl class="kv"><dt>Binnengekomen</dt><dd>' + T.created + '</dd><dt>Afgerond</dt><dd>' + T.done + '</dd>' +
      '<dt>Gem. tot teruggebeld</dt><dd>' + humanMin(T.avgMin) + '</dd><dt>Nu te laat</dt><dd' + (T.lateNow ? ' style="color:var(--red)"' : '') + '>' + T.lateNow + '</dd></dl>' +
      '<p style="margin:12px 0 0"><a class="more" href="#/cijfers">Alle cijfers</a></p></section>';
  }
  html += '</div>';
  if (S.counts.mine === 0 && S.counts.tasks === 0 && S.counts.pool === 0 && (can('members.manage'))) {
    html += '<section class="card"><h2>Aan de slag</h2><p class="muted" style="margin:0 0 12px">Voeg je collega’s toe en geef ze een rol. Daarna kunnen jullie verzoeken en taken aan elkaar geven.</p>' +
      '<a class="btn primary" href="#/mensen">Mensen toevoegen</a></section>';
  }
  return html;
}

// ----- terugbellen -----
function stat(label, n, color, sub) { return '<div class="stat"><span>' + label + '</span><strong' + (color ? ' style="color:' + color + '"' : '') + '>' + n + '</strong>' + (sub ? '<small class="stat-sub">' + sub + '</small>' : '') + '</div>'; }
function dd(label, val) { return '<div><dt>' + label + '</dt><dd>' + esc(val) + '</dd></div>'; }
function viewCallbacks() {
  const searching = S.cbQ.trim().length >= 2;
  const L = searching ? (S.cbResults || []) : S.cbList;
  const tabs = [['mine', 'Mijn verzoeken', S.counts.mine], ['pool', 'Open pool', S.counts.pool]];
  if (can('callbacks.view_all')) tabs.push(['all', 'Alle open', null]);
  tabs.push(['done', 'Afgerond', null]);
  let html = '<header class="page-head"><div><h1>Terugbellen</h1><p>Gesorteerd op urgentie</p></div>' +
    '<div class="actions">' + (can('callbacks.create') ? '<a class="btn primary" href="#/verzoek">' + ICON.plus + 'Nieuw verzoek</a>' : '') + '</div></header>';
  html += '<div class="search soft"><label class="sr-only" for="cb-q">Klant zoeken</label>' + ICON.search +
    '<input id="cb-q" type="search" data-in="cbq" value="' + esc(S.cbQ) + '" placeholder="Klant zoeken op naam, bedrijf, ordernummer of telefoon…" autocomplete="off">' +
    (S.cbQ ? '<button class="icon-btn small" data-act="cb-clearq" aria-label="Zoekopdracht wissen">' + ICON.x + '</button>' : '') + '</div>';
  if (searching) {
    html += '<div class="section-title"><h2>Zoekresultaten · ' + L.length + '</h2><span class="small muted">Open en afgeronde verzoeken van iedereen</span></div>';
  } else {
    if (S.cbTab === 'mine') html += '<div class="stats">' + stat('Te laat', L.filter(c => isLate(c.dueAt)).length, 'var(--red)') +
      stat('Binnen 1 uur', L.filter(c => within(c.dueAt, 60)).length, 'var(--orange)') + stat('Open bij jou', L.length) + stat('In de open pool', S.counts.pool, 'var(--blue)') + '</div>';
    html += '<div class="seg" role="group" aria-label="Overzicht">' + tabs.map(t => '<button data-act="cb-tab" data-v="' + t[0] + '" class="' + (S.cbTab === t[0] ? 'on' : '') + '" aria-pressed="' + (S.cbTab === t[0]) + '">' + t[1] +
      (t[2] != null ? '<span class="cnt">' + t[2] + '</span>' : '') + '</button>').join('') + '</div>';
  }
  if (!L.length) {
    const msg = searching ? 'Geen verzoeken gevonden voor “' + esc(S.cbQ) + '”.' : { mine: 'Je hebt geen open terugbelverzoeken. Lekker bezig!', pool: 'De open pool is leeg.', all: 'Er staan geen open verzoeken.', done: 'Nog niets afgerond.' }[S.cbTab];
    return html + '<div class="empty">' + msg + '</div>';
  }
  html += '<div class="split"><div class="list">' + L.map(c => {
    const who = (searching || S.cbTab !== 'mine') ? (c.assigneeName ? 'Bij ' + c.assigneeName : 'In de open pool') : '';
    const tries = (c.attempts || []).filter(a => !/^Afgerond/.test(a.text)).length;
    const meta = [who, c.status === 'done' ? '' : (tries ? 'Poging ' + tries : 'Nog niet gebeld'), 'door ' + c.createdByName].filter(Boolean).join(' · ');
    const badge = c.status === 'done' ? '<span class="badge green">Afgerond ' + esc(fmtDate(c.doneAt)) + '</span>' : dueBadge(c.dueAt, 'bel');
    return '<button class="item' + (same(c.id, S.cbSel) ? ' sel' : '') + '" data-act="cb-sel" data-id="' + c.id + '">' +
      '<span class="item-top">' + badge + '<span class="item-meta">' + esc(c.category) + (c.priority === 'hoog' ? ' · <strong style="color:var(--red)">Hoog</strong>' : '') + '</span></span>' +
      '<span class="item-title">' + esc(cbTitle(c)) + '</span>' +
      '<span class="item-sub">' + (c.contact ? 't.a.v. ' + esc(c.contact) + ' · ' : '') + 'Order ' + esc(c.order) + ' · ' + esc(c.phone) + '</span>' +
      '<span class="item-meta">' + esc(meta) + '</span></button>';
  }).join('') + '</div>';
  const sel = L.find(c => same(c.id, S.cbSel));
  return html + '<aside class="detail card">' + (sel ? viewCallbackDetail(sel) : '') + '</aside></div>';
}
function viewCallbackDetail(c) {
  const isDone = c.status === 'done';
  const tries = (c.attempts || []).filter(a => !/^Afgerond/.test(a.text)).length;
  let h = '<div style="display:flex;flex-direction:column;gap:18px">' +
    '<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start"><div><div style="margin-bottom:6px">' +
    (isDone ? '<span class="badge green">Afgerond door ' + esc(c.doneByName) + '</span>' : dueBadge(c.dueAt, 'bel')) +
    (c.priority === 'hoog' ? ' <span class="badge red">Hoge prioriteit</span>' : '') + '</div><h2 style="margin:0;font-size:22px">' + esc(cbTitle(c)) + '</h2></div>' +
    (canEditCb(c) ? '<button class="btn small" data-act="cb-edit" data-id="' + c.id + '">' + ICON.edit + 'Bewerken</button>' : '') + '</div>' +
    '<dl class="dl">' + (c.type === 'zakelijk' ? dd('Contactpersoon', c.contact || '–') : dd('Soort', 'Particulier')) +
      '<div><dt>Telefoon</dt><dd><a href="tel:' + esc(String(c.phone).replace(/[^\d+]/g, '')) + '">' + esc(c.phone) + '</a></dd></div>' +
      dd('Ordernummer', c.order) + dd('Categorie', c.category) +
      (c.email ? '<div class="full"><dt>E-mail</dt><dd><a href="mailto:' + esc(c.email) + '">' + esc(c.email) + '</a></dd></div>' : '') +
      dd('Toegewezen aan', c.assigneeName || 'Open pool') + dd('Aangemaakt', fmtDate(c.createdAt) + ' door ' + c.createdByName) +
      (c.note ? '<div class="full"><dt>Reden / notitie</dt><dd>' + esc(c.note) + '</dd></div>' : '') + '</dl>';
  if (c.attempts && c.attempts.length) {
    h += '<div class="detail-section"><span class="legend">Belpogingen &amp; notities</span><div class="attempts">' +
      c.attempts.map(a => '<div><time>' + esc(fmtDate(a.at)) + '</time><span>' + esc(a.text) + ' <span class="muted">· ' + esc(a.byName) + '</span></span></div>').join('') + '</div></div>';
  }
  if (!isDone && tries >= 3) h += '<div class="alert info"><span><strong>3x niet bereikt</strong>Stuur de klant een mail of sms, of zet het verzoek terug in de pool.</span></div>';
  if (isDone) return h + '<div class="detail-section"><button class="btn" data-act="cb-reopen" data-id="' + c.id + '">Weer openzetten</button></div></div>';
  if (!c.assignee) h += '<div class="detail-section"><button class="btn primary" data-act="cb-claim" data-id="' + c.id + '">Pak ik op</button></div>';
  const quick = settings().quick_notes || [];
  h += '<div class="detail-section"><label class="legend" for="cb-note">Notitie bij dit gesprek <small>(optioneel)</small></label>' +
    (quick.length ? '<div class="chips" role="group" aria-label="Snelnotities">' + quick.map(q => '<button type="button" class="chip quick" data-act="cb-quick" data-v="' + esc(q) + '">' + esc(q) + '</button>').join('') + '</div>' : '') +
    '<input class="input" id="cb-note" placeholder="Typ een notitie of kies hierboven">' +
    '<div class="grid2"><button class="btn green" data-act="cb-done" data-id="' + c.id + '">Gebeld, afgerond</button><button class="btn" data-act="cb-attempt" data-id="' + c.id + '">Niet bereikt</button></div></div>';
  if (can('callbacks.assign')) {
    h += '<div class="detail-section"><label class="legend" for="cb-assign">Toewijzen aan collega</label><div class="row"><select class="input" id="cb-assign">' +
      S.colleagues.map(u => '<option value="' + u.id + '"' + (same(u.id, c.assignee) ? ' selected' : '') + '>' + esc(same(u.id, S.me.id) ? 'Ikzelf' : u.name) + ' (' + u.open + ' open)' + (u.leavingOn ? ' · weg na ' + esc(dayShort(u.leavingOn)) : '') + '</option>').join('') +
      '<option value="pool"' + (!c.assignee ? ' selected' : '') + '>Terug naar open pool</option></select><button class="btn dark" data-act="cb-assign" data-id="' + c.id + '">Wijs toe</button></div></div>';
  } else if (same(c.assignee, S.me.id)) {
    h += '<div class="detail-section"><button class="btn" data-act="cb-topool" data-id="' + c.id + '">Terug naar open pool</button></div>';
  }
  return h + '</div>';
}

// ----- verzoek (nieuw / bewerken) -----
function newCallbackForm() {
  const cats = settings().categories || ['Overig'];
  return { editId: null, type: 'zakelijk', company: '', contact: '', name: '', phone: '', email: '', order: '', category: cats[0], priority: 'normaal',
    dueAt: defaultDue(2), note: '', assign: 'me', colleague: '', tried: false, serverError: null, saving: false };
}
function cbMissing(F) {
  const m = {};
  if (F.type === 'zakelijk' && !F.company.trim()) m.company = 'Bedrijfsnaam is verplicht';
  if (F.type === 'particulier' && !F.name.trim()) m.name = 'Naam is verplicht';
  if (!F.phone.trim()) m.phone = 'Telefoonnummer is verplicht';
  if (!F.order.trim()) m.order = 'Ordernummer is verplicht';
  if (F.assign === 'colleague' && !F.colleague) m.colleague = 'Kies een collega';
  return m;
}
function inputField(id, label, F, key, opts) {
  opts = opts || {};
  const err = F.tried && opts.errors && opts.errors[key];
  return '<div class="field' + (opts.span ? ' span2' : '') + '"><label for="' + id + '">' + label + (opts.req ? ' *' : '') + '</label>' +
    '<input class="input' + (err ? ' bad' : '') + '" id="' + id + '" data-f="' + key + '" type="' + (opts.type || 'text') + '" value="' + esc(F[key]) + '" placeholder="' + esc(opts.ph || '') + '"' + (err ? ' aria-invalid="true"' : '') + ' autocomplete="off">' +
    (err ? '<span class="err-text">' + esc(err) + '</span>' : '') + '</div>';
}
function viewDup() {
  if (!S.dup || !S.dup.length) return '';
  return '<div class="alert warn" role="status">' + ICON.warn + '<span><strong>Er staat al een open verzoek voor deze klant</strong>' +
    S.dup.map(d => esc(d.title) + ' · order ' + esc(d.order) + ' · ' + (d.assigneeName ? 'bij ' + esc(d.assigneeName) : 'in de open pool') + (d.dueAt ? ' · bel vóór ' + esc(fmtDate(d.dueAt)) : '') +
      ' <span class="small">(zelfde ' + [d.sameOrder ? 'ordernummer' : '', d.samePhone ? 'telefoonnummer' : ''].filter(Boolean).join(' en ') + ')</span>').join('<br>') +
    '<br><span class="small">Check eerst of je dit verzoek nog nodig hebt, zodat de klant niet twee keer gebeld wordt.</span></span></div>';
}
function viewCallbackForm() {
  const F = S.F; const edit = !!F.editId;
  const errors = cbMissing(F); const errList = Object.keys(errors);
  const names = { company: 'bedrijfsnaam', name: 'naam', phone: 'telefoonnummer', order: 'ordernummer', colleague: 'collega' };
  const cats = settings().categories || [];
  const catList = cats.includes(F.category) ? cats : [F.category].concat(cats);
  let h = '<div class="card form" style="align-self:center"><div><h1 style="margin:0;font-size:26px">' + (edit ? 'Verzoek bewerken' : 'Nieuw terugbelverzoek') + '</h1>' +
    '<p class="muted" style="margin:4px 0 0;font-size:14px">' + (edit ? 'Pas aan wat er niet klopt. Wijzigingen komen in het logboek.' : 'Vul in tijdens of direct na het gesprek.') + ' Velden met * zijn verplicht.</p></div>';
  if (F.tried && errList.length) h += '<div class="alert error" role="alert">' + ICON.alert + '<span><strong>Niet alle verplichte velden zijn ingevuld</strong>Vul nog in: ' + errList.map(k => names[k]).join(', ') + '.</span></div>';
  else if (F.serverError) h += '<div class="alert error" role="alert">' + ICON.alert + '<span>' + esc(F.serverError) + '</span></div>';
  h += '<div class="field"><span class="legend">Soort klant *</span><div class="row">' +
    '<button type="button" class="btn' + (F.type === 'particulier' ? ' on' : '') + '" data-act="f-type" data-v="particulier" aria-pressed="' + (F.type === 'particulier') + '">Particulier</button>' +
    '<button type="button" class="btn' + (F.type === 'zakelijk' ? ' on' : '') + '" data-act="f-type" data-v="zakelijk" aria-pressed="' + (F.type === 'zakelijk') + '">Zakelijk</button></div></div>';
  h += '<div class="fields2">' + (F.type === 'zakelijk'
      ? inputField('f-company', 'Bedrijfsnaam', F, 'company', { req: 1, errors, ph: 'Bijv. Beeldwerk Media BV' }) + inputField('f-contact', 'Contactpersoon', F, 'contact', { ph: 'optioneel' })
      : inputField('f-name', 'Naam', F, 'name', { req: 1, errors, ph: 'Voor- en achternaam', span: 1 })) +
    inputField('f-phone', 'Telefoonnummer', F, 'phone', { req: 1, errors, type: 'tel', ph: '06 …' }) + inputField('f-order', 'Ordernummer', F, 'order', { req: 1, errors, ph: 'Bijv. 123456' }) +
    '<div class="span2" id="dup">' + viewDup() + '</div>' + inputField('f-email', 'E-mail', F, 'email', { type: 'email', ph: 'optioneel', span: 1 }) + '</div>';
  h += '<div class="fields3"><div class="field"><label for="f-cat">Categorie</label><select class="input" id="f-cat" data-f="category">' + catList.map(c => '<option' + (F.category === c ? ' selected' : '') + '>' + esc(c) + '</option>').join('') + '</select></div>' +
    '<div class="field"><label for="f-prio">Prioriteit</label><select class="input" id="f-prio" data-f="priority">' + ['normaal', 'hoog', 'laag'].map(p => '<option value="' + p + '"' + (F.priority === p ? ' selected' : '') + '>' + p[0].toUpperCase() + p.slice(1) + '</option>').join('') + '</select></div>' +
    '<div class="field"><label for="f-due">Bel vóór</label><input class="input" id="f-due" type="datetime-local" data-f="dueAt" value="' + esc(F.dueAt) + '"></div></div>';
  h += '<div class="field"><label for="f-note">Reden / notitie</label><textarea class="input" id="f-note" data-f="note" rows="3" placeholder="Waar gaat het over?">' + esc(F.note) + '</textarea></div>';
  const ca = can('callbacks.assign');
  const opt = (v, label) => '<button type="button" class="btn' + (F.assign === v ? ' on' : '') + '" data-act="f-assign" data-v="' + v + '" aria-pressed="' + (F.assign === v) + '">' + label + '</button>';
  h += '<fieldset class="box' + (F.tried && errors.colleague ? ' bad' : '') + '" style="margin:0"><legend class="legend" style="padding:0 6px">Wie belt terug?</legend><div class="row">' +
    opt('me', 'Ikzelf') + (ca ? opt('colleague', 'Collega') : '') + opt('pool', 'Open pool') + (ca && !edit ? opt('auto', 'Automatisch verdelen') : '') + '</div>';
  if (F.assign === 'colleague') {
    h += '<div class="field"><label for="f-coll">Collega</label><select class="input' + (F.tried && errors.colleague ? ' bad' : '') + '" id="f-coll" data-f="colleague"><option value="">Kies een collega…</option>' +
      S.colleagues.filter(u => !same(u.id, S.me.id)).map(u => '<option value="' + u.id + '"' + (same(F.colleague, u.id) ? ' selected' : '') + '>' + esc(u.name) + ' (' + u.open + ' open)' + (u.leavingOn ? ' · weg na ' + esc(dayShort(u.leavingOn)) : '') + '</option>').join('') + '</select></div>';
  }
  if (F.assign === 'auto') h += '<p class="muted small" style="margin:0">Gaat naar de collega met de minste openstaande verzoeken en taken.</p>';
  h += '</fieldset><div class="form-foot">' + (edit && can('callbacks.delete') ? '<button class="btn danger" data-act="f-delete" style="margin-right:auto">' + ICON.trash + 'Verwijderen</button>' : '') +
    '<a class="btn" href="#/terugbellen">Annuleren</a><button class="btn primary" data-act="f-save"' + (F.saving ? ' disabled' : '') + '>' + (edit ? 'Wijzigingen opslaan' : 'Verzoek opslaan') + '</button></div></div>';
  return h;
}

// ----- taken -----
function viewTasks() {
  const all = S.tView === 'all', arc = S.tView === 'archive';
  let h = '<header class="page-head" style="max-width:920px"><div><h1>' + (arc ? 'Taakarchief' : all ? 'Alle taken' : 'Mijn taken') + '</h1><p>' +
    (arc ? 'Alle afgeronde en gearchiveerde taken van het team. Klik op een taak om te zien wat erin stond.' : all ? 'Alle taken van het team.' : 'Wat je nog moet doen, ook taken die je met collega’s deelt.') + '</p></div>' +
    '<div class="actions"><button class="btn' + (S.searchOpen ? ' on' : '') + '" data-act="t-search" aria-expanded="' + S.searchOpen + '">' + ICON.search + 'Bestaat deze taak al?</button>' +
    (can('tasks.create') ? '<a class="btn primary" href="#/taak">' + ICON.plus + 'Nieuwe taak</a>' : '') + '</div></header>';
  const tabs = [['mine', 'Mijn taken'], can('tasks.view_all') ? ['all', 'Alle taken'] : null, can('tasks.archive') ? ['archive', 'Archief'] : null].filter(Boolean);
  if (tabs.length > 1) h += '<div class="seg" role="group" aria-label="Weergave">' + tabs.map(v => '<button data-act="t-view" data-v="' + v[0] + '" class="' + (S.tView === v[0] ? 'on' : '') + '" aria-pressed="' + (S.tView === v[0]) + '">' + v[1] + '</button>').join('') + '</div>';
  if (S.searchOpen) h += viewSearch();
  return h + (arc ? viewArchiveTasks() : all ? viewAllTasks() : viewMyTasks());
}
function viewSearch() {
  return '<section class="card stack" style="gap:14px;padding:20px" aria-label="Controleer of een taak al bestaat">' +
    '<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start"><div><h2 style="margin:0;font-size:16px">Controleer of deze taak al bestaat</h2>' +
    '<p class="muted" style="margin:2px 0 0;font-size:13px">Zoekt in alle taken van het team, ook die van anderen en wat al af is.</p></div>' +
    '<button class="icon-btn" data-act="t-search" aria-label="Sluiten">' + ICON.x + '</button></div>' +
    '<label class="sr-only" for="t-q">Zoek in alle taken</label><div class="search">' + ICON.search + '<input id="t-q" type="search" data-in="q" value="' + esc(S.q) + '" placeholder="Bijv. retour 482913, prijslijst, showroom…" autocomplete="off"></div>' +
    '<div id="search-results">' + viewResults() + '</div></section>';
}
function viewResults() {
  if (S.results == null) return '<p class="muted small" style="margin:0">Typ minstens 3 letters. Je hoeft niet de precieze woorden te gebruiken.</p>';
  if (!S.results.length) return '<div class="alert ok" style="justify-content:space-between;flex-wrap:wrap"><span style="display:flex;gap:10px;align-items:center">' + ICON.check +
    '<span><strong style="display:inline">Niets gevonden.</strong> Deze taak bestaat nog niet.</span></span>' + (can('tasks.create') ? '<a class="btn green" href="#/taak">Nu aanmaken</a>' : '') + '</div>';
  return '<div class="stack" style="gap:8px"><span class="small" style="font-weight:600;color:var(--orange)">Let op: ' + S.results.length + ' ' + (S.results.length === 1 ? 'taak lijkt' : 'taken lijken') + ' hierop. Check deze eerst.</span>' +
    S.results.map(r => '<div class="result"><div style="flex:1 1 280px;min-width:0;display:flex;flex-direction:column;gap:4px">' +
      '<div class="row" style="align-items:center"><span class="badge ' + (r.strong ? 'red' : 'orange') + '">' + (r.strong ? 'Sterke match' : 'Lijkt erop') + '</span><span class="item-title" style="font-size:15px">' + esc(r.title) + '</span></div>' +
      '<span class="item-sub">' + esc(r.desc || 'Geen omschrijving') + '</span></div>' +
      '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px"><span class="badge ' + (r.done ? 'green' : 'blue') + '">' + (r.done ? 'Afgerond' : 'Open') + (r.dueAt ? ' · ' + esc(fmtDate(r.dueAt)) : '') + '</span>' +
      '<span class="small muted">Voor ' + esc((r.assignees || []).join(', ')) + '</span></div></div>').join('') + '</div>';
}
function peopleStack(t) { return '<span class="people">' + t.assignees.map(a => avatar(a.id, a.name, 'sm')).join('') + '</span>'; }
function taskMeta(t) {
  const by = same(t.createdBy, S.me.id) ? 'door jou' : 'van ' + t.createdByName;
  const parts = [];
  if (t.assignees.length > 1) parts.push(t.mode === 'een' ? 'Gedeeld · klaar zodra één persoon afvinkt' : 'Iedereen vinkt af · ' + t.doneCount + ' van ' + t.assignees.length + ' klaar');
  parts.push(by);
  return esc(parts.join(' · ')) + (t.repeat && t.repeat !== 'none' ? ' · <span class="repeat">' + ICON.repeat + ' ' + esc(REPEATS[t.repeat]) + '</span>' : '');
}
function editBtn(t) { return canEditTask(t) ? '<button class="btn small ghost" data-act="t-edit" data-id="' + t.id + '" aria-label="' + esc(t.title) + ' bewerken">' + ICON.edit + 'Bewerken</button>' : ''; }
function viewMyTasks() {
  const live = S.tasks.filter(t => !t.archived);
  const open = live.filter(t => !t.done && !t.mineDone);
  const done = live.filter(t => t.done || t.mineDone);
  const arch = S.tasks.filter(t => t.archived);
  let h = '<section class="stack"><div class="section-title"><h2>Te doen · ' + open.length + '</h2></div>';
  h += open.length ? open.map(t => '<article class="task"><input type="checkbox" data-act="t-toggle" data-id="' + t.id + '" aria-label="' + esc(t.title) + ' afvinken">' +
    '<div class="task-body"><div class="item-top"><span class="item-title">' + esc(t.title) + (t.priority === 'hoog' ? ' <span class="badge red">Hoog</span>' : '') + '</span>' + dueBadge(t.dueAt, 'taak') + '</div>' +
    (t.desc ? '<span class="item-sub" style="white-space:pre-wrap">' + esc(t.desc) + '</span>' : '') +
    '<div class="row" style="align-items:center;gap:12px">' + peopleStack(t) + '<span class="item-meta" style="padding-left:6px;flex:1">' + taskMeta(t) + '</span>' + editBtn(t) + '</div></div></article>').join('')
    : '<div class="empty">Niets meer te doen. Top!</div>';
  h += '</section><section class="stack"><div class="section-title"><h2>Afgerond · ' + done.length + '</h2>' + (done.length ? '<button class="btn small" data-act="t-archive-all">' + ICON.box + 'Alles archiveren</button>' : '') + '</div>';
  h += done.map(t => {
    const meta = (!t.done && t.mineDone) ? 'Jij klaar · wacht op anderen (' + t.doneCount + '/' + t.assignees.length + ')' : t.mineDone ? 'Afgerond' : 'Afgerond door ' + t.assignees.filter(a => a.done).map(a => a.name).join(', ');
    return '<article class="task done"><input type="checkbox" checked data-act="t-toggle" data-id="' + t.id + '"' + (t.mineDone ? '' : ' disabled') + ' aria-label="' + esc(t.title) + ' weer openzetten">' +
      '<span class="item-title" style="flex:1 1 200px;min-width:0">' + esc(t.title) + '</span><span class="item-meta">' + esc(meta) + '</span>' +
      '<button class="btn small ghost" data-act="t-archive" data-id="' + t.id + '">' + ICON.box + 'Archiveren</button></article>';
  }).join('');
  h += '</section><section class="stack"><button class="btn ghost" style="align-self:flex-start" data-act="t-archive-toggle" aria-expanded="' + S.showArchive + '">' + ICON.box + (S.showArchive ? 'Archief verbergen' : 'Archief bekijken') + ' (' + arch.length + ')</button>';
  if (S.showArchive) h += arch.length ? arch.map(t => '<article class="task archived"><span style="flex:1 1 200px;min-width:0;color:var(--muted)">' + esc(t.title) + '</span><span class="item-meta">Gearchiveerd</span>' +
    '<button class="btn small" data-act="t-restore" data-id="' + t.id + '">Terugzetten</button></article>').join('') : '<p class="muted small" style="margin:0">Het archief is leeg. Archiveer afgeronde taken om je lijst opgeruimd te houden.</p>';
  return h + '</section>';
}
function viewAllTasks() {
  const people = {};
  S.tasks.forEach(t => t.assignees.forEach(a => { people[a.id] = a.name; }));
  const filtered = S.tasks.filter(t => S.tWho === 'ALL' || t.assignees.some(a => same(a.id, S.tWho)));
  const open = filtered.filter(t => !t.done); const done = filtered.filter(t => t.done);
  let h = '<section class="stack" style="gap:14px"><div class="chips"><span class="muted small">Toon van:</span><button class="chip' + (S.tWho === 'ALL' ? ' on' : '') + '" data-act="t-who" data-v="ALL">Iedereen</button>' +
    Object.keys(people).sort((a, b) => people[a].localeCompare(people[b])).map(id => '<button class="chip' + (same(S.tWho, id) ? ' on' : '') + '" data-act="t-who" data-v="' + id + '">' + esc(same(id, S.me.id) ? 'Jij' : people[id]) + '</button>').join('') + '</div>';
  h += '<div class="section-title"><h2>Open · ' + open.length + '</h2></div>';
  h += open.length ? open.map(t => '<article class="task" style="align-items:center;flex-wrap:wrap">' + peopleStack(t) +
    '<div class="task-body" style="flex:1 1 260px;padding-left:6px"><span class="item-title" style="font-size:15px">' + esc(t.title) + '</span>' +
    '<span class="item-meta">Voor ' + esc(t.assignees.map(a => same(a.id, S.me.id) ? 'jij' : a.name).join(', ')) + (t.assignees.length > 1 && t.mode === 'iedereen' ? ' · ' + t.doneCount + '/' + t.assignees.length + ' klaar' : '') +
    ' · van ' + esc(t.createdByName) + (t.repeat && t.repeat !== 'none' ? ' · <span class="repeat">' + ICON.repeat + ' ' + esc(REPEATS[t.repeat]) + '</span>' : '') + '</span></div>' +
    dueBadge(t.dueAt, 'taak') + editBtn(t) + '</article>').join('') : '<div class="empty">Geen open taken.</div>';
  h += '<div class="section-title" style="margin-top:8px"><h2>Afgerond · ' + done.length + '</h2></div>';
  h += done.map(t => taskDetails(t)).join('');
  return h + '</section>';
}
// afgeronde taak die je kunt openklappen: wat stond erin, wie, wanneer
function taskDetails(t) {
  const who = t.assignees.map(a => a.name + (a.done ? ' ✓' : '')).join(', ');
  const canFix = can('tasks.archive') || can('tasks.edit_all') || same(t.createdBy, S.me.id);
  return '<details class="task-det"><summary><span class="item-title">' + esc(t.title) + '</span>' +
    '<span class="item-meta">Voor ' + esc(t.assignees.map(a => a.name).join(', ')) + (t.doneAt ? ' · afgerond ' + esc(fmtDate(t.doneAt)) : '') + '</span>' +
    ((t.archivedBy || []).length ? '<span class="badge">Gearchiveerd</span>' : '') + '</summary>' +
    '<div class="task-det-body">' + (t.desc ? '<p style="white-space:pre-wrap;margin:0">' + esc(t.desc) + '</p>' : '<p class="muted small" style="margin:0">Geen omschrijving.</p>') +
    '<dl class="kv small"><dt>Gemaakt</dt><dd>' + esc(fmtDate(t.createdAt)) + ' door ' + esc(t.createdByName || '–') + '</dd>' +
    '<dt>Voor</dt><dd>' + esc(who) + (t.assignees.length > 1 ? ' (' + (t.mode === 'iedereen' ? 'iedereen moest afvinken' : 'één persoon was genoeg') + ')' : '') + '</dd>' +
    (t.dueAt ? '<dt>Deadline</dt><dd>' + esc(fmtDate(t.dueAt)) + '</dd>' : '') +
    (t.priority && t.priority !== 'normaal' ? '<dt>Prioriteit</dt><dd>' + esc(t.priority) + '</dd>' : '') +
    (t.repeat && t.repeat !== 'none' ? '<dt>Herhalen</dt><dd>' + esc(REPEATS[t.repeat]) + '</dd>' : '') +
    ((t.archivedBy || []).length ? '<dt>Gearchiveerd door</dt><dd>' + esc(t.archivedBy.join(', ')) + '</dd>' : '') + '</dl>' +
    (canFix ? '<div class="row"><button class="btn small" data-act="t-edit" data-id="' + t.id + '">' + ICON.edit + 'Aanpassen</button>' +
      (can('tasks.archive') || can('tasks.edit_all') ? '<button class="btn small ghost" data-act="t-reopen" data-id="' + t.id + '">Weer openzetten</button>' : '') + '</div>' : '') +
    '</div></details>';
}
function viewArchiveTasks() {
  const q = (S.tArcQ || '').trim().toLowerCase();
  const people = {};
  S.tasks.forEach(t => t.assignees.forEach(a => { people[a.id] = a.name; }));
  const list = S.tasks.filter(t => (S.tWho === 'ALL' || t.assignees.some(a => same(a.id, S.tWho))) &&
    (!q || (t.title + ' ' + (t.desc || '')).toLowerCase().includes(q)));
  let h = '<section class="stack" style="gap:14px"><div class="row" style="align-items:center"><input class="input" style="max-width:340px" placeholder="Zoek in titel of omschrijving" data-in="tarcq" value="' + esc(S.tArcQ || '') + '"></div>' +
    '<div class="chips"><span class="muted small">Toon van:</span><button class="chip' + (S.tWho === 'ALL' ? ' on' : '') + '" data-act="t-who" data-v="ALL">Iedereen</button>' +
    Object.keys(people).sort((a, b) => people[a].localeCompare(people[b])).map(id => '<button class="chip' + (same(S.tWho, id) ? ' on' : '') + '" data-act="t-who" data-v="' + id + '">' + esc(people[id]) + '</button>').join('') + '</div>';
  h += '<div class="section-title"><h2>Afgerond · ' + list.length + '</h2></div>';
  h += list.length ? list.map(taskDetails).join('') : '<div class="empty">' + (q ? 'Niets gevonden.' : 'Nog geen afgeronde taken.') + '</div>';
  return h + '</section>';
}

// ----- taak (nieuw / bewerken) -----
function newTaskForm() {
  return { editId: null, title: '', desc: '', dueAt: '', priority: 'normaal', sel: can('tasks.assign') ? {} : { [S.me.id]: true }, mode: 'een', repeat: 'none', tried: false, serverError: null, similar: null, saving: false };
}
function taskErrors(T) {
  const e = {};
  if (!T.title.trim()) e.title = 'Geef de taak een titel';
  if (!Object.keys(T.sel).some(k => T.sel[k])) e.people = 'Kies minstens één persoon';
  if (T.repeat !== 'none' && !T.dueAt) e.dueAt = 'Kies een deadline, dan weet CrewHarbor wanneer de herhaling moet komen';
  return e;
}
function viewTaskForm() {
  const T = S.T; const edit = !!T.editId;
  const chosen = Object.keys(T.sel).filter(k => T.sel[k]);
  const errors = taskErrors(T); const errNames = { title: 'titel', people: 'voor wie', dueAt: 'deadline' };
  let h = '<div class="card form" style="align-self:center"><div><h1 style="margin:0;font-size:26px">' + (edit ? 'Taak bewerken' : 'Nieuwe taak') + '</h1><p class="muted" style="margin:4px 0 0;font-size:14px">' +
    (edit ? 'Pas de taak aan. Wie al had afgevinkt, blijft afgevinkt.' : 'Geef een taak aan jezelf, één collega of meerdere tegelijk.') + ' Velden met * zijn verplicht.</p></div>';
  if (T.tried && Object.keys(errors).length) h += '<div class="alert error" role="alert">' + ICON.alert + '<span><strong>Niet alle verplichte velden zijn ingevuld</strong>Vul nog in: ' + Object.keys(errors).map(k => errNames[k]).join(', ') + '.</span></div>';
  else if (T.serverError) h += '<div class="alert error" role="alert">' + ICON.alert + '<span>' + esc(T.serverError) + '</span></div>';
  const tErr = T.tried && errors.title;
  h += '<div class="field"><label for="t-title">Wat moet er gebeuren? *</label><input class="input' + (tErr ? ' bad' : '') + '" id="t-title" data-t="title" value="' + esc(T.title) + '" placeholder="Bijv. Showroom opruimen voor sluiting" autocomplete="off">' +
    (tErr ? '<span class="err-text">' + errors.title + '</span>' : '') + '<div id="similar">' + viewSimilar() + '</div></div>';
  h += '<div class="field"><label for="t-desc">Omschrijving</label><textarea class="input" id="t-desc" data-t="desc" rows="3" placeholder="optioneel: extra uitleg, ordernummer, waar het ligt…">' + esc(T.desc) + '</textarea></div>';
  const dErr = T.tried && errors.dueAt;
  h += '<div class="fields3"><div class="field"><label for="t-due">Deadline' + (T.repeat !== 'none' ? ' *' : '') + '</label><input class="input' + (dErr ? ' bad' : '') + '" id="t-due" type="datetime-local" data-t="dueAt" value="' + esc(T.dueAt) + '">' +
    (dErr ? '<span class="err-text">' + errors.dueAt + '</span>' : '') + '</div>' +
    '<div class="field"><label for="t-prio">Prioriteit</label><select class="input" id="t-prio" data-t="priority">' + ['normaal', 'hoog', 'laag'].map(p => '<option value="' + p + '"' + (T.priority === p ? ' selected' : '') + '>' + p[0].toUpperCase() + p.slice(1) + '</option>').join('') + '</select></div>' +
    '<div class="field"><label for="t-rep">Herhalen</label><select class="input" id="t-rep" data-t="repeat" data-rerender="1">' + Object.keys(REPEATS).map(k => '<option value="' + k + '"' + (T.repeat === k ? ' selected' : '') + '>' + REPEATS[k] + '</option>').join('') + '</select></div></div>';
  if (T.repeat !== 'none') h += '<p class="small muted" style="margin:-10px 0 0">' + ICON.repeat + ' Zodra de taak klaar is, staat de volgende automatisch klaar voor dezelfde mensen (' + esc(REPEATS[T.repeat].toLowerCase()) + ', zelfde tijd).</p>';
  const ca = can('tasks.assign'); const pErr = T.tried && errors.people;
  const list = ca ? S.colleagues : S.colleagues.filter(u => same(u.id, S.me.id));
  const allOn = ca && list.length && list.every(u => T.sel[u.id]);
  h += '<fieldset class="box' + (pErr ? ' bad' : '') + '" style="margin:0"><legend class="legend" style="padding:0 6px">Voor wie? *' + (ca ? ' <small>(meerdere mogelijk)</small>' : '') + '</legend><div class="row">' +
    list.slice().sort((a, b) => (same(b.id, S.me.id) ? 1 : 0) - (same(a.id, S.me.id) ? 1 : 0)).map(u => '<button type="button" class="person-chip' + (T.sel[u.id] ? ' on' : '') + '" data-act="t-person" data-id="' + u.id + '" aria-pressed="' + !!T.sel[u.id] + '">' +
      avatar(u.id, u.name) + esc(same(u.id, S.me.id) ? 'Ikzelf' : u.name) + ' · ' + u.open + ' open' + (u.leavingOn ? ' ' + leaveTag(u.leavingOn, true) : '') + '</button>').join('') +
    (ca ? '<button type="button" class="chip" style="border-style:dashed;min-height:44px" data-act="t-allpeople">' + (allOn ? 'Niemand' : 'Hele team') + '</button>' : '') + '</div>' + (pErr ? '<span class="err-text">' + errors.people + '</span>' : '');
  if (chosen.length > 1) h += '<div style="display:flex;flex-direction:column;gap:8px;padding-top:12px;border-top:1px solid var(--line)"><span class="legend">Wanneer is de taak klaar?</span><div class="mode-choice">' +
    '<button type="button" class="' + (T.mode === 'een' ? 'on' : '') + '" data-act="t-mode" data-v="een" aria-pressed="' + (T.mode === 'een') + '"><strong>Zodra één persoon afvinkt</strong><small>Wie het eerst kan, pakt het op</small></button>' +
    '<button type="button" class="' + (T.mode === 'iedereen' ? 'on' : '') + '" data-act="t-mode" data-v="iedereen" aria-pressed="' + (T.mode === 'iedereen') + '"><strong>Pas als iedereen afvinkt</strong><small>Bijv. iets wat iedereen moet lezen</small></button></div></div>';
  h += '</fieldset><div class="form-foot">' + (edit && can('tasks.delete') ? '<button class="btn danger" data-act="t-delete" style="margin-right:auto">' + ICON.trash + 'Verwijderen</button>' : '') +
    '<a class="btn" href="#/taken">Annuleren</a><button class="btn primary" data-act="t-save"' + (T.saving ? ' disabled' : '') + '>' + (edit ? 'Wijzigingen opslaan' : 'Taak aanmaken') + '</button></div></div>';
  return h;
}
function viewSimilar() {
  const T = S.T;
  if (!T || !T.similar || !T.similar.length) return '';
  const open = T.similar.filter(r => !r.done && !same(r.id, T.editId)).slice(0, 3);
  if (!open.length) return '';
  return '<div class="alert info" style="margin-top:6px"><span><strong>Lijkt op een bestaande taak</strong>' + open.map(r => esc(r.title) + ' <span class="small">(voor ' + esc((r.assignees || []).join(', ')) + ')</span>').join('<br>') + '</span></div>';
}

// ----- teambord -----
function viewTeam() {
  const cols = S.team || [];
  let h = '<header class="page-head"><div><h1>Teambord</h1><p>Wat er bij wie open staat.' + (can('callbacks.assign') ? ' Sleep een terugbelverzoek naar een andere kolom om het te verplaatsen.' : '') + '</p></div>' +
    '<div class="actions"><button class="btn" data-act="team-refresh">Verversen</button></div></header>';
  const totLate = cols.reduce((n, c) => n + c.callbacks.filter(x => isLate(x.dueAt)).length, 0);
  h += '<div class="stats">' + stat('Open verzoeken', cols.reduce((n, c) => n + c.callbacks.length, 0)) + stat('Te laat', totLate, 'var(--red)') +
    stat('In de open pool', cols[0] ? cols[0].callbacks.length : 0, 'var(--blue)') + stat('Open taken', cols.reduce((n, c) => n + c.tasks.length, 0)) + '</div>';
  const drag = can('callbacks.assign');
  h += '<div class="board" role="list">' + cols.map(col => {
    const key = col.user ? String(col.user.id) : 'pool';
    const late = col.callbacks.filter(x => isLate(x.dueAt)).length; const load = col.callbacks.length + col.tasks.length;
    return '<section class="col" role="listitem" data-drop="' + key + '" aria-label="' + esc(col.user ? col.user.name : 'Open pool') + '">' +
      '<header class="col-head">' + (col.user ? avatar(col.user.id, col.user.name) : '<span class="avatar" style="background:#1D4ED8">P</span>') +
      '<div style="flex:1;min-width:0"><strong>' + esc(col.user ? (same(col.user.id, S.me.id) ? col.user.name + ' (jij)' : col.user.name) : 'Open pool') + '</strong>' +
      '<small>' + col.callbacks.length + ' verzoek' + (col.callbacks.length === 1 ? '' : 'en') + (col.user ? ' · ' + col.tasks.length + ' ' + (col.tasks.length === 1 ? 'taak' : 'taken') : '') + '</small></div>' +
      (late ? '<span class="badge red">' + late + ' te laat</span>' : (col.user && load >= 8 ? '<span class="badge orange">Druk</span>' : '')) + '</header><div class="col-body">' +
      (col.callbacks.length ? col.callbacks.map(c => '<article class="mini"' + (drag ? ' draggable="true" data-drag="' + c.id + '"' : '') + ' tabindex="0" data-act="team-open" data-id="' + c.id + '" aria-label="' + esc(cbTitle(c)) + '">' +
        '<div class="item-top">' + dueBadge(c.dueAt, 'bel') + (c.priority === 'hoog' ? '<span class="badge red">Hoog</span>' : '') + '</div>' +
        '<strong>' + esc(cbTitle(c)) + '</strong><span class="small muted">Order ' + esc(c.order) + ' · ' + esc(c.category) + '</span></article>').join('') : '<p class="small muted" style="margin:4px 2px">Geen open verzoeken</p>') +
      (col.tasks.length ? '<div class="col-tasks"><span class="small" style="font-weight:600;color:var(--ink-2)">Taken</span>' + col.tasks.map(t => '<div class="mini-task"><span>' + esc(t.title) + '</span>' + (t.dueAt ? dueBadge(t.dueAt, 'taak') : '') + '</div>').join('') + '</div>' : '') +
      '</div></section>';
  }).join('') + '</div>';
  return h;
}

// ----- cijfers -----
function viewStats() {
  const s = S.stats;
  let h = '<header class="page-head"><div><h1>Cijfers</h1><p>Hoe het team ervoor staat met terugbellen.</p></div></header>' +
    '<div class="seg" role="group" aria-label="Periode">' + [7, 30, 90].map(d => '<button data-act="stat-days" data-v="' + d + '" class="' + (S.statDays === d ? 'on' : '') + '" aria-pressed="' + (S.statDays === d) + '">Laatste ' + d + ' dagen</button>').join('') + '</div>';
  if (!s) return h;
  const T = s.totals;
  h += '<div class="stats">' + stat('Verzoeken binnengekomen', T.created) + stat('Afgerond', T.done, 'var(--green)') + stat('Gemiddeld tot teruggebeld', humanMin(T.avgMin)) +
    stat('Te laat afgerond', T.latePct == null ? '–' : T.latePct + '%', T.latePct > 20 ? 'var(--red)' : null) + '</div>';
  h += '<div class="stats">' + stat('Nu open', T.openNow) + stat('Nu te laat', T.lateNow, 'var(--red)') + stat('Nu in de pool', T.poolNow, 'var(--blue)') + '<div class="stat" aria-hidden="true" style="visibility:hidden"></div></div>';
  const max = Math.max(1, ...s.perDay.map(d => Math.max(d.created, d.done)));
  const every = s.days > 30 ? 7 : (s.days > 7 ? 3 : 1);
  h += '<section class="card"><div class="section-title" style="margin-bottom:12px"><h2>Per dag</h2><span class="legend-row"><span class="dot blue"></span>Binnengekomen <span class="dot green"></span>Afgerond</span></div>' +
    '<div class="chart" role="img" aria-label="Verzoeken per dag: binnengekomen en afgerond">' + s.perDay.map((d, i) => {
      const dt = new Date(d.date + 'T12:00');
      return '<div class="bar-group" title="' + esc(DAYS[dt.getDay()] + ' ' + dt.getDate() + ' ' + MONTHS[dt.getMonth()] + ': ' + d.created + ' binnen, ' + d.done + ' afgerond') + '">' +
        '<div class="bars"><span class="bar blue" style="height:' + (d.created / max * 100) + '%"></span><span class="bar green" style="height:' + (d.done / max * 100) + '%"></span></div>' +
        '<span class="bar-label">' + (i % every === 0 ? dt.getDate() + ' ' + MONTHS[dt.getMonth()] : '') + '</span></div>';
    }).join('') + '</div></section>';
  h += '<div class="split" style="align-items:stretch"><section class="card" style="flex:2 1 460px;min-width:0"><h2>Per collega</h2>' +
    (s.people.length ? '<div class="table-wrap" style="border:0"><table><thead><tr><th>Naam</th><th>Afgerond</th><th>Gem. tijd</th><th>Te laat</th><th>Belpogingen</th><th>Taken af</th><th>Nu open</th></tr></thead><tbody>' +
      s.people.map(p => '<tr><td class="pad"><strong>' + esc(p.name) + '</strong></td><td class="pad">' + p.done + '</td><td class="pad">' + humanMin(p.avgMin) + '</td><td class="pad">' + (p.late ? '<span style="color:var(--red)">' + p.late + '</span>' : 0) +
        '</td><td class="pad">' + p.attempts + '</td><td class="pad">' + p.tasksDone + '</td><td class="pad">' + p.openNow + '</td></tr>').join('') + '</tbody></table></div>' : '<p class="muted small">Nog geen gegevens in deze periode.</p>') + '</section>';
  const cmax = Math.max(1, ...s.categories.map(c => c.count));
  h += '<section class="card" style="flex:1 1 260px;min-width:0"><h2>Per categorie</h2>' + (s.categories.length ? s.categories.map(c => '<div class="hbar"><span>' + esc(c.name) + '</span><span class="hbar-track"><span style="width:' + (c.count / cmax * 100) + '%"></span></span><strong>' + c.count + '</strong></div>').join('')
    : '<p class="muted small">Nog geen verzoeken in deze periode.</p>') + '</section></div>';
  return h;
}

// ----- logboek -----
const LOG_LABEL = { 'verzoek-nieuw': ['Nieuw', 'blue'], 'verzoek-bewerkt': ['Bewerkt', ''], 'verzoek-verwijderd': ['Verwijderd', 'red'], 'verzoek-poging': ['Belpoging', ''], 'verzoek-afgerond': ['Afgerond', 'green'],
  'verzoek-heropend': ['Heropend', 'orange'], 'verzoek-opgepakt': ['Opgepakt', 'blue'], 'verzoek-toegewezen': ['Toegewezen', 'blue'], 'taak-nieuw': ['Nieuwe taak', 'blue'], 'taak-bewerkt': ['Taak bewerkt', ''],
  'taak-verwijderd': ['Taak verwijderd', 'red'], 'taak-afgevinkt': ['Afgevinkt', 'green'], 'taak-heropend': ['Taak open', 'orange'], 'taak-herhaling': ['Herhaling', ''],
  'medewerker-nieuw': ['Medewerker', 'dark'], 'medewerker-bewerkt': ['Medewerker', 'dark'], 'medewerker-code': ['Code', 'dark'], 'rol-nieuw': ['Rol', 'dark'], 'rol-bewerkt': ['Rol', 'dark'],
  'rol-verwijderd': ['Rol', 'red'], 'bedrijf-nieuw': ['Bedrijf', 'dark'], 'bedrijf-bewerkt': ['Bedrijf', 'dark'],
  'uren-ingediend': ['Uren ingediend', 'blue'], 'uren-goedgekeurd': ['Uren goed', 'green'], 'uren-afgekeurd': ['Uren afgekeurd', 'red'], 'uren-heropend': ['Uren terug', 'orange'],
  'rooster': ['Rooster', ''], 'medewerker-uitdienst': ['Uit dienst', 'red'], 'medewerker-vertrek': ['Vertrek', 'orange'], 'verlof': ['Verlof', 'blue'], 'ziek': ['Ziek', 'red'], 'medewerker-terug': ['Weer in dienst', 'green'], 'prikklok': ['Prikklok', ''], 'kennisbank': ['Kennisbank', ''], 'documenten': ['Documenten', ''] };
function viewLog() {
  const L = S.log;
  let h = '<header class="page-head"><div><h1>Logboek</h1><p>Wie wat heeft aangemaakt, gewijzigd, toegewezen of afgerond.</p></div></header>' +
    '<div class="row" style="max-width:920px"><label class="sr-only" for="log-user">Persoon</label><select class="input" id="log-user" data-in="loguser" style="flex:0 1 220px"><option value="">Iedereen</option>' +
    S.colleagues.map(u => '<option value="' + u.id + '"' + (same(S.logUser, u.id) ? ' selected' : '') + '>' + esc(u.name) + '</option>').join('') + '</select>' +
    '<label class="sr-only" for="log-q">Zoeken in logboek</label><input class="input" id="log-q" type="search" data-in="logq" value="' + esc(S.logQ) + '" placeholder="Zoek, bijv. een klantnaam of ordernummer" autocomplete="off"></div>';
  if (!L) return h;
  if (!L.entries.length) return h + '<div class="empty">Niets gevonden.</div>';
  let lastDay = '';
  h += '<div class="card log" style="max-width:920px;padding:8px 0">' + L.entries.map(e => {
    const d = new Date(e.at);
    const day = sameDay(d, new Date()) ? 'Vandaag' : DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
    const head = day !== lastDay ? '<div class="log-day">' + day + '</div>' : ''; lastDay = day;
    const lab = LOG_LABEL[e.action] || [e.action, ''];
    return head + '<div class="log-row"><time>' + hm(d) + '</time><span class="badge ' + lab[1] + '">' + esc(lab[0]) + '</span><span class="log-text">' + esc(e.text) + '</span><span class="small muted">' + esc(e.byName) + '</span></div>';
  }).join('') + '</div>' + (L.total > L.entries.length ? '<p class="small muted">De laatste ' + L.entries.length + ' van ' + L.total + ' regels. Zoek of filter om verder terug te kijken.</p>' : '');
  return h;
}

// ----- mensen -----
function codeAlert() {
  if (!S.shownCode) return '';
  return '<div class="alert info" role="status" style="justify-content:space-between;flex-wrap:wrap;align-items:center"><span><strong>' + (S.shownCode.own ? 'Je nieuwe code' : 'Inloggegevens voor ' + esc(S.shownCode.name)) + '</strong>' +
    (S.shownCode.own ? 'Gebruik deze code voortaan om in te loggen.' : 'Bedrijfscode <strong style="display:inline">' + esc(S.org.slug) + '</strong>, naam <strong style="display:inline">' + esc(S.shownCode.name) + '</strong>. Deze code wordt maar één keer getoond.') + '</span>' +
    '<span class="code-big">' + esc(S.shownCode.code) + '</span><button class="btn small" data-act="hidecode">Ik heb hem genoteerd</button></div>';
}
function viewMembers() {
  const mm = can('members.manage');
  let h = '<header class="page-head"><div><h1>Mensen</h1><p>Iedereen logt in met zijn eigen e-mailadres en wachtwoord. Nieuwe mensen krijgen een uitnodiging per mail.</p></div>' +
    (mm ? '<div class="actions"><button class="btn" data-act="imp-open">' + ICON.upload + 'Importeren</button><button class="btn primary" data-act="m-new">' + ICON.plus + 'Medewerker toevoegen</button></div>' : '') + '</header>' + codeAlert() + linkAlert() + importPanel();
  const q = (S.mq || '').trim().toLowerCase(), mf = S.mFilter || {};
  const hit = u => (!q || [u.name, u.email, u.roleName, u.personnelNo, contractShort(u)].some(x => String(x || '').toLowerCase().includes(q)))
    && (!mf.role || (mf.role === 'eigenaar' ? u.isOwner : same(u.roleId, mf.role) && !u.isOwner))
    && (!mf.ct || (mf.ct === 'vast' ? u.contractType === 'vast' : u.contractType !== 'vast'));
  const allAct = S.members.filter(u => !u.archived), allArch = S.members.filter(u => u.archived);
  const actief = allAct.filter(hit), archief = allArch.filter(hit);
  if (S.mTab === 'archief' && !allArch.length) S.mTab = 'actief';
  h += '<div class="m-tools"><div class="seg" role="tablist" aria-label="Medewerkers">' + [['actief', 'In dienst', allAct.length], ['archief', 'Archief', allArch.length]].map(t =>
    '<button role="tab" data-act="m-tab" data-v="' + t[0] + '" class="' + (S.mTab === t[0] ? 'on' : '') + '" aria-selected="' + (S.mTab === t[0]) + '">' + t[1] + '<span class="cnt">' + t[2] + '</span></button>').join('') + '</div>' +
    '<div class="m-search"><input class="input" type="search" id="m-q" data-in="mq" placeholder="Zoek op naam, e-mail, rol of personeelsnummer" value="' + esc(S.mq || '') + '" aria-label="Zoek medewerker"></div>' +
    '<select class="input m-filter" data-in="mrole" aria-label="Filter op rol"><option value="">Alle rollen</option><option value="eigenaar"' + (mf.role === 'eigenaar' ? ' selected' : '') + '>Eigenaar</option>' +
      ((S.roles && S.roles.roles) || []).filter(r => !r.isOwner).map(r => '<option value="' + r.id + '"' + (same(mf.role, r.id) ? ' selected' : '') + '>' + esc(r.name) + '</option>').join('') + '</select>' +
    '<select class="input m-filter" data-in="mct" aria-label="Filter op contract"><option value="">Alle contracten</option><option value="vast"' + (mf.ct === 'vast' ? ' selected' : '') + '>Vast</option><option value="flex"' + (mf.ct === 'flex' ? ' selected' : '') + '>Flex / 0-uren</option></select>' +
    (q || mf.role || mf.ct ? '<span class="small muted">' + (S.mTab === 'archief' ? archief.length + ' van ' + allArch.length : actief.length + ' van ' + allAct.length) + ' gevonden · <button class="link-btn" data-act="m-qclear">Wissen</button></span>' : '') + '</div>';
  if (S.mTab === 'archief') {
    h += '<div class="split"><div class="list"><div class="table-wrap"><table><thead><tr><th>Naam</th><th>Laatste rol</th><th>Uit dienst per</th><th>Reden</th></tr></thead><tbody>' +
      archief.map(u => {
        const cell = c => '<td><button class="rowbtn" data-act="m-sel" data-id="' + u.id + '">' + c + '</button></td>';
        return '<tr class="' + (same(S.mSel, u.id) ? 'sel' : '') + '">' + cell('<strong>' + esc(u.name) + '</strong>') + cell(esc(u.roleName)) +
          cell(u.leftOn ? esc(dayShort(u.leftOn) + ' ' + String(u.leftOn).slice(0, 4)) : '–') + cell('<span class="badge ' + reasonColor(u.leaveReason) + '">' + esc(u.leaveReasonLabel || '') + '</span>') + '</tr>';
      }).join('') + (archief.length ? '' : '<tr><td colspan="4" class="pad muted">Niemand gevonden.</td></tr>') + '</tbody></table></div></div><aside class="detail card">' + viewArchivePanel() + '</aside></div>';
    return h;
  }
  h += '<div class="split"><div class="list"><div class="table-wrap"><table><thead><tr><th>Naam</th><th>Rol</th><th>Contract</th><th>Status</th><th>Laatst ingelogd</th></tr></thead><tbody>' +
    actief.map(u => {
      const cell = c => '<td><button class="rowbtn" data-act="m-sel" data-id="' + u.id + '">' + c + '</button></td>';
      return '<tr class="' + (u.isOwner ? 'admin ' : '') + (same(S.mSel, u.id) && !S.mNew ? 'sel' : '') + '">' +
        cell('<span style="display:inline-flex;gap:8px;align-items:center;font-weight:600">' + (u.isOwner ? ICON.lock : '') + esc(u.name) + (same(u.id, S.me.id) ? ' <span class="small muted">(jij)</span>' : '') + '</span>') +
        cell(u.isOwner ? '<span class="badge dark">Eigenaar</span>' : esc(u.roleName)) +
        cell('<span class="small">' + esc(contractShort(u)) + '</span>') +
        cell(u.leaving ? leaveBadge(u) : !u.active ? '<span class="small muted">Gedeactiveerd</span>' : memberStatus(u) || '<span class="small" style="color:var(--green)">Actief</span>') +
        cell('<span class="small muted">' + (u.lastLogin ? esc(fmtDate(u.lastLogin)) : 'Nog nooit') + '</span>') + '</tr>';
    }).join('') + (actief.length ? '' : '<tr><td colspan="5" class="pad muted">Niemand gevonden met deze zoekopdracht.</td></tr>') + '</tbody></table></div></div><aside class="detail card">' + viewMemberPanel() + '</aside></div>';
  return h;
}
function roleOptions(selected) {
  return (S.roles ? S.roles.roles : []).filter(r => !r.isOwner && (r.canAssign || same(r.id, selected)))
    .map(r => '<option value="' + r.id + '"' + (same(r.id, selected) ? ' selected' : '') + (r.canAssign ? '' : ' disabled') + '>' + esc(r.name) + '</option>').join('');
}
function permSummary(roleId) {
  const r = S.roles && S.roles.roles.find(x => same(x.id, roleId));
  if (!r) return '';
  return '<div class="small muted">' + esc(r.description || '') + '</div><div class="chips" style="margin-top:6px">' +
    PERM_GROUPS.flatMap(g => g[1]).filter(p => r.permissions.includes(p[0])).map(p => '<span class="badge">' + esc(p[1]) + '</span>').join('') + '</div>';
}
function unitsBox(u) {
  const U = S.units; if (!U || (!U.departments.length && !U.functions.length)) return '';
  if (!(can('members.manage') || can('hours.plan'))) return '';
  const E = S.muEdit && same(S.muEdit.id, u.id) ? S.muEdit : { id: u.id, d: (u.departmentIds || []).map(String), f: (u.functionIds || []).map(String) };
  const pick = (list, sel, kind) => list.map(x => '<button type="button" class="unit-chip' + (sel.includes(String(x.id)) ? ' on' : '') + '" data-act="mu-toggle" data-v="' + kind + '|' + x.id + '"' + (x.color ? ' style="--c:' + esc(x.color) + '"' : '') + ' aria-pressed="' + sel.includes(String(x.id)) + '">' + esc(x.name) + '</button>').join('');
  return '<fieldset class="box" style="margin:0"><legend class="legend" style="padding:0 4px">Afdelingen en functies</legend>' +
    (U.departments.length ? '<div class="small muted">Afdelingen</div><div class="unit-chips">' + pick(U.departments, E.d, 'd') + '</div>' : '') +
    (U.functions.length ? '<div class="small muted" style="margin-top:8px">Functies (wat mag diegene doen?)</div><div class="unit-chips">' + pick(U.functions, E.f, 'f') + '</div>' : '') +
    (S.muEdit && same(S.muEdit.id, u.id) ? '<div class="row" style="margin-top:8px"><button class="btn small dark" data-act="mu-save" data-id="' + u.id + '">Opslaan</button><button class="btn small ghost" data-act="mu-cancel">Annuleren</button></div>' : '') + '</fieldset>';
}
function viewMemberPanel() {
  if (S.mNew) {
    const first = (S.roles.roles.find(r => r.name === 'Medewerker' && r.canAssign) || S.roles.roles.find(r => !r.isOwner && r.canAssign) || {}).id;
    const sel = S.mNewRole || first;
    return '<div class="stack" style="gap:16px"><div><span class="small muted">Nieuwe medewerker</span><h2 style="margin:0;font-size:22px">Medewerker toevoegen</h2></div>' +
      '<div class="field"><label for="m-name">Naam *</label><input class="input" id="m-name" placeholder="Bijv. Lisa de Jong" autocomplete="off"><span class="small muted">Moet uniek zijn binnen je bedrijf.</span></div>' +
      '<div class="field"><label for="m-email">E-mailadres *</label><input class="input" id="m-email" type="email" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="lisa@bedrijf.nl"><span class="small muted">Hier komt de uitnodiging naartoe. Hiermee logt diegene ook in.</span></div>' + memberBizFields({ locationId: S.locFilter }) +
      '<div class="field"><label for="m-role">Rol</label><select class="input" id="m-role" data-act-change="m-role-new">' + roleOptions(sel) + '</select>' + permSummary(sel) + '</div>' +
      '<div class="detail-section"><button class="btn dark" data-act="m-create">Aanmaken en uitnodigen</button><button class="btn ghost" data-act="m-cancel">Annuleren</button></div>' +
      '<p class="small muted" style="margin:0">Diegene krijgt een mail met een link om een wachtwoord te kiezen. De link werkt 7 dagen.</p></div>';
  }
  const u = S.members.find(x => same(x.id, S.mSel) && !x.archived);
  if (!u) return '<p class="muted" style="margin:0">Kies iemand in de lijst om de gegevens te bekijken of aan te passen.</p>';
  const self = same(u.id, S.me.id);
  if (S.offboard && same(S.offboard.id, u.id)) return offboardForm(u);
  const note = u.leaveNote ? u.leaveNote.trim().replace(/([^.!?])$/, '$1.') + ' ' : '';
  const leavingBox = u.leaving ? '<div class="alert ' + (u.leaveReason === 'ontslagen' ? 'error' : 'warn') + '" style="flex-direction:column;gap:8px"><span><strong>' +
      esc(u.leaveReasonLabel) + ' · laatste werkdag ' + esc(dayLong(u.leftOn).toLowerCase()) + '</strong>' + esc(note) +
      'Daarna gaat het account automatisch uit en komt ' + esc(u.name.split(' ')[0]) + ' in het archief.</span>' +
      (can('members.manage') && u.canManage ? '<span class="row"><button class="btn small" data-act="m-restore" data-id="' + u.id + '">Vertrek intrekken</button>' +
        '<button class="btn small danger" data-act="m-off-now" data-id="' + u.id + '">Nu al uitzetten</button></span>' : '') + '</div>' : '';
  if (u.isOwner && !self) {
    return '<div class="stack" style="gap:12px"><div><span class="small muted">Eigenaar</span><h2 style="margin:0;font-size:22px;display:flex;gap:8px;align-items:center">' + ICON.lock + esc(u.name) + '</h2></div>' +
      '<p class="small muted" style="margin:0">De eigenaar heeft altijd alle rechten. Niemand anders kan dit account aanpassen of deactiveren.</p></div>';
  }
  if (!u.canManage && !self) {
    return '<div class="stack" style="gap:12px"><div><span class="small muted">' + esc(u.roleName) + '</span><h2 style="margin:0;font-size:22px">' + esc(u.name) + '</h2></div>' + leavingBox + permSummary(u.roleId) +
      '<dl class="kv"><dt>Contract</dt><dd>' + esc(contractText(u)) + '</dd></dl>' +
      '<p class="small muted" style="margin:0">' + (can('members.manage') ? 'Deze medewerker heeft meer rechten dan jij; dat kun je niet aanpassen.' : 'Je kunt medewerkers bekijken maar niet aanpassen.') + '</p></div>';
  }
  return '<div class="stack" style="gap:16px"><div><span class="small muted">' + (self ? 'Je eigen account' : 'Bewerken') + '</span><h2 style="margin:0;font-size:22px">' + esc(u.name) + '</h2></div>' + leavingBox +
    '<div class="field"><label for="m-name">Naam</label><input class="input" id="m-name" value="' + esc(u.name) + '"></div>' +
    (self ? '<dl class="kv"><dt>Rol</dt><dd>' + esc(u.roleName) + '</dd></dl>' :
      '<div class="field"><label for="m-role">Rol</label><select class="input" id="m-role" data-act-change="m-role-edit">' + roleOptions(u.roleId) + '</select><div id="m-perms">' + permSummary(u.roleId) + '</div></div>' +
      '<label class="check"><input type="checkbox" id="m-active"' + (u.active ? ' checked' : '') + '> Account actief (kan inloggen)</label>') +
    (!self || S.me.isOwner ? contractFields(u) : '<dl class="kv"><dt>Contract</dt><dd>' + esc(contractText(u)) + '</dd></dl>') + leaveAccountBox(u) + unitsBox(u) +
    (can('members.manage') && (!self || S.me.isOwner || can('members.manage')) ? memberBizFields(u) : '') +
    '<div class="detail-section"><button class="btn dark" data-act="m-save" data-id="' + u.id + '">Opslaan</button>' +
    (self || !can('members.manage') || u.leaving ? '' : '<button class="btn danger" data-act="m-off-open" data-id="' + u.id + '">Uit dienst melden</button>') + '</div>' +
    (self ? '<p class="small muted" style="margin:0">Je e-mailadres, wachtwoord en tweestapsverificatie regel je bij Instellingen.</p>' : memberAccess(u)) + '</div>';
}

// ----- rollen -----
function viewRoles() {
  const R = S.roles;
  if (!R) return '';
  const rm = can('roles.manage');
  let h = '<header class="page-head"><div><h1>Rollen &amp; rechten</h1><p>Elke medewerker heeft één rol. Een rol bepaalt wat iemand mag.</p></div>' +
    (rm ? '<div class="actions"><button class="btn primary" data-act="r-new">' + ICON.plus + 'Nieuwe rol</button></div>' : '') + '</header>';
  h += '<div class="split"><div class="list" style="flex:1 1 300px"><div class="role-list">' + R.roles.map(r => '<button class="role-item' + (same(S.rSel, r.id) && !S.rNew ? ' sel' : '') + '" data-act="r-sel" data-id="' + r.id + '">' +
    '<span><strong>' + esc(r.name) + '</strong><small>' + esc(r.description || '') + '</small></span>' +
    '<span class="badge' + (r.isOwner ? ' dark' : '') + '">' + (r.isOwner ? 'Alles' : r.members + ' ' + (r.members === 1 ? 'persoon' : 'personen')) + '</span></button>').join('') + '</div></div>' +
    '<aside class="detail card" style="flex:2 1 460px">' + viewRolePanel() + '</aside></div>';
  return h;
}
function viewRolePanel() {
  const R = S.roles;
  const r = S.rNew ? { id: null, name: '', description: '', permissions: [], canEdit: true, isOwner: false, members: 0 } : R.roles.find(x => same(x.id, S.rSel));
  if (!r) return '<p class="muted" style="margin:0">Kies een rol om de rechten te bekijken' + (can('roles.manage') ? ' of aan te passen' : '') + '.</p>';
  const editable = r.canEdit && can('roles.manage');
  const mine = new Set(R.mine);
  let h = '<div class="stack" style="gap:16px">';
  if (editable) {
    h += '<div class="fields2"><div class="field"><label for="r-name">Naam</label><input class="input" id="r-name" value="' + esc(r.name) + '" maxlength="40"></div>' +
      '<div class="field"><label for="r-desc">Omschrijving</label><input class="input" id="r-desc" value="' + esc(r.description || '') + '" maxlength="200"></div></div>';
  } else {
    h += '<div><span class="small muted">' + (r.isOwner ? 'Vaste rol' : 'Alleen bekijken') + '</span><h2 style="margin:0;font-size:22px;display:flex;gap:8px;align-items:center">' + (r.isOwner ? ICON.lock : '') + esc(r.name) + '</h2>' +
      '<p class="small muted" style="margin:4px 0 0">' + esc(r.isOwner ? 'De eigenaar heeft altijd alle rechten. Deze rol kan niet worden aangepast of verwijderd.' : (r.description || '')) + '</p></div>';
  }
  h += '<div class="perm-grid">' + PERM_GROUPS.map(g => '<fieldset class="perm-group"><legend class="sr-only">' + g[0] + '</legend><h3>' + g[0] + '</h3>' +
    g[1].map(p => {
      const dis = !editable || (!S.me.isOwner && !mine.has(p[0]));
      return '<label class="check"><input type="checkbox" data-perm="' + p[0] + '"' + (r.permissions.includes(p[0]) ? ' checked' : '') + (dis ? ' disabled' : '') + '> ' + p[1] + '</label>';
    }).join('') + '</fieldset>').join('') + '</div>';
  if (editable) {
    h += (!S.me.isOwner ? '<p class="small muted" style="margin:0">' + ICON.shield + ' Je kunt alleen rechten geven die je zelf ook hebt.</p>' : '') +
      '<div class="form-foot">' + (r.id && !r.members ? '<button class="btn danger" data-act="r-delete" data-id="' + r.id + '" style="margin-right:auto">' + ICON.trash + 'Verwijderen</button>' : '') +
      (S.rNew ? '<button class="btn" data-act="r-cancel">Annuleren</button>' : '') + '<button class="btn primary" data-act="r-save"' + (r.id ? ' data-id="' + r.id + '"' : '') + '>' + (S.rNew ? 'Rol aanmaken' : 'Opslaan') + '</button></div>';
    if (r.id && r.members) h += '<p class="small muted" style="margin:0">' + r.members + ' ' + (r.members === 1 ? 'persoon heeft' : 'personen hebben') + ' deze rol. Wijzigingen gelden direct voor hen.</p>';
  }
  return h + '</div>';
}

// ----- instellingen -----
const SET_TABS = [['account', 'Mijn account'], ['bedrijf', 'Bedrijf'], ['uren', 'Uren & verlof'], ['beveiliging', 'Beveiliging & privacy'], ['abonnement', 'Abonnement']];
function setTabs() {
  return SET_TABS.filter(t => t[0] === 'account' || (t[0] === 'abonnement' ? S.me.isOwner : t[0] === 'beveiliging' ? (can('org.manage') || S.orgLogins || S.me.isOwner) : can('org.manage')));
}
function companyCard() {
  const s = settings();
    const tz = s.timezone || 'Europe/Amsterdam';
    return '<section class="card stack" style="gap:14px"><h2>Bedrijf</h2>' +
      '<div class="field"><label for="o-name">Bedrijfsnaam</label><input class="input" id="o-name" value="' + esc(S.org.name) + '"></div>' +
      '<dl class="kv"><dt>Bedrijfscode</dt><dd>' + esc(S.org.slug) + '</dd></dl>' +
      '<div class="field"><label for="o-tz">Tijdzone</label><select class="input" id="o-tz">' + (TIMEZONES.includes(tz) ? TIMEZONES : [tz].concat(TIMEZONES)).map(z => '<option' + (z === tz ? ' selected' : '') + '>' + z + '</option>').join('') + '</select></div>' +
      '<div class="field"><label for="o-cats">Categorieën voor terugbelverzoeken</label><textarea class="input" id="o-cats" rows="6" aria-describedby="o-cats-h">' + esc((s.categories || []).join('\n')) + '</textarea><span class="small muted" id="o-cats-h">Eén per regel.</span></div>' +
      '<div class="field"><label for="o-notes">Snelnotities</label><textarea class="input" id="o-notes" rows="6" aria-describedby="o-notes-h">' + esc((s.quick_notes || []).join('\n')) + '</textarea><span class="small muted" id="o-notes-h">Eén per regel. Deze knoppen staan bij elk terugbelverzoek.</span></div>' +
      '<div><button class="btn primary" data-act="o-save">Opslaan</button></div></section>';
}
function viewSettings() {
  const tabs = setTabs();
  const tab = tabs.some(t => t[0] === S.setTab) ? S.setTab : 'account';
  const grid = '<div class="cards set-cards">';
  let h = '<header class="page-head"><div><h1>Instellingen</h1><p>' + (tabs.length > 1 ? 'Kies hieronder wat je wilt regelen.' : 'Je eigen account.') + '</p></div></header>' + codeAlert() + linkAlert();
  if (tabs.length > 1) h += '<div class="set-tabs" role="tablist">' + tabs.map(t => '<button role="tab" class="' + (t[0] === tab ? 'on' : '') + '" aria-selected="' + (t[0] === tab) + '" data-act="set-tab" data-v="' + t[0] + '">' + t[1] + '</button>').join('') + '</div>';
  if (tab === 'account') return h + grid + accountCard() + (typeof selfPrefsCard === 'function' ? selfPrefsCard() : '') + mailPrefsCard() + '</div>';
  if (tab === 'bedrijf') return h + grid + companyCard() + locationsCard() + (hasFeature('phone') ? viewPhoneLink() : '') + '</div>';
  if (tab === 'uren') return h + grid + breakRulesCard() + leaveRulesCard() + payrollSettingsCard() + '</div>';
  if (tab === 'beveiliging') return h + grid + securityCards() + (S.me.isOwner ? pinWindowCard() : '') + '</div>';
  if (tab === 'abonnement') return h + grid + billingCard() + '</div>';
  return h;
}
// ---------- verlofsaldo ----------
const COVER = { onbetaald: ['Onbetaald verlof', 'De uren die tekort zijn worden niet doorbetaald.'], voorschot: ['Voorschot', 'Het saldo mag tijdelijk negatief worden en wordt later ingehaald.'],
  kopen: ['Verlof kopen', 'De uren worden ingehouden op het salaris en staan in de salarisexport.'], overuren: ['Overuren gebruiken', 'Tijd voor tijd: de uren gaan van het overurensaldo af.'] };
const hrsTxt = v => { const n = Math.round(Number(v || 0) * 100) / 100; return String(n).replace('.', ',') + ' uur'; };
function leaveHoursField(E, n) {
  const L = S.abs && S.abs.leave; const self = !E.memberId;
  const dayH = self && L ? Number(L.dayHours) : 8;
  const def = Math.round(n * dayH * 100) / 100;
  const hrs = E.hours !== undefined && E.hours !== '' ? Number(String(E.hours).replace(',', '.')) : def;
  let h = '<div class="fields2" style="max-width:520px;align-items:end"><div class="field"><label for="abs-hours">Aantal uur</label><input class="input" id="abs-hours" data-abs="hours" inputmode="decimal" value="' + esc(E.hours !== undefined ? E.hours : '') + '" placeholder="' + esc(String(def).replace('.', ',')) + '"></div>' +
    '<p class="small muted" style="margin:0 0 12px">' + n + (n === 1 ? ' werkdag' : ' werkdagen') + (self ? ' × ' + hrsTxt(dayH) : '') + '. Pas het aan voor bijvoorbeeld een halve dag.</p></div>';
  if (self && E.kind === 'verlof' && L) {
    const y = (E.from || today()).slice(0, 4); const st = L.status && String(L.status.year) === y ? L.status : L.next && String(L.next.year) === y ? L.next : null;
    if (st && st.tracked) {
      const left = Number(st.left) - Number(st.pending || 0);
      h += hrs > left
        ? '<div class="alert warn">Je hebt in ' + y + ' nog ' + hrsTxt(Math.max(left, 0)) + ' verlof over' + (st.pending ? ' (na je andere aanvragen)' : '') + '. Je komt <strong>&nbsp;' + hrsTxt(hrs - Math.max(left, 0)) + '&nbsp;</strong> tekort. Je leidinggevende kiest hoe dat wordt opgelost.</div>'
        : '<p class="small" style="margin:0">Na deze aanvraag heb je in ' + y + ' nog <strong>' + hrsTxt(left - hrs) + '</strong> verlof over.</p>';
    }
  }
  return h;
}
function leaveSaldoCard() {
  const L = S.abs && S.abs.leave; if (!L || !L.status || !L.status.tracked) return '';
  const st = L.status; const pct = st.entitled > 0 ? Math.max(0, Math.min(100, st.used / st.entitled * 100)) : 100;
  return '<section class="card leave-card"><div><span class="small muted">Verlofsaldo ' + st.year + '</span><strong class="leave-big' + (st.left < 0 ? ' neg' : '') + '">' + hrsTxt(st.left) + '</strong><span class="small muted">over van ' + hrsTxt(st.entitled) + '</span></div>' +
    '<div class="leave-bar"><span style="width:' + pct + '%"></span></div>' +
    '<div class="small muted">' + hrsTxt(st.used) + ' opgenomen' + (st.pending ? ' · ' + hrsTxt(st.pending) + ' aangevraagd' : '') + (Number(st.tvt) ? ' · overuren: ' + hrsTxt(st.tvtLeft) + ' over' : '') + '</div></section>';
}
function leavePendingInfo(a) {
  const b = a.balance; if (a.kind !== 'verlof' || !b || !b.tracked || a.hours == null) return '';
  const avail = Math.max(Number(b.left), 0); const short = Number(a.hours) - avail;
  const L = S.abs && S.abs.leave; const opts = Object.keys(COVER).filter(k => L && L.settings && L.settings[k]);
  let h = '<div class="small" style="margin-top:4px">Saldo ' + b.year + ': <strong>' + hrsTxt(b.left) + '</strong> over · deze aanvraag: <strong>' + hrsTxt(a.hours) + '</strong>' + (Number(b.tvt) ? ' · overuren: ' + hrsTxt(b.tvtLeft) : '') + '</div>';
  if (short > 0) {
    h += '<div class="alert warn" style="margin-top:8px;flex-direction:column;align-items:stretch;gap:6px"><strong>Tekort: ' + hrsTxt(short) + '</strong>' +
      (opts.length ? '<label class="small" for="cover-' + a.id + '">Hoe los je het tekort op?</label><select class="input" id="cover-' + a.id + '"><option value="">— Kies —</option>' +
        opts.map(k => '<option value="' + k + '"' + (k === 'overuren' && Number(b.tvtLeft) < short ? ' disabled' : '') + '>' + COVER[k][0] + (k === 'voorschot' ? ' (max. ' + hrsTxt(L.settings.advanceMax) + ' negatief)' : '') + (k === 'overuren' ? ' (' + hrsTxt(b.tvtLeft) + ' beschikbaar)' : '') + '</option>').join('') + '</select>'
        : '<span class="small">Er staan geen oplossingen aan bij Instellingen → Verlofregels. Wijs de aanvraag af of zet daar een optie aan.</span>') + '</div>';
  }
  return h;
}
function leaveAccountBox(u) {
  if (!(S.me.isOwner || can('hours.leave_balance'))) return '';
  const A = S.leaveAcc && same(S.leaveAcc.memberId, u.id) ? S.leaveAcc : null;
  const y = S.leaveYear || Number(today().slice(0, 4));
  if (!A && S.leaveLoading !== u.id) { S.leaveLoading = u.id; loadLeaveAcc(u.id).then(() => { S.leaveLoading = null; if (S.leaveAcc && same(S.mSel, u.id)) render(); }); }
  if (!A) return '<fieldset class="box" style="margin:0"><legend class="legend" style="padding:0 4px">Verlofsaldo</legend><p class="small muted" style="margin:0">Laden…</p></fieldset>';
  const d = A.data;
  return '<fieldset class="box" style="margin:0"><legend class="legend" style="padding:0 4px">Verlofsaldo</legend>' +
    '<div class="seg"><button class="' + (y === Number(today().slice(0, 4)) ? 'on' : '') + '" data-act="la-year" data-id="' + u.id + '" data-v="' + today().slice(0, 4) + '">' + today().slice(0, 4) + '</button><button class="' + (y === Number(today().slice(0, 4)) + 1 ? 'on' : '') + '" data-act="la-year" data-id="' + u.id + '" data-v="' + (Number(today().slice(0, 4)) + 1) + '">' + (Number(today().slice(0, 4)) + 1) + '</button></div>' +
    '<div class="fields2"><div class="field"><label for="la-leave">Verlofuren in ' + y + '</label><input class="input" id="la-leave" inputmode="decimal" placeholder="Bijv. 160" value="' + (d.tracked && !d.auto ? esc(String(d.entitled).replace('.', ',')) : '') + '"></div>' +
    '<div class="field"><label for="la-tvt">Overuren (tijd voor tijd)</label><input class="input" id="la-tvt" inputmode="decimal" placeholder="0" value="' + (d.tracked && !d.auto && Number(d.tvt) ? esc(String(d.tvt).replace('.', ',')) : '') + '"></div></div>' +
    (d.auto ? '<p class="small" style="margin:0;color:var(--accent)">' + (d.auto.basis === 'vast' ? 'Automatisch: ' + String(d.auto.weeks).replace('.', ',') + ' × ' + hrsTxt(d.auto.weekHours) + ' per week = <strong>' + hrsTxt(d.auto.entitled) + '</strong>' + (d.auto.partial ? ' (naar rato, gaat uit dienst)' : '') : 'Automatisch, flex: ' + hrsTxt(d.auto.worked) + ' gewerkt × ' + String(d.auto.weeks).replace('.', ',') + '/52 = <strong>' + hrsTxt(d.auto.entitled) + '</strong> opgebouwd') + '. Vul zelf een getal in om dit te overschrijven.</p>' : '') +
    (d.tracked ? '<p class="small muted" style="margin:0">Opgenomen: ' + hrsTxt(d.used) + ' · over: <strong>' + hrsTxt(d.left) + '</strong>' + (d.pending ? ' · aangevraagd: ' + hrsTxt(d.pending) : '') + (Number(d.tvt) ? ' · overuren over: ' + hrsTxt(d.tvtLeft) : '') + '</p>' : '<p class="small muted" style="margin:0">Nog geen saldo voor ' + y + '. Leeg laten = geen saldo bijhouden.</p>') +
    '<div class="row"><button class="btn small" data-act="la-save" data-id="' + u.id + '">Saldo opslaan</button></div></fieldset>';
}
async function loadLeaveAcc(id) {
  const y = S.leaveYear || Number(today().slice(0, 4));
  try { S.leaveAcc = { memberId: id, data: await rpc('cd_leave_account', { p_member: id, p_year: y }) }; } catch (e) { S.leaveAcc = null; }
}
function leaveRulesCard() {
  const L = (S.org.settings || {}).leave || {}; const v = k => L[k] === undefined ? true : !!L[k];
  const auto = L.auto === undefined ? true : !!L.auto;
  if (S.lvWeeks == null) S.lvWeeks = Number(L.weeks) || 4;
  if (!S.lvContracts) S.lvContracts = (L.contracts || []).map(Number);
  const wk = S.lvWeeks;
  const fmtNum = n => String(Math.round(n * 100) / 100).replace('.', ',');
  const std = [40, 36, 32, 24], all = std.concat(S.lvContracts.filter(h => !std.includes(h))).sort((x, y) => y - x);
  const ex = h => { const own = !std.includes(h); return '<tr' + (own ? ' class="own"' : '') + '><td>' + fmtNum(h) + ' uur' + (own ? ' <span class="lv-own">eigen</span>' : '') + '</td><td><strong>' + fmtNum(wk * h) + ' uur</strong></td><td class="muted">' + fmtNum(wk * h / 8) + '</td><td>' +
    (own ? '<button class="icon-btn small" data-act="lv-ctr-del" data-v="' + h + '" aria-label="' + fmtNum(h) + ' uur weghalen">' + ICON.x + '</button>' : '') + '</td></tr>'; };
  return '<section class="card stack" style="gap:12px"><h2>Standaard verlof</h2><p class="small muted" style="margin:0">Het verlofsaldo wordt automatisch berekend uit de contracturen. Wettelijk minimum in Nederland: <strong>4 × de uren per week</strong>. Een eigen saldo bij Mensen gaat altijd voor.</p>' +
    '<label class="check"><input type="checkbox" id="lr-auto"' + (auto ? ' checked' : '') + '> <span><strong>Verlof automatisch berekenen</strong></span></label>' +
    '<div class="field"><label for="lr-weeks">Weken verlof per jaar</label><select class="input" id="lr-weeks" data-in="lvweeks">' + [4, 4.5, 5, 5.5, 6].map(n => '<option value="' + n + '"' + (n === wk ? ' selected' : '') + '>' + String(n).replace('.', ',') + ' weken' + (n === 4 ? ' (wettelijk minimum)' : ' (' + String(n * 5).replace('.', ',') + ' dagen bij fulltime)') + '</option>').join('') + '</select></div>' +
    '<table class="lv-table"><colgroup><col><col><col style="width:64px"><col style="width:40px"></colgroup><thead><tr><th>Contract</th><th>Verlof per jaar</th><th>Dagen*</th><th></th></tr></thead><tbody>' + all.map(ex).join('') + '</tbody></table>' +
    '<div class="lv-add"><label for="lv-new" class="small"><strong>Eigen contract toevoegen</strong></label><div class="row" style="gap:8px;flex-wrap:nowrap"><input class="input" id="lv-new" data-in="lvnew" inputmode="decimal" placeholder="Bijv. 28" style="max-width:110px"><span class="small muted" style="white-space:nowrap">uur per week</span><button class="btn small" data-act="lv-ctr-add">Toevoegen</button></div>' +
      '<span class="small" id="lv-prev" style="color:var(--accent)"></span></div>' +
    '<p class="small muted" style="margin:0">* Dagen van 8 uur. Flex en 0-uren: per gewerkt uur ' + String((wk / 52).toFixed(4)).replace('.', ',') + ' uur verlof (' + String(wk).replace('.', ',') + ' weken ÷ 52), op basis van goedgekeurde uren.</p>' +
    '<div><button class="btn primary" data-act="lr-save">Opslaan</button></div></section>' +
    '<section class="card stack" style="gap:12px"><h2>Verlofregels</h2><p class="small muted" style="margin:0">Wat mag er gebeuren als iemand meer verlof aanvraagt dan er op zijn saldo staat? Wie het verlof goedkeurt, kiest dan uit de opties die hier aan staan.</p>' +
    Object.keys(COVER).map(k => '<label class="check"><input type="checkbox" id="lr-' + k + '"' + (v(k) ? ' checked' : '') + '> <span><strong>' + COVER[k][0] + '</strong><br><span class="small muted">' + COVER[k][1] + '</span></span></label>').join('') +
    '<div class="field" style="max-width:240px"><label for="lr-max">Voorschot: saldo mag maximaal zoveel uur negatief</label><input class="input" id="lr-max" inputmode="decimal" value="' + esc(String(L.advanceMax === undefined ? 40 : L.advanceMax)) + '"></div>' +
    '<div><button class="btn primary" data-act="lr-save">Opslaan</button></div></section>';
}
// ---------- status van collega's (rechterbalk) ----------
const PRES = { beschikbaar: ['Beschikbaar', '#23A55A'], niet_storen: ['Niet storen', '#F23F43'], afwezig: ['Afwezig', '#F0B232'], lunch: ['Lunch', '#3B82F6'] };
const PRES_ORDER = ['beschikbaar', 'lunch', 'afwezig', 'niet_storen'];
async function loadPresence() {
  if (!S.me || (typeof isMobileApp === 'function' && isMobileApp())) return;
  try { S.presence = await rpc('cd_presence'); } catch (e) { S.presence = null; }
}
function presRow(p, inside) {
  const st = PRES[p.status] || PRES.beschikbaar;
  const col = inside ? st[1] : '#9AA4B2';
  const since = p.since ? (p.sinceDate ? dayShort(p.sinceDate) + ' ' : '') + p.since : '';
  return '<li class="pres-row' + (inside ? '' : ' off') + '"><span class="pres-av">' + avatar(p.id, p.name) + '<i style="background:' + col + '" aria-hidden="true"></i></span>' +
    '<span class="pres-txt"><strong>' + esc(p.name) + (same(p.id, S.me.id) ? ' <span class="muted">(jij)</span>' : '') + '</strong>' +
    '<span>' + (inside ? esc(st[0]) + (since ? ' · in sinds ' + esc(since) : '') : 'Niet ingeklokt') + '</span></span></li>';
}
function viewPresence() {
  const P = S.presence; if (!P) return '';
  const open = !!S.presOpen;
  const inside = P.people.filter(p => p.in).sort((a, b) => PRES_ORDER.indexOf(a.status) - PRES_ORDER.indexOf(b.status) || a.name.localeCompare(b.name));
  const out = P.people.filter(p => !p.in);
  const me = PRES[P.me] || PRES.beschikbaar;
  let h = '<aside class="presence' + (open ? ' open' : '') + '" id="presence" aria-label="Status van collega\'s">' +
    '<button class="pres-fab" data-act="pres-toggle" aria-expanded="' + open + '" title="Collega\'s">' + NI.mensen + '<b>' + inside.length + '</b></button>' +
    '<div class="pres-panel"><div class="pres-me"><span class="pres-av">' + avatar(S.me.id, S.me.name) + '<i style="background:' + me[1] + '"></i></span>' +
    '<div class="field" style="flex:1;min-width:0;gap:2px"><label for="pres-me" class="small muted">Jouw status</label><select class="input" id="pres-me">' +
    PRES_ORDER.map(k => '<option value="' + k + '"' + (k === P.me ? ' selected' : '') + '>' + PRES[k][0] + '</option>').join('') + '</select></div>' +
    '<button class="icon-btn pres-close" data-act="pres-toggle" aria-label="Sluiten">' + ICON.x + '</button></div>';
  h += '<h3 class="pres-h">Ingeklokt — ' + inside.length + '</h3>' + (inside.length ? '<ul class="pres-list">' + inside.map(p => presRow(p, true)).join('') + '</ul>' : '<p class="small muted pres-empty">Nu is er niemand ingeklokt.</p>');
  if (out.length) h += '<details class="pres-out"' + (S.presOutOpen ? ' open' : '') + '><summary class="pres-h" data-act="pres-out">Niet ingeklokt — ' + out.length + '</summary><ul class="pres-list">' + out.map(p => presRow(p, false)).join('') + '</ul></details>';
  return h + '</div></aside>';
}
// ---------- danger zone: eigen pincode bij de prikklok ----------
function pinD(v) { const x = new Date(v + 'T12:00'); return x.getDate() + ' ' + MONTHS[x.getMonth()]; }
function pinDT(v) { const [d, t] = v.split('T'); const x = new Date(d + 'T12:00'); return x.getDate() + ' ' + MONTHS[x.getMonth()] + ' ' + t; }
function pinWindowCard() {
  const D = S.pinWin; if (!D) return '';
  const P = S.pinNew || (S.pinNew = { mode: 'dagen', from: today(), to: today(), t1: '08:00', t2: '17:00' });
  const active = D.windows.find(w => w.active);
  let h = '<section class="card stack danger-zone" style="gap:14px;grid-column:1/-1"><div><span class="dz-tag">Danger zone</span><h2 style="margin-top:6px">Inklokken met eigen pincode</h2>' +
    '<p class="small" style="margin:4px 0 0">Normaal klokt iedereen in met de wisselende code uit de CrewHarbor-app (8 cijfers, elke 20 seconden nieuw). Een eigen pincode is minder veilig: een collega kan hem afkijken en voor iemand anders inklokken. Zet dit alleen aan als het echt nodig is, bijvoorbeeld als de app een paar dagen niet werkt.</p></div>' +
    (active ? '<div class="alert warn"><strong>Staat nu aan</strong>&nbsp;tot ' + esc(pinDT(active.to)) + '. Op de prikklok staat een melding.</div>' : '<p class="small muted" style="margin:0">Staat nu uit. ' + D.pins + ' ' + (D.pins === 1 ? 'medewerker heeft' : 'medewerkers hebben') + ' een eigen pincode ingesteld.</p>');
  if (D.windows.length) h += '<div class="doc-list">' + D.windows.map(w => '<div class="doc"><div class="doc-main"><strong>' + esc(pinDT(w.from)) + ' tot ' + esc(pinDT(w.to)) + '</strong><span class="small muted">' + (w.active ? 'Nu actief' : 'Gepland') + (w.by ? ' · door ' + esc(w.by) : '') + '</span></div>' +
    '<div class="doc-act"><button class="btn small danger" data-act="pinw-del" data-id="' + w.id + '">' + (w.active ? 'Nu uitzetten' : 'Weghalen') + '</button></div></div>').join('') + '</div>';
  h += '<fieldset class="dz-form"><legend class="legend">Periode toevoegen</legend>' +
    '<div class="seg" role="radiogroup"><button class="' + (P.mode === 'dagen' ? 'on' : '') + '" data-act="pinw-mode" data-v="dagen" role="radio" aria-checked="' + (P.mode === 'dagen') + '">Hele dagen</button><button class="' + (P.mode === 'tijd' ? 'on' : '') + '" data-act="pinw-mode" data-v="tijd" role="radio" aria-checked="' + (P.mode === 'tijd') + '">Eén dag, tussen tijden</button></div>' +
    (P.mode === 'dagen'
      ? '<div class="fields4"><div class="field"><label for="pw-from">Van</label><input class="input" type="date" id="pw-from" data-pw="from" min="' + today() + '" value="' + esc(P.from) + '"></div><div class="field"><label for="pw-to">Tot en met</label><input class="input" type="date" id="pw-to" data-pw="to" min="' + today() + '" value="' + esc(P.to) + '"></div></div>'
      : '<div class="fields4"><div class="field"><label for="pw-from">Datum</label><input class="input" type="date" id="pw-from" data-pw="from" min="' + today() + '" value="' + esc(P.from) + '"></div><div class="field"><label for="pw-t1">Van</label><input class="input" type="time" id="pw-t1" data-pw="t1" value="' + esc(P.t1) + '"></div><div class="field"><label for="pw-t2">Tot</label><input class="input" type="time" id="pw-t2" data-pw="t2" value="' + esc(P.t2) + '"></div></div>') +
    '<div><button class="btn danger" data-act="pinw-add">Eigen pincode toestaan</button></div></fieldset></section>';
  return h;
}
const BREAK_DEFAULT = { auto: true, adult: [{ fromMin: 330, breakMin: 30 }, { fromMin: 600, breakMin: 45 }], minor: [{ fromMin: 270, breakMin: 30 }, { fromMin: 600, breakMin: 45 }] };
function breakRules() { return Object.assign({}, BREAK_DEFAULT, (S.org.settings || {}).breakRules || {}); }
function breakRulesCard() {
  const B = S.brEdit || JSON.parse(JSON.stringify(breakRules()));
  const hrs = m => String(Math.round(m / 60 * 100) / 100).replace('.', ',');
  const rows = k => (B[k] || []).map((r, i) => '<div class="br-row"><span>Meer dan</span><input class="input" inputmode="decimal" data-br="' + k + '|' + i + '|from" value="' + hrs(r.fromMin) + '" aria-label="Uren gewerkt"><span>uur gewerkt →</span>' +
    '<input class="input" inputmode="numeric" data-br="' + k + '|' + i + '|break" value="' + r.breakMin + '" aria-label="Minuten pauze"><span>min pauze</span>' +
    '<button class="icon-btn small" data-act="br-del" data-v="' + k + '|' + i + '" aria-label="Regel verwijderen">' + ICON.trash + '</button></div>').join('') +
    '<button class="btn small ghost" data-act="br-add" data-v="' + k + '">' + ICON.plus + 'Regel toevoegen</button>';
  return '<section class="card stack" style="gap:14px"><div class="item-top"><h2 style="margin:0">Pauzeregels</h2>' + (S.brEdit ? '<span class="badge orange">Niet opgeslagen</span>' : '') + '</div>' +
    '<p class="small muted" style="margin:0">Standaard volgens de Arbeidstijdenwet. Bij uitklokken haalt CrewHarbor de pauze er automatisch af; bij te weinig pauze zie je een waarschuwing.</p>' +
    '<label class="check"><input type="checkbox" data-br-auto' + (B.auto !== false ? ' checked' : '') + '> Pauze automatisch aftrekken bij uitklokken</label>' +
    '<div class="stack" style="gap:8px"><strong>18 jaar en ouder</strong>' + rows('adult') + '</div>' +
    '<div class="stack" style="gap:8px"><strong>16 en 17 jaar</strong> <span class="small muted">Zet bij de medewerker het vinkje "Jonger dan 18".</span>' + rows('minor') + '</div>' +
    '<div class="row"><button class="btn primary" data-act="br-save"' + (S.brEdit ? '' : ' disabled') + '>Pauzeregels opslaan</button>' +
    '<button class="btn ghost" data-act="br-reset">Standaard herstellen</button></div></section>';
}

// ======================================================================
// Telefonie (3CX)
// ======================================================================
function fmtDur(sec) {
  if (sec == null) return '–';
  sec = Math.round(sec);
  if (sec < 60) return sec + ' sec';
  if (sec < 3600) return Math.floor(sec / 60) + ':' + pad(sec % 60) + ' min';
  return Math.floor(sec / 3600) + ' u ' + pad(Math.floor(sec % 3600 / 60)) + ' min';
}
function phRange() { return S.phPeriod === 'vandaag' ? [today(), today()] : periodRange(S.phPeriod); }
function timeAgo(v) {
  if (!v) return 'nog nooit';
  const m = Math.round((Date.now() - new Date(v)) / 60000);
  if (m < 1) return 'zojuist';
  if (m < 60) return m + ' min geleden';
  const d = new Date(v);
  return (ymd(d) === today() ? 'vandaag' : dayShort(ymd(d))) + ' om ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}
async function loadPhone() {
  S.phStatus = await rpc('cd_phone_status');
  if (S.phStatus.connected) {
    const [f, t] = phRange();
    S.phone = await rpc('cd_phone_stats', { p_from: f, p_to: t });
    if (!S.phSyncing && Date.now() - S.phSyncedAt > 120000) phoneSync(false);
  } else S.phone = null;
}
async function phoneSync(force) {
  S.phSyncing = true; if (route() === 'telefonie') render();
  try {
    const r = await svc('phone-sync', { force: !!force });
    S.phSyncedAt = Date.now();
    if (force && r.error) toast(r.error, true);
    else if (force && r.skipped) toast('Net al bijgewerkt. Probeer het zo nog eens.');
    else if (force) toast('Bijgewerkt.');
  } catch (e) { if (force) toast(e.message, true); }
  S.phSyncing = false;
  if (route() === 'telefonie') {
    try {
      S.phStatus = await rpc('cd_phone_status');
      const [f, t] = phRange(); S.phone = await rpc('cd_phone_stats', { p_from: f, p_to: t });
    } catch (e) { /* de vorige cijfers blijven staan */ }
    render();
  }
}
function viewPhone() {
  const st = S.phStatus, P = S.phone;
  let h = '<header class="page-head"><div><h1>Telefonie</h1><p>' + (st && st.connected ? 'Cijfers uit 3CX · bijgewerkt ' + esc(timeAgo(st.lastSync)) : 'Telefoontjes, reactietijd en gemiste gesprekken uit je 3CX-telefooncentrale.') + '</p></div>' +
    (st && st.connected ? '<div class="actions"><button class="btn" data-act="ph-sync"' + (S.phSyncing ? ' disabled' : '') + '>' + (S.phSyncing ? 'Bezig met bijwerken…' : 'Nu bijwerken') + '</button></div>' : '') + '</header>';
  if (!st) return h;
  if (!st.connected) {
    return h + '<section class="card empty-state"><h2>Nog niet gekoppeld</h2><p class="muted">Koppel CrewHarbor één keer met jullie 3CX. Daarna zie je hier hoeveel telefoontjes er binnenkomen, hoe snel ze worden opgenomen, hoe lang gesprekken duren, welke gemist zijn en hoeveel mensen jullie zelf bellen.</p>' +
      (st.canManage ? '<p><a class="btn primary" href="#/instellingen">Koppelen bij Instellingen</a></p>' : '<p class="small muted">Vraag iemand die de bedrijfsinstellingen beheert om de koppeling aan te zetten.</p>') + '</section>';
  }
  if (st.lastError) h += '<div class="alert error" role="alert">' + ICON.alert + '<span><strong>Bijwerken lukt niet:</strong> ' + esc(st.lastError) + (st.canManage ? ' Controleer de koppeling bij <a href="#/instellingen">Instellingen</a>.' : '') + '</span></div>';
  const periods = [['vandaag', 'Vandaag'], ['week', 'Deze week'], ['vorigeweek', 'Vorige week'], ['maand', 'Deze maand'], ['vorigemaand', 'Vorige maand']];
  h += '<div class="seg" role="group" aria-label="Periode">' + periods.map(p => '<button data-act="ph-period" data-v="' + p[0] + '" class="' + (S.phPeriod === p[0] ? 'on' : '') + '" aria-pressed="' + (S.phPeriod === p[0]) + '">' + p[1] + '</button>').join('') + '</div>';
  if (!P) return h;
  const T = P.totals;
  const pct = T.inbound ? Math.round(T.answered / T.inbound * 100) : null;
  h += '<div class="stats">' + stat('Inkomende telefoontjes', T.inbound) + stat('Opgenomen', T.answered + (pct == null ? '' : ' <small class="muted" style="font-size:14px;font-weight:600">' + pct + '%</small>'), 'var(--green)') +
    stat('Niet opgenomen', T.missed, T.missed ? 'var(--red)' : null) + stat('Gem. reactietijd', fmtDur(T.avgWaitSec)) + '</div>';
  h += '<div class="stats">' + stat('Gem. gespreksduur', fmtDur(T.avgTalkSec)) + stat('Zelf gebeld', T.outbound) + stat('Mensen gebeld', T.outboundPeople) + stat('Totale beltijd', fmtDur(T.talkSec)) + '</div>';
  if (P.perDay.length > 1) {
    const max = Math.max(1, ...P.perDay.map(d => Math.max(d.inbound, d.outbound)));
    const every = P.perDay.length > 31 ? 7 : (P.perDay.length > 10 ? 3 : 1);
    h += '<section class="card"><div class="section-title" style="margin-bottom:12px"><h2>Per dag</h2><span class="legend-row"><span class="dot water"></span>Inkomend <span class="dot red"></span>Gemist <span class="dot navy"></span>Zelf gebeld</span></div>' +
      '<div class="chart" role="img" aria-label="Telefoontjes per dag: inkomend, gemist en zelf gebeld">' + P.perDay.map((d, i) => {
        const dt = pd(d.date);
        return '<div class="bar-group" title="' + esc(DAYS[dt.getDay()] + ' ' + dt.getDate() + ' ' + MONTHS[dt.getMonth()] + ': ' + d.inbound + ' inkomend, ' + d.missed + ' gemist, ' + d.outbound + ' zelf gebeld') + '">' +
          '<div class="bars three"><span class="bar water" style="height:' + (d.inbound / max * 100) + '%"></span><span class="bar red" style="height:' + (d.missed / max * 100) + '%"></span><span class="bar navy" style="height:' + (d.outbound / max * 100) + '%"></span></div>' +
          '<span class="bar-label">' + (i % every === 0 ? dt.getDate() + ' ' + MONTHS[dt.getMonth()] : '') + '</span></div>';
      }).join('') + '</div></section>';
  }
  const hmax = Math.max(1, ...P.perHour.map(x => x.inbound));
  h += '<div class="split" style="align-items:stretch"><section class="card" style="flex:1 1 300px;min-width:0"><h2>Drukste uren</h2>' +
    (T.inbound ? P.perHour.map(x => '<div class="hbar"><span>' + pad(x.hour) + ':00 – ' + pad(x.hour + 1) + ':00</span><span class="hbar-track"><span style="width:' + (x.inbound / hmax * 100) + '%"></span></span><strong>' + x.inbound + '</strong></div>').join('') +
      '<p class="small muted" style="margin:8px 0 0">Inkomende telefoontjes per uur in deze periode.</p>' : '<p class="muted small">Nog geen inkomende telefoontjes in deze periode.</p>') + '</section>';
  h += '<section class="card" style="flex:1 1 300px;min-width:0"><h2>Niet opgenomen</h2>' + (P.missedList.length
    ? '<ul class="ph-missed">' + P.missedList.map(m => { const d = new Date(m.at); return '<li><span>' + esc((ymd(d) === today() ? 'Vandaag' : dayShort(ymd(d))) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())) + '</span>' +
        (m.number ? '<a href="tel:' + esc(m.number) + '">' + esc(m.number) + '</a>' : '<span class="muted">Anoniem</span>') + '<span class="small muted">' + fmtDur(m.waitSec) + ' gewacht</span></li>'; }).join('') + '</ul>' +
      (T.missed > P.missedList.length ? '<p class="small muted" style="margin:8px 0 0">De laatste ' + P.missedList.length + ' van ' + T.missed + '.</p>' : '')
    : '<p class="muted small">Alles is opgenomen in deze periode.</p>') + '</section></div>';
  h += '<section class="card"><h2>Per collega</h2>' + (P.people.length
    ? '<div class="table-wrap" style="border:0"><table><thead><tr><th>Naam in 3CX</th><th>Opgenomen</th><th>Zelf gebeld</th><th>Gem. reactietijd</th><th>Gem. gespreksduur</th><th>Totale beltijd</th></tr></thead><tbody>' +
      P.people.map(x => '<tr><td class="pad"><strong>' + esc(x.agent) + '</strong></td><td class="pad">' + x.answered + '</td><td class="pad">' + x.outbound + '</td><td class="pad">' + fmtDur(x.avgWaitSec) +
        '</td><td class="pad">' + fmtDur(x.avgTalkSec) + '</td><td class="pad">' + fmtDur(x.talkSec) + '</td></tr>').join('') + '</tbody></table></div>'
    : '<p class="muted small">Nog geen gesprekken in deze periode.</p>') + '</section>';
  h += '<p class="small muted" style="margin:0">Reactietijd = hoe lang de beller wachtte tot er werd opgenomen. Interne gesprekken tellen niet mee.</p>';
  return h;
}
function viewPhoneLink() {
  const st = S.phStatus;
  let h = '<section class="card stack" style="gap:14px"><h2>Telefonie (3CX)</h2>';
  if (!st) return h + '<p class="small muted">Status kon niet worden geladen.</p></section>';
  if (st.connected && !S.phEdit) {
    h += '<dl class="kv"><dt>Status</dt><dd>' + (st.lastError ? '<span class="badge red">Fout</span>' : '<span class="badge green">Gekoppeld</span>') + '</dd><dt>Adres</dt><dd>' + esc(st.baseUrl) + '</dd><dt>Client ID</dt><dd>' + esc(st.clientId) + '</dd>' +
      '<dt>Bijgewerkt</dt><dd>' + esc(timeAgo(st.lastSync)) + '</dd><dt>Gesprekken</dt><dd>' + st.calls + '</dd></dl>' +
      (st.lastError ? '<div class="alert error" role="alert">' + ICON.alert + '<span>' + esc(st.lastError) + '</span></div>' : '');
    if (S.phDisc) {
      return h + '<div class="box"><p style="margin:0">CrewHarbor haalt dan niets meer op uit 3CX.</p><label class="check"><input type="checkbox" id="ph-del"> Ook de opgehaalde gespreksgegevens verwijderen</label>' +
        '<div class="ph-btns"><button class="btn danger" data-act="ph-disconnect">Loskoppelen</button><button class="btn ghost" data-act="ph-disc-cancel">Annuleren</button></div></div></section>';
    }
    return h + '<div class="ph-btns"><a class="btn" href="#/telefonie">Bekijk cijfers</a><button class="btn" data-act="ph-edit">Gegevens wijzigen</button><button class="btn ghost" data-act="ph-disc">Loskoppelen</button></div></section>';
  }
  h += '<p class="small muted" style="margin:0">Laat zien hoeveel telefoontjes er binnenkomen, hoe snel ze worden opgenomen en welke gemist zijn. Werkt met 3CX versie 20.</p>' +
    '<ol class="small muted" style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:4px"><li>Ga in 3CX naar <strong>Admin Console → Integrations → API</strong> en klik op <strong>Add</strong>.</li>' +
    '<li>Kies een Client ID (bijvoorbeeld 900), zet <strong>XAPI Access</strong> aan en geef de rol <strong>System Owner</strong> of <strong>System Admin</strong>.</li><li>Sla op en kopieer de API-sleutel die 3CX één keer laat zien.</li></ol>' +
    '<div class="field"><label for="ph-url">Adres van je 3CX</label><input class="input" id="ph-url" placeholder="https://bedrijf.3cx.nl" autocomplete="off" spellcheck="false" value="' + esc(st.baseUrl || '') + '"></div>' +
    '<div class="field"><label for="ph-id">Client ID</label><input class="input" id="ph-id" autocomplete="off" spellcheck="false" value="' + esc(st.clientId || '') + '"></div>' +
    '<div class="field"><label for="ph-key">API-sleutel</label><input class="input" id="ph-key" type="password" autocomplete="new-password" spellcheck="false"' + (st.connected ? ' placeholder="Vul de sleutel opnieuw in"' : '') + '>' +
      '<span class="small muted">Wordt alleen op de server bewaard en is daarna voor niemand meer zichtbaar.</span></div>' +
    '<div class="ph-btns"><button class="btn primary" data-act="ph-connect">Koppelen</button>' + (S.phEdit ? '<button class="btn ghost" data-act="ph-edit-cancel">Annuleren</button>' : '') + '</div></section>';
  return h;
}

// ======================================================================
// Uren, rooster, goedkeuren, urenoverzicht
// ======================================================================
function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function pd(s) { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d, 12); }
function addDays(s, n) { const d = pd(s); d.setDate(d.getDate() + n); return ymd(d); }
function mondayOf(s) { const d = pd(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return ymd(d); }
function today() { return ymd(new Date()); }
function weekNo(s) {
  const d = pd(s); const t = new Date(d); t.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const w1 = new Date(t.getFullYear(), 0, 4);
  return 1 + Math.round(((t - w1) / 864e5 - 3 + ((w1.getDay() + 6) % 7)) / 7);
}
function fmtHM(min) { min = Math.round(min || 0); const neg = min < 0; min = Math.abs(min); return (neg ? '-' : '') + Math.floor(min / 60) + ':' + pad(min % 60); }
function dayShort(s) { const d = pd(s); return DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()]; }
function dayLong(s) { const d = pd(s); const t = DAYS_FULL[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()]; return t.charAt(0).toUpperCase() + t.slice(1); }
function weekLabel(mon) {
  const a = pd(mon), b = pd(addDays(mon, 6));
  return 'Week ' + weekNo(mon) + ' · ' + a.getDate() + (a.getMonth() !== b.getMonth() ? ' ' + MONTHS[a.getMonth()] : '') + ' – ' + b.getDate() + ' ' + MONTHS[b.getMonth()] +
    (b.getFullYear() !== new Date().getFullYear() ? ' ' + b.getFullYear() : '');
}
function spanMin(start, end) {
  const [a, b] = [start, end].map(t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; });
  return ((b - a) + 1440) % 1440;
}
function contractText(u) {
  if (!u) return '';
  if (u.contractType === 'flex') return 'Flex (0-uren)';
  return Number(u.contractHours) > 0 ? 'Vast, ' + String(Number(u.contractHours)).replace('.', ',') + ' uur per week' : 'Vast, uren nog niet ingevuld';
}
function contractShort(u) { return u.contractType === 'flex' ? 'Flex' : (Number(u.contractHours) > 0 ? String(Number(u.contractHours)).replace('.', ',') + ' u/week' : 'Vast'); }
function contractFields(u) {
  const flex = u.contractType === 'flex';
  return '<fieldset class="box" style="margin:0"><legend class="legend" style="padding:0 4px">Contract</legend>' +
    '<div class="fields2"><div class="field"><label for="m-ctype">Soort</label><select class="input" id="m-ctype" data-act-change="m-ctype">' +
      '<option value="vast"' + (!flex ? ' selected' : '') + '>Vast contract</option><option value="flex"' + (flex ? ' selected' : '') + '>Flex / 0-uren</option></select></div>' +
    '<div class="field"><label for="m-chours">Uren per week</label><input class="input" id="m-chours" inputmode="decimal" value="' + (flex ? '' : esc(String(Number(u.contractHours) || '').replace('.', ','))) + '"' + (flex ? ' disabled placeholder="Niet van toepassing"' : ' placeholder="Bijv. 32"') + '></div></div>' +
    '<span class="small muted">Wordt gebruikt bij Mijn uren en het urenoverzicht om gewerkte uren naast het contract te zetten.</span>' +
    '<label class="check"><input type="checkbox" id="m-minor"' + (u.isMinor ? ' checked' : '') + '> Jonger dan 18 jaar <span class="small muted">(strengere pauzeregels)</span></label></fieldset>';
}
function breakWarn(e) { return e.requiredBreak > (e.breakMin || 0) ? '<span class="badge red" title="Wettelijk verplicht bij deze werktijd">Te weinig pauze · minimaal ' + e.requiredBreak + ' min</span>' : ''; }
const H_STATUS = { open: ['Bezig', 'blue'], concept: ['Concept', ''], ingediend: ['Ingediend', 'orange'], goedgekeurd: ['Goedgekeurd', 'green'], afgekeurd: ['Afgekeurd', 'red'] };
function hBadge(st) { const b = H_STATUS[st] || [st, '']; return '<span class="badge ' + b[1] + '">' + b[0] + '</span>'; }
function weekNav(act, mon) {
  const cur = mondayOf(today());
  return '<div class="weeknav"><button class="icon-btn" data-act="' + act + '" data-v="' + addDays(mon, -7) + '" aria-label="Vorige week">' + ICON.left + '</button>' +
    '<strong>' + weekLabel(mon) + '</strong>' +
    '<button class="icon-btn" data-act="' + act + '" data-v="' + addDays(mon, 7) + '" aria-label="Volgende week">' + ICON.right + '</button>' +
    (mon !== cur ? '<button class="btn small ghost" data-act="' + act + '" data-v="' + cur + '">Naar deze week</button>' : '') + '</div>';
}
function runningSince(e) { if (!e) return 0; const d = new Date(e.date + 'T' + e.start + ':00'); return Math.max(0, Math.round((Date.now() - d) / 60000)); }

async function loadHours() {
  const H = await rpc('cd_hours_week', { p_member: S.hMember || null, p_week: S.hWeek || null });
  S.hours = H; S.hWeek = H.weekStart;
}

function homeHoursCard() {
  const W = S.nowWeek; if (!W) return '';
  const ct = W.member.contractType, ch = Number(W.member.contractHours) * 60;
  const todayShifts = W.shifts.filter(s => s.date === W.today);
  let h = '<section class="card"><h2>Mijn uren</h2>';
  h += S.running ? '<div class="clock-mini"><span class="live-dot"></span><span>Ingeklokt sinds <strong>' + esc(S.running.start) + '</strong></span></div>' : '';
  h += '<dl class="kv"><dt>Deze week</dt><dd>' + fmtHM(W.totalMin) + (ct === 'vast' && ch ? ' van ' + fmtHM(ch) : '') + '</dd>' +
    '<dt>Vandaag ingepland</dt><dd>' + (todayShifts.length ? todayShifts.map(s => esc(s.start + '–' + s.end)).join(', ') : '<span class="muted" style="font-weight:400">Niet ingepland</span>') + '</dd></dl>';
  h += '<div class="row" style="margin-top:14px">' + (kioskOnly() ? '' : S.running ? '<button class="btn dark small" data-act="clock-out">Uitklokken</button>' : '<button class="btn primary small" data-act="clock-in">Inklokken</button>') +
    '<a class="btn small ghost" href="#/uren">Naar mijn uren</a></div></section>';
  if (can('hours.approve') && S.pendingCount) {
    h += '<section class="card"><h2>Uren goedkeuren</h2><p class="muted small" style="margin:0 0 12px">' + S.pendingCount + (S.pendingCount === 1 ? ' regel wacht' : ' regels wachten') + ' op jouw beoordeling.</p>' +
      '<a class="btn small" href="#/goedkeuren">Beoordelen</a></section>';
  }
  return h;
}

const kioskOnly = () => settings().clock_mode === 'prikklok';
function clockCard() {
  const R = S.running;
  if (kioskOnly()) {
    return '<section class="card clock' + (R ? ' on' : '') + '"><div class="clock-text">' +
      (R ? '<span class="small"><span class="live-dot"></span> Ingeklokt sinds ' + esc(R.start) + '</span><strong id="clock-elapsed" data-date="' + esc(R.date) + '" data-start="' + esc(R.start) + '">' + fmtHM(runningSince(R)) + '</strong>'
        : '<span class="small muted">Je bent niet ingeklokt</span><strong>Klok in bij de prikklok</strong>') + '</div>' +
      '<span class="small muted" style="max-width:260px">Bij jullie gaat in- en uitklokken via de prikklok op locatie, met de code uit de app.</span></section>';
  }
  return '<section class="card clock' + (R ? ' on' : '') + '"><div class="clock-text">' +
    (R ? '<span class="small">' + '<span class="live-dot"></span> Ingeklokt sinds ' + esc(R.start) + (R.date !== today() ? ' (' + esc(dayShort(R.date)) + ')' : '') + '</span><strong id="clock-elapsed" data-date="' + esc(R.date) + '" data-start="' + esc(R.start) + '">' + fmtHM(runningSince(R)) + '</strong>'
      : '<span class="small muted">Je bent niet ingeklokt</span><strong>Begin je dienst</strong>') + '</div>' +
    (R ? '<button class="btn dark" data-act="clock-out">Uitklokken</button>' : '<button class="btn primary" data-act="clock-in">Inklokken</button>') + '</section>';
}

function entryForm() {
  const E = S.hEdit;
  return '<div class="entry-form" role="group" aria-label="Uren invullen">' +
    '<div class="fields4"><div class="field"><label for="h-date">Datum</label><input class="input" type="date" id="h-date" data-h="date" value="' + esc(E.date) + '" max="' + addDays(today(), 1) + '"></div>' +
    '<div class="field"><label for="h-start">Begin</label><input class="input" type="time" id="h-start" data-h="start" value="' + esc(E.start) + '"></div>' +
    '<div class="field"><label for="h-end">Eind</label><input class="input" type="time" id="h-end" data-h="end" value="' + esc(E.end) + '"></div>' +
    '<div class="field"><label for="h-break">Pauze (min)</label><input class="input" type="number" min="0" max="600" step="5" id="h-break" data-h="breakMin" value="' + esc(E.breakMin) + '"></div></div>' +
    '<div class="field"><label for="h-note">Notitie <span class="muted" style="font-weight:400">(optioneel)</span></label><input class="input" id="h-note" data-h="note" maxlength="300" value="' + esc(E.note) + '" placeholder="Bijv. inventarisatie magazijn"></div>' +
    (E.start && E.end && E.start !== E.end ? '<p class="small muted" style="margin:0">Totaal: <strong>' + fmtHM(Math.max(0, spanMin(E.start, E.end) - (Number(E.breakMin) || 0))) + '</strong>' + (E.end < E.start ? ' (loopt door na middernacht)' : '') + '</p>' : '') +
    (E.wasAuto ? '<p class="small" style="margin:0;color:#93370D">Let op: deze uren waren geklokt en al goedgekeurd. Na het aanpassen moet je ze opnieuw indienen en keurt je leidinggevende ze goed.</p>' : '') +
    '<div class="form-foot" style="justify-content:flex-start"><button class="btn primary small" data-act="h-save">Opslaan</button><button class="btn small ghost" data-act="h-cancel">Annuleren</button></div></div>';
}
function entryRow(e, self) {
  if (S.hEdit && same(S.hEdit.id, e.id)) return entryForm();
  const editable = self && ['concept', 'afgekeurd'].includes(e.status);
  const fixable = self && e.auto && e.date >= addDays(today(), -14);
  return '<div class="entry' + (e.status === 'afgekeurd' ? ' bad' : '') + '"><div class="entry-main">' +
    '<span class="entry-time">' + esc(e.start) + ' – ' + (e.end ? esc(e.end) : 'nu') + '</span>' +
    (e.breakMin ? '<span class="small muted">' + e.breakMin + ' min pauze</span>' : '') + breakWarn(e) +
    (e.note ? '<span class="small entry-note">' + esc(e.note) + '</span>' : '') +
    (e.source === 'prikklok' ? '<span class="src-tag">Prikklok</span>' : e.source === 'handmatig' ? '<span class="src-tag soft">Handmatig</span>' : '') + '</div>' +
    '<div class="entry-side"><strong>' + (e.minutes == null ? fmtHM(runningSince(e)) : fmtHM(e.minutes)) + '</strong>' + (e.auto ? '<span class="badge green" title="Geklokte uren zijn meteen goedgekeurd">Geklokt ✓</span>' : hBadge(e.status)) +
    (fixable ? '<button class="btn small ghost" data-act="h-edit" data-id="' + e.id + '" title="Klopt het niet? Pas het aan; daarna dien je het opnieuw in.">Aanpassen</button>' : '') +
    (!self && can('hours.approve') && ['goedgekeurd', 'ingediend'].includes(e.status) && (!same(e.memberId, S.me.id) || S.me.isOwner) ? '<button class="btn small ghost" data-act="h-correct" data-id="' + e.id + '">Corrigeren</button>' : '') +
    (editable ? '<button class="icon-btn small" data-act="h-edit" data-id="' + e.id + '" aria-label="Bewerken">' + ICON.edit + '</button><button class="icon-btn small" data-act="h-del" data-id="' + e.id + '" aria-label="Verwijderen">' + ICON.trash + '</button>' : '') +
    (!self && e.status === 'goedgekeurd' && can('hours.approve') ? '<button class="btn small ghost" data-act="h-reopen" data-id="' + e.id + '">Terugzetten</button>' : '') + '</div>' +
    (e.correctedByName ? '<div class="entry-reason soft">Gecorrigeerd door ' + esc(e.correctedByName) + (e.correctReason ? ': ' + esc(e.correctReason) : '') + '</div>' : '') +
    (e.status === 'afgekeurd' && e.rejectReason ? '<div class="entry-reason">Afgekeurd door ' + esc(e.reviewedByName || 'teamleider') + ': ' + esc(e.rejectReason) + '</div>' : '') + '</div>';
}

function corrForm() {
  const C = S.hCorr;
  return '<section class="card stack" style="gap:14px;max-width:none"><div class="item-top"><h2 style="margin:0">Uren corrigeren · ' + esc(C.name) + '</h2><button class="icon-btn small" data-act="hc-cancel" aria-label="Sluiten">' + ICON.x + '</button></div>' +
    '<p class="small muted" style="margin:0">Was: <strong>' + esc(dayLong(C.date)) + ', ' + esc(C.was) + '</strong>. De uren blijven goedgekeurd; ' + esc(C.name.split(' ')[0]) + ' krijgt een melding met je reden.</p>' +
    '<div class="fields4"><div class="field"><label for="hc-date">Datum</label><input class="input" type="date" id="hc-date" data-hc="date" value="' + esc(C.date) + '"></div>' +
    '<div class="field"><label for="hc-start">Begin</label><input class="input" type="time" id="hc-start" data-hc="start" value="' + esc(C.start) + '"></div>' +
    '<div class="field"><label for="hc-end">Eind</label><input class="input" type="time" id="hc-end" data-hc="end" value="' + esc(C.end) + '"></div>' +
    '<div class="field"><label for="hc-break">Pauze (min)</label><input class="input" type="number" min="0" max="600" step="5" id="hc-break" data-hc="breakMin" value="' + esc(C.breakMin) + '"></div></div>' +
    '<div class="field"><label for="hc-reason">Waarom pas je het aan?</label><input class="input" id="hc-reason" data-hc="reason" maxlength="300" value="' + esc(C.reason) + '" placeholder="Bijv. vergeten uit te klokken, was om 17:00 klaar"></div>' +
    '<div class="form-foot"><button class="btn ghost" data-act="hc-cancel">Annuleren</button><button class="btn primary" data-act="hc-save">Opslaan</button></div></section>';
}
function viewHours() {
  const H = S.hours; if (!H) return '';
  const self = same(H.member.id, S.me.id);
  const mon = H.weekStart;
  const ct = H.member.contractType, ch = Number(H.member.contractHours) * 60;
  const planned = H.shifts.reduce((a, s) => a + spanMin(s.start, s.end), 0);
  let h = '<header class="page-head"><div><h1>' + (self ? 'Mijn uren' : 'Uren van ' + esc(H.member.name)) + '</h1><p>' +
    (self ? 'Geklokte uren zijn meteen goedgekeurd. Uren die je zelf invult, dien je in en worden daarna goedgekeurd.' : esc(contractText(H.member)) + '.' + (can('hours.approve') ? ' Klopt er iets niet? Klik op Corrigeren.' : '')) + '</p></div>' +
    (!self ? '<div class="actions"><button class="btn" data-act="h-me">' + ICON.left + 'Mijn eigen uren</button></div>' : '') + '</header>';
  if (S.hCorr) h += modal(corrForm(), 'hc-cancel');
  h += weekNav('h-week', mon);
  if (self && mon === mondayOf(today())) h += clockCard();
  if (self && H.published === false && !can('hours.plan')) h += '<p class="small muted" style="margin:0">Het rooster voor deze week is nog niet vastgezet. Je diensten verschijnen hier zodra het klaar is.</p>';
  const diff = H.totalMin - ch;
  // alleen goedgekeurde uren tellen als "Goedgekeurd"; de rest staat er klein onder
  const sumOf = st => H.entries.filter(e => st.includes(e.status)).reduce((a, e) => a + (e.minutes || 0), 0);
  const okMin = sumOf(['goedgekeurd']), waitMin = sumOf(['ingediend']), draftMin = sumOf(['concept', 'afgekeurd', 'open']);
  const subTxt = [waitMin ? fmtHM(waitMin) + ' wacht op goedkeuring' : '', draftMin ? fmtHM(draftMin) + ' nog niet ingediend' : ''].filter(Boolean).join(' · ');
  h += '<div class="stats">' + stat('Goedgekeurd', fmtHM(okMin), null, subTxt) + stat('Ingepland', fmtHM(planned)) +
    stat('Contract', ct === 'flex' ? 'Flex' : (ch ? fmtHM(ch) : '–')) +
    stat(ct === 'flex' || !ch ? 'Verschil' : (diff >= 0 ? 'Boven contract' : 'Nog te gaan'), ct === 'flex' || !ch ? '–' : fmtHM(Math.abs(diff)), ct === 'vast' && ch && diff > 0 ? 'var(--orange)' : null) + '</div>';
  if (ct === 'vast' && ch) {
    const okW = Math.min(100, okMin / ch * 100), restW = Math.max(0, Math.min(100 - okW, (H.totalMin - okMin) / ch * 100));
    h += '<div class="progress two" role="progressbar" aria-label="Uren van contract (goedgekeurd en nog niet goedgekeurd)" aria-valuemin="0" aria-valuemax="' + ch + '" aria-valuenow="' + okMin + '">' +
      '<span style="width:' + okW + '%"></span><span class="pending" style="width:' + restW + '%"></span></div>';
  }
  h += '<div class="days">' + [0, 1, 2, 3, 4, 5, 6].map(i => {
    const d = addDays(mon, i);
    const es = H.entries.filter(e => e.date === d);
    const ss = H.shifts.filter(s => s.date === d);
    const tot = es.reduce((a, e) => a + (e.minutes || 0), 0);
    const adding = S.hEdit && !S.hEdit.id && S.hEdit.date === d;
    return '<section class="day' + (d === H.today ? ' today' : '') + '"><div class="day-head"><div class="day-name"><strong>' + esc(dayLong(d)) + '</strong>' +
      (d === H.today ? '<span class="badge blue">Vandaag</span>' : '') +
      ((H.absences || []).filter(a => absCovers(a, d)).map(a => absChip(a)).join('')) +
      (ss.length ? '<span class="small muted">Ingepland ' + ss.map(s => esc(s.start + '–' + s.end) + (s.note ? ' (' + esc(s.note) + ')' : '')).join(', ') + '</span>' : '') + '</div>' +
      '<span class="day-total">' + (tot ? fmtHM(tot) : '') + '</span></div>' +
      es.map(e => entryRow(e, self)).join('') + (adding ? entryForm() : '') +
      (self && !adding && d <= addDays(H.today, 1) ? '<button class="add-line" data-act="h-add" data-v="' + d + '">' + ICON.plus + 'Uren toevoegen</button>' : '') + '</section>';
  }).join('') + '</div>';
  if (self) {
    const todo = H.entries.filter(e => ['concept', 'afgekeurd'].includes(e.status));
    const sent = H.entries.filter(e => e.status === 'ingediend').length;
    if (todo.length) {
      h += '<section class="card submit-bar sticky" aria-label="Week indienen"><div><strong>' + todo.length + (todo.length === 1 ? ' regel' : ' regels') + ' nog niet ingediend · ' + fmtHM(todo.reduce((a, e) => a + (e.minutes || 0), 0)) + '</strong>' +
        '<p class="small muted" style="margin:2px 0 0"><span class="saved-tag">' + ICON.check + ' Opgeslagen als concept</span> Klaar? Dien de week in, dan kan je teamleider hem goedkeuren. Daarna kun je niets meer wijzigen.</p></div>' +
        '<button class="btn primary" data-act="h-submit">Week indienen</button></section>';
    } else if (sent) {
      h += '<div class="alert info">' + '<span>Deze week is ingediend en wacht op goedkeuring.</span></div>';
    }
  }
  return h;
}

function leaveTag(on, short) {
  if (!on) return '';
  return '<span class="leave-tag" title="Laatste werkdag ' + esc(dayLong(on)) + '">' + (short ? 'Weg na ' : 'Vertrekt · laatste werkdag ') + esc(dayShort(on)) + '</span>';
}
function monthStart(s) { return String(s).slice(0, 8) + '01'; }
function monthEnd(s) { const d = pd(monthStart(s)); return ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0)); }
function addMonths(s, n) { const d = pd(monthStart(s)); return ymd(new Date(d.getFullYear(), d.getMonth() + n, 1)); }
function monthLabel(s) { const d = pd(s); const n = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'][d.getMonth()]; return n.charAt(0).toUpperCase() + n.slice(1) + ' ' + d.getFullYear(); }
async function loadRoster() {
  if (S.rosterView === 'maand') {
    const m = S.rosterMonth || monthStart(today()); S.rosterMonth = m;
    const from = mondayOf(m), to = addDays(mondayOf(monthEnd(m)), 6);
    S.roster = await rpc('cd_roster_range', { p_from: from, p_to: to });
  } else {
    S.roster = await rpc('cd_roster', { p_week: S.rosterWeek || today() }); S.rosterWeek = S.roster.weekStart;
  }
}
function UNITS(R) { return (R && R.units) || (S.roster && S.roster.units) || { departments: [], functions: [] }; }
function deptOf(id, R) { return UNITS(R).departments.find(d => same(d.id, id)); }
function funcOf(id, R) { return UNITS(R).functions.find(f => same(f.id, id)); }
function unitFields(R, E) {
  const U = UNITS(R); if (!U.departments.length && !U.functions.length) return '';
  return '<div class="fields2">' +
    (U.departments.length ? '<div class="field"><label for="sh-dept">Afdeling</label><select class="input" id="sh-dept" data-sh="departmentId" data-rerender="1"><option value="">— Geen —</option>' +
      U.departments.map(d => '<option value="' + d.id + '"' + (same(d.id, E.departmentId) ? ' selected' : '') + '>' + esc(d.name) + '</option>').join('') + '</select></div>' : '') +
    (U.functions.length ? '<div class="field"><label for="sh-func">Functie nodig</label><select class="input" id="sh-func" data-sh="functionId" data-rerender="1"><option value="">— Geen —</option>' +
      U.functions.map(f => '<option value="' + f.id + '"' + (same(f.id, E.functionId) ? ' selected' : '') + '>' + esc(f.name) + '</option>').join('') + '</select></div>' : '') + '</div>';
}
function shiftForm(R) {
  const E = S.shiftEdit;
  const p = R.people.find(x => same(x.id, E.memberId));
  return '<section class="card stack" style="gap:14px;max-width:none"><div class="item-top"><h2 style="margin:0">' + (E.id ? 'Dienst wijzigen' : 'Dienst inplannen') + '</h2><button class="icon-btn small" data-act="sh-cancel" aria-label="Sluiten">' + ICON.x + '</button></div>' +
    '<div class="fields4"><div class="field"><label for="sh-member">Medewerker</label><select class="input" id="sh-member" data-sh="memberId" data-rerender="1">' +
      R.people.map(x => { const off = blockedAbs(R, x.id, E.date); return '<option value="' + x.id + '"' + (same(x.id, E.memberId) ? ' selected' : '') + (off && !same(x.id, E.memberId) ? ' disabled' : '') + '>' + esc(x.name) +
        (off ? ' (' + esc(off.kind === 'ziek' ? 'ziek' : off.kindLabel.toLowerCase()) + ')' : '') + (x.leavingOn ? ' (weg na ' + esc(dayShort(x.leavingOn)) + ')' : '') + '</option>'; }).join('') + '</select></div>' +
    '<div class="field"><label for="sh-date">Datum</label><input class="input" type="date" id="sh-date" data-sh="date" data-rerender="1" value="' + esc(E.date) + '"' + (p && p.leavingOn ? ' max="' + esc(p.leavingOn) + '"' : '') + '></div>' +
    '<div class="field"><label for="sh-start">Begin</label><input class="input" type="time" id="sh-start" data-sh="start" value="' + esc(E.start) + '"></div>' +
    '<div class="field"><label for="sh-end">Eind</label><input class="input" type="time" id="sh-end" data-sh="end" value="' + esc(E.end) + '"></div></div>' +
    (p && p.leavingOn ? '<p class="small" style="margin:0;color:var(--red)">' + esc(p.name) + ' vertrekt: de laatste werkdag is ' + esc(dayLong(p.leavingOn).toLowerCase()) + '.</p>' : '') +
    (R.templates && R.templates.length ? '<div class="chips"><span class="small muted">Vaste dienst:</span>' + R.templates.map(t => '<button class="chip quick" data-act="sh-tpl" data-id="' + t.id + '">' + esc(t.name) + ' ' + esc(t.start + '–' + t.end) + '</button>').join('') + '</div>' : '') +
    unitFields(R, E) + shiftWarnings(R, E) + whoCanWork(R, E) +
    '<div class="fields2">' + shiftLocField(E) + '<div class="field"><label for="sh-note">Notitie <span class="muted" style="font-weight:400">(optioneel, bijv. balie of magazijn)</span></label><input class="input" id="sh-note" data-sh="note" maxlength="120" value="' + esc(E.note) + '"></div></div>' +
    '<div class="form-foot">' + (E.id ? '<button class="btn danger small" data-act="sh-del" data-id="' + E.id + '" style="margin-right:auto">' + ICON.trash + 'Verwijderen</button>' : '') +
    '<button class="btn small ghost" data-act="sh-cancel">Annuleren</button><button class="btn primary small" data-act="sh-save">' + (E.id ? 'Opslaan' : 'Inplannen') + '</button></div></section>';
}
// goedgekeurd verlof of ziek: niet in te plannen
// pop-up: legt een venster over de pagina; klik ernaast of Esc sluit het
function modal(inner, closeAct) {
  return '<div class="modal-wrap"><div class="modal-back" data-act="' + closeAct + '" aria-hidden="true"></div><div class="modal" role="dialog" aria-modal="true">' + inner + '</div></div>';
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') { const b = document.querySelector('.modal-wrap .modal-back'); if (b) { e.preventDefault(); b.click(); } } });
function blockedAbs(R, memberId, d) { const a = absFor(R.absences, memberId, d); return a && a.status === 'goedgekeurd' ? a : null; }
// overzicht voor de roostermaker: wie kan er op deze dag?
function whoCanWork(R, E) {
  if (!R.canPlan || !E.date) return '';
  const groups = { kan: [], leeg: [], niet: [], vrij: [], dienst: [] };
  R.people.forEach(x => {
    if (x.leavingOn && E.date > x.leavingOn) return;
    if (E.functionId && !(x.functionIds || []).some(f => same(f, E.functionId))) return;
    const off = absFor(R.absences, x.id, E.date);
    const av = (R.availability || []).find(a => same(a.memberId, x.id) && a.date === E.date);
    const has = (R.shifts || []).find(s2 => same(s2.memberId, x.id) && s2.date === E.date && !same(s2.id, E.id));
    if (off && off.status === 'goedgekeurd') groups.vrij.push([x, off.kind === 'ziek' ? 'ziek' : off.kindLabel.toLowerCase()]);
    else if (has) groups.dienst.push([x, has.start + '–' + has.end]);
    else if (av && av.status === 'kan_niet') groups.niet.push([x, av.note || '']);
    else if (av && av.status === 'kan') groups.kan.push([x, (av.start ? av.start + '–' + av.end : 'hele dag') + (off ? ' · verlof aangevraagd' : '')]);
    else groups.leeg.push([x, off ? 'verlof aangevraagd' : '']);
  });
  const chip = ([x, sub], kind) => '<button type="button" class="who-chip ' + kind + (same(x.id, E.memberId) ? ' on' : '') + '"' + (kind === 'vrij' ? ' disabled' : ' data-act="sh-pick" data-id="' + x.id + '"') + '>' +
    '<strong>' + esc(x.name) + '</strong>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</button>';
  const block = (title, list, kind) => list.length ? '<div class="who-group"><span class="who-title ' + kind + '">' + title + ' · ' + list.length + '</span><div class="who-list">' + list.map(i => chip(i, kind)).join('') + '</div></div>' : '';
  const fn = E.functionId ? funcOf(E.functionId, R) : null;
  return '<div class="who-can"><strong class="who-head">Wie kan er op ' + esc(dayLong(E.date).toLowerCase()) + '?' + (fn ? ' <span class="func-tag">alleen met functie ' + esc(fn.name) + '</span>' : '') + '</strong>' +
    block('Beschikbaar', groups.kan, 'kan') + block('Niet ingevuld', groups.leeg, 'leeg') + block('Al ingepland', groups.dienst, 'dienst') +
    block('Niet beschikbaar', groups.niet, 'niet') + block('Verlof of ziek (kan niet)', groups.vrij, 'vrij') +
    '<p class="small muted" style="margin:0">Klik op een naam om die medewerker te kiezen.</p></div>';
}
function shiftWarnings(R, E) {
  if (!E.memberId || !E.date) return '';
  const w = [];
  const ab = absFor(R.absences, E.memberId, E.date);
  if (ab) w.push(ab.status === 'aangevraagd' ? 'Heeft ' + ab.kindLabel.toLowerCase() + ' aangevraagd op deze dag.' : 'Is ' + (ab.kind === 'ziek' ? 'ziek gemeld' : 'met ' + ab.kindLabel.toLowerCase()) + ' op deze dag en kan niet worden ingepland.');
  const av = (R.availability || []).find(x => same(x.memberId, E.memberId) && x.date === E.date);
  if (av && av.status === 'kan_niet') w.push('Heeft aangegeven niet te kunnen' + (av.source === 'vast' ? ' (vaste beschikbaarheid)' : '') + (av.note ? ' (' + av.note + ')' : '') + '.');
  if (av && av.status === 'kan' && av.start && E.start && E.end && (E.start < av.start || E.end > av.end)) w.push('Kan alleen van ' + av.start + ' tot ' + av.end + '.');
  if (av && av.status === 'kan' && !w.length) return '<p class="small" style="margin:0;color:var(--green)">Heeft aangegeven te kunnen' + (av.start ? ' van ' + esc(av.start) + ' tot ' + esc(av.end) : '') + '.</p>';
  return w.length ? '<div class="alert warn" style="padding:10px 14px"><span>' + w.map(esc).join(' ') + '</span></div>' : '';
}
function viewRoster() {
  const R = rosterFiltered(S.roster); if (!R) return '';
  const view = S.rosterView || (R.canPlan ? 'week' : 'mijn');
  const month = view === 'maand', mineView = view === 'mijn', dayView = view === 'dag';
  let h = '<header class="page-head"><div><div class="ro-title"><h1>Rooster</h1>' + (R.canPlan && !mineView && !month ? pubPill(R) : '') + '</div><p>' + (mineView ? 'Jouw diensten van deze week.' : R.canPlan && !month ? 'Klik op <strong>+</strong> of sleep een vaste dienst naar een vakje. Sleep een dienst om hem te verplaatsen (met Ctrl ingedrukt: kopiëren).' : 'Wie wanneer werkt.') + '</p></div></header>';
  h += '<div class="roster-bar"><div class="seg" role="group" aria-label="Weergave">' + [['mijn', 'Mijn week'], ['week', 'Iedereen'], ['dag', 'Dag'], ['maand', 'Maand']].map(v =>
    '<button data-act="ro-view" data-v="' + v[0] + '" class="' + (view === v[0] ? 'on' : '') + '" aria-pressed="' + (view === v[0]) + '">' + v[1] + '</button>').join('') + '</div>';
  if (month) {
    const cur = monthStart(today());
    h += '<div class="weeknav"><button class="icon-btn" data-act="ro-month" data-v="' + addMonths(S.rosterMonth, -1) + '" aria-label="Vorige maand">' + ICON.left + '</button>' +
      '<strong>' + monthLabel(S.rosterMonth) + '</strong><button class="icon-btn" data-act="ro-month" data-v="' + addMonths(S.rosterMonth, 1) + '" aria-label="Volgende maand">' + ICON.right + '</button>' +
      (S.rosterMonth !== cur ? '<button class="btn small ghost" data-act="ro-month" data-v="' + cur + '">Naar deze maand</button>' : '') + '</div>';
    h += '<label class="sr-only" for="ro-who">Toon</label><select class="input" id="ro-who" data-in="rowho" style="max-width:240px"><option value="">Iedereen</option>' +
      R.people.map(p => '<option value="' + p.id + '"' + (same(S.rosterWho, p.id) ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('') + '</select>';
  } else {
    if (!dayView) h += weekNav('ro-week', R.weekStart);
    if (R.canSeeWorked && !mineView && !dayView) h += '<label class="check compare-toggle"><input type="checkbox" data-in="rocompare"' + (S.rosterCompare ? ' checked' : '') + '> Vergelijk met gewerkt</label>';
  }
  h += (mineView ? '' : locFilterSelect()) + '</div>';
  const swM = typeof swapOfferModal === 'function' ? (S.swOffer ? modal(swapOfferModal(R), 'sw-offer-x') : '') + (S.swReview && R.canPlan ? modal(swapReviewModal(R), 'sw-review-x') : '') : '';
  if (R.canPlan && !mineView && typeof swapPendingBar === 'function') h += swapPendingBar();
  if (mineView) return h + rosterMine(R) + swM;
  if (!month && !R.canPlan) h += publishBanner(R);
  const RV = roView(R);
  h += rosterPanels(RV);
  if (S.shiftEdit) h += modal(shiftForm(R), 'sh-cancel');
  if (!R.people.length) return h + '<div class="empty">Nog geen actieve medewerkers.</div>';
  if (dayView) return h + deptBar(RV) + rosterDayView(RV) + (R.canPlan && S.tplModal ? modal(templatesModal(R), 'tpl-x') : '') + swM;
  return h + (month ? '' : rosterToolbar(RV)) + (month ? rosterMonth(R) : rosterWeek(RV)) + (month ? '' : rosterLegend(R)) + (R.canPlan && S.tplModal ? modal(templatesModal(R), 'tpl-x') : '') + swM;
}
function tplOf(R, s) {
  const T = R.templates || []; const sameT = t => t.start === s.start && t.end === s.end;
  let i = T.findIndex(t => sameT(t) && same(t.functionId || '', s.functionId || '') && same(t.departmentId || '', s.departmentId || ''));
  if (i < 0) i = T.findIndex(t => sameT(t) && same(t.functionId || '', s.functionId || ''));
  if (i < 0) i = T.findIndex(sameT);
  return i < 0 ? null : { i: i % 6, t: T[i] };
}
function rosterMine(R) {
  const days = [0, 1, 2, 3, 4, 5, 6].map(i => addDays(R.weekStart, i));
  const mine = R.shifts.filter(s => same(s.memberId, S.me.id));
  const tot = mine.reduce((a, s) => a + spanMin(s.start, s.end), 0);
  const meP = R.people.find(p => same(p.id, S.me.id)) || {};
  const ch = meP.contractType === 'vast' ? Number(meP.contractHours) * 60 : 0;
  let h = '<section class="card my-week-sum"><div><span class="small muted">Ingepland deze week</span><strong>' + fmtHM(tot) + ' uur</strong>' + (ch ? '<span class="small muted">van ' + fmtHM(ch) + ' contract</span>' : '') + '</div>' +
    '<div><span class="small muted">Diensten</span><strong>' + mine.length + '</strong></div></section>';
  h += '<div class="my-week">' + days.map(d => {
    const list = mine.filter(s => s.date === d).sort((a, b) => a.start.localeCompare(b.start));
    const ab = absFor(R.absences, S.me.id, d);
    const others = R.shifts.filter(s => s.date === d && !same(s.memberId, S.me.id));
    const names = [...new Set(others.map(s => s.memberName.split(' ')[0]))];
    return '<div class="my-day' + (d === today() ? ' today' : '') + (d < today() ? ' past' : '') + (list.length ? ' has' : '') + '"><div class="my-day-date"><strong>' + esc(DAYS_FULL[pd(d).getDay()]) + '</strong><span>' + pd(d).getDate() + ' ' + esc(MONTHS[pd(d).getMonth()]) + '</span>' + (d === today() ? '<span class="badge green">Vandaag</span>' : '') + '</div>' +
      '<div class="my-day-main">' + (ab ? absChip(ab) : '') +
      (list.length ? list.map(s => { const tp = tplOf(R, s); return '<div class="my-shift' + (tp ? ' t' + tp.i : '') + '"><strong>' + esc(s.start + ' – ' + s.end) + '</strong><span>' + fmtHM(spanMin(s.start, s.end)) + ' uur' + (tp ? ' · ' + esc(tp.t.name) : '') + (s.note ? ' · ' + esc(s.note) : '') + '</span>' + (typeof swapBtn === 'function' ? swapBtn(s) : '') + '</div>'; }).join('')
        : ab ? '' : '<span class="muted">Vrij</span>') +
      (list.length && names.length ? '<div class="small muted">Ook aan het werk: ' + esc(names.slice(0, 6).join(', ')) + (names.length > 6 ? ' en ' + (names.length - 6) + ' anderen' : '') + '</div>' : '') + '</div></div>';
  }).join('') + '</div>';
  if (typeof swapsSection === 'function') h += swapsSection(R);
  return h;
}
function weekPub(R, wk) { return (R.published || []).find(x => x.week === wk); }
function pubPill(R) {
  const pub = weekPub(R, R.weekStart);
  if (pub) return '<span class="pub-pill on" title="' + esc('Vastgezet' + (pub.byName ? ' door ' + pub.byName : '') + ' · ' + fmtDate(pub.at) + '. Iedereen ziet deze week; wijzigingen worden gemeld.') + '">✓ Verstuurd</span><button class="link-btn small" data-act="ro-unpublish">Terug naar concept</button>';
  return '<span class="pub-pill" title="Alleen planners zien deze week">Concept</span><button class="btn small primary" data-act="ro-publish"' + (R.shifts.length ? '' : ' disabled') + ' title="Zet het rooster vast; iedereen met een dienst krijgt een melding">Versturen</button>' +
    (R.shifts.length ? '<button class="link-btn small danger-link" data-act="ro-concept-del" title="Alle diensten van dit concept verwijderen">Concept verwijderen</button>' : '');
}
function publishBanner(R) {
  const pub = weekPub(R, R.weekStart);
  if (!R.canPlan) return pub || R.shifts.length ? '' : '<div class="alert info"><span>Het rooster voor deze week is nog niet klaar.</span></div>';
  if (pub) return '<div class="pub-bar on"><span><strong>Vastgezet</strong>' + (pub.byName ? ' door ' + esc(pub.byName) : '') + ' · ' + esc(fmtDate(pub.at)) +
    '. Iedereen ziet deze week. Wijzig je een dienst, dan krijgt die medewerker automatisch een melding.</span><button class="btn small ghost" data-act="ro-unpublish">Terug naar concept</button></div>';
  return '<div class="pub-bar"><span><strong>Concept</strong> · alleen planners zien deze week. Zet hem vast als hij klaar is; iedereen met een dienst krijgt dan een melding.</span>' +
    '<button class="btn small primary" data-act="ro-publish"' + (R.shifts.length ? '' : ' disabled') + '>Rooster vastzetten en versturen</button></div>';
}
function templatesModal(R) {
  const E = S.tplEdit || { name: '', start: '', end: '', note: '' }; const U = UNITS(R);
  const T = R.templates.slice().sort((a, b) => a.start.localeCompare(b.start) || String(a.name).localeCompare(String(b.name)));
  const editing = !!E.id;
  const list = T.length ? '<div class="tplm-list">' + T.map(t => { const d = deptOf(t.departmentId, R), f = funcOf(t.functionId, R); const on = same(E.id, t.id);
    return '<div class="tplm-row' + (on ? ' on' : '') + '"' + (d ? ' style="--dept:' + esc(d.color) + '"' : '') + '><div class="tplm-main"><strong>' + esc(t.name) + '</strong><span class="tplm-time">' + esc(t.start + '–' + t.end) + '</span></div>' +
      '<div class="tplm-tags">' + (d ? '<span class="nd-tag dept" style="--dept:' + esc(d.color) + '">' + esc(d.name) + '</span>' : '') + (f ? '<span class="nd-tag func">' + esc(f.name) + '</span>' : '') + (!d && !f ? '<span class="nd-tag any">Iedereen</span>' : '') + (t.note ? '<span class="small muted">' + esc(t.note) + '</span>' : '') + '</div>' +
      '<div class="tplm-act"><button class="btn small ghost" data-act="tpl-edit" data-id="' + t.id + '">' + (on ? 'Wordt aangepast' : 'Aanpassen') + '</button><button class="icon-btn small" data-act="tpl-del" data-id="' + t.id + '" aria-label="' + esc(t.name) + ' verwijderen">' + ICON.trash + '</button></div></div>'; }).join('') + '</div>'
    : '<p class="muted" style="margin:0">Nog geen vaste diensten. Maak er hieronder een, bijvoorbeeld Ochtend 08:00–13:00.</p>';
  const sel = (id, key, label, arr) => arr.length ? '<div class="field"><label for="' + id + '">' + label + '</label><select class="input" id="' + id + '" data-tpl="' + key + '"><option value="">' + (key === 'functionId' ? 'Iedereen' : '—') + '</option>' + arr.map(x => '<option value="' + x.id + '"' + (same(x.id, E[key]) ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('') + '</select></div>' : '';
  return '<section class="card stack tplm" style="gap:16px;max-width:none"><div class="item-top"><div><h2 style="margin:0">Vaste diensten</h2><p class="muted" style="margin:4px 0 0">Diensten die vaak terugkomen. Je sleept ze in het rooster.</p></div><button class="icon-btn" data-act="tpl-x" aria-label="Sluiten">' + ICON.x + '</button></div>' +
    list +
    '<div class="tplm-form"><h3>' + (editing ? 'Vaste dienst aanpassen' : 'Nieuwe vaste dienst') + '</h3>' +
      '<div class="tplm-grid"><div class="field span2"><label for="tpl-name">Naam</label><input class="input" id="tpl-name" data-tpl="name" maxlength="40" value="' + esc(E.name) + '" placeholder="Bijv. Ochtend"></div>' +
      '<div class="field"><label for="tpl-start">Begin</label><input class="input" type="time" id="tpl-start" data-tpl="start" value="' + esc(E.start) + '"></div>' +
      '<div class="field"><label for="tpl-end">Eind</label><input class="input" type="time" id="tpl-end" data-tpl="end" value="' + esc(E.end) + '"></div>' +
      sel('tpl-dept', 'departmentId', 'Afdeling', U.departments) + sel('tpl-func', 'functionId', 'Functie nodig', U.functions) +
      '<div class="field span2"><label for="tpl-note">Notitie <span class="opt">(optioneel)</span></label><input class="input" id="tpl-note" data-tpl="note" maxlength="120" value="' + esc(E.note || '') + '" placeholder="Bijv. balie"></div></div>' +
      (!U.departments.length && !U.functions.length ? '<p class="small muted" style="margin:0">Afdelingen en functies stel je in bij <strong>Instellen → Afdelingen &amp; functies</strong>.</p>' : '') +
      '<div class="row"><button class="btn primary" data-act="tpl-save">' + (editing ? 'Wijzigingen opslaan' : 'Toevoegen') + '</button>' + (editing ? '<button class="btn ghost" data-act="tpl-new">Annuleren</button>' : '') + '</div>' +
      (editing ? '<p class="small muted" style="margin:0">Diensten die al in het rooster staan blijven zoals ze zijn.</p>' : '') + '</div></section>';
}
function rosterLegend(R) {
  return '<div class="legend-bar small muted"><span><span class="abs-chip verlof">Verlof</span> goedgekeurd</span><span><span class="abs-chip verlof pending">Verlof?</span> aangevraagd</span><span><span class="abs-chip ziek">Ziek</span></span>' +
    (R.canPlan ? '<span><span class="av-dot kan"></span> kan werken</span><span><span class="av-dot kan_niet"></span> kan niet</span>' : '') +
    (S.rosterCompare ? '<span><span class="wk ok">gewerkt</span></span><span><span class="wk warn">afwijking</span></span><span><span class="wk bad">niet geklokt</span></span>' : '') + '</div>';
}
function workedCell(R, p, d, shifts) {
  const w = (R.worked || []).find(x => same(x.memberId, p.id) && x.date === d);
  if (d > today()) return '';
  if (!w) return shifts.length && d < today() ? '<span class="wk bad">Niet geklokt</span>' : '';
  if (!shifts.length) return '<span class="wk warn">Niet ingepland · ' + esc(w.start + '–' + (w.end || 'nu')) + '</span>';
  const s0 = shifts[0], sl = shifts[shifts.length - 1];
  const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const late = toMin(w.start) - toMin(s0.start), early = w.end ? toMin(sl.end) - toMin(w.end) : 0;
  const notes = [];
  if (late > 5) notes.push(late + ' min te laat');
  if (!w.open && early > 5) notes.push(early + ' min eerder weg');
  return '<span class="wk ' + (notes.length ? 'warn' : 'ok') + '">' + esc(w.start + '–' + (w.end || 'nu')) + (w.minutes ? ' · ' + fmtHM(w.minutes) : '') + (notes.length ? '<small>' + esc(notes.join(', ')) + '</small>' : '') + '</span>';
}
function rosterMonth(R) {
  const m = S.rosterMonth, last = monthEnd(m);
  const who = S.rosterWho ? R.people.find(p => same(p.id, S.rosterWho)) : null;
  const shifts = R.shifts.filter(s => !who || same(s.memberId, who.id));
  const inMonth = shifts.filter(s => s.date >= m && s.date <= last);
  let h = '<div class="month" role="grid" aria-label="' + esc(monthLabel(m)) + '"><div class="month-head" role="row">' + ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'].map(d => '<span role="columnheader">' + d + '</span>').join('') + '</div><div class="month-grid">';
  for (let d = R.from; d <= R.to; d = addDays(d, 1)) {
    const out = d < m || d > last;
    const list = shifts.filter(s => s.date === d);
    const gone = who && who.leavingOn && d > who.leavingOn;
    h += '<div class="mday' + (out ? ' out' : '') + (d === today() ? ' today' : '') + (gone ? ' gone' : '') + '" role="gridcell">' +
      '<div class="mday-top"><button class="mday-num" data-act="ro-goweek" data-v="' + d + '" aria-label="Week van ' + esc(dayLong(d)) + ' bekijken">' + pd(d).getDate() + '</button>' +
      (list.length ? '<span class="mday-count">' + list.length + '</span>' : '') + '</div>' +
      '<div class="mday-list">' + (R.absences || []).filter(a => (!who || same(a.memberId, who.id)) && absCovers(a, d) && !out).map(a => who ? absChip(a) :
        '<span class="abs-chip ' + a.kind + (a.status === 'aangevraagd' ? ' pending' : '') + '">' + esc((R.people.find(p => same(p.id, a.memberId)) || { name: '?' }).name.split(' ')[0] + ' · ' + a.kindLabel) + '</span>').join('') +
      (who && R.canPlan ? (R.availability || []).filter(x => same(x.memberId, who.id) && x.date === d).map(av => '<span class="av-tag ' + av.status + '"><span class="av-dot ' + av.status + '"></span>' + (av.status === 'kan' ? (av.start ? esc(av.start + '–' + av.end) : 'Kan') : 'Kan niet') + '</span>').join('') : '') +
      list.slice(0, 4).map(s => shiftChip(R, s, !who)).join('') +
      (list.length > 4 ? '<button class="mday-more" data-act="ro-goweek" data-v="' + d + '">+' + (list.length - 4) + ' meer</button>' : '') + '</div>' +
      (R.canPlan && !out && !gone ? '<button class="mday-add" data-act="sh-new" data-id="' + (who ? who.id : '') + '" data-v="' + d + '" aria-label="Dienst inplannen op ' + esc(dayLong(d)) + '">+</button>' : '') + '</div>';
  }
  h += '</div></div>';
  // overzicht van de maand per persoon
  const people = who ? [who] : R.people;
  h += '<section class="card"><h2>Ingepland in ' + esc(monthLabel(m).toLowerCase()) + '</h2><div class="month-sum">' + people.map(p => {
    const mine = inMonth.filter(s => same(s.memberId, p.id));
    const tot = mine.reduce((a, s) => a + spanMin(s.start, s.end), 0);
    return '<button class="month-person" data-act="ro-who" data-id="' + p.id + '">' + avatar(p.id, p.name, 'sm2') + '<span><strong>' + esc(p.name) + '</strong><small>' + mine.length + (mine.length === 1 ? ' dienst' : ' diensten') + ' · ' + fmtHM(tot) + ' uur</small>' + leaveTag(p.leavingOn, true) + '</span></button>';
  }).join('') + '</div></section>';
  return h;
}
async function copyLastWeek() {
  const R = S.roster; const prevFrom = addDays(R.weekStart, -7);
  const prev = await rpc('cd_roster_range', { p_from: prevFrom, p_to: addDays(prevFrom, 6) });
  const have = new Set(R.shifts.map(s => s.memberId + '|' + s.date + '|' + s.start));
  const people = new Map(R.people.map(p => [String(p.id), p]));
  const todo = prev.shifts.map(s => Object.assign({}, s, { date: addDays(s.date, 7) }))
    .filter(s => people.has(String(s.memberId)) && !have.has(s.memberId + '|' + s.date + '|' + s.start))
    .filter(s => { const p = people.get(String(s.memberId)); return !p.leavingOn || s.date <= p.leavingOn; });
  if (!todo.length) { toast(prev.shifts.length ? 'Alle diensten van vorige week staan er al.' : 'Vorige week stonden er geen diensten.'); return false; }
  if (!confirm(todo.length + (todo.length === 1 ? ' dienst' : ' diensten') + ' van vorige week overnemen in deze week?')) return false;
  let ok = 0;
  const made = [];
  for (const s of todo) { try { made.push((await rpc('cd_shift_save', { p_id: null, p: { memberId: s.memberId, date: s.date, start: s.start, end: s.end, note: s.note || '', departmentId: s.departmentId || '', functionId: s.functionId || '' } })).id); ok++; } catch (e) { /* sla over */ } }
  if (made.length) roPush(opCreate(todo.filter((x, i) => i < made.length), made.length + ' diensten van vorige week', made));
  const skip = todo.length - ok;
  toast(ok + (ok === 1 ? ' dienst' : ' diensten') + ' gekopieerd.' + (skip ? ' ' + skip + ' overgeslagen (verlof, ziek of niet meer in dienst).' : ''), !!skip);
  return true;
}

function pendingGroups() {
  const G = []; const by = {};
  (S.pending || []).forEach(e => {
    const k = e.memberId + '|' + e.weekStart;
    if (!by[k]) { by[k] = { key: k, memberId: e.memberId, name: e.memberName, week: e.weekStart, entries: [] }; G.push(by[k]); }
    by[k].entries.push(e);
  });
  return G;
}
function viewApprove() {
  const G = pendingGroups();
  let h = '<header class="page-head"><div><h1>Uren goedkeuren</h1><p>Ingediende uren van het team. Vink uit wat je niet wilt meenemen. Je eigen uren keurt iemand anders goed.</p></div></header>';
  if (!S.pending) return h;
  if (!G.length) return h + '<div class="empty-state card"><strong>Alles is beoordeeld</strong>Er wachten geen ingediende uren.</div>';
  h += G.map(g => {
    const on = g.entries.filter(e => !S.pOff[e.id]);
    const total = on.reduce((a, e) => a + (e.minutes || 0), 0);
    return '<section class="card approve"><div class="section-title"><div style="display:flex;gap:10px;align-items:center">' + avatar(g.memberId, g.name) +
      '<div><strong>' + esc(g.name) + '</strong><div class="small muted">' + weekLabel(g.week) + '</div></div></div>' +
      '<button class="btn small ghost" data-act="p-view" data-id="' + g.memberId + '" data-v="' + g.week + '">Hele week bekijken</button></div>' +
      '<div class="table-wrap" style="border:0;margin-top:8px"><table><thead><tr><th style="width:44px"><span class="sr-only">Meenemen</span></th><th>Dag</th><th>Tijd</th><th>Pauze</th><th>Uren</th><th>Notitie</th></tr></thead><tbody>' +
      g.entries.map(e => '<tr><td class="pad"><input type="checkbox" data-psel="' + e.id + '"' + (S.pOff[e.id] ? '' : ' checked') + ' aria-label="' + esc(dayShort(e.date)) + ' meenemen"></td>' +
        '<td class="pad">' + esc(dayShort(e.date)) + '</td><td class="pad">' + esc(e.start + ' – ' + e.end) + '</td><td class="pad">' + (e.breakMin ? e.breakMin + ' min' : '–') + (e.requiredBreak > (e.breakMin || 0) ? '<br><span class="badge red">Min. ' + e.requiredBreak + ' min</span>' : '') + '</td>' +
        '<td class="pad"><strong>' + fmtHM(e.minutes) + '</strong></td><td class="pad small">' + esc(e.note || '') + '</td></tr>').join('') + '</tbody></table></div>' +
      (S.rejectFor === g.key
        ? '<div class="reject-box"><div class="field"><label for="rej-reason">Waarom keur je ' + (on.length === 1 ? 'deze regel' : 'deze ' + on.length + ' regels') + ' af?</label><input class="input" id="rej-reason" maxlength="300" placeholder="Bijv. pauze ontbreekt op dinsdag"></div>' +
          '<div class="form-foot"><button class="btn small ghost" data-act="p-reject-cancel">Annuleren</button><button class="btn small danger" data-act="p-reject" data-v="' + g.key + '">Afkeuren</button></div></div>'
        : '<div class="form-foot" style="margin-top:12px;align-items:center"><span class="small muted" style="margin-right:auto">Geselecteerd: <strong>' + on.length + '</strong> · ' + fmtHM(total) + ' uur</span>' +
          '<button class="btn small" data-act="p-reject-open" data-v="' + g.key + '"' + (on.length ? '' : ' disabled') + '>Afkeuren…</button>' +
          '<button class="btn small primary" data-act="p-approve" data-v="' + g.key + '"' + (on.length ? '' : ' disabled') + '>Goedkeuren</button></div>') + '</section>';
  }).join('');
  return h;
}

function periodRange(key) {
  const t = pd(today());
  if (key === 'week') { const m = mondayOf(today()); return [m, addDays(m, 6)]; }
  if (key === 'vorigeweek') { const m = addDays(mondayOf(today()), -7); return [m, addDays(m, 6)]; }
  if (key === 'maand') return [ymd(new Date(t.getFullYear(), t.getMonth(), 1)), ymd(new Date(t.getFullYear(), t.getMonth() + 1, 0))];
  if (key === 'vorigemaand') return [ymd(new Date(t.getFullYear(), t.getMonth() - 1, 1)), ymd(new Date(t.getFullYear(), t.getMonth(), 0))];
  return [S.repFrom || today(), S.repTo || today()];
}
async function loadReport() {
  const [f, t] = periodRange(S.repPeriod);
  S.repFrom = f; S.repTo = t;
  S.report = await rpc('cd_hours_report', { p_from: f, p_to: t });
}
function viewReport() {
  const R = reportFiltered(S.report);
  const periods = [['week', 'Deze week'], ['vorigeweek', 'Vorige week'], ['maand', 'Deze maand'], ['vorigemaand', 'Vorige maand'], ['eigen', 'Zelf kiezen']];
  let h = '<header class="page-head"><div><h1>Urenoverzicht</h1><p>Gewerkte uren per medewerker, naast het contract. Klik op iemand voor de details.</p></div>' +
    '<div class="actions">' + locFilterSelect() + '<button class="btn" data-act="rep-csv"' + (R && R.entries.length ? '' : ' disabled') + '>' + ICON.download + 'Diensten (CSV)</button>' + payrollButton(R) + '</div></header>';
  h += '<div class="seg" role="group" aria-label="Periode">' + periods.map(p => '<button data-act="rep-period" data-v="' + p[0] + '" class="' + (S.repPeriod === p[0] ? 'on' : '') + '" aria-pressed="' + (S.repPeriod === p[0]) + '">' + p[1] + '</button>').join('') + '</div>';
  if (S.repPeriod === 'eigen') {
    h += '<div class="row" style="align-items:flex-end;max-width:620px"><div class="field" style="flex:1 1 160px"><label for="rep-from">Van</label><input class="input" type="date" id="rep-from" value="' + esc(S.repFrom || '') + '"></div>' +
      '<div class="field" style="flex:1 1 160px"><label for="rep-to">Tot en met</label><input class="input" type="date" id="rep-to" value="' + esc(S.repTo || '') + '"></div>' +
      '<button class="btn dark" data-act="rep-custom">Toon</button></div>';
  }
  if (!R) return h;
  h += payrollPanel(R);
  const sum = k => R.people.reduce((a, p) => a + (p[k] || 0), 0);
  h += '<p class="small muted" style="margin:0">' + esc(dayShort(R.from)) + ' t/m ' + esc(dayShort(R.to)) + ' · ' + R.workdays + ' werkdagen</p>';
  h += '<div class="stats">' + stat('Goedgekeurd', fmtHM(sum('approvedMin')), 'var(--green)') + stat('Ingediend, wacht', fmtHM(sum('submittedMin')), 'var(--orange)') +
    stat('Nog niet ingediend', fmtHM(sum('conceptMin'))) + stat('Medewerkers', R.people.length) + '</div>';
  h += '<div class="table-wrap"><table><thead><tr><th>Naam</th><th>Contract</th><th>Verlof</th><th>Ziek</th><th>Verwacht</th><th>Goedgekeurd</th><th>Ingediend</th><th>Niet ingediend</th><th>Verschil</th></tr></thead><tbody>' +
    R.people.map(p => {
      const worked = p.approvedMin + p.submittedMin;
      const diff = p.expectedMin == null ? null : worked - p.expectedMin;
      const cell = c => '<td><button class="rowbtn" data-act="p-view" data-id="' + p.id + '" data-v="' + mondayOf(R.from) + '">' + c + '</button></td>';
      return '<tr>' + cell('<strong>' + esc(p.name) + '</strong>' + (p.active ? '' : ' <span class="small muted">(gedeactiveerd)</span>')) + cell('<span class="small">' + esc(contractShort(p)) + '</span>') +
        cell(p.leaveDays ? p.leaveDays + ' d' : '–') + cell(p.sickDays ? '<span style="color:var(--red)">' + p.sickDays + ' d</span>' : '–') +
        cell(p.expectedMin == null ? '–' : fmtHM(p.expectedMin)) + cell('<strong>' + fmtHM(p.approvedMin) + '</strong>') + cell(p.submittedMin ? fmtHM(p.submittedMin) : '–') +
        cell(p.conceptMin ? fmtHM(p.conceptMin) : '–') +
        cell(diff == null || !p.expectedMin ? '–' : '<span style="color:' + (diff < 0 ? 'var(--red)' : 'var(--green)') + '">' + (diff > 0 ? '+' : '') + fmtHM(diff) + '</span>') + '</tr>';
    }).join('') + '</tbody></table></div>' +
    '<p class="small muted" style="margin:0">Verwacht = contracturen × (werkdagen − verlof- en ziektedagen) ÷ 5. Feestdagen tellen nog niet mee. Verschil = goedgekeurd + ingediend − verwacht.</p>';
  return h;
}
function exportCsv() {
  const R = reportFiltered(S.report); if (!R) return;
  const q = v => { const s = String(v == null ? '' : v); return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const rows = [['Naam', 'Datum', 'Begin', 'Eind', 'Pauze (min)', 'Uren', 'Status', 'Notitie']]
    .concat(R.entries.map(e => [e.memberName, e.date, e.start, e.end, e.breakMin, ((e.minutes || 0) / 60).toFixed(2).replace('.', ','), (H_STATUS[e.status] || [e.status])[0], e.note]));
  if (R.absences && R.absences.length) {
    rows.push([]); rows.push(['Afwezigheid', 'Van', 'Tot en met', '', 'Werkdagen', '', 'Soort', 'Toelichting']);
    R.absences.forEach(a => rows.push([a.memberName, a.from, a.to || '(loopt nog)', '', a.workdays, '', a.kindLabel, a.note]));
  }
  if (APP && APP.saveText) {
    const where = APP.saveText('uren-' + R.from + '-tm-' + R.to + '.csv', '\ufeff' + rows.map(r => r.map(q).join(';')).join('\r\n'), 'text/csv');
    toast(where ? 'Opgeslagen in ' + where : 'Opslaan is niet gelukt.', !where); return;
  }
  const blob = new Blob(['﻿' + rows.map(r => r.map(q).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'uren-' + R.from + '-tm-' + R.to + '.csv';
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

// ======================================================================
// Uit dienst en archief
// ======================================================================
const LEAVE_REASONS = [['ontslag_genomen', 'Zelf ontslag genomen'], ['ontslagen', 'Ontslagen'], ['einde_contract', 'Contract afgelopen'], ['pensioen', 'Met pensioen'], ['overig', 'Andere reden']];
function reasonColor(r) { return r === 'ontslagen' ? 'red' : r === 'ontslag_genomen' ? 'orange' : r === 'pensioen' ? 'blue' : ''; }
function leaveBadge(u) {
  return '<span class="badge leave-badge ' + (u.leaveReason === 'ontslagen' ? 'red' : 'orange') + '" title="' + esc(u.leaveReasonLabel || '') + '">' +
    (u.leaveReason === 'ontslagen' ? 'Ontslagen' : 'Vertrekt') + '<small>laatste dag ' + esc(dayShort(u.leftOn)) + '</small></span>';
}
function offboardForm(u) {
  const O = S.offboard; const later = O.mode === 'later';
  return '<div class="stack" style="gap:16px;max-width:none"><div><span class="small muted">Uit dienst melden</span><h2 style="margin:0;font-size:22px">' + esc(u.name) + '</h2></div>' +
    '<fieldset class="reason-grid"><legend class="legend">Reden *</legend>' + LEAVE_REASONS.map(r =>
      '<label class="reason' + (O.reason === r[0] ? ' on' : '') + '"><input type="radio" name="off-reason" value="' + r[0] + '" data-off="reason"' + (O.reason === r[0] ? ' checked' : '') + '> ' + r[1] + '</label>').join('') + '</fieldset>' +
    '<fieldset class="reason-grid"><legend class="legend">Wanneer gaat het account uit? *</legend>' +
      '<label class="reason' + (later ? ' on' : '') + '"><input type="radio" name="off-mode" value="later" data-off="mode"' + (later ? ' checked' : '') + '> <span><strong>Na de laatste werkdag</strong><small>Werkt nog door tot en met de datum hieronder</small></span></label>' +
      '<label class="reason' + (!later ? ' on' : '') + '"><input type="radio" name="off-mode" value="now" data-off="mode"' + (!later ? ' checked' : '') + '> <span><strong>Meteen uitzetten</strong><small>Bijvoorbeeld bij ontslag op staande voet</small></span></label></fieldset>' +
    '<div class="field"><label for="off-date">' + (later ? 'Laatste werkdag *' : 'Uit dienst per') + '</label><input class="input" type="date" id="off-date" data-off="date" value="' + esc(O.date) + '"' + (later ? ' min="' + today() + '"' : ' max="' + today() + '"') + '></div>' +
    '<div class="field"><label for="off-note">Toelichting' + (O.reason === 'overig' ? ' *' : ' <span class="muted" style="font-weight:400">(optioneel)</span>') + '</label>' +
      '<textarea class="input" id="off-note" data-off="note" rows="3" maxlength="500" placeholder="Bijv. gaat verhuizen, of afspraken over de overdracht">' + esc(O.note) + '</textarea>' +
      '<span class="small muted">Alleen zichtbaar voor mensen die medewerkers beheren.</span></div>' +
    '<div class="alert warn"><span><strong>Wat er gebeurt</strong>' + (later
      ? esc(u.name.split(' ')[0]) + ' werkt gewoon door en krijgt in Mensen en het rooster een label met de laatste werkdag. Diensten na die dag gaan uit het rooster. ' +
        'De dag erna gaat het account automatisch uit: open terugbelverzoeken gaan naar de open pool en ' + esc(u.name.split(' ')[0]) + ' komt in het archief.'
      : 'Het account gaat meteen uit. Open terugbelverzoeken gaan naar de open pool, diensten na vandaag verdwijnen uit het rooster en een lopende klok wordt gestopt.') +
      ' Uren, taken en het logboek blijven bewaard.</span></div>' +
    '<div class="form-foot"><button class="btn ghost" data-act="m-off-cancel">Annuleren</button><button class="btn danger" data-act="m-off-save" data-id="' + u.id + '">' + (later ? 'Vertrek vastleggen' : 'Nu uit dienst melden') + '</button></div></div>';
}
function viewArchivePanel() {
  const u = S.members.find(x => same(x.id, S.mSel) && x.archived);
  if (!u) return '<p class="muted" style="margin:0">Kies iemand in het archief om de gegevens te bekijken.</p>';
  return '<div class="stack" style="gap:14px;max-width:none"><div><span class="small muted">Archief</span><h2 style="margin:0;font-size:22px">' + esc(u.name) + '</h2></div>' +
    '<dl class="kv"><dt>Reden</dt><dd><span class="badge ' + reasonColor(u.leaveReason) + '">' + esc(u.leaveReasonLabel || '') + '</span></dd>' +
    '<dt>Uit dienst per</dt><dd>' + (u.leftOn ? esc(dayLong(u.leftOn) + ' ' + String(u.leftOn).slice(0, 4)) : '–') + '</dd>' +
    '<dt>Laatste rol</dt><dd>' + esc(u.roleName) + '</dd><dt>Contract</dt><dd>' + esc(contractText(u)) + '</dd>' +
    '<dt>In dienst sinds</dt><dd>' + esc(fmtDate(u.createdAt).replace(/ \d\d:\d\d$/, '')) + '</dd>' +
    '<dt>Gemeld door</dt><dd>' + esc(u.leftByName || '–') + (u.leftAt ? ' <span class="small muted" style="font-weight:400">· ' + esc(fmtDate(u.leftAt)) + '</span>' : '') + '</dd></dl>' +
    (u.leaveNote ? '<div class="box"><span class="small muted">Toelichting</span><div style="white-space:pre-wrap">' + esc(u.leaveNote) + '</div></div>' : '') +
    '<p class="small muted" style="margin:0">De uren en het logboek van ' + esc(u.name.split(' ')[0]) + ' blijven bewaard, bijvoorbeeld voor de loonadministratie.</p>' +
    (can('members.manage') && u.canManage ? '<div class="detail-section"><button class="btn" data-act="m-restore" data-id="' + u.id + '">Weer in dienst nemen</button>' +
      '<span class="small muted">Het account gaat weer aan met de oude code. Maak eventueel een nieuwe code.</span></div>' : '') + '</div>';
}

// ======================================================================
// Prikklok: beheer (ingelogd) en het scherm zelf
// ======================================================================
function viewKioskAdmin() {
  const D = S.kiosks; if (!D) return '';
  const here = kioskToken();
  let h = '<header class="page-head"><div><h1>Prikklok</h1><p>Zet een tablet of pc bij de ingang neer. Medewerkers tikken hun naam aan en bevestigen met hun eigen code.</p></div></header>';
  h += '<div class="cards" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr))">';
  h += '<section class="card stack" style="gap:14px"><h2 style="margin:0">Dit apparaat als prikklok</h2>' +
    '<p class="small muted" style="margin:0">Je wordt op dit apparaat uitgelogd. Daarna staat hier alleen nog de prikklok. Niemand kan via de prikklok bij de rest van CrewHarbor.</p>' +
    '<div class="field"><label for="kiosk-name">Naam van dit apparaat</label><input class="input" id="kiosk-name" maxlength="60" placeholder="Bijv. Tablet bij de ingang" value="' + esc(S.kioskName) + '"></div>' + kioskLocField() +
    '<div><button class="btn primary" data-act="kiosk-setup">Prikklok starten op dit apparaat</button></div></section>';
  h += '<section class="card stack" style="gap:14px"><h2 style="margin:0">Waar mag je inklokken?</h2>' +
    ['overal', 'prikklok'].map(v => '<label class="reason' + (D.mode === v ? ' on' : '') + (D.canMode ? '' : ' disabled') + '"><input type="radio" name="clock-mode" value="' + v + '" data-mode' + (D.mode === v ? ' checked' : '') + (D.canMode ? '' : ' disabled') + '> ' +
      (v === 'overal' ? '<span><strong>In de app en bij de prikklok</strong><small>Medewerkers klokken ook zelf in op hun telefoon of pc.</small></span>' : '<span><strong>Alleen bij de prikklok</strong><small>Inklokken kan alleen op locatie, met code. Uren achteraf invullen blijft mogelijk.</small></span>') + '</label>').join('') +
    (D.canMode ? '' : '<p class="small muted" style="margin:0">Alleen iemand met het recht "Bedrijfsinstellingen" kan dit wijzigen.</p>') + '</section></div>';
  h += '<section class="stack" style="gap:8px;max-width:none"><div class="section-title"><h2>Actieve prikklokken</h2></div>' +
    (D.kiosks.length ? '<div class="doc-list">' + D.kiosks.map(k => '<div class="doc"><span class="doc-ext">' + NI.prikklok + '</span><div class="doc-main"><strong>' + esc(k.name) + '</strong>' +
      '<span class="small muted">' + (k.locationName ? esc(k.locationName) + ' · ' : '') + 'Ingesteld door ' + esc(k.createdByName || '–') + ' · ' + esc(fmtDate(k.createdAt)) + ' · ' + (k.lastSeen ? 'laatst actief ' + esc(fmtDate(k.lastSeen)) : 'nog niet gebruikt') + '</span></div>' +
      '<div class="doc-act"><button class="btn small danger" data-act="kiosk-revoke" data-id="' + k.id + '">Uitzetten</button></div></div>').join('') + '</div>'
      : '<div class="empty">Nog geen prikklokken. Start er een op het apparaat dat bij de ingang komt te staan.</div>') +
    (here ? '<div class="alert info" style="align-items:center;justify-content:space-between;flex-wrap:wrap"><span>Dit apparaat is als prikklok ingesteld.</span><button class="btn small primary" data-act="kiosk-reopen">Prikklok weer openen</button></div>' : '') +
    '<p class="small muted" style="margin:0">Prikklok verlaten: tik op het apparaat 5 keer snel op het CrewHarbor-logo linksboven en log in met je eigen naam en code. Dat kan alleen met het recht "Prikklok verlaten met eigen code".</p></section>';
  return h;
}

async function loadKiosk() {
  const token = kioskToken();
  if (!token) { K.info = null; K.error = 'none'; return; }
  try { K.info = await svc('kiosk-info', { token }); K.error = null; }
  catch (e) { if (/uitgezet/.test(e.message)) { K.info = null; K.error = 'revoked'; } else { K.error = K.info ? null : 'offline'; K.offline = e.message; } }
}
function kioskTime() { const d = new Date(); return hm(d); }
function kioskDate() { const d = new Date(); const t = DAYS_FULL[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()]; return t.charAt(0).toUpperCase() + t.slice(1); }
function viewKiosk() {
  const head = '<header class="kiosk-head"><div><span class="kiosk-logo" data-act="k-logo" aria-hidden="true">' + LOGO(30) + '</span>' + (K.info ? '<div class="kiosk-org">' + esc(K.info.org) + ' · ' + esc(K.info.kiosk) + '</div>' : '') + '</div>' +
    '<div class="kiosk-clock"><strong id="k-time">' + kioskTime() + '</strong><span id="k-date">' + kioskDate() + '</span></div></header>';
  let body;
  if (K.exit) {
    const X = K.exit;
    body = '<form class="kiosk-exit" data-form="kiosk-exit" novalidate><h1>Prikklok verlaten</h1><p>Log in met je e-mailadres en wachtwoord. Alleen mensen met het recht "Prikklok verlaten" kunnen dit.</p>' +
      (X.err ? '<p class="kiosk-err" role="alert">' + esc(X.err) + '</p>' : '') +
      '<div class="field"><label for="kx-name">E-mailadres</label><input class="input" id="kx-name" name="name" type="email" autocapitalize="none" spellcheck="false" autocomplete="off" value="' + esc(X.name || '') + '"></div>' +
      '<div class="field"><label for="kx-code">Wachtwoord</label><input class="input" id="kx-code" name="code" type="password" autocomplete="off"></div>' +
      '<label class="check"><input type="checkbox" name="revoke"' + (X.revoke ? ' checked' : '') + '> Prikklok op dit apparaat helemaal uitzetten</label>' +
      '<div class="form-foot"><button type="button" class="btn ghost" data-act="k-exit-cancel">Annuleren</button><button type="submit" class="btn primary"' + (X.busy ? ' disabled' : '') + '>' + (X.busy ? 'Bezig…' : 'Inloggen') + '</button></div></form>';
  } else if (K.error === 'none' || K.error === 'revoked') {
    body = '<div class="kiosk-msg"><h1>' + (K.error === 'revoked' ? 'Deze prikklok is uitgezet' : 'Dit apparaat is nog geen prikklok') + '</h1>' +
      '<p>' + (K.error === 'revoked' ? 'Een leidinggevende heeft deze prikklok uitgezet.' : 'Log in als leidinggevende en kies Uren → Prikklok om hem in te stellen.') + '</p>' +
      '<button class="btn primary" data-act="k-exit">Naar inloggen</button></div>';
  } else if (!K.info) {
    body = '<div class="kiosk-msg"><h1>Geen verbinding</h1><p>' + esc(K.offline || 'De server is niet bereikbaar.') + ' We proberen het zo opnieuw.</p></div>';
  } else if (K.result) {
    const R = K.result;
    const inn = R.action === 'in';
    // feestelijke animatie: vinkje dat zich tekent, golven, confetti en een bootje dat de haven in (of uit) vaart
    const conf = Array.from({ length: 28 }, (_, i) => '<i style="--a:' + Math.round(i * 12.86) + 'deg;--d:' + (120 + (i * 47) % 90) + 'px;--t:' + (i % 4) + '"></i>').join('');
    body = '<div class="kiosk-done kd2 ' + (inn ? 'in' : 'out') + '" role="status">' +
      '<div class="kd-burst" aria-hidden="true">' + conf + '</div>' +
      '<div class="kd-ring r1" aria-hidden="true"></div><div class="kd-ring r2" aria-hidden="true"></div>' +
      '<div class="kiosk-check"><svg viewBox="0 0 24 24" fill="none" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path class="kd-tick" d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>' +
      '<h1 class="kd-up" style="--dl:.35s">' + (inn ? 'Ingeklokt om ' : 'Uitgeklokt om ') + esc(R.time) + '</h1>' +
      '<p class="kd-up" style="--dl:.5s">' + (inn ? 'Fijne dienst, ' : 'Tot de volgende keer, ') + esc(R.name.split(' ')[0]) + '!' + (!inn && R.minutes != null ? ' Je hebt <strong>' + fmtHM(R.minutes) + '</strong> gewerkt.' : '') + '</p>' +
      '<div class="kd-sea" aria-hidden="true"><svg class="kd-boat" viewBox="0 0 64 56"><path d="M30 4v34" stroke="#EDE8DC" stroke-width="2.5" stroke-linecap="round"/><path d="M33 8l17 26H33z" fill="#EDE8DC"/><path d="M28 12L14 34h14z" fill="#7FC4CF"/><path d="M8 40h48l-7 10H15z" fill="' + (inn ? '#16A34A' : '#F59E0B') + '"/></svg>' +
        '<svg class="kd-waves" viewBox="0 0 400 20" preserveAspectRatio="none"><path d="M0 10 Q 25 0 50 10 T 100 10 T 150 10 T 200 10 T 250 10 T 300 10 T 350 10 T 400 10 V20 H0z" fill="rgba(127,196,207,.28)"/></svg></div>' +
      '<div class="kd-timer" aria-hidden="true"><span></span></div></div>';
  } else if (K.sel) {
    const P = K.info.people.find(x => same(x.id, K.sel));
    const goingIn = !P || !P.in;
    body = '<div class="kiosk-pad"><button class="btn ghost" data-act="k-cancel">' + ICON.left + 'Terug</button>' +
      '<div class="kiosk-who">' + avatar(P.id, P.name, 'xl') + '<div><h1>' + esc(P.name) + '</h1><p>' + (goingIn ? 'Inklokken' + (P.shift ? ' · ingepland ' + esc(P.shift) : '') : 'Uitklokken · binnen sinds ' + esc(P.in)) + '</p></div></div>' +
      '<label class="kiosk-label" id="k-lab">' + (K.info && K.info.pinUntil ? 'Voer de klokcode uit de CrewHarbor-app in, of je eigen pincode' : 'Voer de klokcode uit de CrewHarbor-app in') + '</label>' +
      '<div class="kiosk-dots' + (K.err ? ' bad' : '') + '" aria-labelledby="k-lab" aria-live="polite">' + (K.code ? K.code.split('').map(() => '<span></span>').join('') : '<em>••••••••</em>') + '</div>' +
      (K.err ? '<p class="kiosk-err" role="alert">' + esc(K.err) + '</p>' : '') +
      '<div class="keypad">' + ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'].map(k =>
        k === 'del' ? '<button data-act="k-key" data-v="del" aria-label="Wissen">⌫</button>'
        : k === 'ok' ? '<button class="ok ' + (goingIn ? 'in' : 'out') + '" data-act="k-ok"' + (K.code.length >= 6 && !K.busy ? '' : ' disabled') + '>' + (K.busy ? '…' : goingIn ? 'Inklokken' : 'Uitklokken') + '</button>'
        : '<button data-act="k-key" data-v="' + k + '">' + k + '</button>').join('') + '</div></div>';
  } else {
    const q = K.q.trim().toLowerCase();
    const people = K.info.people.filter(p => !q || p.name.toLowerCase().includes(q));
    const inside = K.info.people.filter(p => p.in).length;
    body = '<div class="kiosk-list"><div class="kiosk-bar"><h1>Tik op je naam</h1><span class="badge green">' + inside + ' binnen</span>' +
      (K.info.people.length > 12 ? '<input class="input" id="k-q" data-in="kq" type="search" placeholder="Zoek je naam" value="' + esc(K.q) + '" autocomplete="off">' : '') + '</div>' +
      '<div class="kiosk-grid">' + people.map(p => '<button class="kiosk-person' + (p.in ? ' in' : '') + '" data-act="k-sel" data-id="' + p.id + '">' + avatar(p.id, p.name, 'lg') +
        '<strong>' + esc(p.name) + '</strong><small>' + (p.in ? '<span class="live-dot"></span> Binnen sinds ' + esc(p.in) : p.shift ? 'Ingepland ' + esc(p.shift) : 'Niet ingeklokt') + '</small></button>').join('') + '</div></div>';
  }
  const pinNote = K.info && K.info.pinUntil ? '<div class="kiosk-pinnote" role="status">Tijdelijk mag je ook inklokken met je eigen pincode, tot ' + esc(pinDT(K.info.pinUntil)) + '.</div>' : '';
  return '<div class="kiosk">' + head + pinNote + '<main class="kiosk-main">' + body + '</main>' +
    '<footer class="kiosk-foot">Klokken met de code uit de CrewHarbor-app. Klopt er iets niet? Pas je uren aan in CrewHarbor of meld het bij je leidinggevende.</footer></div>';
}
let kioskTimer = null;
function kioskReset(delay) { clearTimeout(kioskTimer); kioskTimer = setTimeout(async () => { K.sel = null; K.code = ''; K.err = null; K.result = null; K.exit = null; await loadKiosk(); if (route() === 'klok') render(); }, delay); }
async function kioskSubmit() {
  if (K.busy || K.code.length < 8) return;
  K.busy = true; K.err = null; render();
  try {
    K.result = await svc('kiosk-clock', { token: kioskToken(), memberId: K.sel, code: K.code });
    K.busy = false; K.code = ''; render(); kioskReset(4500);
  } catch (e) {
    K.busy = false; K.code = ''; K.err = e.message;
    if (/uitgezet/.test(e.message)) { K.error = 'revoked'; K.info = null; }
    render(); kioskReset(30000);
  }
}
function kioskKey(k) {
  if (!K.sel || K.busy || K.result) return;
  if (k === 'del') K.code = K.code.slice(0, -1);
  else if (/^\d$/.test(k) && K.code.length < 8) K.code += k;
  K.err = null; render(); kioskReset(30000);
  if (K.code.length === 8) kioskSubmit();
}
document.addEventListener('keydown', e => {
  if (route() !== 'klok' || !K.sel) return;
  if (/^\d$/.test(e.key)) { kioskKey(e.key); e.preventDefault(); }
  else if (e.key === 'Backspace') { kioskKey('del'); e.preventDefault(); }
  else if (e.key === 'Enter') { kioskSubmit(); e.preventDefault(); }
  else if (e.key === 'Escape') { K.sel = null; K.code = ''; K.err = null; render(); }
});
setInterval(() => {
  if (route() !== 'klok') return;
  const t = document.getElementById('k-time'); if (t) t.textContent = kioskTime();
  const d = document.getElementById('k-date'); if (d) d.textContent = kioskDate();
}, 5000);
setInterval(async () => {
  if (route() !== 'klok' || K.sel || K.result || K.exit || document.activeElement && document.activeElement.id === 'k-q') return;
  await loadKiosk(); render();
}, 30000);

// ======================================================================
// Afwezigheid, beschikbaarheid en meldingen
// ======================================================================
const ABS_KINDS = [['verlof', 'Verlof'], ['bijzonder', 'Bijzonder verlof'], ['ziek', 'Ziek']];
const ABS_STATUS = { aangevraagd: ['Aangevraagd', 'orange'], goedgekeurd: ['Goedgekeurd', 'green'], afgewezen: ['Afgewezen', 'red'], ingetrokken: ['Ingetrokken', ''] };
function absCovers(a, d) {
  // een lopende ziekmelding tonen we tot en met vandaag
  const to = a.to || (a.kind === 'ziek' ? (d <= today() ? d : null) : a.from);
  return to && a.from <= d && d <= to;
}
function absFor(list, memberId, d) { return (list || []).find(a => same(a.memberId, memberId) && absCovers(a, d) && a.status !== 'afgewezen' && a.status !== 'ingetrokken'); }
function absChip(a) {
  const pending = a.status === 'aangevraagd';
  return '<span class="abs-chip ' + a.kind + (pending ? ' pending' : '') + '" title="' + esc(a.kindLabel + (pending ? ' (aangevraagd)' : '')) + '">' + esc(a.kindLabel) + (pending ? '?' : '') + '</span>';
}
function spanLabel(a) {
  if (!a.to) return 'vanaf ' + dayShort(a.from);
  return a.from === a.to ? dayShort(a.from) : dayShort(a.from) + ' t/m ' + dayShort(a.to);
}
function workdaysClient(f, t) { let n = 0; for (let d = f; d <= t; d = addDays(d, 1)) { const w = pd(d).getDay(); if (w > 0 && w < 6) n++; } return n; }

async function loadAbsences() {
  const boss = can('hours.approve'), team = boss || can('hours.plan') || can('hours.view_all');
  const [mine, pending, teamList] = await Promise.all([rpc('cd_absences', { p_scope: 'mine' }),
    boss ? rpc('cd_absences', { p_scope: 'pending' }) : Promise.resolve([]),
    team ? rpc('cd_absences', { p_scope: 'team', p_from: today(), p_to: addDays(today(), 60) }) : Promise.resolve(null)]);
  S.abs = { mine, pending, team: teamList, leave: await rpc('cd_leave_me').catch(() => null) };
  if (boss && !S.colleagues.length) await loadColleagues();
}
function absenceForm() {
  const E = S.absForm; const ziek = E.kind === 'ziek';
  const n = E.from && (E.to || !ziek) ? workdaysClient(E.from, E.to || E.from) : 0;
  return '<section class="card stack" style="gap:14px;max-width:none"><h2 style="margin:0">' + (ziek ? 'Ziek melden' : 'Verlof aanvragen') + '</h2>' +
    '<div class="seg" role="group" aria-label="Soort">' + ABS_KINDS.map(k => '<button data-act="abs-kind" data-v="' + k[0] + '" class="' + (E.kind === k[0] ? 'on' : '') + '" aria-pressed="' + (E.kind === k[0]) + '">' + k[1] + '</button>').join('') + '</div>' +
    (can('hours.approve') ? '<div class="field" style="max-width:360px"><label for="abs-who">Voor wie</label><select class="input" id="abs-who" data-abs="memberId"><option value="">Mezelf</option>' +
      S.colleagues.filter(u => !same(u.id, S.me.id)).map(u => '<option value="' + u.id + '"' + (same(E.memberId, u.id) ? ' selected' : '') + '>' + esc(u.name) + '</option>').join('') + '</select>' +
      '<span class="small muted">Voor iemand anders ingevoerd verlof is meteen goedgekeurd.</span></div>' : '') +
    '<div class="fields2" style="max-width:520px"><div class="field"><label for="abs-from">' + (ziek ? 'Ziek sinds' : 'Van') + '</label><input class="input" type="date" id="abs-from" data-abs="from" value="' + esc(E.from) + '"' + (ziek ? ' max="' + addDays(today(), 1) + '"' : '') + '></div>' +
    '<div class="field"><label for="abs-to">' + (ziek ? 'Tot en met <span class="muted" style="font-weight:400">(als je het al weet)</span>' : 'Tot en met') + '</label><input class="input" type="date" id="abs-to" data-abs="to" value="' + esc(E.to) + '" min="' + esc(E.from || '') + '"></div></div>' +
    (!ziek && n ? leaveHoursField(E, n) : '') +
    '<div class="field"><label for="abs-note">Toelichting <span class="muted" style="font-weight:400">(optioneel)</span></label><input class="input" id="abs-note" data-abs="note" maxlength="300" value="' + esc(E.note) + '" placeholder="' + (ziek ? 'Bijv. verwacht terug op maandag' : 'Bijv. vakantie Spanje') + '"></div>' +
    (ziek ? '<p class="small muted" style="margin:0">Je leidinggevende krijgt meteen een melding. Meld je weer beter zodra je kunt werken. <strong>Schrijf hier niet wat je hebt</strong>: je werkgever mag volgens de privacywet niet vastleggen welke ziekte je hebt.</p>' : '<p class="small muted" style="margin:0">Je leidinggevende krijgt een melding en keurt het verlof goed of af.</p>') +
    '<div class="form-foot"><button class="btn ghost" data-act="abs-cancel">Annuleren</button><button class="btn ' + (ziek ? 'danger' : 'primary') + '" data-act="abs-save">' + (ziek ? 'Ziek melden' : 'Aanvragen') + '</button></div></section>';
}
function sickCard(sick) {
  return '<section class="card sick-card"><div><strong>Je bent ziek gemeld sinds ' + esc(dayLong(sick.from).toLowerCase()) + '</strong><p class="small muted" style="margin:2px 0 0">Beterschap! Meld je beter zodra je weer kunt werken.</p></div>' +
    '<div class="row" style="align-items:flex-end"><div class="field"><label for="beter-date">Weer aan het werk op</label><input class="input" type="date" id="beter-date" value="' + today() + '" min="' + esc(sick.from) + '"></div>' +
    '<button class="btn primary" data-act="abs-beter" data-id="' + sick.id + '">Beter melden</button></div></section>';
}
function myAbsList(list) {
  if (!list.length) return '<div class="empty">Nog niets aangevraagd of gemeld.</div>';
  return '<div class="doc-list">' + list.map(a => {
    const st = ABS_STATUS[a.status] || [a.status, ''];
    const canCancel = a.status === 'aangevraagd' || (a.status === 'goedgekeurd' && a.kind !== 'ziek' && a.from > today());
    return '<div class="doc"><span class="abs-chip big ' + a.kind + '">' + esc(a.kindLabel) + '</span><div class="doc-main"><strong>' + esc(spanLabel(a)) + '</strong>' +
      '<span class="small muted">' + (a.to || a.kind !== 'ziek' ? a.workdays + (a.workdays === 1 ? ' werkdag' : ' werkdagen') + (a.hours != null ? ' · ' + hrsTxt(a.hours) : '') : 'loopt nog') + (a.cover ? ' · tekort ' + hrsTxt(a.coverHours) + ': ' + COVER[a.cover][0].toLowerCase() : '') + (a.note ? ' · ' + esc(a.note) : '') +
      (a.reviewedByName && a.status !== 'aangevraagd' && a.kind !== 'ziek' ? ' · ' + esc(st[0].toLowerCase()) + ' door ' + esc(a.reviewedByName) : '') + (a.rejectReason ? ': ' + esc(a.rejectReason) : '') + '</span></div>' +
      '<div class="doc-act"><span class="badge ' + st[1] + '">' + st[0] + '</span>' + (canCancel ? '<button class="btn small ghost" data-act="abs-cancel-item" data-id="' + a.id + '">Intrekken</button>' : '') + '</div></div>';
  }).join('') + '</div>';
}
function viewAbsence() {
  const A = S.abs; if (!A) return '';
  const sick = A.mine.find(a => a.kind === 'ziek' && a.status === 'goedgekeurd' && !a.to);
  const own = selfOn('selfLeave');
  let h = own ? '<header class="page-head"><div><h1>Verlof &amp; ziek</h1><p>Vraag verlof aan, meld je ziek en zie wie er de komende tijd weg is.</p></div>' +
    '<div class="actions">' + (sick ? '' : '<button class="btn" data-act="abs-new" data-v="ziek">Ziek melden</button>') + '<button class="btn primary" data-act="abs-new" data-v="verlof">' + ICON.plus + 'Verlof aanvragen</button></div></header>'
    : '<header class="page-head"><div><h1>Verlof</h1><p>Beoordeel aanvragen van je team en zie wie er de komende tijd weg is.</p></div></header>';
  if (sick && own) h += sickCard(sick);
  if (own) h += leaveSaldoCard();
  if (S.absForm) h += absenceForm();
  if (A.pending.length) {
    h += '<section class="stack" style="gap:10px;max-width:none"><div class="section-title"><h2>Aanvragen om te beoordelen</h2><span class="badge orange">' + A.pending.length + '</span></div>' +
      A.pending.map(a => '<div class="card abs-row"><div class="abs-main">' + avatar(a.memberId, a.memberName) + '<div><strong>' + esc(a.memberName) + '</strong> · ' + esc(a.kindLabel) +
        '<div class="small muted">' + esc(spanLabel(a)) + ' · ' + a.workdays + (a.workdays === 1 ? ' werkdag' : ' werkdagen') + (a.hours != null ? ' · ' + hrsTxt(a.hours) : '') + (a.note ? ' · ' + esc(a.note) : '') + '</div>' + leavePendingInfo(a) + '</div></div>' +
        (S.absReject === a.id
          ? '<div class="row" style="flex:1 1 320px"><input class="input" id="abs-reason" maxlength="300" placeholder="Reden van afwijzen"><button class="btn small ghost" data-act="abs-reject-cancel">Annuleren</button><button class="btn small danger" data-act="abs-reject" data-id="' + a.id + '">Afwijzen</button></div>'
          : '<div class="row"><button class="btn small" data-act="abs-reject-open" data-id="' + a.id + '">Afwijzen…</button><button class="btn small primary" data-act="abs-approve" data-id="' + a.id + '">Goedkeuren</button></div>') + '</div>').join('') + '</section>';
  }
  if (A.team) {
    const now = A.team.filter(a => absCovers(a, today()) && a.status === 'goedgekeurd');
    const soon = A.team.filter(a => a.from > today());
    h += '<div class="cards" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr))">' +
      '<section class="card"><h2>Vandaag afwezig</h2>' + (now.length ? '<div class="mini-list">' + now.map(a => '<div class="mini-row"><span>' + esc(a.memberName) + '</span>' + absChip(a) + '</div>').join('') + '</div>' : '<p class="small muted" style="margin:0">Iedereen is er.</p>') + '</section>' +
      '<section class="card"><h2>Komende 2 maanden</h2>' + (soon.length ? '<div class="mini-list">' + soon.map(a => '<div class="mini-row"><span>' + esc(a.memberName) + ' <span class="small muted">· ' + esc(spanLabel(a)) + '</span></span>' + absChip(a) + '</div>').join('') + '</div>' : '<p class="small muted" style="margin:0">Geen verlof gepland.</p>') + '</section></div>';
  }
  if (!own) return h + (A.pending.length || A.team ? '' : '<div class="empty">Er zijn nu geen aanvragen.</div>');
  h += '<section class="stack" style="gap:8px;max-width:none"><div class="section-title"><h2>Mijn verlof en ziekte</h2></div>' + myAbsList(A.mine);
  return h + '</section>';
}

async function loadAvailability() {
  const m = S.avMonth || monthStart(today()); S.avMonth = m;
  const [av, wk] = await Promise.all([rpc('cd_availability', { p_from: mondayOf(m), p_to: addDays(mondayOf(monthEnd(m)), 6) }),
    rpc('cd_roster_range', { p_from: mondayOf(m), p_to: addDays(mondayOf(monthEnd(m)), 6) })]);
  S.av = av; S.avRoster = wk;
  if (!S.avPatEdit) S.avPat = await rpc('cd_availability_pattern');
}
function avpSet(el) {
  const [wd, k] = el.dataset.avp.split('|');
  S.avPatEdit = S.avPatEdit || Object.fromEntries((S.avPat || []).map(x => [x.weekday, Object.assign({}, x)]));
  S.avPatEdit[wd] = Object.assign({ weekday: Number(wd), status: '' }, S.avPatEdit[wd], { [k]: el.value });
}
const WD = ['Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag', 'Zondag'];
const WD_SHORT = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];
function avPat() { return S.avPatEdit || Object.fromEntries((S.avPat || []).map(x => [x.weekday, Object.assign({}, x)])); }
let avpTimer = null;
function avpAutoSave() {
  clearTimeout(avpTimer);
  avpTimer = setTimeout(async () => {
    const P = S.avPatEdit || {};
    for (const wd of [1, 2, 3, 4, 5, 6, 7]) { const r = P[wd] || {}; if (r.status === 'kan' && (!!r.start !== !!r.end)) return; }
    try {
      S.avPat = await rpc('cd_availability_pattern_set', { p: [1, 2, 3, 4, 5, 6, 7].map(wd => ({ weekday: wd, status: (P[wd] || {}).status || '', start: (P[wd] || {}).start || '', end: (P[wd] || {}).end || '', note: (P[wd] || {}).note || '' })) });
      S.avPatEdit = null; await loadAvailability(); renderKeepFocus(); toast('Vaste week opgeslagen.');
    } catch (err) { toast(err.message, true); }
  }, 500);
}
function avPatternCard() {
  const P = avPat();
  const card = i => {
    const wd = i + 1, r = P[wd] || { status: '' }, st = r.status || '';
    return '<div class="avd ' + (st || 'leeg') + '"><strong>' + WD[i] + '</strong>' +
      '<div class="avd-opts" role="radiogroup" aria-label="' + WD[i] + '">' + [['kan', 'Kan'], ['kan_niet', 'Kan niet'], ['', 'Leeg']].map(o =>
        '<button role="radio" aria-checked="' + (st === o[0]) + '" class="' + (st === o[0] ? 'on ' : '') + (o[0] || 'leeg') + '" data-act="avp-st" data-v="' + wd + '|' + o[0] + '">' + o[1] + '</button>').join('') + '</div>' +
      (st === 'kan' ? '<div class="avd-times"><span class="muted">van</span><input class="input" type="time" aria-label="' + WD[i] + ' vanaf" data-avp="' + wd + '|start" value="' + esc(r.start || '') + '"><span class="muted">tot</span><input class="input" type="time" aria-label="' + WD[i] + ' tot" data-avp="' + wd + '|end" value="' + esc(r.end || '') + '"></div>' +
        '<span class="small muted">' + (r.start && r.end ? esc(r.start + ' – ' + r.end) : 'Hele dag') + '</span>'
        : '<span class="small muted">' + (st === 'kan_niet' ? 'Nooit op ' + WD[i].toLowerCase() : 'Niet ingevuld') + '</span>') + '</div>';
  };
  return '<section class="card stack" style="gap:14px;max-width:none"><div><h2 style="margin:0">Mijn vaste week</h2>' +
    '<p class="small muted" style="margin:4px 0 0">Wanneer kun je normaal werken? Dit geldt elke week. Laat de tijden leeg voor de hele dag. Wijzigingen worden meteen opgeslagen.</p></div>' +
    '<div class="avd-grid">' + [0, 1, 2, 3, 4, 5, 6].map(card).join('') + '</div>' +
    '<div class="row avd-presets"><span class="small muted">Snel:</span>' +
      '<button class="btn small ghost" data-act="avp-preset" data-v="werkdagen">Ma t/m vr hele dag</button>' +
      '<button class="btn small ghost" data-act="avp-preset" data-v="weekend-niet">Weekend kan niet</button>' +
      '<button class="btn small ghost" data-act="avp-preset" data-v="kopieer-ma">Maandag naar ma t/m vr</button>' +
      '<button class="btn small ghost" data-act="avp-preset" data-v="leeg">Alles leeg</button></div></section>';
}
function viewAvailability() {
  if (!S.av) return '';
  const tab = S.avTab || 'vast';
  let h = '<header class="page-head"><div><h1>Beschikbaarheid</h1><p>Geef aan wanneer je kunt werken. Wie het rooster maakt, ziet dit meteen.</p></div></header>';
  h += '<div class="seg" role="tablist">' + [['vast', 'Vaste week'], ['dagen', 'Losse dagen']].map(t => '<button role="tab" aria-selected="' + (tab === t[0]) + '" class="' + (tab === t[0] ? 'on' : '') + '" data-act="av-tab" data-v="' + t[0] + '">' + t[1] + '</button>').join('') + '</div>';
  if (tab === 'vast') return h + avPatternCard();
  const m = S.avMonth, last = monthEnd(m), from = mondayOf(m), to = addDays(mondayOf(last), 6);
  const sel = S.avSel || {};
  const nSel = Object.keys(sel).filter(k => sel[k]).length;
  const cur = monthStart(today());
  h += '<p class="small muted" style="margin:0">Wijkt een dag af van je vaste week, bijvoorbeeld door een toets of feestje? Tik op die dag(en) en kies daarna onderaan. Een losse dag gaat altijd voor je vaste week.</p>';
  h += '<div class="roster-bar"><div class="weeknav"><button class="icon-btn" data-act="av-month" data-v="' + addMonths(m, -1) + '" aria-label="Vorige maand">' + ICON.left + '</button>' +
    '<strong>' + monthLabel(m) + '</strong><button class="icon-btn" data-act="av-month" data-v="' + addMonths(m, 1) + '" aria-label="Volgende maand">' + ICON.right + '</button>' +
    (m !== cur ? '<button class="btn small ghost" data-act="av-month" data-v="' + cur + '">Naar deze maand</button>' : '') + '</div>' +
    '<div class="av-legend"><span><i class="kan"></i>Kan</span><span><i class="kan_niet"></i>Kan niet</span><span><i class="vast"></i>Uit vaste week</span><span><i class="los"></i>Losse dag</span></div></div>';
  h += '<div class="month av-month"><div class="month-head">' + WD_SHORT.map((d, i) => '<button class="av-wd" data-act="av-weekday" data-v="' + i + '" title="Kies elke ' + WD[i].toLowerCase() + ' van deze maand">' + d + '</button>').join('') + '</div><div class="month-grid">';
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const out = d < m || d > last, past = d < today();
    const a = S.av.find(x => x.date === d) || Object.assign({ vast: true }, (S.avRoster.availability || []).find(x => x.date === d && same(x.memberId, S.me.id) && x.source === 'vast') || { none: true });
    if (a.none) delete a.status;
    const ab = absFor(S.avRoster.absences, S.me.id, d);
    const sh = S.avRoster.shifts.filter(s => same(s.memberId, S.me.id) && s.date === d);
    h += '<button class="mday av' + (out ? ' out' : '') + (past ? ' past' : '') + (d === today() ? ' today' : '') + (sel[d] ? ' picked' : '') + (a.status ? ' ' + a.status + (a.vast ? ' vast' : ' los') : '') + '"' +
      (past || out ? ' disabled' : ' data-act="av-pick" data-v="' + d + '"') + ' aria-pressed="' + !!sel[d] + '">' +
      '<span class="mday-num">' + pd(d).getDate() + '</span>' +
      (a.status ? '<span class="av-state">' + (a.status === 'kan' ? (a.start ? esc(a.start + '–' + a.end) : 'Kan') : 'Kan niet') + '</span>' + (a.note ? '<span class="av-note">' + esc(a.note) + '</span>' : '') : '') +
      (ab ? absChip(ab) : '') + (sh.length ? '<span class="av-shift">Dienst ' + esc(sh[0].start + '–' + sh[0].end) + '</span>' : '') + '</button>';
  }
  h += '</div></div>';
  if (nSel) {
    const A = S.avEdit || { start: '', end: '', note: '' };
    h += '<section class="av-bar2" role="region" aria-label="Gekozen dagen"><div class="av-bar2-top"><strong>' + nSel + (nSel === 1 ? ' dag gekozen' : ' dagen gekozen') + '</strong><button class="link-btn" data-act="av-clear">Selectie wissen</button></div>' +
      '<div class="av-bar2-row"><div class="field"><label for="av-start">Vanaf</label><input class="input" type="time" id="av-start" data-av="start" value="' + esc(A.start) + '"></div>' +
        '<div class="field"><label for="av-end">Tot</label><input class="input" type="time" id="av-end" data-av="end" value="' + esc(A.end) + '"></div>' +
        '<div class="field" style="flex:1 1 160px"><label for="av-note">Notitie</label><input class="input" id="av-note" data-av="note" maxlength="120" value="' + esc(A.note) + '" placeholder="Bijv. school, sport"></div></div>' +
      '<div class="av-bar2-row"><button class="btn primary" data-act="av-set" data-v="kan">Kan werken</button><button class="btn" data-act="av-set" data-v="kan_niet">Kan niet</button><button class="btn ghost" data-act="av-set" data-v="">Terug naar vaste week</button>' +
        '<span class="small muted">Tijden leeg = hele dag.</span></div></section>';
  }
  return h;
}

function viewNotifications() {
  const N = S.notif; if (!N) return '';
  let h = '<header class="page-head"><div><h1>Meldingen</h1><p>Wijzigingen in je rooster, verlof en ziekmeldingen.</p></div></header>';
  if (!N.items.length) return h + '<div class="empty-state card"><strong>Geen meldingen</strong>Als er iets voor je verandert, zie je het hier.</div>';
  return h + '<div class="doc-list">' + N.items.map(n => '<button class="doc notif' + (S.notifUnreadIds && S.notifUnreadIds.has(n.id) ? ' unread' : '') + '" data-act="notif-open" data-id="' + n.id + '">' +
    '<span class="notif-ico ' + esc(n.kind) + '">' + (n.kind === 'rooster' ? NI.rooster : n.kind === 'ziek' || n.kind === 'verlof' ? NI.verlof : ICON.bell) + '</span>' +
    '<div class="doc-main"><strong>' + esc(n.text) + '</strong><span class="small muted">' + esc(fmtDate(n.at)) + '</span></div></button>').join('') + '</div>';
}

// ======================================================================
// Kennisbank
// ======================================================================
function md(src) {
  const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
  let out = '', list = null, para = [];
  const flushP = () => { if (para.length) { out += '<p>' + para.map(inline).join('<br>') + '</p>'; para = []; } };
  const flushL = () => { if (list) { out += '</' + list + '>'; list = null; } };
  String(src || '').replace(/\r/g, '').split('\n').forEach(raw => {
    const l = raw.replace(/\s+$/, ''); let m;
    if (!l.trim()) { flushP(); flushL(); return; }
    if ((m = l.match(/^(#{1,3})\s+(.*)$/))) { flushP(); flushL(); const n = m[1].length + 1; out += '<h' + n + '>' + inline(m[2]) + '</h' + n + '>'; return; }
    if ((m = l.match(/^\s*[-*]\s+(.*)$/))) { flushP(); if (list !== 'ul') { flushL(); out += '<ul>'; list = 'ul'; } out += '<li>' + inline(m[1]) + '</li>'; return; }
    if ((m = l.match(/^\s*\d+[.)]\s+(.*)$/))) { flushP(); if (list !== 'ol') { flushL(); out += '<ol>'; list = 'ol'; } out += '<li>' + inline(m[1]) + '</li>'; return; }
    flushL(); para.push(l);
  });
  flushP(); flushL();
  return out;
}
async function loadKb() {
  S.kb = await rpc('cd_kb_list', { p_q: S.kbQ.trim() || null, p_cat: S.kbCat || null });
  if (S.kbSel) { try { S.kbArticle = await rpc('cd_kb_get', { p_id: S.kbSel }); } catch (e) { S.kbSel = null; S.kbArticle = null; } }
}
function kbPanel() {
  const K = S.kb;
  if (S.kbEdit) {
    const E = S.kbEdit;
    return '<div class="stack" style="gap:14px;max-width:none"><div><span class="small muted">' + (E.id ? 'Artikel bewerken' : 'Nieuw artikel') + '</span></div>' +
      '<div class="field"><label for="kb-title">Titel *</label><input class="input" id="kb-title" data-kb="title" maxlength="160" value="' + esc(E.title) + '" placeholder="Bijv. Een retour verwerken"></div>' +
      '<div class="field"><label for="kb-cat">Categorie</label><input class="input" id="kb-cat" data-kb="category" maxlength="40" list="kb-cats" value="' + esc(E.category) + '" placeholder="Bijv. Klantenservice">' +
        '<datalist id="kb-cats">' + K.categories.map(c => '<option value="' + esc(c) + '">').join('') + '</datalist></div>' +
      '<div class="field"><label for="kb-body">Tekst</label><textarea class="input" id="kb-body" data-kb="body" rows="16" aria-describedby="kb-help">' + esc(E.body) + '</textarea>' +
        '<span class="small muted" id="kb-help">Opmaak: # Kop · ## Tussenkop · **vet** · regels die met - beginnen worden een lijst · 1. genummerde stappen · links worden vanzelf klikbaar.</span></div>' +
      '<label class="check"><input type="checkbox" id="kb-pin" data-kb-pin' + (E.pinned ? ' checked' : '') + '> Vastzetten bovenaan</label>' +
      '<div class="form-foot"><button class="btn ghost" data-act="kb-cancel">Annuleren</button><button class="btn primary" data-act="kb-save">' + (E.id ? 'Opslaan' : 'Publiceren') + '</button></div></div>';
  }
  const A = S.kbArticle;
  if (!A) return '<div class="empty-state"><strong>Kies een artikel</strong>Of zoek op een woord, bijvoorbeeld "retour" of "wachtwoord".</div>';
  return '<article class="stack" style="gap:12px;max-width:none"><div>' + (A.category ? '<span class="badge">' + esc(A.category) + '</span> ' : '') + (A.pinned ? '<span class="badge blue">' + ICON.pin + ' Vast</span>' : '') +
    '<h2 class="kb-title">' + esc(A.title) + '</h2><p class="small muted" style="margin:0">Bijgewerkt ' + esc(fmtDate(A.updatedAt)) + ' door ' + esc(A.updatedByName || 'onbekend') + '</p></div>' +
    '<div class="prose">' + (A.body.trim() ? md(A.body) : '<p class="muted">Dit artikel is nog leeg.</p>') + '</div>' +
    (A.canEdit ? '<div class="detail-section" style="flex-direction:row;flex-wrap:wrap"><button class="btn small" data-act="kb-edit">' + ICON.edit + 'Bewerken</button><button class="btn small danger" data-act="kb-del">' + ICON.trash + 'Verwijderen</button></div>' : '') + '</article>';
}
function viewKb() {
  const K = S.kb; if (!K) return '';
  let h = '<header class="page-head"><div><h1>Kennisbank</h1><p>Werkinstructies, afspraken en antwoorden op vaste vragen. Voor iedereen in ' + esc(S.org.name) + '.</p></div>' +
    (K.canEdit ? '<div class="actions"><button class="btn primary" data-act="kb-new">' + ICON.plus + 'Nieuw artikel</button></div>' : '') + '</header>';
  h += '<div class="search soft">' + ICON.search + '<label class="sr-only" for="kb-q">Zoeken in de kennisbank</label><input id="kb-q" type="search" data-in="kbq" value="' + esc(S.kbQ) + '" placeholder="Zoek in titels en tekst" autocomplete="off"></div>';
  if (K.categories.length) {
    h += '<div class="chips">' + [['', 'Alles']].concat(K.categories.map(c => [c, c])).map(c => '<button class="chip' + (S.kbCat === c[0] ? ' on' : '') + '" data-act="kb-cat" data-v="' + esc(c[0]) + '" aria-pressed="' + (S.kbCat === c[0]) + '">' + esc(c[1]) + '</button>').join('') + '</div>';
  }
  if (!K.articles.length && !S.kbQ && !S.kbCat && !S.kbEdit) {
    return h + '<div class="empty-state card"><strong>Nog geen artikelen</strong>' + (K.canEdit ? 'Schrijf het eerste, bijvoorbeeld hoe jullie een retour afhandelen of wie je belt bij storing.' : 'Zodra je teamleider iets schrijft, staat het hier.') + '</div>';
  }
  h += '<div class="split"><div class="list">' + (K.articles.length ? K.articles.map(a => '<button class="item' + (same(a.id, S.kbSel) && !S.kbEdit ? ' sel' : '') + '" data-act="kb-sel" data-id="' + a.id + '">' +
    '<span class="item-top"><span class="item-title">' + (a.pinned ? ICON.pin + ' ' : '') + esc(a.title) + '</span>' + (a.category ? '<span class="badge">' + esc(a.category) + '</span>' : '') + '</span>' +
    (a.excerpt.trim() ? '<span class="item-sub">' + esc(a.excerpt.trim()) + (a.excerpt.length >= 180 ? '…' : '') + '</span>' : '') +
    '<span class="item-meta">Bijgewerkt ' + esc(fmtDate(a.updatedAt)) + ' · ' + esc(a.updatedByName || '') + '</span></button>').join('') : '<div class="empty">Niets gevonden.</div>') +
    '</div><aside class="detail card" style="flex:2 1 460px">' + kbPanel() + '</aside></div>';
  return h;
}

// ======================================================================
// Documenten
// ======================================================================
async function loadDocs() {
  try { S.docs = await rpc('cd_docs', { p_folder: S.docFolder || null }); }
  catch (e) { if (S.docFolder) { S.docFolder = null; S.docs = await rpc('cd_docs', { p_folder: null }); toast(e.message, true); } else throw e; }
}
function fmtSize(b) { if (b < 1024) return b + ' B'; if (b < 1048576) return Math.round(b / 1024) + ' KB'; return (b / 1048576).toFixed(1).replace('.', ',') + ' MB'; }
function extOf(n) { const m = String(n).match(/\.([A-Za-z0-9]+)$/); return m ? m[1].toUpperCase().slice(0, 4) : 'BESTAND'; }
function folderForm() {
  const E = S.folderEdit; const D = S.docs;
  return '<section class="card stack" style="gap:14px"><h2 style="margin:0">' + (E.id ? 'Map bewerken' : 'Nieuwe map') + '</h2>' +
    '<div class="field"><label for="fo-name">Naam</label><input class="input" id="fo-name" data-fo="name" maxlength="60" value="' + esc(E.name) + '" placeholder="Bijv. Handboeken"></div>' +
    '<fieldset class="perm-group"><legend class="legend" style="padding:0 4px">Wie mag deze map zien?</legend>' +
      D.roles.map(r => '<label class="check"><input type="checkbox" data-fo-role="' + r.id + '"' + (E.roleIds.some(x => same(x, r.id)) ? ' checked' : '') + '> ' + esc(r.name) + '</label>').join('') +
      '<span class="small muted">Niets aangevinkt = iedereen. De eigenaar en mensen met het recht "Mappen en documenten beheren" zien altijd alles.</span></fieldset>' +
    '<div class="form-foot">' + (E.id ? '<button class="btn danger small" data-act="fo-del" style="margin-right:auto">' + ICON.trash + 'Map verwijderen</button>' : '') +
      '<button class="btn small ghost" data-act="fo-cancel">Annuleren</button><button class="btn primary small" data-act="fo-save">' + (E.id ? 'Opslaan' : 'Map maken') + '</button></div></section>';
}
function viewDocs() {
  const D = S.docs; if (!D) return '';
  const F = D.folder;
  const access = f => f.roleIds.length ? 'Alleen ' + f.roleNames.join(', ') : 'Iedereen';
  let h = '<header class="page-head"><div>' + (F ? '<nav class="crumbs" aria-label="Kruimelpad"><a href="#/documenten" data-act="doc-folder" data-v="">Documenten</a> / </nav>' : '') +
    '<h1>' + (F ? esc(F.name) : 'Documenten') + '</h1><p>' + (F ? 'Zichtbaar voor: ' + esc(access(D.folders.find(x => same(x.id, F.id)) || { roleIds: F.roleIds, roleNames: [] })) : 'Handboeken, formulieren en afspraken. Per map bepaal je wie erbij kan.') + '</p></div>' +
    '<div class="actions">' + (F && D.canManage ? '<button class="btn" data-act="fo-edit" data-id="' + F.id + '">' + ICON.edit + 'Map bewerken</button>' : '') +
    (!F && D.canManage ? '<button class="btn" data-act="fo-new">' + ICON.plus + 'Nieuwe map</button>' : '') +
    (D.canUpload ? '<label class="btn primary upload-btn">' + ICON.upload + 'Uploaden<input type="file" multiple data-in="upload" class="sr-only"></label>' : '') + '</div></header>';
  if (S.uploading) h += '<div class="alert info" role="status"><span>' + esc(S.uploading) + '</span></div>';
  if (S.folderEdit) h += folderForm();
  if (!F) {
    h += '<div class="folders">' + D.folders.map(f => '<button class="folder" data-act="doc-folder" data-v="' + f.id + '">' + ICON.folder +
      '<span><strong>' + esc(f.name) + '</strong><small>' + f.count + (f.count === 1 ? ' document' : ' documenten') + ' · ' + esc(access(f)) + '</small></span></button>').join('') + '</div>';
  }
  h += '<section class="stack" style="gap:8px;max-width:none"><div class="section-title"><h2>' + (F ? 'In deze map' : 'Algemeen') + '</h2>' + (!F ? '<span class="small muted">Voor iedereen zichtbaar</span>' : '') + '</div>';
  if (!D.docs.length) {
    h += '<div class="empty">' + (D.canUpload ? 'Nog geen documenten. Klik op Uploaden om er een toe te voegen (maximaal 20 MB per bestand).' : 'Nog geen documenten.') + '</div>';
  } else {
    h += '<div class="doc-list">' + D.docs.map(d => '<div class="doc"><span class="doc-ext">' + esc(extOf(d.name)) + '</span>' +
      '<div class="doc-main"><strong>' + esc(d.name) + '</strong><span class="small muted">' + fmtSize(d.size) + ' · ' + esc(d.uploadedByName || '') + ' · ' + esc(fmtDate(d.createdAt)) + '</span></div>' +
      '<div class="doc-act"><button class="btn small" data-act="doc-dl" data-id="' + d.id + '">' + ICON.download + 'Downloaden</button>' +
      (d.canDelete ? '<button class="icon-btn small" data-act="doc-del" data-id="' + d.id + '" aria-label="' + esc(d.name) + ' verwijderen">' + ICON.trash + '</button>' : '') + '</div></div>').join('') + '</div>';
  }
  return h + '</section>';
}
async function uploadFiles(files) {
  const D = S.docs; const folder = D && D.folder ? D.folder.id : null;
  let ok = 0; const fails = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    S.uploading = 'Bezig met uploaden (' + (i + 1) + ' van ' + files.length + '): ' + f.name; render();
    let prep = null;
    try {
      prep = await rpc('cd_doc_prepare', { p_folder: folder, p_name: f.name, p_size: f.size, p_mime: f.type || '' });
      const { error } = await sb.storage.from('crewdeck').upload(prep.path, f, { contentType: f.type || 'application/octet-stream', upsert: false });
      if (error) throw new Error('Uploaden mislukt: ' + error.message);
      await rpc('cd_doc_confirm', { p_id: prep.id });
      ok++;
    } catch (e) {
      fails.push(f.name + ': ' + e.message);
      if (prep) { try { await rpc('cd_doc_delete', { p_id: prep.id }); } catch (err) { /* */ } }
    }
  }
  S.uploading = null;
  await loadDocs(); render();
  if (fails.length) toast((ok ? ok + ' geüpload, ' + fails.length + ' niet. ' : '') + fails.join(' · '), true); else toast(ok === 1 ? 'Document geüpload.' : ok + ' documenten geüpload.');
}

// ---------- formulieren inloggen / registreren ----------
$app.addEventListener('submit', async e => {
  const f = e.target.closest('form[data-form]');
  if (!f) return;
  e.preventDefault(); unlockAudio();
  if (f.dataset.form === 'kiosk-exit') {
    const legacy = !!(K.exit && K.exit.legacy);
    const name = f.elements.name.value.trim(), code = f.elements.code.value, revoke = f.elements.revoke.checked;
    K.exit = { name, revoke, legacy, busy: true }; render();
    try {
      const d = await svc('kiosk-exit', legacy ? { token: kioskToken(), name, code: code.trim(), revoke } : { token: kioskToken(), email: name.toLowerCase(), password: code, revoke });
      await sb.auth.setSession(d.session);
      if (d.revoked) { try { localStorage.removeItem('crewdeck-kiosk'); } catch (err) { /* */ } }
      clearTimeout(kioskTimer); K.exit = null; K.info = null;
      if (!(await enterApp())) return;
      toast(d.revoked ? 'Prikklok uitgezet. Je bent ingelogd.' : 'Je bent ingelogd. De prikklok open je weer via Uren → Prikklok.');
    } catch (err) {
      K.exit = { name, revoke, legacy, err: err.message }; render();
      const c = document.getElementById('kx-code'); if (c) c.focus();
    }
    return;
  }
  const btn = f.querySelector('button[type=submit]');
  if (btn) btn.disabled = true;
  try {
    if (f.dataset.form === 'login') {
      const company = f.elements.company.value.trim().toLowerCase(), name = f.elements.name.value.trim(), code = f.elements.code.value.trim();
      if (!company || !name || !code) throw new Error('Vul je bedrijfscode, naam en code in.');
      const d = await svc('login', { company, name, code });
      await sb.auth.setSession(d.session);
      try { localStorage.setItem('crewdeck-company', company); } catch (err) { /* */ }
    } else if (f.dataset.form === 'request') {
      const v = k => (f.elements[k] ? f.elements[k].value.trim() : '');
      const email = v('email');
      await svc('request', { company: v('company'), contactName: v('contactName'), email, phone: v('phone'), employees: v('employees'), message: v('message'), website: v('website') });
      S.requestSent = email; S.authError = null; render();
      return;
    } else {
      const v = k => (f.elements[k] ? f.elements[k].value.trim() : '');
      const pr = window.CHMFA.passwordProblem(f.elements.password.value, v('email')); if (pr) throw new Error(pr);
      const d = await svc('register', { orgName: v('orgName'), slug: v('slug').toLowerCase(), ownerName: v('ownerName'), email: v('email').toLowerCase(), password: f.elements.password.value, website: v('website') });
      if (d.session) await sb.auth.setSession(d.session);
      try { localStorage.setItem('crewharbor-email', v('email').toLowerCase()); } catch (err) { /* */ }
      toast('Welkom bij CrewHarbor! Je bedrijf staat klaar.');
    }
    await enterApp();
  } catch (err) {
    S.authError = err.message;
    const vals = {}; [...f.elements].forEach(el => { if (el.id && el.type !== 'password') vals[el.id] = el.value; });
    render();
    Object.keys(vals).forEach(id => { const el = document.getElementById(id); if (el) el.value = vals[id]; });
    const c = document.querySelector('input[type=password]'); if (c) c.focus();
  }
});

// ---------- invoer ----------
let searchTimer, similarTimer, dupTimer, cbqTimer, logTimer;
$app.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset.f && S.F) { S.F[el.dataset.f] = el.value; S.F.serverError = null; if (el.dataset.f === 'order' || el.dataset.f === 'phone') checkDup(); return; }
  if (el.dataset.pw && S.pinNew) { S.pinNew[el.dataset.pw] = el.value; return; }
  if (el.dataset.t && S.T) { S.T[el.dataset.t] = el.value; S.T.serverError = null; if (el.dataset.t === 'title') checkSimilar(); return; }
  if (el.dataset.in === 'q') { S.q = el.value; runSearch(); }
  if (el.dataset.in === 'cbq') {
    S.cbQ = el.value; clearTimeout(cbqTimer);
    cbqTimer = setTimeout(async () => {
      try {
        S.cbResults = S.cbQ.trim().length >= 2 ? await rpc('cd_callback_search', { p_q: S.cbQ.trim() }) : null;
        const list = S.cbResults || S.cbList;
        if (!list.some(c => same(c.id, S.cbSel))) S.cbSel = list.length ? list[0].id : null;
        renderKeepFocus();
      } catch (err) { toast(err.message, true); }
    }, 250);
  }
  if (el.dataset.h && S.hEdit) {
    S.hEdit[el.dataset.h] = el.value;
    if (['start', 'end', 'breakMin'].includes(el.dataset.h)) { const box = el.closest('.entry-form'); if (box) { const p = box.querySelector('p.small'); const E = S.hEdit;
      const txt = E.start && E.end && E.start !== E.end ? 'Totaal: <strong>' + fmtHM(Math.max(0, spanMin(E.start, E.end) - (Number(E.breakMin) || 0))) + '</strong>' + (E.end < E.start ? ' (loopt door na middernacht)' : '') : '';
      if (p) p.innerHTML = txt; else if (txt) box.querySelector('.form-foot').insertAdjacentHTML('beforebegin', '<p class="small muted" style="margin:0">' + txt + '</p>'); } }
    return;
  }
  if (el.dataset.sh && S.shiftEdit) { S.shiftEdit[el.dataset.sh] = el.value; return; }
  if (el.dataset.kb && S.kbEdit) { S.kbEdit[el.dataset.kb] = el.value; return; }
  if (el.dataset.fo && S.folderEdit) { S.folderEdit.name = el.value; return; }
  if (el.dataset.off && S.offboard && !['reason', 'mode'].includes(el.dataset.off)) { S.offboard[el.dataset.off] = el.value; return; }
  if (el.dataset.abs && S.absForm) { S.absForm[el.dataset.abs] = el.value; return; }
  if (el.dataset.av) { S.avEdit = S.avEdit || { start: '', end: '', note: '' }; S.avEdit[el.dataset.av] = el.value; return; }
  if (el.dataset.br) {
    S.brEdit = S.brEdit || JSON.parse(JSON.stringify(breakRules()));
    const [k, i, f] = el.dataset.br.split('|'); const v = Number(String(el.value).replace(',', '.'));
    if (isFinite(v)) { if (f === 'from') S.brEdit[k][i].fromMin = Math.round(v * 60); else S.brEdit[k][i].breakMin = Math.round(v); }
    const b = document.querySelector('[data-act="br-save"]'); if (b) b.disabled = false; return;
  }
  if (el.dataset.avp) { avpSet(el); return; }
  if (el.dataset.in === 'lvweeks') { S.lvWeeks = Number(el.value) || 4; render(); return; }
  if (el.dataset.in === 'lvnew') { const h = Number(String(el.value).trim().replace(',', '.')), out = document.getElementById('lv-prev'), wk = S.lvWeeks || 4;
    if (out) out.textContent = h > 0 && h <= 60 ? '= ' + String(Math.round(wk * h * 100) / 100).replace('.', ',') + ' uur verlof per jaar (' + String(Math.round(wk * h / 8 * 10) / 10).replace('.', ',') + ' dagen van 8 uur)' : ''; return; }
  if (el.dataset.tpl) { S.tplEdit = S.tplEdit || { name: '', start: '', end: '', note: '' }; S.tplEdit[el.dataset.tpl] = el.value; return; }
  if (el.dataset.in === 'kq') { K.q = el.value; renderKeepFocus(); return; }
  if (el.dataset.in === 'kbq') { S.kbQ = el.value; clearTimeout(logTimer); logTimer = setTimeout(async () => { try { await loadKb(); renderKeepFocus(); } catch (err) { toast(err.message, true); } }, 300); }
  if (el.dataset.in === 'tarcq') { S.tArcQ = el.value; renderKeepFocus(); return; }
  if (el.dataset.in === 'mq') { S.mq = el.value; renderKeepFocus(); return; }
  if (el.dataset.in === 'logq') { S.logQ = el.value; clearTimeout(logTimer); logTimer = setTimeout(async () => { try { await loadLog(); renderKeepFocus(); } catch (err) { toast(err.message, true); } }, 300); }
});
$app.addEventListener('change', async e => {
  const el = e.target;
  if (el.dataset.f && S.F) { S.F[el.dataset.f] = el.value; if (el.dataset.f === 'colleague') render(); }
  if (el.dataset.t && S.T) { S.T[el.dataset.t] = el.value; if (el.dataset.rerender) render(); }
  if (el.dataset.in === 'loguser') { S.logUser = el.value; try { await loadLog(); render(); } catch (err) { toast(err.message, true); } }
  if (el.dataset.actChange === 'm-role-new') { const n = document.getElementById('m-name').value; S.mNewRole = el.value; render(); document.getElementById('m-name').value = n; }
  if (el.dataset.off === 'mode' && S.offboard) { S.offboard.mode = el.value; const n = document.getElementById('off-note'); if (n) S.offboard.note = n.value;
    if (el.value === 'now' && S.offboard.date > today()) S.offboard.date = today(); render(); }
  if (el.dataset.off === 'reason' && S.offboard) { S.offboard.reason = el.value; const n = document.getElementById('off-note'); if (n) S.offboard.note = n.value; render(); }
  if (el.dataset.mode !== undefined && el.checked) {
    try { await rpc('cd_clock_mode', { p_mode: el.value }); S.org.settings.clock_mode = el.value; S.kiosks.mode = el.value; toast(el.value === 'prikklok' ? 'Inklokken kan nu alleen nog bij de prikklok.' : 'Inklokken kan weer ook in de app.'); }
    catch (err) { toast(err.message, true); }
    render(); return;
  }
  if (el.id === 'ac-photo' && el.files && el.files[0]) { await setPhoto(el.files[0]); el.value = ''; return; }
  if (el.id === 'pres-me') {
    try { S.presence = await rpc('cd_presence_set', { p_status: el.value }); toast('Je status is nu: ' + PRES[el.value][0] + '.'); } catch (err) { toast(err.message, true); }
    const pr = document.getElementById('presence'); if (pr) pr.outerHTML = viewPresence(); return;
  }
  if (el.dataset.sh && S.shiftEdit) { S.shiftEdit[el.dataset.sh] = el.value; if (el.dataset.rerender) render(); }
  if (el.dataset.in === 'rowho') { S.rosterWho = el.value; render(); }
  if (el.dataset.in === 'mrole' || el.dataset.in === 'mct') { S.mFilter = Object.assign({}, S.mFilter, { [el.dataset.in === 'mrole' ? 'role' : 'ct']: el.value }); render(); }
  if (el.dataset.avp) { avpSet(el); avpAutoSave(); }
  if (el.dataset.brAuto !== undefined) { S.brEdit = S.brEdit || JSON.parse(JSON.stringify(breakRules())); S.brEdit.auto = el.checked; render(); }
  if (el.dataset.in === 'rocompare') { S.rosterCompare = el.checked; render(); }
  if (el.dataset.abs && S.absForm) { S.absForm[el.dataset.abs] = el.value; if (el.dataset.abs === 'from' && S.absForm.to && S.absForm.to < el.value) S.absForm.to = el.value; if (['from', 'to', 'memberId', 'hours'].includes(el.dataset.abs)) render(); }
  if (el.dataset.h && S.hEdit) S.hEdit[el.dataset.h] = el.value;
  if (el.dataset.hc && S.hCorr) S.hCorr[el.dataset.hc] = el.value;
  if (el.dataset.kbPin !== undefined && S.kbEdit) S.kbEdit.pinned = el.checked;
  if (el.dataset.foRole && S.folderEdit) { const id = el.dataset.foRole; S.folderEdit.roleIds = S.folderEdit.roleIds.filter(x => !same(x, id)); if (el.checked) S.folderEdit.roleIds.push(id); }
  if (el.dataset.psel) { if (el.checked) delete S.pOff[el.dataset.psel]; else S.pOff[el.dataset.psel] = true; render(); }
  if (el.dataset.in === 'upload' && el.files && el.files.length) { const files = [...el.files]; el.value = ''; uploadFiles(files); }
  if (el.dataset.actChange === 'm-ctype') { const hrs = document.getElementById('m-chours'); if (hrs) { hrs.disabled = el.value === 'flex'; hrs.placeholder = el.value === 'flex' ? 'Niet van toepassing' : 'Bijv. 32'; if (el.value === 'flex') hrs.value = ''; } }
  if (el.dataset.actChange === 'm-role-edit') { const box = document.getElementById('m-perms'); if (box) box.innerHTML = permSummary(el.value); }
});
function runSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    const q = S.q.trim();
    if (!q.split(/[^0-9A-Za-zÀ-ÿ]+/).some(w => w.length >= 3)) S.results = null;
    else { try { S.results = await rpc('cd_task_search', { p_q: q }); } catch (err) { toast(err.message, true); } }
    const box = document.getElementById('search-results'); if (box) box.innerHTML = viewResults();
  }, 250);
}
function checkSimilar() {
  clearTimeout(similarTimer);
  similarTimer = setTimeout(async () => {
    if (!S.T) return;
    const q = S.T.title.trim();
    if (q.length < 3) S.T.similar = null; else { try { S.T.similar = await rpc('cd_task_search', { p_q: q }); } catch (err) { /* stil */ } }
    const box = document.getElementById('similar'); if (box) box.innerHTML = viewSimilar();
  }, 400);
}
function checkDup() {
  clearTimeout(dupTimer);
  dupTimer = setTimeout(async () => {
    if (!S.F) return;
    try { S.dup = await rpc('cd_callback_check', { p_order: S.F.order, p_phone: S.F.phone, p_exclude: S.F.editId || null }); } catch (err) { S.dup = null; }
    const box = document.getElementById('dup'); if (box) box.innerHTML = viewDup();
  }, 400);
}

// ---------- slepen op het teambord ----------
let dragId = null;
$app.addEventListener('dragstart', e => {
  const card = e.target.closest('[data-drag]'); if (!card) return;
  dragId = Number(card.dataset.drag); e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', String(dragId)); } catch (err) { /* */ }
  card.classList.add('dragging');
});
$app.addEventListener('dragend', e => {
  const card = e.target.closest('[data-drag]'); if (card) card.classList.remove('dragging');
  document.querySelectorAll('.col.over').forEach(c => c.classList.remove('over')); dragId = null;
});
$app.addEventListener('dragover', e => {
  const col = e.target.closest('[data-drop]'); if (!col || dragId == null) return;
  e.preventDefault();
  document.querySelectorAll('.col.over').forEach(c => { if (c !== col) c.classList.remove('over'); });
  col.classList.add('over');
});
$app.addEventListener('drop', async e => {
  const col = e.target.closest('[data-drop]'); if (!col || dragId == null) return;
  e.preventDefault();
  const id = dragId; dragId = null; col.classList.remove('over');
  const target = col.dataset.drop;
  const from = (S.team || []).find(c => c.callbacks.some(x => same(x.id, id)));
  if (from && (from.user ? String(from.user.id) : 'pool') === target) return;
  try {
    await rpc('cd_callback_action', { p_id: id, p_action: 'assign', p_text: null, p_assignee: target });
    const col2 = S.team.find(c => c.user && same(c.user.id, target));
    toast('Verplaatst naar ' + (target === 'pool' ? 'de open pool' : col2.user.name) + '.');
    S.quiet = true;
    try { await loadRoute(); } finally { S.quiet = false; }
    render();
  } catch (err) { toast(err.message, true); }
});
$app.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches && e.target.matches('.mini[data-act="team-open"]')) e.target.click(); });

// ---------- knoppen ----------
const linesOf = id => document.getElementById(id).value.split('\n').map(s => s.trim()).filter(Boolean);
$app.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const act = el.dataset.act;
  const raw = el.dataset.id;
  const num = raw != null ? Number(raw) : null;
  try {
    switch (act) {
      case 'logout': await sb.auth.signOut(); S.me = null; S.seen = null; S.authError = null; location.hash = '#/login'; render(); return;
      case 'sound': prefs.sound = !prefs.sound; savePrefs(); unlockAudio(); if (prefs.sound) beep(); render(); return;
      case 'notif-allow': await Notification.requestPermission(); render(); return;
      case 'go-pool': S.cbTab = 'pool'; return;
      case 'hidecode': S.shownCode = null; render(); return;
      case 'k-exit-mode': K.exit = Object.assign({}, K.exit, { legacy: !(K.exit && K.exit.legacy), err: null, name: '' }); render(); return;
      case 'nav-group': {
        if (el.dataset.locked) return;
        const g = el.closest('.nav-group'); const open = g.classList.toggle('open');
        el.setAttribute('aria-expanded', String(open));
        // maar één groep tegelijk open (de groep van de huidige pagina blijft altijd open)
        if (open) g.parentElement.querySelectorAll('.nav-group.open').forEach(o => {
          const b = o.querySelector('.nav-group-btn'); if (o === g || b.dataset.locked) return;
          o.classList.remove('open'); b.setAttribute('aria-expanded', 'false');
        });
        prefs.navOpen = open ? { [el.dataset.v]: true } : {}; delete prefs.navClosed; savePrefs();
        return;
      }
      case 'menu': { const nav = el.closest('.nav'); const open = nav.classList.toggle('open'); el.setAttribute('aria-expanded', String(open)); el.textContent = open ? 'Sluiten' : 'Menu'; return; }

      case 'cb-tab': S.cbTab = el.dataset.v; S.cbSel = null; await loadCallbacks(); render(); return;
      case 'cb-sel': S.cbSel = num; render(); return;
      case 'cb-clearq': S.cbQ = ''; S.cbResults = null; S.cbSel = null; await loadCallbacks(); render(); return;
      case 'cb-edit': S.edit = { kind: 'cb', id: num }; go('verzoek'); return;
      case 'cb-quick': {
        const inp = document.getElementById('cb-note'); const v = el.dataset.v;
        inp.value = inp.value.trim() ? (inp.value.includes(v) ? inp.value : inp.value.trim() + ' · ' + v) : v; inp.focus(); return;
      }
      case 'cb-claim': await rpc('cd_callback_action', { p_id: num, p_action: 'claim' }); toast('Opgepakt. Het staat nu in jouw lijst.'); break;
      case 'cb-reopen': await rpc('cd_callback_action', { p_id: num, p_action: 'reopen' }); toast('Weer opengezet.'); break;
      case 'cb-done': await rpc('cd_callback_action', { p_id: num, p_action: 'done', p_text: (document.getElementById('cb-note') || {}).value || '' }); toast('Afgerond. Goed gedaan!'); break;
      case 'cb-attempt': {
        const note = (document.getElementById('cb-note') || {}).value || '';
        await rpc('cd_callback_action', { p_id: num, p_action: 'attempt', p_text: note ? 'Niet bereikt · ' + note : 'Niet bereikt' }); toast('Belpoging genoteerd.'); break;
      }
      case 'cb-assign': {
        const v = document.getElementById('cb-assign').value;
        await rpc('cd_callback_action', { p_id: num, p_action: 'assign', p_assignee: v }); toast(v === 'pool' ? 'Terug in de open pool.' : 'Toegewezen.'); break;
      }
      case 'cb-topool': await rpc('cd_callback_action', { p_id: num, p_action: 'assign', p_assignee: 'pool' }); toast('Terug in de open pool.'); break;

      case 'f-type': S.F.type = el.dataset.v; render(); return;
      case 'f-assign': S.F.assign = el.dataset.v; render(); return;
      case 'f-delete':
        if (!confirm('Dit verzoek definitief verwijderen? Dit kan niet ongedaan worden gemaakt.')) return;
        await rpc('cd_callback_delete', { p_id: S.F.editId }); toast('Verzoek verwijderd.'); S.cbSel = null; go('terugbellen'); return;
      case 'f-save': {
        const F = S.F; F.tried = true;
        if (Object.keys(cbMissing(F)).length) { render(); window.scrollTo(0, 0); return; }
        F.saving = true; render();
        const body = { type: F.type, company: F.company, contact: F.contact, name: F.name, phone: F.phone, email: F.email, order: F.order, category: F.category,
          priority: F.priority, dueAt: inputToIso(F.dueAt), note: F.note, assignee: F.assign === 'colleague' ? F.colleague : F.assign };
        try {
          const c = await rpc('cd_callback_save', { p_id: F.editId || null, p: body });
          toast(F.editId ? 'Wijzigingen opgeslagen.' : (c.assigneeName ? 'Verzoek opgeslagen voor ' + (same(c.assignee, S.me.id) ? 'jou' : c.assigneeName) + '.' : 'Verzoek in de open pool gezet.'));
          S.cbQ = ''; S.cbResults = null;
          S.cbTab = same(c.assignee, S.me.id) ? 'mine' : (c.assignee ? (can('callbacks.view_all') ? 'all' : 'mine') : 'pool');
          S.cbSel = c.id; S.quiet = true; go('terugbellen');
        } catch (err) { F.saving = false; F.serverError = err.message; F.tried = false; render(); window.scrollTo(0, 0); }
        return;
      }

      case 't-view': S.tView = el.dataset.v; S.tWho = 'ALL'; await loadTasks(); render(); return;
      case 't-who': S.tWho = el.dataset.v; render(); return;
      case 't-search': S.searchOpen = !S.searchOpen; S.q = ''; S.results = null; render(); if (S.searchOpen) document.getElementById('t-q').focus(); return;
      case 't-edit': S.edit = { kind: 'task', id: num }; go('taak'); return;
      case 't-reopen': await rpc('cd_task_reopen', { p_id: num }); await loadTasks(); render(); toast('De taak staat weer open bij iedereen.'); return;
      case 't-toggle': await rpc('cd_task_action', { p_id: num, p_action: 'toggle' }); break;
      case 't-archive': await rpc('cd_task_action', { p_id: num, p_action: 'archive' }); toast('Gearchiveerd.'); break;
      case 't-restore': await rpc('cd_task_action', { p_id: num, p_action: 'restore' }); toast('Teruggezet.'); break;
      case 't-archive-all': {
        const ids = S.tasks.filter(t => !t.archived && (t.done || t.mineDone)).map(t => t.id);
        for (const tid of ids) await rpc('cd_task_action', { p_id: tid, p_action: 'archive' });
        toast(ids.length === 1 ? '1 taak gearchiveerd.' : ids.length + ' taken gearchiveerd.'); break;
      }
      case 't-archive-toggle': S.showArchive = !S.showArchive; render(); return;
      case 't-person': S.T.sel[raw] = !S.T.sel[raw]; render(); return;
      case 't-allpeople': {
        const allOn = S.colleagues.every(u => S.T.sel[u.id]);
        S.T.sel = {}; if (!allOn) S.colleagues.forEach(u => { S.T.sel[u.id] = true; });
        render(); return;
      }
      case 't-mode': S.T.mode = el.dataset.v; render(); return;
      case 't-delete':
        if (!confirm('Deze taak definitief verwijderen? Dit kan niet ongedaan worden gemaakt.')) return;
        await rpc('cd_task_delete', { p_id: S.T.editId }); toast('Taak verwijderd.'); go('taken'); return;
      case 't-save': {
        const T = S.T; T.tried = true;
        if (Object.keys(taskErrors(T)).length) { render(); window.scrollTo(0, 0); return; }
        const chosen = Object.keys(T.sel).filter(k => T.sel[k]);
        T.saving = true; render();
        try {
          await rpc('cd_task_save', { p_id: T.editId || null, p: { title: T.title, desc: T.desc, dueAt: inputToIso(T.dueAt), priority: T.priority, assignees: chosen, mode: T.mode, repeat: T.repeat } });
          toast(T.editId ? 'Wijzigingen opgeslagen.' : 'Taak aangemaakt.');
          if (!T.editId) S.tView = chosen.some(id => same(id, S.me.id)) || !can('tasks.view_all') ? 'mine' : 'all';
          S.quiet = true; go('taken');
        } catch (err) { T.saving = false; T.serverError = err.message; T.tried = false; render(); window.scrollTo(0, 0); }
        return;
      }

      case 'team-refresh': await loadRoute(); render(); toast('Bijgewerkt.'); return;
      case 'team-open': S.cbTab = can('callbacks.view_all') ? 'all' : 'mine'; S.cbQ = ''; S.cbResults = null; S.cbSel = num; go('terugbellen'); return;
      case 'stat-days': S.statDays = Number(el.dataset.v); S.stats = await rpc('cd_stats', { p_days: S.statDays }); render(); return;

      // uren
      case 'clock-in': await rpc('cd_hours_clock', { p_action: 'in' }); toast('Ingeklokt. Fijne dienst!'); break;
      case 'clock-out': { const e2 = await rpc('cd_hours_clock', { p_action: 'out' }); toast('Uitgeklokt: ' + fmtHM(e2.minutes) + ' gewerkt. Vergeet je pauze niet in te vullen.'); break; }
      case 'h-week': S.hWeek = el.dataset.v; S.hEdit = null; await loadHours(); render(); return;
      case 'h-me': S.hMember = null; S.hEdit = null; await loadHours(); render(); return;
      case 'h-add': {
        const d = el.dataset.v; const sh = S.hours.shifts.find(x => x.date === d);
        S.hEdit = { id: null, date: d, start: sh ? sh.start : '', end: sh ? sh.end : '', breakMin: sh && spanMin(sh.start, sh.end) > 330 ? 30 : 0, note: '' };
        render(); const f = document.getElementById(sh ? 'h-break' : 'h-start'); if (f) f.focus(); return;
      }
      case 'h-edit': { const e2 = S.hours.entries.find(x => same(x.id, raw)); S.hEdit = { id: e2.id, date: e2.date, start: e2.start, end: e2.end || '', breakMin: e2.breakMin, note: e2.note || '', wasAuto: !!e2.auto }; render(); return; }
      case 'h-correct': { const e2 = S.hours.entries.find(x => same(x.id, raw)); S.hCorr = { id: e2.id, name: e2.memberName, date: e2.date, start: e2.start, end: e2.end || '', breakMin: e2.breakMin, note: e2.note || '', reason: '', was: e2.start + '–' + (e2.end || '') + (e2.breakMin ? ', ' + e2.breakMin + ' min pauze' : '') }; render(); return; }
      case 'hc-cancel': S.hCorr = null; render(); return;
      case 'hc-save': {
        const C = S.hCorr; if (!C.reason.trim()) { toast('Schrijf kort waarom je de uren aanpast.', true); document.getElementById('hc-reason').focus(); return; }
        el.disabled = true; await rpc('cd_hours_correct', { p_id: C.id, p: { date: C.date, start: C.start, end: C.end, breakMin: C.breakMin, note: C.note, reason: C.reason } });
        S.hCorr = null; toast('Uren gecorrigeerd. ' + C.name.split(' ')[0] + ' krijgt een melding.'); break;
      }
      case 'h-cancel': S.hEdit = null; render(); return;
      case 'h-save': {
        const E = S.hEdit;
        if (!E.date || !E.start || !E.end) { toast('Vul een datum, begintijd en eindtijd in.', true); return; }
        const saved = await rpc('cd_hours_save', { p_id: E.id || null, p: { date: E.date, start: E.start, end: E.end, breakMin: Number(E.breakMin) || 0, note: E.note } });
        toast((E.id ? 'Aangepast: ' : 'Opgeslagen: ') + fmtHM(saved.minutes) + ' uur.');
        S.hEdit = null; if (mondayOf(E.date) !== S.hWeek) S.hWeek = mondayOf(E.date); break;
      }
      case 'h-del': if (!confirm('Deze uren verwijderen?')) return; await rpc('cd_hours_delete', { p_id: num }); toast('Verwijderd.'); break;
      case 'h-submit': {
        if (S.running && mondayOf(S.running.date) === S.hWeek && !confirm('Je bent nog ingeklokt. De lopende dienst wordt niet meegenomen. Toch indienen?')) return;
        const d = await rpc('cd_hours_submit', { p_week: S.hWeek }); toast('Ingediend: ' + fmtHM(d.minutes) + ' uur in ' + d.count + (d.count === 1 ? ' regel.' : ' regels.')); break;
      }
      case 'h-reopen': if (!confirm('Deze goedgekeurde uren terugzetten naar concept? De medewerker kan ze dan weer aanpassen.')) return; await rpc('cd_hours_reopen', { p_id: num }); toast('Teruggezet naar concept.'); break;

      // rooster
      case 'ro-week': S.rosterWeek = el.dataset.v; S.shiftEdit = null; break;
      case 'ro-view': S.rosterView = el.dataset.v; S.shiftEdit = null; S.roMenu = null;
        if (S.rosterView === 'dag') { S.rosterDay = S.rosterDay && mondayOf(S.rosterDay) === S.rosterWeek ? S.rosterDay : (mondayOf(today()) === S.rosterWeek ? today() : S.rosterWeek); }
        if (S.rosterView === 'maand' && !S.rosterMonth) S.rosterMonth = monthStart(S.rosterWeek || today());
        break;
      case 'ro-month': S.rosterMonth = el.dataset.v; S.shiftEdit = null; break;
      case 'ro-who': S.rosterWho = same(S.rosterWho, raw) ? '' : raw; render(); window.scrollTo(0, 0); return;
      case 'ro-goweek': S.rosterView = 'week'; S.rosterWeek = mondayOf(el.dataset.v); S.shiftEdit = null; break;
      case 'ro-copy': if (!(await copyLastWeek())) return; break;
      case 'sh-new': {
        const prev = S.shiftEdit;
        const mid = raw || (rosterFiltered(S.roster).people[0] || {}).id;
        S.shiftEdit = { id: null, memberId: mid, date: el.dataset.v, start: prev && !prev.id ? prev.start : '09:00', end: prev && !prev.id ? prev.end : '17:00', note: prev && !prev.id ? prev.note : '',
          departmentId: (S.roFilter && S.roFilter.dept) || '', functionId: '',
          locationId: S.locFilter || memberLoc(mid) || (prev && !prev.id ? prev.locationId : '') || '' };
        S.roMenu = null; render(); return;
      }
      case 'sh-edit': { const s2 = S.roster.shifts.find(x => same(x.id, raw)); S.shiftEdit = Object.assign({}, s2, { memberId: s2.memberId, note: s2.note || '' }); render(); return; }
      case 'sh-cancel': S.shiftEdit = null; render(); return;
      case 'sh-save': {
        const E = S.shiftEdit;
        const saved = await rpc('cd_shift_save', { p_id: E.id || null, p: { memberId: E.memberId, date: E.date, start: E.start, end: E.end, note: E.note, departmentId: E.departmentId || '', functionId: E.functionId || '' } });
        if (!E.id && saved) roPush(opCreate([Object.assign({}, E, { locationId: E.locationId })], 'Dienst ingepland', [saved.id]));
        if (LOCS().length && saved && (saved.locationId || '') !== (E.locationId || '')) await rpc('cd_shift_location', { p_id: saved.id, p_location: E.locationId || null });
        toast(E.id ? 'Dienst gewijzigd.' : 'Dienst ingepland.');
        S.shiftEdit = null;
        break;
      }
      case 'sh-del': {
        const old = S.roster.shifts.find(x => same(x.id, num));
        await rpc('cd_shift_delete', { p_id: num }); S.shiftEdit = null;
        if (old) { roPush(opDelete(old)); toast('Dienst verwijderd. Ctrl+Z zet hem terug.'); } else toast('Dienst verwijderd.');
        break;
      }

      case 'avp-cancel': S.avPatEdit = null; render(); return;
      case 'av-tab': S.avTab = el.dataset.v; render(); return;
      case 'avp-st': {
        const [wd, st] = el.dataset.v.split('|'); const P = S.avPatEdit = avPat();
        P[wd] = Object.assign({ weekday: Number(wd) }, P[wd], { status: st }); if (st !== 'kan') { P[wd].start = ''; P[wd].end = ''; }
        render(); avpAutoSave(); return;
      }
      case 'avp-preset': {
        const P = S.avPatEdit = avPat(); const v = el.dataset.v;
        if (v === 'werkdagen') [1, 2, 3, 4, 5].forEach(wd => { P[wd] = { weekday: wd, status: 'kan', start: '', end: '' }; });
        if (v === 'weekend-niet') [6, 7].forEach(wd => { P[wd] = { weekday: wd, status: 'kan_niet', start: '', end: '' }; });
        if (v === 'kopieer-ma') { const m0 = P[1] || { status: '' }; [2, 3, 4, 5].forEach(wd => { P[wd] = Object.assign({}, m0, { weekday: wd }); }); }
        if (v === 'leeg') { if (!confirm('Je hele vaste week leegmaken?')) return; [1, 2, 3, 4, 5, 6, 7].forEach(wd => { P[wd] = { weekday: wd, status: '' }; }); }
        render(); avpAutoSave(); return;
      }
      case 'avp-save': {
        const P = S.avPatEdit || {};
        S.avPat = await rpc('cd_availability_pattern_set', { p: [1, 2, 3, 4, 5, 6, 7].map(wd => ({ weekday: wd, status: (P[wd] || {}).status || '', start: (P[wd] || {}).start || '', end: (P[wd] || {}).end || '', note: (P[wd] || {}).note || '' })) });
        S.avPatEdit = null; await loadAvailability(); render(); toast('Je vaste week is opgeslagen. Wie het rooster maakt, ziet dit meteen.'); return;
      }
      case 'br-add': { S.brEdit = S.brEdit || JSON.parse(JSON.stringify(breakRules())); const k = el.dataset.v; S.brEdit[k] = (S.brEdit[k] || []).concat([{ fromMin: 360, breakMin: 30 }]); render(); return; }
      case 'br-del': { S.brEdit = S.brEdit || JSON.parse(JSON.stringify(breakRules())); const [k, i] = el.dataset.v.split('|'); S.brEdit[k].splice(Number(i), 1); render(); return; }
      case 'br-reset': S.brEdit = JSON.parse(JSON.stringify(BREAK_DEFAULT)); render(); return;
      case 'go-account': S.setTab = 'account'; if (route() === 'instellingen') { e.preventDefault(); render(); window.scrollTo(0, 0); } return;
      case 'set-tab': S.setTab = el.dataset.v; render(); return;
      case 'm-qclear': S.mq = ''; S.mFilter = {}; render(); return;
      case 'mu-toggle': {
        const u = S.members.find(x => same(x.id, S.mSel)); if (!u) return;
        const E = S.muEdit && same(S.muEdit.id, u.id) ? S.muEdit : (S.muEdit = { id: u.id, d: (u.departmentIds || []).map(String), f: (u.functionIds || []).map(String) });
        const [k, id] = el.dataset.v.split('|'); const arr = E[k]; const i = arr.indexOf(id); if (i >= 0) arr.splice(i, 1); else arr.push(id); render(); return;
      }
      case 'mu-cancel': S.muEdit = null; render(); return;
      case 'mu-save': {
        const E = S.muEdit; el.disabled = true;
        const d = await rpc('cd_member_units', { p_member: E.id, p_departments: E.d, p_functions: E.f });
        const u = S.members.find(x => same(x.id, E.id)); if (u) { u.departmentIds = d.departmentIds; u.functionIds = d.functionIds; }
        S.muEdit = null; render(); toast('Afdelingen en functies opgeslagen.'); return;
      }
      case 'pres-toggle': { S.presOpen = !S.presOpen; const pr = document.getElementById('presence'); if (pr) pr.outerHTML = viewPresence(); return; }
      case 'pres-out': S.presOutOpen = !el.parentElement.open; return;
      case 'pinw-mode': S.pinNew.mode = el.dataset.v; render(); return;
      case 'pinw-add': {
        const P = S.pinNew; const dagen = P.mode === 'dagen';
        if (!P.from || (dagen && !P.to) || (!dagen && (!P.t1 || !P.t2))) { toast('Vul de datum' + (dagen ? 's' : ' en tijden') + ' in.', true); return; }
        const txt = dagen ? (P.from === P.to ? 'op ' + pinD(P.from) : 'van ' + pinD(P.from) + ' tot en met ' + pinD(P.to)) : 'op ' + pinD(P.from) + ' van ' + P.t1 + ' tot ' + P.t2;
        if (!confirm('Weet je het zeker? Iedereen met een eigen pincode kan dan ' + txt + ' daarmee inklokken. Dit is minder veilig dan de code uit de app.')) return;
        el.disabled = true;
        S.pinWin = await rpc('cd_pin_window_add', dagen ? { p_from_date: P.from, p_to_date: P.to } : { p_from_date: P.from, p_to_date: P.from, p_from_time: P.t1, p_to_time: P.t2 });
        S.pinNew = null; render(); toast('Eigen pincode is toegestaan ' + txt + '.'); return;
      }
      case 'pinw-del': {
        if (!confirm('Deze periode weghalen? Dan werkt de eigen pincode in die tijd niet.')) return;
        el.disabled = true; S.pinWin = await rpc('cd_pin_window_del', { p_id: raw }); render(); toast('Weggehaald.'); return;
      }
      case 'br-save': {
        const r = await rpc('cd_break_rules_save', { p: S.brEdit || breakRules() });
        S.org.settings = Object.assign({}, S.org.settings, { breakRules: r }); S.brEdit = null; render(); toast('Pauzeregels opgeslagen.'); return;
      }
      case 'sh-pick': if (S.shiftEdit) { S.shiftEdit.memberId = raw; render(); } return;
      case 'sh-tpl': {
        const t = S.roster.templates.find(x => same(x.id, raw));
        Object.assign(S.shiftEdit, { start: t.start, end: t.end, note: t.note || S.shiftEdit.note, departmentId: t.departmentId || S.shiftEdit.departmentId || '', functionId: t.functionId || '' }); render(); return;
      }
      case 'ro-publish': {
        const wk = S.roster.weekStart;
        if (!confirm('Week ' + weekNo(wk) + ' vastzetten? Iedereen met een dienst krijgt een melding en ziet het rooster.')) return;
        const d = await rpc('cd_roster_publish', { p_week: wk });
        toast('Rooster vastgezet. ' + d.notified + (d.notified === 1 ? ' medewerker' : ' medewerkers') + ' op de hoogte gebracht.'); break;
      }
      case 'ro-concept-del': {
        const wk = S.roster.weekStart; const V = typeof roView === 'function' ? roView(rosterFiltered(S.roster)) : rosterFiltered(S.roster);
        const list = (V.shifts || []).filter(x => x.date >= wk && x.date < addDays(wk, 7));
        if (!list.length) { toast('Er staan geen diensten in dit concept.'); return; }
        const dn = (S.roFilter || {}).dept && typeof deptOf === 'function' && deptOf(S.roFilter.dept);
        if (!confirm('Concept van week ' + weekNo(wk) + ' verwijderen?\n\n' + list.length + (list.length === 1 ? ' dienst wordt' : ' diensten worden') + ' verwijderd' + (dn ? ' (alleen afdeling ' + dn.name + ')' : '') + '. Met Ctrl+Z zet je ze terug.')) return;
        const specs = list.map(x => specOf(x)); const st = { ids: list.map(x => x.id) };
        const n = await rpc('cd_roster_concept_delete', { p_week: wk, p_ids: st.ids });
        roPush({ label: 'Concept verwijderd', undo: async () => { st.ids = []; for (const sp of specs) { try { st.ids.push((await roCreate(sp)).id); } catch (e) { /* */ } } },
          redo: async () => { await rpc('cd_roster_concept_delete', { p_week: wk, p_ids: st.ids }); } });
        toast(n + (n === 1 ? ' dienst' : ' diensten') + ' verwijderd · Ctrl+Z = terug'); break;
      }
      case 'ro-unpublish': if (!confirm('Deze week terugzetten naar concept? Medewerkers zien hun diensten dan niet meer tot je hem opnieuw vastzet.')) return;
        await rpc('cd_roster_unpublish', { p_week: S.roster.weekStart }); toast('Week staat weer op concept.'); break;
      case 'tpl-open': { const dd = el.closest('details'); if (dd) dd.open = false; } S.tplModal = true; S.tplEdit = null; render(); return;
      case 'tpl-x': S.tplModal = false; S.tplEdit = null; render(); return;
      case 'tpl-new': S.tplEdit = null; render(); return;
      case 'tpl-edit': { const t = (S.roster.templates || []).find(x => same(x.id, num)); if (!t) return;
        S.tplEdit = { id: t.id, name: t.name, start: t.start, end: t.end, note: t.note || '', departmentId: t.departmentId || '', functionId: t.functionId || '' }; render();
        setTimeout(() => { const i = document.getElementById('tpl-name'); if (i) { i.focus(); i.scrollIntoView({ block: 'center', behavior: 'smooth' }); } }, 30); return; }
      case 'tpl-save': {
        const E = S.tplEdit || {};
        if (!E.name || !E.start || !E.end) { toast('Vul een naam, begin- en eindtijd in.', true); return; }
        el.disabled = true;
        await rpc('cd_shift_template_save', { p_id: E.id || null, p: E }); S.tplEdit = null; toast(E.id ? 'Vaste dienst aangepast.' : 'Vaste dienst toegevoegd.'); break;
      }
      case 'tpl-del': if (!confirm('Deze vaste dienst verwijderen? Ingeplande diensten blijven staan.')) return; await rpc('cd_shift_template_delete', { p_id: num }); if (S.tplEdit && same(S.tplEdit.id, num)) S.tplEdit = null; break;

      // verlof en ziek
      case 'abs-new': S.absForm = { kind: el.dataset.v, from: el.dataset.v === 'ziek' ? today() : '', to: '', note: '', memberId: '' }; S.absReject = null; render(); window.scrollTo(0, 0); return;
      case 'abs-kind': S.absForm.kind = el.dataset.v; if (el.dataset.v === 'ziek' && !S.absForm.from) S.absForm.from = today(); render(); return;
      case 'abs-cancel': S.absForm = null; render(); return;
      case 'abs-save': {
        const E = S.absForm;
        if (!E.from) { toast('Kies een begindatum.', true); return; }
        if (E.kind !== 'ziek' && !E.to) E.to = E.from;
        const a = await rpc('cd_absence_save', { p: { kind: E.kind, from: E.from, to: E.to, note: E.note, memberId: E.memberId || null, hours: E.kind !== 'ziek' && E.hours ? String(E.hours) : null } });
        toast(a.kind === 'ziek' ? (E.memberId ? a.memberName + ' is ziek gemeld.' : 'Ziek gemeld. Beterschap!') : a.status === 'goedgekeurd' ? a.kindLabel + ' ingevoerd voor ' + a.memberName + '.' : 'Aangevraagd. Je krijgt een melding zodra het is beoordeeld.');
        S.absForm = null; break;
      }
      case 'abs-beter': {
        const d = document.getElementById('beter-date').value;
        await rpc('cd_absence_action', { p_id: num, p_action: 'beter', p_date: d }); toast('Fijn dat je weer beter bent!'); break;
      }
      case 'abs-approve': {
        const cv = document.getElementById('cover-' + num);
        if (cv && !cv.value) { toast('Kies eerst hoe je het tekort aan verlofuren oplost.', true); cv.focus(); return; }
        await rpc('cd_absence_review', { p_id: num, p_approve: true, p_cover: cv ? cv.value : null }); toast('Goedgekeurd.'); break;
      }
      case 'abs-reject-open': S.absReject = num; render(); { const f = document.getElementById('abs-reason'); if (f) f.focus(); } return;
      case 'abs-reject-cancel': S.absReject = null; render(); return;
      case 'abs-reject': {
        const reason = document.getElementById('abs-reason').value.trim();
        if (!reason) { toast('Geef een reden op.', true); return; }
        await rpc('cd_absence_review', { p_id: num, p_approve: false, p_reason: reason }); S.absReject = null; toast('Afgewezen.'); break;
      }
      case 'abs-cancel-item': if (!confirm('Dit verlof intrekken?')) return; await rpc('cd_absence_action', { p_id: num, p_action: 'intrekken' }); toast('Ingetrokken.'); break;

      // beschikbaarheid
      case 'av-month': S.avMonth = el.dataset.v; S.avSel = {}; break;
      case 'av-pick': S.avSel[el.dataset.v] = !S.avSel[el.dataset.v]; render(); return;
      case 'av-weekday': {
        const wd = Number(el.dataset.v); const m = S.avMonth, last = monthEnd(m);
        const days = []; for (let d = m; d <= last; d = addDays(d, 1)) if ((pd(d).getDay() + 6) % 7 === wd && d >= today()) days.push(d);
        const allOn = days.length && days.every(d => S.avSel[d]);
        days.forEach(d => { S.avSel[d] = !allOn; }); render(); return;
      }
      case 'av-clear': S.avSel = {}; render(); return;
      case 'av-set': {
        const dates = Object.keys(S.avSel).filter(k => S.avSel[k]);
        const A = S.avEdit || {};
        if (el.dataset.v === 'kan' && (!!A.start !== !!A.end)) { toast('Vul zowel vanaf als tot in, of laat beide leeg.', true); return; }
        const d = await rpc('cd_availability_set', { p_dates: dates, p_status: el.dataset.v || null, p_start: el.dataset.v === 'kan' ? A.start || null : null, p_end: el.dataset.v === 'kan' ? A.end || null : null, p_note: A.note || null });
        toast(el.dataset.v ? 'Opgeslagen voor ' + dates.length + (dates.length === 1 ? ' dag.' : ' dagen.') : 'Teruggezet naar je vaste week.'); S.avSel = {}; void d; break;
      }

      // meldingen
      case 'notif-open': {
        const n = S.notif.items.find(x => same(x.id, raw)); if (!n || !n.link) return;
        if (n.link.startsWith('instellingen|factuur|')) { S.setTab = 'abonnement'; S.invFocus = Number(n.link.split('|')[2]); go('instellingen'); }
        else if (n.link.startsWith('rooster|')) { S.rosterView = 'week'; S.rosterWeek = n.link.split('|')[1]; go('rooster'); }
        else if (n.link === 'ruilen') { if (can('hours.plan')) { S.rosterView = 'week'; S.swReview = true; } else S.rosterView = 'mijn'; go('rooster'); }
        else if (n.link === 'verlof') go('verlof');
        return;
      }

      // goedkeuren
      case 'p-view': S.hMember = raw; S.hWeek = el.dataset.v; S.hKeep = true; go('uren'); return;
      case 'p-reject-open': S.rejectFor = el.dataset.v; render(); { const f = document.getElementById('rej-reason'); if (f) f.focus(); } return;
      case 'p-reject-cancel': S.rejectFor = null; render(); return;
      case 'p-approve': case 'p-reject': {
        const g = pendingGroups().find(x => x.key === el.dataset.v); if (!g) return;
        const ids = g.entries.filter(e2 => !S.pOff[e2.id]).map(e2 => e2.id);
        const reason = act === 'p-reject' ? (document.getElementById('rej-reason') || {}).value || '' : null;
        if (act === 'p-reject' && !reason.trim()) { toast('Geef een reden op, dan weet ' + g.name + ' wat er moet worden aangepast.', true); return; }
        const d = await rpc('cd_hours_review', { p_ids: ids, p_approve: act === 'p-approve', p_reason: reason });
        toast((act === 'p-approve' ? 'Goedgekeurd: ' : 'Afgekeurd: ') + d.count + (d.count === 1 ? ' regel van ' : ' regels van ') + g.name + '.');
        S.rejectFor = null; break;
      }

      // urenoverzicht
      case 'rep-period': S.repPeriod = el.dataset.v; if (S.repPeriod === 'eigen') { render(); return; } break;
      case 'rep-custom': {
        const f = document.getElementById('rep-from').value, t = document.getElementById('rep-to').value;
        if (!f || !t) { toast('Kies een begin- en einddatum.', true); return; }
        S.repFrom = f; S.repTo = t; break;
      }
      case 'rep-csv': exportCsv(); return;

      // telefonie
      case 'ph-period': S.phPeriod = el.dataset.v; break;
      case 'ph-sync': phoneSync(true); return;
      case 'ph-edit': S.phEdit = true; render(); return;
      case 'ph-edit-cancel': S.phEdit = false; render(); return;
      case 'ph-disc': S.phDisc = true; render(); return;
      case 'ph-disc-cancel': S.phDisc = false; render(); return;
      case 'ph-disconnect': {
        const del = (document.getElementById('ph-del') || {}).checked === true;
        await rpc('cd_phone_disconnect', { p_delete_calls: del });
        S.phDisc = false; S.phEdit = false; S.phone = null; toast('Telefonie losgekoppeld.'); break;
      }
      case 'ph-connect': {
        const v = id => document.getElementById(id).value.trim();
        if (!v('ph-url') || !v('ph-id') || !v('ph-key')) { toast('Vul het adres, de Client ID en de API-sleutel in.', true); return; }
        el.disabled = true; el.textContent = 'Verbinden met 3CX…';
        try {
          const r = await svc('phone-connect', { baseUrl: v('ph-url'), clientId: v('ph-id'), secret: v('ph-key') });
          S.phEdit = false; S.phSyncedAt = Date.now();
          toast(r.error ? 'Gekoppeld, maar ophalen lukte nog niet: ' + r.error : 'Gekoppeld met 3CX. ' + (r.synced || 0) + ' gesprekken van de afgelopen maand opgehaald.', !!r.error);
        } catch (e) { el.disabled = false; el.textContent = 'Koppelen'; throw e; }
        break;
      }

      // kennisbank
      case 'kb-cat': S.kbCat = el.dataset.v; break;
      case 'kb-sel': S.kbSel = num; S.kbEdit = null; S.kbArticle = await rpc('cd_kb_get', { p_id: num }); render(); if (window.innerWidth < 900) { const d = document.querySelector('.detail'); if (d) d.scrollIntoView({ behavior: 'smooth' }); } return;
      case 'kb-new': S.kbEdit = { id: null, title: '', category: S.kbCat || '', body: '', pinned: false }; render(); document.getElementById('kb-title').focus(); return;
      case 'kb-edit': { const A = S.kbArticle; S.kbEdit = { id: A.id, title: A.title, category: A.category, body: A.body, pinned: A.pinned }; render(); return; }
      case 'kb-cancel': S.kbEdit = null; render(); return;
      case 'kb-save': {
        const E = S.kbEdit;
        if (E.title.trim().length < 2) { toast('Geef het artikel een titel.', true); return; }
        const a = await rpc('cd_kb_save', { p_id: E.id || null, p: { title: E.title, category: E.category, body: E.body, pinned: !!E.pinned } });
        toast(E.id ? 'Artikel opgeslagen.' : 'Artikel gepubliceerd.'); S.kbEdit = null; S.kbSel = a.id; break;
      }
      case 'kb-del': if (!confirm('Dit artikel verwijderen? Dit kan niet ongedaan worden gemaakt.')) return; await rpc('cd_kb_delete', { p_id: S.kbSel }); S.kbSel = null; S.kbArticle = null; toast('Artikel verwijderd.'); break;

      // documenten
      case 'doc-folder': e.preventDefault(); S.docFolder = el.dataset.v || null; S.folderEdit = null; await loadDocs(); render(); window.scrollTo(0, 0); return;
      case 'doc-dl': {
        const d = S.docs.docs.find(x => same(x.id, raw));
        const { data, error } = await sb.storage.from('crewdeck').createSignedUrl(d.path, 120, { download: d.name });
        if (error || !data) throw new Error('Downloaden lukt niet: ' + (error ? error.message : 'onbekende fout'));
        const a = document.createElement('a'); a.href = data.signedUrl; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove(); return;
      }
      case 'doc-del': {
        const d = S.docs.docs.find(x => same(x.id, raw));
        if (!confirm('"' + d.name + '" verwijderen?')) return;
        const r2 = await rpc('cd_doc_delete', { p_id: raw });
        try { await sb.storage.from('crewdeck').remove([r2.path]); } catch (err) { /* het bestand is al onzichtbaar */ }
        toast('Document verwijderd.'); break;
      }
      case 'fo-new': S.folderEdit = { id: null, name: '', roleIds: [] }; render(); document.getElementById('fo-name').focus(); return;
      case 'fo-edit': { const F = S.docs.folder; S.folderEdit = { id: F.id, name: F.name, roleIds: (F.roleIds || []).slice() }; render(); return; }
      case 'fo-cancel': S.folderEdit = null; render(); return;
      case 'fo-save': {
        const E = S.folderEdit;
        if (!E.name.trim()) { toast('Geef de map een naam.', true); return; }
        const f = await rpc('cd_folder_save', { p_id: E.id || null, p: { name: E.name, roleIds: E.roleIds } });
        toast(E.id ? 'Map opgeslagen.' : 'Map gemaakt.'); S.folderEdit = null; S.docFolder = f.id; break;
      }
      case 'fo-del': {
        if (!confirm('Deze map verwijderen? Dat kan alleen als hij leeg is.')) return;
        await rpc('cd_folder_delete', { p_id: S.folderEdit.id }); S.folderEdit = null; S.docFolder = null; toast('Map verwijderd.'); break;
      }

      // uit dienst
      case 'm-tab': S.mTab = el.dataset.v; S.mSel = null; S.mNew = false; S.offboard = null; render(); return;
      case 'm-off-open': S.offboard = { id: raw, reason: '', mode: 'later', date: '', note: '' }; render(); return;
      case 'm-off-now': {
        const u = S.members.find(x => same(x.id, raw));
        if (!confirm(u.name + ' nu al uitzetten? Het account gaat meteen uit en ' + u.name.split(' ')[0] + ' komt in het archief.')) return;
        await rpc('cd_member_offboard', { p_id: raw, p: { mode: 'now' } });
        toast(u.name + ' staat in het archief.'); S.mTab = 'archief'; S.mSel = raw; await loadPeople(); render(); return;
      }
      case 'm-off-cancel': S.offboard = null; render(); return;
      case 'm-off-save': {
        const O = S.offboard; const u = S.members.find(x => same(x.id, raw));
        if (!O.reason) { toast('Kies een reden.', true); return; }
        if (O.reason === 'overig' && !O.note.trim()) { toast('Schrijf kort op wat de reden is.', true); return; }
        if (O.mode === 'later' && !O.date) { toast('Kies de laatste werkdag.', true); return; }
        if (!confirm(O.mode === 'later' ? 'Vertrek van ' + u.name + ' vastleggen? De laatste werkdag is ' + dayLong(O.date).toLowerCase() + '.' : u.name + ' nu uit dienst melden? Het account wordt meteen uitgezet.')) return;
        const d = await rpc('cd_member_offboard', { p_id: raw, p: { reason: O.reason, mode: O.mode, date: O.date, note: O.note } });
        if (d.planned) {
          toast('Vastgelegd: laatste werkdag ' + dayLong(d.date).toLowerCase() + '.' + (d.shifts ? ' ' + d.shifts + (d.shifts === 1 ? ' dienst' : ' diensten') + ' daarna uit het rooster gehaald.' : ''));
          S.offboard = null; await loadPeople(); render(); return;
        }
        const parts = [];
        if (d.callbacks) parts.push(d.callbacks + ' open verzoek' + (d.callbacks === 1 ? '' : 'en') + ' naar de pool');
        if (d.shifts) parts.push(d.shifts + ' dienst' + (d.shifts === 1 ? '' : 'en') + ' uit het rooster');
        if (d.soloTasks) parts.push(d.soloTasks + ' ta' + (d.soloTasks === 1 ? 'ak staat' : 'ken staan') + ' nog alleen op ' + u.name.split(' ')[0] + ': wijs ' + (d.soloTasks === 1 ? 'die' : 'die') + ' opnieuw toe');
        toast(u.name + ' staat in het archief.' + (parts.length ? ' ' + parts.join(' · ') + '.' : ''));
        S.offboard = null; S.mTab = 'archief'; S.mSel = raw; await loadPeople(); render(); return;
      }
      case 'm-restore': {
        const u = S.members.find(x => same(x.id, raw));
        if (!confirm(u.archived ? u.name + ' weer in dienst nemen?' : 'Het vertrek van ' + u.name + ' intrekken?')) return;
        const d = await rpc('cd_member_restore', { p_id: raw }); toast(d.wasArchived ? u.name + ' is weer in dienst.' : 'Vertrek van ' + u.name + ' ingetrokken.'); S.mTab = 'actief'; S.mSel = raw; await loadPeople(); render(); return;
      }

      // prikklok
      case 'kiosk-setup': {
        const name = document.getElementById('kiosk-name').value.trim(); S.kioskName = name;
        if (name.length < 2) { toast('Geef dit apparaat een naam, bijvoorbeeld "Tablet bij de ingang".', true); return; }
        if (!confirm('Dit apparaat wordt een prikklok en je wordt hier uitgelogd. Doorgaan?')) return;
        const kl = document.getElementById('kiosk-loc');
        const k = await rpc('cd_kiosk_create', { p_name: name, p_location: kl && kl.value ? kl.value : null });
        try { localStorage.setItem('crewdeck-kiosk', k.token); } catch (err) { throw new Error('Dit apparaat kan de prikklok-sleutel niet bewaren (privévenster?).'); }
        await sb.auth.signOut({ scope: 'local' }); S.me = null; S.seen = null;
        Object.assign(K, { info: null, error: null, sel: null, code: '', result: null });
        location.hash = '#/klok'; return;
      }
      case 'kiosk-reopen': {
        if (!confirm('De prikklok weer openen? Je wordt op dit apparaat uitgelogd.')) return;
        await sb.auth.signOut({ scope: 'local' }); S.me = null; S.seen = null;
        Object.assign(K, { info: null, error: null, sel: null, code: '', result: null, exit: null });
        location.hash = '#/klok'; return;
      }
      case 'kiosk-revoke': {
        const k = S.kiosks.kiosks.find(x => same(x.id, raw));
        if (!confirm('"' + k.name + '" uitzetten? Op dat apparaat kan dan niemand meer klokken.')) return;
        await rpc('cd_kiosk_revoke', { p_id: raw }); toast('Prikklok uitgezet.'); break;
      }
      case 'k-sel': K.sel = raw; K.code = ''; K.err = null; render(); kioskReset(30000); return;
      case 'k-cancel': K.sel = null; K.code = ''; K.err = null; render(); return;
      case 'k-key': kioskKey(el.dataset.v); return;
      case 'k-ok': await kioskSubmit(); return;
      case 'k-logo': {
        const now = Date.now(); K.taps = K.taps.filter(t => now - t < 3000); K.taps.push(now);
        if (K.taps.length >= 5 && !K.exit) { K.taps = []; K.sel = null; K.code = ''; K.result = null; K.exit = { name: '', revoke: false }; render(); const f = document.getElementById('kx-name'); if (f) f.focus(); kioskReset(90000); }
        return;
      }
      case 'k-exit-cancel': K.exit = null; render(); return;
      case 'k-exit': try { localStorage.removeItem('crewdeck-kiosk'); } catch (err) { /* */ } K.error = null; location.hash = '#/login'; return;

      // mensen
      case 'm-sel': S.mSel = raw; S.mNew = false; S.offboard = null; S.leaveAcc = null; render(); return;
      case 'la-year': S.leaveYear = Number(el.dataset.v); await loadLeaveAcc(raw); render(); return;
      case 'la-save': {
        const num2 = v => { const t = String(v || '').trim().replace(',', '.'); return t === '' ? null : Number(t); };
        const lv = num2(document.getElementById('la-leave').value), tv = num2(document.getElementById('la-tvt').value);
        if ((lv != null && !isFinite(lv)) || (tv != null && !isFinite(tv))) { toast('Vul alleen getallen in.', true); return; }
        if (lv == null && tv != null) { toast('Vul ook de verlofuren in.', true); return; }
        el.disabled = true;
        await rpc('cd_leave_account_save', { p_member: raw, p_year: S.leaveYear || Number(today().slice(0, 4)), p_leave: lv, p_tvt: tv || 0 });
        await loadLeaveAcc(raw); render(); toast(lv == null ? 'Saldo weggehaald.' : 'Verlofsaldo opgeslagen.'); return;
      }
      case 'lv-ctr-add': {
        const inp = document.getElementById('lv-new'); const h = Number(String(inp.value).trim().replace(',', '.'));
        if (!isFinite(h) || h <= 0 || h > 60) { toast('Vul een aantal uren per week in, tussen 0 en 60.', true); inp.focus(); return; }
        const r = Math.round(h * 100) / 100; S.lvContracts = S.lvContracts || [];
        if (![40, 36, 32, 24].includes(r) && !S.lvContracts.includes(r)) S.lvContracts.push(r);
        render(); toast('Toegevoegd. Klik op Opslaan om het te bewaren.'); return;
      }
      case 'lv-ctr-del': S.lvContracts = (S.lvContracts || []).filter(x => x !== Number(el.dataset.v)); render(); return;
      case 'lr-save': {
        const p = Object.fromEntries(Object.keys(COVER).map(k => [k, document.getElementById('lr-' + k).checked]));
        p.advanceMax = Number(String(document.getElementById('lr-max').value).replace(',', '.'));
        p.auto = document.getElementById('lr-auto').checked; p.weeks = Number(document.getElementById('lr-weeks').value) || 4; p.contracts = S.lvContracts || [];
        el.disabled = true; const v = await rpc('cd_leave_settings_save', { p });
        S.org.settings = Object.assign({}, S.org.settings, { leave: v }); S.lvContracts = null; S.lvWeeks = null; render(); toast('Opgeslagen.'); return;
      }
      case 'm-new': S.mNew = true; S.mNewRole = null; render(); document.getElementById('m-name').focus(); return;
      case 'm-cancel': S.mNew = false; render(); return;
      case 'm-create': {
        const name = document.getElementById('m-name').value.trim();
        const email = document.getElementById('m-email').value.trim().toLowerCase();
        const roleId = document.getElementById('m-role').value;
        if (name.length < 2) { toast('Vul een naam in van minstens 2 tekens.', true); return; }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { toast('Vul een geldig e-mailadres in.', true); return; }
        el.disabled = true;
        const d = await svc('member-create', { name, roleId, email });
        deliveryResult(d, d.member.name, email, false); S.mNew = false; S.mSel = d.member.id;
        try { await saveMemberBiz(d.member.id, true); } catch (err) { toast(err.message, true); }
        await loadPeople(); render(); window.scrollTo(0, 0); return;
      }
      case 'm-save': {
        const p = { name: document.getElementById('m-name').value };
        const role = document.getElementById('m-role'); const active = document.getElementById('m-active');
        if (role) p.roleId = role.value;
        if (active) p.active = active.checked;
        await rpc('cd_member_update', { p_id: raw, p });
        const ct = document.getElementById('m-ctype');
        if (ct) {
          const u = S.members.find(x => same(x.id, raw));
          const hrs = ct.value === 'flex' ? 0 : Number(String(document.getElementById('m-chours').value).replace(',', '.'));
          if (ct.value === 'vast' && (!isFinite(hrs) || hrs < 0 || hrs > 80)) throw new Error('Vul bij een vast contract 0 tot 80 uur per week in.');
          if (!u || u.contractType !== ct.value || Number(u.contractHours) !== hrs) await rpc('cd_member_contract', { p_id: raw, p_type: ct.value, p_hours: hrs });
          const mi = document.getElementById('m-minor');
          if (mi && (!u || !!u.isMinor !== mi.checked)) await rpc('cd_member_minor', { p_id: raw, p_minor: mi.checked });
        }
        await saveMemberBiz(raw);
        toast('Opgeslagen.');
        if (same(raw, S.me.id)) await loadSession();
        await loadPeople(); render(); return;
      }
      case 'm-reset': {
        const u = S.members.find(x => same(x.id, raw));
        if (!confirm('Nieuwe code maken voor ' + u.name + '? De oude code werkt dan niet meer.')) return;
        const d = await svc('member-code', { memberId: raw });
        S.shownCode = { name: u.name, code: d.code }; render(); window.scrollTo(0, 0); return;
      }

      // rollen
      case 'r-sel': S.rSel = raw; S.rNew = false; render(); return;
      case 'r-new': S.rNew = true; render(); document.getElementById('r-name').focus(); return;
      case 'r-cancel': S.rNew = false; render(); return;
      case 'r-save': {
        const perms = [...document.querySelectorAll('[data-perm]')].filter(c => c.checked).map(c => c.dataset.perm);
        const d = await rpc('cd_role_save', { p_id: raw || null, p: { name: document.getElementById('r-name').value, description: document.getElementById('r-desc').value, permissions: perms } });
        toast(S.rNew ? 'Rol aangemaakt.' : 'Rol opgeslagen.');
        S.rNew = false; S.rSel = d.id; await loadPeople(); await loadSession(); render(); return;
      }
      case 'r-delete': {
        if (!confirm('Deze rol verwijderen?')) return;
        await rpc('cd_role_delete', { p_id: raw }); toast('Rol verwijderd.'); S.rSel = null; await loadPeople(); render(); return;
      }

      // instellingen
      case 's-owncode': {
        const c1 = document.getElementById('s-code').value.trim(), c2 = document.getElementById('s-code2').value.trim();
        if (!/^\d{6,12}$/.test(c1)) { toast('Een code bestaat uit 6 tot 12 cijfers.', true); return; }
        if (c1 !== c2) { toast('De twee codes zijn niet hetzelfde.', true); return; }
        await svc('member-code', { memberId: S.me.id, code: c1 });
        S.shownCode = null; toast('Je nieuwe code is opgeslagen.'); render(); return;
      }
      case 'o-save': {
        const o = await rpc('cd_org_update', { p: { name: document.getElementById('o-name').value, timezone: document.getElementById('o-tz').value,
          categories: linesOf('o-cats'), quick_notes: linesOf('o-notes') } });
        S.org.name = o.name; S.org.settings = o.settings; toast('Instellingen opgeslagen.'); render(); return;
      }
      default: return;
    }
    S.quiet = true;
    try { await loadRoute(); } finally { S.quiet = false; }
    render();
  } catch (err) { toast(err.message, true); if (el.isConnected) el.disabled = false; }
});

// ---------- automatisch verversen (elke 20 seconden) ----------
setInterval(async () => {
  if (!S.me || dragId != null || (typeof roDrag !== 'undefined' && roDrag)) return;
  if (typeof isMobileApp === 'function' && isMobileApp()) {
    const ae = document.activeElement;
    if (!(ae && /INPUT|TEXTAREA/.test(ae.tagName)) && !document.hidden) { try { await loadMobile(); render(); } catch (e) { /* stil */ } }
    else { try { await loadCounts(); } catch (e) { /* stil */ } }
    return;
  }
  const r = route(); const a = document.activeElement;
  const typing = a && /INPUT|TEXTAREA|SELECT/.test(a.tagName);
  try {
    const editing = S.hEdit || S.shiftEdit || S.rejectFor || S.roNeedsEdit || S.roHoursEdit || S.roProposal || S.roMenu;
    if (['overzicht', 'terugbellen', 'taken', 'team', 'uren', 'goedkeuren', 'rooster', 'verlof'].includes(r) && !typing && !editing && !S.absForm && !S.absReject && !document.hidden) {
      const y = window.scrollY; await loadRoute(); render(); window.scrollTo(0, y);
    } else {
      await Promise.all([loadCounts(), loadPresence()]);
      const nav = document.querySelector('.nav'); if (nav && !typing) nav.outerHTML = viewNav(r);
      const pr = document.getElementById('presence'); if (pr && !typing) pr.outerHTML = viewPresence();
    }
  } catch (e) { /* stil */ }
}, 20000);

// lopende klok bijwerken zonder het scherm opnieuw te tekenen
setInterval(() => {
  const el = document.getElementById('clock-elapsed');
  if (el) el.textContent = fmtHM(runningSince({ date: el.dataset.date, start: el.dataset.start }));
}, 15000);

// ---------- start ----------
(async function start() {
  // wacht tot alle scripts (ook mobile.js, roster.js) geladen zijn
  if (document.readyState === 'loading') await new Promise(r => document.addEventListener('DOMContentLoaded', r, { once: true }));
  if (forgetIfNeeded()) { try { await sb.auth.signOut({ scope: 'local' }); } catch (e) { /* */ } }
  try { sessionStorage.setItem('crewharbor-live', '1'); } catch (e) { /* */ }
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (session) await loadSession();
  } catch (e) {
    S.me = null;
    if ((e.code === 'CH001' || e.code === 'CH002') && !['wachtwoord', 'email'].includes(route())) { await enterApp(); return; }
    // Alleen uitloggen als de sessie echt niet meer geldig is. Bij een haperende verbinding blijf je ingelogd.
    if (isAuthError(e)) { try { await sb.auth.signOut({ scope: 'local' }); } catch (err) { /* */ } }
    else { noConnection(); return; }
  }
  await onRoute();
})();
function isAuthError(e) {
  return !!e && (e.code === '28000' || e.code === 'PGRST301' || e.code === 'PGRST303' || /JWT|refresh token|not authenticated|deactiv/i.test(e.message || ''));
}
/** Geen verbinding bij opstarten: in de app naar de offline-weergave, anders opnieuw proberen. */
function noConnection() {
  if (APP && typeof APP.goOffline === 'function') { APP.goOffline(); return; }
  $app.innerHTML = '<div class="login"><section class="login-brand"><div>' + LOGO(36) + '</div></section><section class="login-main"><div class="login-card">' +
    '<h2>Geen verbinding</h2><p class="muted" style="margin:0">CrewHarbor kan de server nu niet bereiken. Je blijft ingelogd; we proberen het zo opnieuw.</p>' +
    '<button class="btn primary" onclick="location.reload()">Opnieuw proberen</button></div></section></div>';
  setTimeout(() => location.reload(), 15000);
}
