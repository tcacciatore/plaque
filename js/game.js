/* ═══════════════════════════════════════════════════════════
   PLAQUE — moteur commun aux modes Trafic et Parking
   dictionnaire, règle des lettres, tirage des plaques, question
   bonus, collection, records, partage, sons, explosion.
   ═══════════════════════════════════════════════════════════ */
(function () {
'use strict';

/* ─────────── réglages ─────────── */
var MODES = {
  trafic:    { label: 'Trafic',    traffic: true },
  parking:   { label: 'Parking',   parking: true },
  poursuite: { label: 'Poursuite', pursuit: true }
};
// la difficulté règle la richesse des paires tirées : n = mots courants disponibles
var DIFF = {
  facile: { nMin: 1200, nMax: 4200, label: 'Facile' },
  normal: { nMin: 400,  nMax: 1250, label: 'Normal' },
  expert: { nMin: 40,   nMax: 420,  label: 'Expert' }
};

var state = { mode: 'trafic', diff: 'normal', total: 0, history: [], rng: Math.random, usedPairs: {} };

var WORDS = null, DICT = null, RARITY = null;

/* ─────────── utilitaires ─────────── */
var $ = function (id) { return document.getElementById(id); };

function norm(s) {
  return s.replace(/œ/g, 'oe').replace(/æ/g, 'ae')
          .replace(/Œ/g, 'OE').replace(/Æ/g, 'AE')
          .normalize('NFD').replace(/[̀-ͯ]/g, '')
          .toLowerCase().replace(/[^a-z]/g, '');
}
function rand(n) { return Math.floor(state.rng() * n); }
function pick(a)  { return a[rand(a.length)]; }
function shuffle(a) {
  for (var i = a.length - 1; i > 0; i--) { var j = rand(i + 1); var t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}
function screen(id) {
  var all = document.querySelectorAll('.screen');
  for (var i = 0; i < all.length; i++) all[i].classList.remove('active');
  $(id).classList.add('active');
  window.scrollTo(0, 0);
}

/* ─────────── stockage ─────────── */
var store = {
  get: function (k, dflt) {
    try { var v = localStorage.getItem('plaque.' + k); return v === null ? dflt : JSON.parse(v); }
    catch (e) { return dflt; }
  },
  set: function (k, v) { try { localStorage.setItem('plaque.' + k, JSON.stringify(v)); } catch (e) {} }
};
function collection() { return store.get('collection', []); }
function collect(num) {
  var c = collection();
  if (c.indexOf(num) === -1) { c.push(num); store.set('collection', c); return true; }
  return false;
}
function bestKey() { return 'best.' + state.mode + '.' + state.diff; }

/* ─────────── son & vibration ─────────── */
var audio = { on: store.get('sound', true), ctx: null };
function tone(freq, dur, delay, type, vol) {
  if (!audio.on) return;
  try {
    if (!audio.ctx) audio.ctx = new (window.AudioContext || window.webkitAudioContext)();
    var t0 = audio.ctx.currentTime + (delay || 0);
    var osc = audio.ctx.createOscillator(), g = audio.ctx.createGain();
    osc.type = type || 'triangle';
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol || 0.12, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(audio.ctx.destination);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  } catch (e) {}
}
var touched = false;   // la vibration n'est autorisée qu'après une vraie interaction
['pointerdown', 'keydown'].forEach(function (ev) {
  window.addEventListener(ev, function () { touched = true; }, { once: true, capture: true });
});
function buzz(ms) { try { if (touched && navigator.vibrate) navigator.vibrate(ms); } catch (e) {} }
var sfx = {
  ok:   function (m) { tone(430 + m * 55, 0.10, 0); tone(650 + m * 70, 0.11, 0.055); buzz(12); },
  rare: function ()  { tone(660, .09, 0); tone(880, .09, .07); tone(1180, .16, .14); buzz([12, 40, 25]); },
  dbl:  function ()  { tone(520, .1, 0); tone(780, .1, .08); tone(1040, .2, .16); buzz([15, 40, 30]); },
  ko:   function ()  { tone(150, 0.16, 0, 'sawtooth', 0.07); buzz(55); },
  time: function ()  { tone(880, .07, 0, 'sine', .07); },
  over: function ()  { tone(400, .18, 0, 'sine'); tone(280, .3, .16, 'sine'); },
  win:  function ()  { tone(520, .1, 0); tone(660, .1, .09); tone(880, .28, .18); }
};

/* ─────────── dictionnaire ─────────── */
function gunzipB64(b64) {
  var bin = atob(b64), n = bin.length, bytes = new Uint8Array(n);
  for (var i = 0; i < n; i++) bytes[i] = bin.charCodeAt(i);
  var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}
function loadDict() {
  if (typeof DecompressionStream === 'undefined') return Promise.reject(new Error('navigateur trop ancien'));
  return Promise.all([gunzipB64(window.DICT_GZ_B64), gunzipB64(window.RARITY_GZ_B64)])
    .then(function (r) {
      WORDS = r[0].split('\n');
      var tiers = r[1];
      DICT = new Set(WORDS);
      RARITY = new Map();
      for (var i = 0; i < WORDS.length; i++) RARITY.set(WORDS[i], tiers.charCodeAt(i) - 48);
    });
}

/* ═══════════ règle de correspondance ═══════════
   Les deux lettres de la paire, dans l'ordre, où que ce soit dans le mot :
   PL → PoLogne, PLongeon, PaLudisme, exPLoser.
   On retient le placement le plus écarté, celui qui rapporte le plus.   */
function matchPair(word, pair) {
  var a = pair[0].toLowerCase(), b = pair[1].toLowerCase();
  for (var p = word.length - 1; p >= 1; p--) {
    if (word[p] !== b) continue;
    var q = word.lastIndexOf(a, p - 1);
    if (q !== -1) return [q, p];
  }
  return null;
}

/* ═══════════ tirage d'une plaque ═══════════ */
function pairPool() {
  var d = DIFF[state.diff];
  var f = Math.pow(1.5, state.skill || 0);            // > 1 : plus rare ; < 1 : plus riche
  var lo = d.nMin / f, hi = d.nMax / f;
  var pool = window.PAIRS.filter(function (p) { return p.n >= lo && p.n <= hi && p.ex.length >= 8; });
  return pool.length >= 8 ? pool : window.PAIRS.filter(function (p) { return p.n >= d.nMin && p.n <= d.nMax && p.ex.length >= 8; });
}
function pickDepartement() {
  var all = window.DEPARTEMENTS, have = collection();
  var missing = all.filter(function (d) { return have.indexOf(d.num) === -1; });
  // deux fois sur trois, un département encore absent de la collection
  return (missing.length && state.rng() < 0.66) ? pick(missing) : pick(all);
}
function newPlate(easy) {
  // une paire de lettres n'est tirée qu'une seule fois par partie, quelle que soit la plaque
  var fresh = function (list) { return list.filter(function (p) { return !state.usedPairs[p.p]; }); };
  var pool = fresh(pairPool());
  if (easy) {                      // une première cible accessible, quelle que soit la difficulté
    var rich = fresh(window.PAIRS.filter(function (p) { return p.n >= 1200 && p.ex.length >= 8; }));
    if (rich.length >= 8) pool = rich;
  }
  if (pool.length < 2) pool = fresh(window.PAIRS.filter(function (p) { return p.ex.length >= 8; }));
  if (pool.length < 2) { state.usedPairs = {}; pool = pairPool(); }   // tout a servi : on repart

  var p1 = pick(pool), p2, guard = 0;
  do { p2 = pick(pool); guard++; } while (guard < 80 && (p2.p === p1.p || p2.p[0] === p1.p[0]));
  state.usedPairs[p1.p] = true;
  state.usedPairs[p2.p] = true;
  return { p1: p1, p2: p2, dep: pickDepartement(), value: plateValue(p1, p2) };
}

/* ═══════════ carrière : neuf véhicules, trois métaux, gravis avec les points ═══════════
   Chaque point marqué en partie compte. Citadine bronze → argent → or, puis utilitaire
   bronze… jusqu'au coupé or. Certains rangs débloquent une teinte de carrosserie.        */
var VEHICLES = [
  { id: 'citadine', name: 'Citadine' },
  { id: 'van',      name: 'Utilitaire' },
  { id: 'camper',   name: 'Camping-car' },
  { id: 'berline',  name: 'Berline',   unlock: 'violet' },
  { id: 'suv',      name: 'Break' },
  { id: '4x4',      name: '4×4' },
  { id: 'pickup',   name: 'Pick-up',   unlock: 'chrome' },
  { id: 'cabrio',   name: 'Cabriolet' },
  { id: 'coupe',    name: 'Coupé sport', unlock: 'nacre' }
];
var METALS = ['bronze', 'argent', 'or'];
var RANKS = [];
for (var vi = 0; vi < VEHICLES.length; vi++) {
  for (var mi = 0; mi < METALS.length; mi++) {
    var k = vi * 3 + mi;
    RANKS.push({
      vehicle: VEHICLES[vi], metal: METALS[mi],
      name: VEHICLES[vi].name + ' ' + METALS[mi],
      pts: k === 0 ? 0 : Math.round(1200 * Math.pow(k, 1.75) / 100) * 100,   // 1 200, 4 000, 8 200 … ≈ 360 000
      unlock: mi === 0 ? VEHICLES[vi].unlock : null
    });
  }
}
var CAREER = { mission: 400, dep: 100 };
var BASE_COLORS = ['rouge', 'bleu', 'blanc', 'noir', 'vert', 'jaune', 'gris', 'orange'];

function career() { return store.get('career', 0); }
function rankOf(pts) {
  var r = 0;
  for (var i = 0; i < RANKS.length; i++) if (pts >= RANKS[i].pts) r = i;
  return r;
}
function addCareer(n) {
  var before = rankOf(career()), after = career() + n;
  store.set('career', after);
  if (rankOf(after) > before) session.newRank = RANKS[rankOf(after)];
}
function colors() {
  var r = rankOf(career()), out = BASE_COLORS.slice();
  for (var i = 0; i <= r; i++) if (RANKS[i].unlock) out.push(RANKS[i].unlock);
  return out;
}
function rankSprite(rank) { return 'assets/cars/' + rank.vehicle.id + '-' + rank.metal + '.webp'; }

/* ═══════════ série de jours : une partie par jour l'entretient ═══════════
   Le bonus de carrière grimpe de 10 % par jour de série, jusqu'à +100 %.        */
function streak() { return store.get('streak', { last: 0, n: 0 }); }
function streakAlive(s) { var d = dayNum(); return s.last === d || s.last === d - 1; }
function streakBonus(s) { return streakAlive(s) && s.n > 1 ? Math.min(10, s.n - 1) * 0.1 : 0; }
function bumpStreak() {
  var s = streak(), d = dayNum();
  if (s.last === d) return s;
  s.n = (s.last === d - 1) ? s.n + 1 : 1;
  s.last = d;
  store.set('streak', s);
  return s;
}

/* ═══════════ difficulté adaptative ═══════════
   Trois plaques ratées d'affilée : des paires plus riches. Des plaques lues à la
   chaîne : des paires plus rares, donc des cotes plus hautes. Invisible, borné.  */
function adapt(delta) {
  state.skill = Math.max(-3, Math.min(3, (state.skill || 0) + delta));
}

/* ═══════════ badges ═══════════ */
var BADGES = [
  { id: 'lettre',   name: 'Lettré',         txt: '50 mots rares',             stat: 'rare',   goal: 50,  icon: 'book',    metal: 'bronze', tint: '#4f7cf0' },
  { id: 'erudit',   name: 'Érudit',         txt: '200 mots rares',            stat: 'rare',   goal: 200, icon: 'book',    metal: 'or', tint: '#3b5fd6' },
  { id: 'expert',   name: 'Académicien',    txt: '20 mots d\'expert',         stat: 'expert', goal: 20,  icon: 'cap',     metal: 'argent', tint: '#8a5cf0' },
  { id: 'pyro',     name: 'Pyromane',       txt: '100 plaques lues',          stat: 'plates', goal: 100, icon: 'flame',   metal: 'bronze', tint: '#ff5a3c' },
  { id: 'incendie', name: 'Incendiaire',    txt: '500 plaques lues',          stat: 'plates', goal: 500, icon: 'flame',   metal: 'or', tint: '#e03a1e' },
  { id: 'demineur', name: 'Démineur',       txt: '10 camions-citernes',       stat: 'tank',   goal: 10,  icon: 'barrel',  metal: 'argent', tint: '#ff9a3c' },
  { id: 'orfevre',  name: 'Orfèvre',        txt: '5 voitures dorées',         stat: 'gold',   goal: 5,   icon: 'gem',     metal: 'or', tint: '#ffcf3f' },
  { id: 'aligneur', name: 'Aligneur',       txt: '25 alignements de couleur', stat: 'lines',  goal: 25,  icon: 'align',   metal: 'argent', tint: '#3ddc84' },
  { id: 'fievre',   name: 'Fiévreux',       txt: '10 fièvres déclenchées',    stat: 'fever',  goal: 10,  icon: 'thermo',  metal: 'bronze', tint: '#ff3c6e' },
  { id: 'marathon', name: 'Marathonien',    txt: '30 parties',                stat: 'games',  goal: 30,  icon: 'clock',   metal: 'bronze', tint: '#35c4d6' },
  { id: 'forcene',  name: 'Forcené',        txt: '100 parties',               stat: 'games',  goal: 100, icon: 'clock',   metal: 'or', tint: '#1fa3b8' },
  { id: 'carto',    name: 'Cartographe',    txt: '50 départements',           stat: 'deps',   goal: 50,  icon: 'map',     metal: 'argent', tint: '#2e86de' },
  { id: 'tour',     name: 'Tour de France', txt: 'les 101 départements',      stat: 'deps',   goal: 101, icon: 'trophy',  metal: 'or', tint: '#ffb13d' },
  { id: 'assidu',   name: 'Assidu',         txt: '7 jours d\'affilée',        stat: 'streak', goal: 7,   icon: 'calendar', metal: 'bronze', tint: '#ff8a3c' },
  { id: 'fidele',   name: 'Fidèle',         txt: '30 jours d\'affilée',       stat: 'streak', goal: 30,  icon: 'calendar', metal: 'or', tint: '#ff6a2a' }
];
/* pictogrammes en trait, 24×24 */
var ICONS = {
  book:     '<path d="M3 5h6a3 3 0 0 1 3 2 3 3 0 0 1 3-2h6v13h-6a3 3 0 0 0-3 2 3 3 0 0 0-3-2H3zM12 7v13"/>',
  cap:      '<path d="M2 9l10-5 10 5-10 5zM6 11v4c0 2 3 4 6 4s6-2 6-4v-4M22 9v6"/>',
  flame:    '<path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3-1-3-1-6 1-9z"/>',
  barrel:   '<path d="M6 4h12v16H6zM6 9h12M6 15h12M9 4v16M15 4v16"/>',
  gem:      '<path d="M7 3h10l4 6-9 12-9-12zM3 9h18M9 9l3 12M15 9l-3 12"/>',
  align:    '<path d="M3 8h5v8H3zM9.5 8h5v8h-5zM16 8h5v8h-5z"/>',
  thermo:   '<path d="M10 4a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0zM12 8v7"/>',
  clock:    '<circle cx="12" cy="13" r="8"/><path d="M12 8v5l3 2M9 3h6"/>',
  map:      '<path d="M12 2l8 5v10l-8 5-8-5V7zM12 7l4 2.5v5L12 17l-4-2.5v-5z"/>',
  trophy:   '<path d="M7 4h10v5a5 5 0 0 1-10 0zM5 5H3v2a4 4 0 0 0 4 3M19 5h2v2a4 4 0 0 1-4 3M9 21h6M12 14v7"/>',
  calendar: '<path d="M4 6h16v14H4zM4 11h16M8 3v5M16 3v5M8 15h2M12 15h2"/>'
};
/* une médaille en trois dimensions : face bombée aux reflets métalliques, tranche
   épaisse, dos gravé. Verrouillée : grise. En grand, elle tourne sur elle-même. */
function badgeMedal(b, ok, size, spin) {
  var s = size || 64;
  var slices = '';
  for (var i = 1; i <= 8; i++) slices += '<i class="medal__slice" style="transform:translateZ(' + (-i * s * 0.011) + 'px)"></i>';
  var icon = ICONS[b.icon];
  return '<div class="medal medal--' + b.metal + (ok ? '' : ' medal--off') + (spin ? ' medal--spin' : '') +
         '" style="--size:' + s + 'px;--tint:' + b.tint + '" data-badge="' + b.id + '">' +
           '<div class="medal__body">' +
             slices +
             '<div class="medal__face medal__face--front">' +
               '<div class="medal__rim"></div>' +
               '<div class="medal__rivets"></div>' +
               '<div class="medal__inner"></div>' +
               '<div class="medal__dome"></div>' +
               '<svg viewBox="0 0 24 24" class="medal__icon medal__icon--shadow" fill="none" stroke="#000" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' + icon + '</svg>' +
               '<svg viewBox="0 0 24 24" class="medal__icon" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' + icon + '</svg>' +
               '<div class="medal__glint"></div>' +
               (ok ? '<i class="medal__spark s1"></i><i class="medal__spark s2"></i><i class="medal__spark s3"></i><i class="medal__spark s4"></i>' : '') +
             '</div>' +
             '<div class="medal__face medal__face--back"><span>PLAQUE</span><b>' + b.name + '</b></div>' +
           '</div>' +
         '</div>';
}
var badgeSVG = badgeMedal;

/* la médaille en grand */
function openMedal(b) {
  var got = store.get('badges', {}), s = stats(), ok = !!got[b.id];
  var v = Math.min(b.goal, s[b.stat] || 0);
  $('medal-stage').innerHTML = badgeMedal(b, ok, 210, true);
  $('medal-name').textContent = b.name;
  $('medal-txt').textContent = b.txt;
  $('medal-state').innerHTML = ok
    ? '<b>Obtenu</b>' + (got[b.id] > 1 ? ' — ' + new Date(got[b.id] * 86400000).toLocaleDateString('fr-FR') : '')
    : v + ' / ' + b.goal + ' — <u style="width:' + Math.round(v / b.goal * 100) + '%"></u>';
  $('medal-modal').hidden = false;
  $('medal-stage').style.setProperty('--tint', b.tint);
  $('medal-stage').classList.toggle('medal-stage--off', !ok);
  ok ? sfx.win() : sfx.time();
}

function stats() { return store.get('stats', {}); }
function bumpStat(key, n, absolute) {
  var s = stats();
  s[key] = absolute ? Math.max(s[key] || 0, n) : (s[key] || 0) + n;
  store.set('stats', s);
  var got = store.get('badges', {});
  BADGES.forEach(function (b) {
    if (got[b.id] || b.stat !== key || s[key] < b.goal) return;
    got[b.id] = dayNum();
    store.set('badges', got);
    session.badges.push(b);
    toast(badgeSVG(b, true, 30) + ' Badge <b>' + b.name + '</b> — ' + b.txt);
    sfx.win();
  });
}

/* ═══════════ missions du jour ═══════════ */
var MISSION_TYPES = {
  plates:  { n: [8, 12, 20],   txt: function (n) { return 'Pulvériser ' + n + ' voitures'; } },
  sport:   { n: [2, 3, 4],     txt: function (n) { return 'Pulvériser ' + n + ' coupés'; } },
  lines:   { n: [1, 2, 3],     txt: function (n) { return n + ' alignement' + (n > 1 ? 's' : '') + ' de couleur en Parking'; } },
  long:    { n: [9, 10, 11],   txt: function (n) { return 'Jouer un mot de ' + n + ' lettres ou plus'; } },
  rare:    { n: [2, 3, 5],     txt: function (n) { return 'Jouer ' + n + ' mots rares'; } },
  combo5:  { n: [1, 2, 3],     txt: function (n) { return 'Atteindre ×5 ' + (n > 1 ? n + ' fois' : 'une fois'); } },
  score:   { n: [1500, 2500, 4000], txp: function (n) { return 'Marquer ' + n + ' points en une partie'; } },
  deps:    { n: [1, 2, 3],     txt: function (n) { return 'Découvrir ' + n + ' nouveau' + (n > 1 ? 'x' : '') + ' département' + (n > 1 ? 's' : ''); } },
  gold:    { n: [1, 1, 2],     txt: function (n) { return 'Pulvériser ' + (n > 1 ? n + ' voitures dorées' : 'une voiture dorée'); } }
};
MISSION_TYPES.score.txt = MISSION_TYPES.score.txp;
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    var t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function dayNum() {
  var d = new Date();
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
}
function missions() {
  var day = dayNum(), saved = store.get('missions', null);
  if (saved && saved.day === day) return saved;
  var rng = mulberry32(day * 7919 + 17), keys = Object.keys(MISSION_TYPES), list = [];
  while (list.length < 3) {
    var k = keys[Math.floor(rng() * keys.length)];
    if (list.some(function (m) { return m.type === k; })) continue;
    var lvl = Math.floor(rng() * 3);
    list.push({ type: k, goal: MISSION_TYPES[k].n[lvl], done: 0, ok: false });
  }
  saved = { day: day, list: list };
  store.set('missions', saved);
  return saved;
}
function missionLabel(m) { return MISSION_TYPES[m.type].txt(m.goal); }
function progress(type, n, absolute) {
  var ms = missions(), hit = null;
  ms.list.forEach(function (m) {
    if (m.type !== type || m.ok) return;
    m.done = absolute ? Math.max(m.done, n) : m.done + n;
    if (m.done >= m.goal) { m.ok = true; m.done = m.goal; hit = m; addCareer(CAREER.mission); }
  });
  store.set('missions', ms);
  if (hit) {
    session.missionsDone.push(missionLabel(hit));
    toast('🎯 Mission accomplie — ' + missionLabel(hit) + ' · +' + CAREER.mission + ' pts de carrière');
  }
}

/* ═══════════ suivi d'une partie : statistiques, missions, XP ═══════════ */
var session = {};
function sessionStart() {
  session = { words: 0, bestWord: null, bestWordPts: 0, maxCombo: 1, bestPlate: null, bestPlatePts: 0,
              plates: 0, sport: 0, rare: 0, expert: 0, gold: 0, lines: 0, newDeps: 0, newRank: null, missionsDone: [],
              badges: [], missed: [], t0: Date.now() };
}
var track = {
  word: function (w, pts, tier, combo) {
    session.words++;
    if (pts > session.bestWordPts) { session.bestWordPts = pts; session.bestWord = w; }
    if (combo > session.maxCombo) session.maxCombo = combo;
    if (combo >= 5) progress('combo5', 1);
    if (tier === 2) { session.rare++; progress('rare', 1); bumpStat('rare', 1); }
    if (tier === 2 && w.length >= 9) { session.expert++; bumpStat('expert', 1); }
    if (combo >= 5 && !session.fever5) { session.fever5 = true; }
    progress('long', w.length, true);
  },
  plate: function (label, pts, opts) {
    session.plates++;
    bumpStat('plates', 1);
    adapt(0.5);
    if (opts && opts.tank) bumpStat('tank', 1);
    if (opts && opts.dep && collect(opts.dep)) {
      session.newDeps++;
      progress('deps', 1);
      addCareer(CAREER.dep);
      bumpStat('deps', collection().length, true);
      toast('🗺️ Nouveau département — ' + opts.dep + ' ' + (opts.depName || '') + ' · ' + collection().length + '/101');
    }
    if (pts > session.bestPlatePts) { session.bestPlatePts = pts; session.bestPlate = label; }
    progress('plates', 1);
    if (opts && opts.sport) { session.sport++; progress('sport', 1); }
    if (opts && opts.gold)  { session.gold++;  progress('gold', 1); bumpStat('gold', 1); }
  },
  line:  function () { session.lines++; progress('lines', 1); bumpStat('lines', 1); },
  miss:  function (car) { session.missed.push(car); adapt(-1); },     // une plaque partie sans être lue
  fever: function () { bumpStat('fever', 1); }
};

/* ═══════════ le « juice » : compteurs qui défilent, score qui réagit ═══════════ */
var tweens = {};
function tweenNumber(el, to, ms) {
  var id = el.id || Math.random();
  var from = parseInt((el.dataset.val || el.textContent).replace(/\D/g, ''), 10) || 0;
  if (from === to) { el.textContent = to; el.dataset.val = to; return; }
  cancelAnimationFrame(tweens[id]);
  var t0 = performance.now(), dur = ms || 500;
  el.dataset.val = to;
  var step = function (now) {
    var k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    el.textContent = Math.round(from + (to - from) * e);
    if (k < 1) tweens[id] = requestAnimationFrame(step);
  };
  tweens[id] = requestAnimationFrame(step);
}
function bump(el, cls) {
  el.classList.remove(cls || 'bump'); void el.offsetWidth; el.classList.add(cls || 'bump');
}
/* les points gagnés jaillissent du champ de saisie */
function floatPts(input, txt, cls) {
  var f = document.createElement('i');
  f.className = 'float ' + (cls || '');
  f.textContent = txt;
  var r = input.getBoundingClientRect();
  f.style.left = (r.left + 24 + Math.random() * 60) + 'px';
  f.style.top = (r.top - 6) + 'px';
  document.body.appendChild(f);
  setTimeout(function () { f.remove(); }, 1000);
}
/* confettis pour un record ou un nouveau rang */
function confetti(n) {
  var box = document.createElement('div');
  box.className = 'confetti';
  var tints = ['#ffcf3f', '#3ddc84', '#ff6b6b', '#8ab6ff', '#ff9a3c', '#fff'];
  for (var i = 0; i < (n || 60); i++) {
    var p = document.createElement('i');
    p.style.left = (Math.random() * 100) + 'vw';
    p.style.background = tints[i % tints.length];
    p.style.animationDelay = (Math.random() * 0.8) + 's';
    p.style.animationDuration = (1.8 + Math.random() * 1.4) + 's';
    p.style.transform = 'rotate(' + (Math.random() * 360) + 'deg)';
    box.appendChild(p);
  }
  document.body.appendChild(box);
  setTimeout(function () { box.remove(); }, 3600);
}

/* petit message éphémère, en haut de l'écran */
function toast(msg) {
  var t = $('toast');
  t.innerHTML = msg;
  t.classList.remove('go');
  void t.offsetWidth;
  t.classList.add('go');
}

/* ═══════════ fantôme du record : le score du record au même instant ═══════════ */
var ghost = { ref: null, cur: [] };
function ghostKey() { return 'ghost.' + state.mode + '.' + state.diff; }
function ghostStart() { ghost.ref = store.get(ghostKey(), null); ghost.cur = []; }
function ghostSample(sec, score) { ghost.cur[Math.floor(sec)] = score; }
function ghostAt(sec) {
  if (!ghost.ref) return null;
  var i = Math.min(ghost.ref.length - 1, Math.floor(sec));
  while (i >= 0 && ghost.ref[i] == null) i--;
  return i < 0 ? 0 : ghost.ref[i];
}
function ghostCommit(isBest) {
  if (!isBest) return;
  var arr = [], last = 0;
  for (var i = 0; i < ghost.cur.length; i++) { if (ghost.cur[i] != null) last = ghost.cur[i]; arr.push(last); }
  store.set(ghostKey(), arr);
}
/* la pastille du HUD alterne : écart au record, puis distance au prochain rang */
function paintGhost(el, sec, score) {
  var showRank = Math.floor(sec / 5) % 2 === 1;
  var ref = ghostAt(sec);
  if (showRank || ref == null) {
    var pts = career() + score, r = rankOf(pts), nx = RANKS[r + 1];
    if (!nx) { el.textContent = ''; el.className = 'ghost'; return; }
    el.textContent = nx.name + ' dans ' + (nx.pts - pts);
    el.className = 'ghost ghost--rank';
    return;
  }
  var d = score - ref;
  el.textContent = (d >= 0 ? '+' : '') + d + ' vs record';
  el.className = 'ghost ' + (d >= 0 ? 'ghost--up' : 'ghost--down');
}

/* ═══════════ valeur d'un mot : longueur, écartement, rareté ═══════════
   Le vocabulaire paie : au-delà de 7 lettres chaque lettre vaut le double, un mot
   peu courant rapporte +25, un mot rare +70, et un mot rare de 9 lettres ou plus
   est un « mot d'expert » : ×1,5 sur le tout.                                     */
function wordScore(w, hit) {
  var len = w.length;
  var base = 10 + 5 * Math.min(4, Math.max(0, len - 3)) + 10 * Math.max(0, len - 7);
  var spread = Math.min(15, Math.max(0, hit[1] - hit[0] - 2) * 3);
  var tier = RARITY ? (RARITY.get(w) || 0) : 0;
  var rare = len >= 5 ? (tier === 2 ? 70 : tier === 1 ? 25 : 0) : 0;
  var expert = tier === 2 && len >= 9;
  var pts = Math.round((base + spread + rare) * (expert ? 1.5 : 1));
  return { pts: pts, base: base, spread: spread, rare: rare, tier: tier, expert: expert,
           label: expert ? '🎓 mot d\'expert ×1,5' : tier === 2 && rare ? '💎 mot rare +' + rare
                : tier === 1 && rare ? 'mot peu courant +' + rare : '' };
}

/* ═══════════ cote d'une plaque : les trois chiffres disent ce qu'elle vaut ═══════════ */
function plateValue(p1, p2) {
  var lo = Math.log(40), hi = Math.log(4200);
  var m = (Math.log(p1.n) + Math.log(p2.n)) / 2;
  var t = Math.max(0, Math.min(1, (m - lo) / (hi - lo)));       // 0 = paires rares, 1 = paires riches
  return Math.round((100 + 800 * (1 - t)) / 5) * 5;
}

/* Fin de partie partagée par les modes : le récap du mode, puis l'écran de résultat. */
var modeRecap = '';
function finishGame(recapHtml, baseScore) {
  unfit();
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  modeRecap = recapHtml;
  state.total = baseScore;
  endGame();
}

function row(k, v, dim, total) {
  return '<div class="recap__row' + (dim ? ' dim' : '') + (total ? ' total' : '') +
         '"><span>' + k + '</span><span>' + v + '</span></div>';
}

/* ═══════════ fin de partie ═══════════ */
function endGame() {
  var m = MODES[state.mode];
  var best = store.get(bestKey(), 0);
  var isBest = state.total > best;
  if (isBest) store.set(bestKey(), state.total);
  ghostCommit(isBest);
  progress('score', state.total, true);
  bumpStat('games', 1);
  if (session.fever5) bumpStat('combo5', 1);

  var beforePts = career(), beforeRank = rankOf(beforePts);
  var st = bumpStreak();
  bumpStat('streak', st.n, true);
  var bonus = streakBonus(st);
  var gained = Math.round(state.total * (1 + bonus));
  addCareer(gained);
  animateRank(beforePts, beforeRank, career());
  if (!store.get('tuto', false)) store.set('tuto', true);

  $('end-title').textContent = m.parking ? 'Parking — fin de service' : m.pursuit ? 'Fin de course' : 'Vous êtes arrivé';
  $('end-score').textContent = '0'; $('end-score').dataset.val = '0';
  setTimeout(function () { tweenNumber($('end-score'), state.total, 1200); }, 250);
  if (isBest || rankOf(career()) > beforeRank) setTimeout(function () { confetti(isBest ? 90 : 60); }, 700);
  $('end-best').innerHTML = isBest
    ? '🏆 <b>Nouveau record</b> en ' + m.label + ' · ' + DIFF[state.diff].label +
      (best ? ' — l\'ancien : ' + best : '')
    : 'Record ' + m.label + ' · ' + DIFF[state.diff].label + ' : <b>' + best + '</b> — il manque ' + (best - state.total);

  var s = session, html = modeRecap || '';
  if (s.bestWord) html += row('Meilleur mot', '<b>' + s.bestWord.toUpperCase() + '</b> · ' + s.bestWordPts + ' pts');
  if (s.bestPlate) html += row('Voiture la plus chère', '<b class="mono">' + s.bestPlate + '</b> · ' + s.bestPlatePts + ' pts');
  html += row('Plus longue série', '×' + s.maxCombo);
  if (s.rare) html += row('Vocabulaire', s.rare + ' mot' + (s.rare > 1 ? 's' : '') + ' rare' + (s.rare > 1 ? 's' : '') +
                          (s.expert ? ' dont ' + s.expert + ' d\'expert 🎓' : ''));
  html += row('Mots · plaques', s.words + ' · ' + s.plates + (s.sport ? ' (dont ' + s.sport + ' coupé' + (s.sport > 1 ? 's' : '') + ')' : ''));
  if (s.lines) html += row('Alignements de couleur', s.lines);
  if (s.newDeps) html += row('🗺️ Nouveaux départements', s.newDeps + ' — collection ' + collection().length + '/101');
  s.missionsDone.forEach(function (lbl) { html += row('🎯 Mission accomplie', lbl); });
  if (s.newRank) html += row('🏅 Nouveau rang', '<b>' + s.newRank.name + '</b>' +
                             (s.newRank.unlock ? ' — teinte <b>' + s.newRank.unlock + '</b> débloquée' : ''));
  html += row('🔥 Série de jours', st.n + ' jour' + (st.n > 1 ? 's' : '') +
              (bonus ? ' — carrière <b>+' + Math.round(bonus * 100) + ' %</b> : ' + gained + ' pts' : ''));
  session.badges.forEach(function (b) { html += row('Badge', badgeSVG(b, true, 34) + ' <b>' + b.name + '</b> — ' + b.txt); });
  html += missedHtml();
  $('end-recap').innerHTML = html + row('Total', state.total + ' pts', false, true);
  $('btn-share').textContent = 'Copier mon résultat';
  screen('screen-end');
}

/* la barre de rang de l'écran de fin se remplit sous les yeux du joueur */
function animateRank(fromPts, fromRank, toPts) {
  var box = $('end-rank');
  var rk = RANKS[fromRank], nx = RANKS[fromRank + 1];
  var toRank = rankOf(toPts);
  var pct = function (p, r) { var a = RANKS[r], b = RANKS[r + 1]; return b ? Math.min(100, (p - a.pts) / (b.pts - a.pts) * 100) : 100; };
  box.querySelector('img').src = rankSprite(rk);
  box.querySelector('b').textContent = rk.name;
  box.querySelector('i').textContent = nx ? 'prochain : ' + nx.name + ' à ' + nx.pts : 'rang maximal';
  var bar = box.querySelector('.rank__fill');
  bar.style.transition = 'none';
  bar.style.width = pct(fromPts, fromRank) + '%';
  void bar.offsetWidth;
  bar.style.transition = 'width 1.4s cubic-bezier(.2,.7,.3,1)';
  setTimeout(function () {
    bar.style.width = (toRank > fromRank ? 100 : pct(toPts, fromRank)) + '%';
    if (toRank > fromRank) setTimeout(function () {
      var nr = RANKS[toRank];
      box.querySelector('img').src = rankSprite(nr);
      box.querySelector('b').textContent = nr.name;
      box.querySelector('i').textContent = RANKS[toRank + 1] ? 'prochain : ' + RANKS[toRank + 1].name + ' à ' + RANKS[toRank + 1].pts : 'rang maximal';
      box.classList.add('rank--up');
      bar.style.transition = 'none'; bar.style.width = '0%'; void bar.offsetWidth;
      bar.style.transition = 'width 1s ease-out'; bar.style.width = pct(toPts, toRank) + '%';
      sfx.win();
    }, 1500);
  }, 350);
}

/* ce que le joueur aurait pu jouer sur les plaques qui lui ont échappé */
function missedHtml() {
  var out = [], seen = {};
  session.missed.forEach(function (car) {
    [[car.p1, car.got1], [car.p2, car.got2]].forEach(function (pp) {
      if (pp[1] || out.length >= 6 || seen[pp[0]]) return;
      var pair = window.PAIRS.filter(function (p) { return p.p === pp[0]; })[0];
      if (!pair) return;
      seen[pp[0]] = true;
      var w = pair.ex[Math.floor(Math.random() * Math.min(4, pair.ex.length))];
      var hit = matchPair(norm(w), pp[0]);
      var html = '', k = 0;
      for (var i = 0; i < w.length; i++) {
        var plain = norm(w[i]);
        html += (plain && hit && (k === hit[0] || k === hit[1])) ? '<b>' + w[i] + '</b>' : w[i];
        if (plain) k++;
      }
      out.push('<em>' + pp[0] + ' → ' + html + '</em>');
    });
  });
  if (!out.length) return '';
  return '<div class="recap__row recap__row--missed"><span>Vous auriez pu jouer</span><span>' + out.join(' ') + '</span></div>';
}

/* ═══════════ page des badges ═══════════ */
function renderBadges() {
  var got = store.get('badges', {}), s = stats();
  $('badges-intro').innerHTML = '<b>' + Object.keys(got).length + '</b> badge' + (Object.keys(got).length > 1 ? 's' : '') + ' sur ' + BADGES.length;
  $('badges-list').innerHTML = BADGES.map(function (b) {
    var ok = !!got[b.id], v = Math.min(b.goal, s[b.stat] || 0);
    return '<div class="badge' + (ok ? ' badge--on' : '') + '" data-badge="' + b.id + '">' + badgeMedal(b, ok, 64) +
           '<div class="badge__txt"><b>' + b.name + '</b><span>' + b.txt + '</span>' +
           '<i>' + (ok ? '✓ obtenu' : v + ' / ' + b.goal) + '</i>' +
           (ok ? '' : '<u style="width:' + Math.round(v / b.goal * 100) + '%"></u>') + '</div></div>';
  }).join('');
  screen('screen-badges');
}

function shareText() {
  var m = MODES[state.mode], h = state.history;
  var words = h.reduce(function (a, x) { return a + x.words; }, 0);
  var done = h.filter(function (x) { return x.reached; }).length;
  var lines = [], bars = '';
  if (m.pursuit) {
    lines.push('🏁 PLAQUE — Poursuite  ·  ' + DIFF[state.diff].label);
    lines.push(done + ' voiture' + (done > 1 ? 's' : '') + ' dégommée' + (done > 1 ? 's' : '') + ' sur ' + h.length);
    for (var u = 0; u < Math.min(12, h.length); u++) bars += h[u].reached ? '💥' : '⬜';
  } else if (m.parking) {
    lines.push('💥 PLAQUE — Parking  ·  ' + DIFF[state.diff].label);
    lines.push(done + ' voiture' + (done > 1 ? 's' : '') + ' pulvérisée' + (done > 1 ? 's' : '') + ' sur ' + h.length);
    for (var q = 0; q < h.length; q++) bars += h[q].reached ? '💥' : '⬜';
  } else {
    lines.push('🚦 PLAQUE — Trafic  ·  ' + DIFF[state.diff].label);
    lines.push(done + ' voiture' + (done > 1 ? 's' : '') + ' pulvérisée' + (done > 1 ? 's' : '') +
               ' sur ' + h.length + ' croisée' + (h.length > 1 ? 's' : ''));
    for (var t = 0; t < Math.min(12, h.length); t++) bars += h[t].reached ? '💥' : '⬜';
  }
  lines.push(state.total + ' pts · ' + words + ' mot' + (words > 1 ? 's' : '') + (bars ? '  ' + bars : ''));
  lines.push('🗺️ ' + collection().length + '/101 départements');
  return lines.join('\n');
}
function copyShare() {
  var txt = shareText();
  var done = function () {
    $('btn-share').textContent = '✓ Copié — collez où vous voulez';
    setTimeout(function () { $('btn-share').textContent = 'Copier mon résultat'; }, 2600);
  };
  function fallback() {
    var ta = document.createElement('textarea');
    ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { window.prompt('Votre résultat :', txt); }
    document.body.removeChild(ta);
  }
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, fallback);
  else fallback();
}

/* ═══════════ collection ═══════════ */
function renderCollection() {
  var have = collection(), all = window.DEPARTEMENTS;
  $('collec-intro').innerHTML = '<b>' + have.length + '</b> département' + (have.length > 1 ? 's' : '') +
    ' sur 101 — chaque plaque entièrement lue ajoute le sien';
  $('collec-fill').style.width = (have.length / all.length * 100) + '%';
  var byRegion = {};
  all.forEach(function (d) { (byRegion[d.region] = byRegion[d.region] || []).push(d); });
  var html = '';
  Object.keys(byRegion).sort().forEach(function (reg) {
    var list = byRegion[reg];
    var n = list.filter(function (d) { return have.indexOf(d.num) !== -1; }).length;
    html += '<div class="collec__reg"><h3>' + reg + ' <i>' + n + '/' + list.length + '</i></h3><div class="collec__row">';
    list.forEach(function (d) {
      var ok = have.indexOf(d.num) !== -1;
      html += '<div class="dep' + (ok ? ' dep--on' : '') + '" title="' +
              (ok ? d.nom + ' — ' + d.chef : 'pas encore identifié') + '">' + d.num + '</div>';
    });
    html += '</div></div>';
  });
  $('collec-grid').innerHTML = html;
  screen('screen-collection');
}

/* ═══════════ écran carrière : les 27 rangs ═══════════ */
function renderCareer() {
  var pts = career(), r = rankOf(pts);
  $('career-intro').innerHTML = '<b>' + pts + '</b> points de carrière — chaque point marqué en partie compte, ' +
    'les missions en rapportent ' + CAREER.mission + ', un nouveau département ' + CAREER.dep + '.';
  var html = '';
  VEHICLES.forEach(function (v, vi) {
    html += '<div class="career__row"><h3>' + v.name + (v.unlock ? ' <i>débloque la teinte ' + v.unlock + '</i>' : '') + '</h3><div class="career__metals">';
    METALS.forEach(function (m, mi) {
      var k = vi * 3 + mi, rk = RANKS[k];
      var cls = k < r ? 'got' : k === r ? 'now' : 'todo';
      html += '<div class="career__rank career__rank--' + cls + '"><img src="' + rankSprite(rk) + '" alt="">' +
              '<span>' + m + '</span><b>' + (k === 0 ? '—' : rk.pts) + '</b></div>';
    });
    html += '</div></div>';
  });
  $('career-list').innerHTML = html;
  screen('screen-career');
}

/* ═══════════ explosion (Parking, Trafic) ═══════════
   Particules en CSS pur : flash, onde de choc, éclats, fumée, secousse du décor. */
function explode(fx, shakeEl) {
  var html = '<div class="flash"></div><div class="ring"></div>';
  var tints = ['#ffd479', '#ff9a3c', '#ff6a2a', '#c9ced6', '#8b9099'];
  for (var i = 0; i < 24; i++) {
    var a = Math.random() * Math.PI * 2, r = 45 + Math.random() * 120;
    var sz = (5 + Math.random() * 8).toFixed(0);
    html += '<i class="frag" style="--dx:' + (Math.cos(a) * r).toFixed(0) + 'px;' +
            '--dy:' + (Math.sin(a) * r * 0.8 - 42).toFixed(0) + 'px;' +
            '--rot:' + (Math.random() * 900 - 450).toFixed(0) + 'deg;' +
            'width:' + sz + 'px;height:' + sz + 'px;background:' + tints[i % tints.length] + ';' +
            'animation-delay:' + (Math.random() * 110).toFixed(0) + 'ms"></i>';
  }
  for (var s = 0; s < 5; s++) {
    html += '<i class="smoke" style="left:' + (26 + Math.random() * 48).toFixed(0) + '%;' +
            'animation-delay:' + (s * 80) + 'ms"></i>';
  }
  fx.innerHTML = html;
  if (shakeEl) {
    shakeEl.classList.remove('lot--shake');
    void shakeEl.offsetWidth;
    shakeEl.classList.add('lot--shake');
  }
  sfx.dbl();
  setTimeout(function () { fx.innerHTML = ''; }, 1400);
}

/* ═══════════ démarrage ═══════════ */
function newGame() {
  state.total = 0; state.history = []; state.rng = Math.random; state.usedPairs = {};
  sessionStart();
  ghostStart();
  guideStart();
  state.skill = 0;
  if (MODES[state.mode].parking) window.PARKING.start();
  else if (MODES[state.mode].pursuit) window.PURSUIT.start();
  else window.TRAFFIC.start();
}
function stopAll() {
  if (window.TRAFFIC) window.TRAFFIC.stop();
  if (window.PARKING) window.PARKING.stop();
  if (window.PURSUIT) window.PURSUIT.stop();
}
function refreshHome() {
  var m = MODES[state.mode];
  $('stat-collec').textContent = collection().length + '/101';
  $('stat-best').textContent = store.get(bestKey(), 0);
  var s = streak(), alive = streakAlive(s);
  $('stat-streak').textContent = alive ? s.n : 0;
  $('stat-streak-k').textContent = !alive ? 'Jours d\'affilée' : s.last === dayNum() ? 'Jours d\'affilée ✓' : 'Jours — jouez aujourd\'hui';
  var gotB = store.get('badges', {});
  $('stat-badges').textContent = Object.keys(gotB).length + '/' + BADGES.length;
  var recent = BADGES.filter(function (b) { return gotB[b.id]; }).sort(function (a, b) { return gotB[b.id] - gotB[a.id]; }).slice(0, 4);
  $('stat-badges-row').innerHTML = recent.length ? recent.map(function (b) { return badgeSVG(b, true, 22); }).join('') : '';
  var pts = career(), r = rankOf(pts), rk = RANKS[r], next = RANKS[r + 1];
  $('stat-rank').textContent = rk.name;
  $('rank-img').src = rankSprite(rk);
  $('rank-img').className = 'rank__img rank__img--' + rk.metal;
  $('rank-bar').style.width = next ? Math.round((pts - rk.pts) / (next.pts - rk.pts) * 100) + '%' : '100%';
  $('rank-xp').textContent = next ? pts + ' / ' + next.pts + ' pts' : pts + ' pts';
  $('rank-next').textContent = next ? 'Prochain : ' + next.name : 'Rang maximal';
  $('missions').innerHTML = missions().list.map(function (mi) {
    return '<li class="mission' + (mi.ok ? ' mission--ok' : '') + '"><span>' + missionLabel(mi) + '</span>' +
           '<b>' + (mi.ok ? '✓' : mi.done + '/' + mi.goal) + '</b></li>';
  }).join('');
  $('btn-play').textContent = m.parking ? 'Entrer dans le parking' : m.pursuit ? 'Mettre les gaz' : 'Démarrer le moteur';
}
function segmented(id, key, after) {
  var box = $(id);
  box.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    var all = box.querySelectorAll('button');
    for (var i = 0; i < all.length; i++) all[i].classList.remove('on');
    b.classList.add('on');
    state[key] = b.dataset.v;
    store.set(key, b.dataset.v);
    if (after) after();
  });
  var saved = store.get(key, null);
  if (saved) {
    var t = box.querySelector('[data-v="' + saved + '"]');
    if (t) t.click(); else store.set(key, state[key]);
  }
}

