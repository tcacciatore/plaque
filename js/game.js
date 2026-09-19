/* ═══════════════════════════════════════════════════════════
   PLAQUE — moteur commun aux modes Trafic et Parking
   dictionnaire, règle des lettres, tirage des plaques, question
   bonus, collection, records, partage, sons, explosion.
   ═══════════════════════════════════════════════════════════ */
(function () {
'use strict';

/* ─────────── réglages ─────────── */
var MODES = {
  trafic:  { label: 'Trafic',  traffic: true },
  parking: { label: 'Parking', parking: true }
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
  return window.PAIRS.filter(function (p) {
    return p.n >= d.nMin && p.n <= d.nMax && p.ex.length >= 8;
  });
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
              plates: 0, sport: 0, rare: 0, expert: 0, gold: 0, lines: 0, newDeps: 0, newRank: null, missionsDone: [], t0: Date.now() };
}
var track = {
  word: function (w, pts, tier, combo) {
    session.words++;
    if (pts > session.bestWordPts) { session.bestWordPts = pts; session.bestWord = w; }
    if (combo > session.maxCombo) session.maxCombo = combo;
    if (combo >= 5) progress('combo5', 1);
    if (tier === 2) { session.rare++; progress('rare', 1); }
    if (tier === 2 && w.length >= 9) session.expert++;
    progress('long', w.length, true);
  },
  plate: function (label, pts, opts) {
    session.plates++;
    if (opts && opts.dep && collect(opts.dep)) {
      session.newDeps++;
      progress('deps', 1);
      addCareer(CAREER.dep);
      toast('🗺️ Nouveau département — ' + opts.dep + ' ' + (opts.depName || '') + ' · ' + collection().length + '/101');
    }
    if (pts > session.bestPlatePts) { session.bestPlatePts = pts; session.bestPlate = label; }
    progress('plates', 1);
    if (opts && opts.sport) { session.sport++; progress('sport', 1); }
    if (opts && opts.gold)  { session.gold++;  progress('gold', 1); }
  },
  line: function () { session.lines++; progress('lines', 1); }
};

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
/* affiche l'écart au record dans une pastille du HUD */
function paintGhost(el, sec, score) {
  var ref = ghostAt(sec);
  if (ref == null) { el.textContent = ''; el.className = 'ghost'; return; }
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
  addCareer(state.total);

  $('end-title').textContent = m.parking ? 'Parking — fin de service' : 'Vous êtes arrivé';
  $('end-score').textContent = state.total;
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
  var cr = career(), ri = rankOf(cr), nx = RANKS[ri + 1];
  html += row('Carrière', '<b>' + RANKS[ri].name + '</b> · ' + cr + ' pts' + (nx ? ' — prochain rang à ' + nx.pts : ''));
  $('end-recap').innerHTML = html + row('Total', state.total + ' pts', false, true);
  $('btn-share').textContent = 'Copier mon résultat';
  screen('screen-end');
}

function shareText() {
  var m = MODES[state.mode], h = state.history;
  var words = h.reduce(function (a, x) { return a + x.words; }, 0);
  var done = h.filter(function (x) { return x.reached; }).length;
  var lines = [], bars = '';
  if (m.parking) {
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
  if (MODES[state.mode].parking) window.PARKING.start();
  else window.TRAFFIC.start();
}
function stopAll() {
  if (window.TRAFFIC) window.TRAFFIC.stop();
  if (window.PARKING) window.PARKING.stop();
}
function refreshHome() {
  var m = MODES[state.mode];
  $('stat-collec').textContent = collection().length + '/101';
  $('stat-best').textContent = store.get(bestKey(), 0);
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
  $('btn-play').textContent = m.parking ? 'Entrer dans le parking' : 'Démarrer le moteur';
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

/* ═══════════ saisie sans bouton : le mot se valide tout seul ═══════════
   Une courte pause de frappe suffit quand ce qui est tapé est un mot du
   dictionnaire qui va sur une plaque ; Entrée ou l'espace valident sur-le-champ. */
var AUTO_MS = 900;      // la pause avant qu'un mot tapé se valide : le temps de finir « gagnant » après « gag »
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
  track: track, colors: colors, plateValue: plateValue, toast: toast, wordScore: wordScore,
  autoSubmit: autoSubmit, fitViewport: fitViewport, unfit: unfit,
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