/* ═══════════ première partie guidée ═══════════
   Quelques bulles au bon moment, une seule fois, pour un joueur qui découvre.   */
var guide = { on: false, step: 0 };
function guideStart() { guide.on = !store.get('tuto', false); guide.step = 0; }
function guideSay(step, msg) {
  if (!guide.on || guide.step >= step) return;
  guide.step = step;
  var t = $('guide');
  t.innerHTML = msg;
  t.classList.remove('go'); void t.offsetWidth; t.classList.add('go');
}

/* ═══════════ saisie sans bouton : le mot se valide tout seul ═══════════
   Une courte pause de frappe suffit quand ce qui est tapé est un mot du
   dictionnaire qui va sur une plaque ; Entrée ou l'espace valident sur-le-champ. */
var AUTO_MS = 550;      // la pause avant qu'un mot tapé se valide — assez pour finir « gagnant » après « gag », sans traîner
function autoSubmit(input, form, canAccept) {
  var timer = null;
  var fire = function () { clearTimeout(timer); timer = null; form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })); };
  input.addEventListener('input', function () {
    clearTimeout(timer); timer = null;
    var raw = input.value;
    if (/\s$/.test(raw)) { input.value = raw.trim(); if (input.value) fire(); return; }
    var w = norm(raw);
    if (w.length >= 3 && DICT && DICT.has(w) && canAccept(w)) timer = setTimeout(fire, AUTO_MS);
  });
}

/* ═══════════ mise en page au viewport visible ═══════════
   Sur téléphone, le clavier prend la moitié de l'écran : la scène se redimensionne
   pour que tout — compteurs, scène, jetons, champ — tienne dans ce qui reste,
   sans que la page ne défile.                                                    */
var fitted = null;
function fitViewport(screenId, sceneSel, stackSel) {
  fitted = { screen: screenId, scene: sceneSel, stack: stackSel };
  applyFit();
}
function applyFit() {
  if (!fitted) return;
  var scr = $(fitted.screen);
  if (!scr || !scr.classList.contains('active')) return;
  var vv = window.visualViewport;
  var h = Math.round(vv ? vv.height : window.innerHeight);
  document.body.classList.add('fitted');
  scr.style.height = h + 'px';
  var scene = scr.querySelector(fitted.scene);
  if (!scene) return;
  var used = 0;
  Array.prototype.forEach.call(scr.querySelectorAll(fitted.stack), function (el) {
    if (el === scene) return;
    var r = el.getBoundingClientRect();
    var st = getComputedStyle(el);
    used += r.height + parseFloat(st.marginTop) + parseFloat(st.marginBottom);
  });
  var pad = 28;
  var avail = Math.max(150, h - used - pad);
  if (scene.classList.contains('road')) {
    var ms = getComputedStyle(scene);
    scene.style.setProperty('--roadH', avail - parseFloat(ms.marginTop) - parseFloat(ms.marginBottom) + 'px');
  } else {                                   // le parking : on le réduit à l'échelle
    scene.style.transform = '';
    var nat = scene.offsetHeight;
    var k = Math.min(1, avail / nat);
    scene.style.transformOrigin = '50% 0';
    scene.style.transform = 'scale(' + k.toFixed(3) + ')';
    scene.style.marginBottom = (nat * k - nat + 8) + 'px';
  }
  window.scrollTo(0, 0);
}
function unfit() {
  fitted = null;
  document.body.classList.remove('fitted');
  Array.prototype.forEach.call(document.querySelectorAll('.screen'), function (s) { s.style.height = ''; });
  var road = document.querySelector('.road'); if (road) road.style.removeProperty('--roadH');
  var lot = $('pk-lot'); if (lot) { lot.style.transform = ''; lot.style.marginBottom = ''; }
}
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', applyFit);
  window.visualViewport.addEventListener('scroll', function () { if (fitted) window.scrollTo(0, 0); });
}
window.addEventListener('resize', applyFit);
window.addEventListener('orientationchange', function () { setTimeout(applyFit, 250); });

/* ═══════════ passerelle pour les modes (js/traffic.js, js/parking.js) ═══════════ */
window.PLAQUE = {
  $: $, norm: norm, matchPair: matchPair, screen: screen, sfx: sfx, store: store,
  shuffle: shuffle, pick: pick, rand: rand, row: row, explode: explode,
  collection: collection, collect: collect, finishGame: finishGame,
  DIFF: DIFF, MODES: MODES, state: state, newPlate: newPlate, endGame: endGame,
  track: track, colors: colors, plateValue: plateValue, toast: toast, wordScore: wordScore, guideSay: guideSay,
  tweenNumber: tweenNumber, bump: bump, floatPts: floatPts,
  autoSubmit: autoSubmit, fitViewport: fitViewport, unfit: unfit,
  myCar: function () { return rankSprite(RANKS[rankOf(career())]); },
  ghostSample: ghostSample, paintGhost: paintGhost,
  isWord:  function (w) { return DICT ? DICT.has(w) : false; },
  rarity:  function (w) { return RARITY ? (RARITY.get(w) || 0) : 0; },
  goHome:  function () { stopAll(); unfit(); refreshHome(); screen('screen-home'); }
};

document.addEventListener('DOMContentLoaded', function () {
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  segmented('opt-mode', 'mode', refreshHome);
  segmented('opt-diff', 'diff', refreshHome);
  refreshHome();

  $('btn-sound').textContent = audio.on ? '🔊' : '🔇';
  $('btn-sound').addEventListener('click', function () {
    audio.on = !audio.on;
    store.set('sound', audio.on);
    this.textContent = audio.on ? '🔊' : '🔇';
    if (audio.on) sfx.time();
  });
  $('btn-play').addEventListener('click', newGame);
  $('btn-again').addEventListener('click', newGame);
  $('btn-share').addEventListener('click', copyShare);
  $('btn-collection').addEventListener('click', renderCollection);
  $('btn-career').addEventListener('click', renderCareer);
  $('btn-badges').addEventListener('click', renderBadges);
  $('btn-badges-back').addEventListener('click', window.PLAQUE.goHome);
  $('badges-list').addEventListener('click', function (e) {
    var el = e.target.closest('.badge'); if (!el) return;
    var b = BADGES.filter(function (x) { return x.id === el.dataset.badge; })[0];
    if (b) openMedal(b);
  });
  $('stat-badges-row').addEventListener('click', function (e) {
    var m = e.target.closest('.medal'); if (!m) return;
    e.stopPropagation();
    var b = BADGES.filter(function (x) { return x.id === m.dataset.badge; })[0];
    if (b) openMedal(b);
  });
  $('medal-modal').addEventListener('click', function (e) {
    if (e.target === this || e.target.closest('[data-close]')) this.hidden = true;
  });
  $('btn-career-back').addEventListener('click', window.PLAQUE.goHome);
  $('btn-collection-back').addEventListener('click', window.PLAQUE.goHome);
  $('btn-home').addEventListener('click', window.PLAQUE.goHome);

  // quitter une partie en cours : un premier clic demande confirmation, un second quitte
  Array.prototype.forEach.call(document.querySelectorAll('[data-exit]'), function (b) {
    var armed = null;
    b.addEventListener('click', function () {
      if (armed) { clearTimeout(armed); armed = null; b.textContent = 'Quitter'; window.PLAQUE.goHome(); return; }
      b.textContent = 'Abandonner la partie ? Confirmer';
      b.classList.add('linkbtn--armed');
      armed = setTimeout(function () { armed = null; b.textContent = 'Quitter'; b.classList.remove('linkbtn--armed'); }, 3000);
    });
  });

  loadDict().then(function () {
    $('btn-play').disabled = false;
    refreshHome();
  }).catch(function (err) {
    $('btn-play').textContent = 'Dictionnaire illisible : ' + err.message;
  });
});

})();
