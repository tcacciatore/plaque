/* ═══════════════════════════════════════════════════════════
   PLAQUE — mode Parking
   Neuf places sur trois rangées. Les deux mots d'une plaque et la
   voiture explose ; une autre vient se garer à sa place. Chaque
   place garde la couleur de la dernière voiture pulvérisée : trois
   places alignées de même couleur — ligne, colonne, diagonale —
   rapportent un bonus et se remettent à zéro. Deux minutes, que
   chaque mot rallonge.
   ═══════════════════════════════════════════════════════════ */
(function () {
'use strict';

var P = null;
var SPOTS = 9;
var LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
var LINE_BONUS = 300, DIAG_BONUS = 500;
var GAME_TIME = 120, TIME_CAP = 135;
var RUSH = 20, FEVER = 10;             // rush final (×2) et fièvre à ×5 (un mot lit la plaque)
var GOLD_ODDS = 25, GOLD_MULT = 3;     // voiture dorée : ×3, sa marque au sol est un joker
var TANK_ODDS = 14;                    // camion-citerne : ses voisines explosent avec lui
var WORD_TIME = 1, PLATE_TIME = 2;     // secondes gagnées par mot, et en plus par plaque lue
var TOW_PENALTY = 15;                  // secondes perdues en faisant remorquer une voiture
var PARK_MIN = 2500, PARK_MAX = 4500;  // délai avant qu'une place libre soit réoccupée, en ms
// le parc (silhouettes, plaques, tailles, bonus) est décrit une fois pour toutes dans js/game.js
var FLEET = window.PLAQUE.FLEET, TANK = window.PLAQUE.TANK;
var SPRITES = 'assets/cars/';
var isSport = function (s) { return !!FLEET[s].sport; };

var K = { spots: [], marks: [], palette: [], done: 0, seen: 0, lines: 0, score: 0, combo: 1,
          timeLeft: 0, timers: [], tick: null, running: false, target: null, history: [],
          t0: 0, feverUntil: 0, feverArmed: true, rush: false };
var $ = function (id) { return document.getElementById(id); };

/* ─────────── mise en place ─────────── */
function pickShape() {
  // un modèle absent du parking si possible ; le coupé reste rare, la citerne plus encore
  var present = K.spots.filter(Boolean).map(function (c) { return c.shape; });
  if (present.indexOf(TANK) === -1 && K.seen >= SPOTS && P.rand(TANK_ODDS) === 0) return TANK;
  var sports = K.roster.filter(function (s) { return isSport(s) && present.indexOf(s) === -1; });
  if (sports.length && P.rand(6) === 0) return P.pick(sports);
  var pool = K.roster.filter(function (s) { return !isSport(s) && present.indexOf(s) === -1; });
  if (!pool.length) pool = K.roster.filter(function (s) { return !isSport(s); });
  return P.pick(pool);
}

function makeCar(i, shape, color, easy) {
  var plate = P.newPlate(easy);
  shape = shape || pickShape();
  var gold = shape !== TANK && K.seen >= SPOTS && P.rand(GOLD_ODDS) === 0;
  return {
    i: i, p1: plate.p1, p2: plate.p2, dep: plate.dep,
    value: plate.value, num: String(plate.value).padStart(3, '0'),
    shape: shape, color: gold ? 'or' : (color || P.pick(K.palette)),
    gold: gold, tank: shape === TANK,
    got1: null, got2: null, words: 0, pts: 0, dead: false
  };
}
function newCar(i, shape, color, easy) {          // makeCar + le caractère du modèle
  var c = makeCar(i, shape, color, easy);
  P.initCar(c, 'parking');
  return c;
}

function carHTML(c) {
  var F = FLEET[c.shape];
  return '<div class="spot__car' + (isSport(c.shape) ? ' spot__car--sport' : '') + (c.gold ? ' spot__car--gold' : '') +
      '" style="--plateY:' + F.plateY + '%;--plateW:' + F.plateW + '%;width:' + F.width + '%">' +
        (c.gold ? '<span class="sport-tag sport-tag--gold">✨ ×3</span>' :
         c.tank ? '<span class="sport-tag sport-tag--tank">⚠ citerne</span>' :
         isSport(c.shape) ? '<span class="sport-tag">' + P.sportTag(c.shape) + '</span>' :
         c.tag ? '<span class="sport-tag sport-tag--trait">' + c.tag + '</span>' : '') +
        '<img class="car__body" alt="" draggable="false" src="' + SPRITES + c.shape + '-' + c.color + '.webp">' +
        '<div class="car__shadow"></div>' +
        '<div class="plate plate--car plate--park">' +
          '<div class="plate__eu"><div class="plate__f">F</div></div>' +
          '<div class="plate__body">' +
            '<span class="plate__letters" data-pair="1">' + c.p1.p + '</span>' +
            '<span class="plate__sep">·</span><span class="plate__num">' + c.num + '</span>' +
            '<span class="plate__sep">·</span>' +
            '<span class="plate__letters" data-pair="2">' + (c.hidden ? '??' : c.p2.p) + '</span>' +
          '</div>' +
          '<div class="plate__dep"><div class="plate__depnum">' + c.dep.num + '</div></div>' +
        '</div>' +
      '</div>';
}

function buildLot() {
  // trois couleurs par parking, jamais deux qui se confondent
  var clash = [['blanc', 'gris'], ['rouge', 'orange']];
  do { K.palette = P.shuffle(P.colors()).slice(0, 3); }
  while (clash.some(function (c) { return K.palette.indexOf(c[0]) !== -1 && K.palette.indexOf(c[1]) !== -1; }));

  // tous les modèles du roster présents au départ, complétés par des silhouettes courantes
  K.roster = P.fleetRoster();
  K.roster.concat([TANK]).forEach(function (s) {      // les remplaçantes arrivent sans délai de chargement
    P.colors().concat(['or']).forEach(function (c) { var im = new Image(); im.src = SPRITES + s + '-' + c + '.webp'; });
  });
  var shapes = K.roster.slice(), extra = K.roster.filter(function (s) { return !isSport(s); });
  while (shapes.length < SPOTS) shapes.push(P.pick(extra));
  P.shuffle(shapes);
  shapes.splice(shapes.indexOf(K.roster[0]), 1);   // la silhouette neutre en première place :
  shapes.unshift(K.roster[0]);                     // la première rangée reste abordable

  K.spots = []; K.marks = [];
  var html = '';
  for (var i = 0; i < SPOTS; i++) {
    K.spots.push(newCar(i, shapes[i], null, i < 3));   // la première rangée est accessible
    K.marks.push(null);
    html += '<div class="spot" id="spot' + i + '"><div class="spot__mark"></div>' +
            '<div class="spot__slot">' + carHTML(K.spots[i]) + '</div><div class="spot__fx"></div></div>';
  }
  $('pk-lot').innerHTML = html;
  K.seen = SPOTS;
}

/* ─────────── réoccupation d'une place ─────────── */
function park(i) {
  if (!K.running || K.spots[i]) return;
  var c = newCar(i);
  K.spots[i] = c;
  K.seen++;
  var spot = $('spot' + i);
  spot.classList.remove('spot--boom');
  var slot = spot.querySelector('.spot__slot');
  slot.innerHTML = carHTML(c);
  slot.firstChild.classList.add('spot__car--in');
  updateTokens();
  renderHud();
}
function schedulePark(i, delay) {
  clearTimeout(K.timers[i]);
  K.timers[i] = setTimeout(function () { K.timers[i] = null; park(i); }, delay);
}

/* ─────────── explosion & départ ─────────── */
function boom(c) {
  var spot = $('spot' + c.i);
  if (!spot) return;
  spot.classList.add('spot--boom');
  P.explode(spot.querySelector('.spot__fx'), $('pk-lot'));
}
function leave(c, pulverized) {
  c.dead = true;
  K.spots[c.i] = null;
  if (K.target === c) K.target = null;
  K.history.push({ p1: c.p1.p, p2: c.p2.p, dep: c.dep.num, words: c.words, pts: c.pts, reached: pulverized });
  var spot = $('spot' + c.i), car = spot.querySelector('.spot__car');
  if (pulverized) {
    boom(c);
    setMark(c.i, c.color);
  } else {
    car.classList.add('spot__car--tow');
  }
  setTimeout(function () { if (car.parentNode) car.parentNode.removeChild(car); }, 900);
  schedulePark(c.i, PARK_MIN + Math.random() * (PARK_MAX - PARK_MIN));
}

/* ─────────── marques de couleur au sol ─────────── */
var TINT = { rouge: '#c23a2e', bleu: '#2b6fb8', blanc: '#e6e9ee', noir: '#1a1d24', vert: '#2f7d4f',
             jaune: '#e0b42c', gris: '#8a93a0', orange: '#d8731e', violet: '#6d3f8e', chrome: '#b9c2cc',
             nacre: '#f0d9e2', or: '#f2c230' };
function setMark(i, color) {
  K.marks[i] = color;
  var m = $('spot' + i).querySelector('.spot__mark');
  m.style.setProperty('--tint', color ? TINT[color] : 'transparent');
  m.classList.toggle('spot__mark--on', !!color);
}
function checkLines(i) {
  var gain = 0, mine = K.marks[i], seen = {};
  LINES.forEach(function (line, idx) {
    if (line.indexOf(i) === -1) return;
    // la couleur de la ligne : la première marque non dorée ; l'or compte pour n'importe laquelle
    var color = null;
    for (var q = 0; q < 3; q++) { var mk = K.marks[line[q]]; if (mk && mk !== 'or') { color = mk; break; } }
    if (!color) color = mine;
    if (!line.every(function (j) { return K.marks[j] && (K.marks[j] === color || K.marks[j] === 'or'); })) return;
    if (seen[line.join()]) return;
    seen[line.join()] = true;
    var diag = idx >= 6, b = diag ? DIAG_BONUS : LINE_BONUS;
    gain += b; K.lines++;
    line.forEach(function (j) {
      var s = $('spot' + j);
      s.classList.add('spot--line');
      setTimeout(function () { s.classList.remove('spot--line'); setMark(j, null); }, 1600);
    });
    setTimeout(function () {
      feedback('🎯 <b>' + (diag ? 'Diagonale' : idx < 3 ? 'Ligne' : 'Colonne') + ' ' + color +
               '</b> — trois places de la même couleur, <b>+' + b + '</b>', 'ok');
      P.sfx.win();
    }, 650);
  });
  if (gain) { K.score += Math.round(gain * multiplier()); gainTime(PLATE_TIME); P.track.line(); }
  return gain;
}

/* ─────────── affichage ─────────── */
function played() { return (Date.now() - K.t0) / 1000; }
function multiplier() { return K.rush ? 2 : 1; }
function inFever() { return Date.now() < K.feverUntil; }
function startFever() {
  K.feverUntil = Date.now() + FEVER * 1000;
  P.track.fever();
  $('pk-lot').classList.add('fever');
  P.toast('🔥 <b>FIÈVRE</b> — pendant ' + FEVER + ' s, un seul mot suffit à lire une plaque');
  P.sfx.win();
}

function fmt(s) {
  var m = Math.floor(s / 60), r = Math.floor(s % 60);
  return m + ':' + (r < 10 ? '0' : '') + r;
}
function renderHud() {
  $('pk-time').textContent = fmt(Math.max(0, K.timeLeft));
  $('pk-left').innerHTML = K.done + (K.combo > 1 ? ' <i class="combo combo--' + K.combo + '">×' + K.combo + '</i>' : '');
  P.tweenNumber($('pk-score'), K.score, 450);
  $('pk-timebox').classList.toggle('low', K.timeLeft <= 15);
}
function gainTime(sec) {
  K.timeLeft = Math.min(TIME_CAP, K.timeLeft + sec);
  var g = $('pk-gain');
  g.textContent = '+' + sec + ' s';
  g.classList.remove('go');
  void g.offsetWidth;
  g.classList.add('go');
  P.sfx.time();
}
function setTarget(c) {
  K.target = c;
  K.spots.forEach(function (x, i) {
    var s = $('spot' + i);
    if (s) s.classList.toggle('spot--target', !!x && x === c);
  });
  updateTokens();
}
function updateTokens() {
  $('pk-tokens').innerHTML = K.spots.map(function (c) {
    if (!c) return '<span class="tokgroup tokgroup--empty"><span class="tok tok--wait">…</span></span>';
    var sp = isSport(c.shape) ? ' tok--sport' : '';
    var tg = c === K.target ? ' tok--target' : '';
    return '<span class="tokgroup' + tg + '" data-i="' + c.i + '">' +
           '<span class="tok' + sp + (c.got1 ? ' tok--on' : '') + '">' + c.p1.p + (!c.got1 && c.n1 ? '½' : '') + '</span>' +
           '<span class="tok' + sp + (c.got2 ? ' tok--on' : '') + '">' + (c.got2 || P.canUse(c, 2) ? c.p2.p + (!c.got2 && c.n2 ? '½' : '') : '??') + '</span></span>';
  }).join('');
}
function feedback(msg, cls) {
  var f = $('pk-feedback');
  f.innerHTML = msg;
  f.className = 'feedback ' + (cls || '');
}
function reveal(c) {                             // la deuxième paire du 4×4 apparaît
  c.hidden = false;
  var spot = $('spot' + c.i);
  var el = spot && spot.querySelector('[data-pair="2"]');
  if (el) { el.textContent = c.p2.p; el.classList.add('hit'); }
}
function flashPair(c, which) {
  var spot = $('spot' + c.i);
  var el = spot && spot.querySelector('[data-pair="' + which + '"]');
  if (!el) return;
  el.classList.add('hit');
  setTimeout(function () { el.classList.remove('hit'); }, 500);
}

/* ─────────── saisie ─────────── */
function submit(e) {
  e.preventDefault();
  if (!K.running) return;
  var inp = $('pk-input'), w = P.norm(inp.value.trim());
  inp.value = '';
  if (!w) return;

  function reject(msg) {
    feedback(msg, 'ko');
    K.combo = 1; K.feverArmed = true;
    P.sfx.ko();
    inp.classList.add('shake');
    setTimeout(function () { inp.classList.remove('shake'); }, 320);
    renderHud();
  }
  if (w.length < 3) return reject('Trop court — 3 lettres minimum.');

  // la cible : la voiture désignée, sinon une que le mot achève, sinon une entamée, sinon la première
  var best = null, used = false, ruleMsg = null;
  K.spots.forEach(function (c) {
    if (!c) return;
    if (c.used.indexOf(w) !== -1) { used = true; return; }
    var h1 = P.canUse(c, 1) ? P.matchPair(w, c.p1.p) : null;
    var h2 = P.canUse(c, 2) ? P.matchPair(w, c.p2.p) : null;
    if (!h1 && !h2) return;
    var bad = P.wordRule(c, w, 'parking');                   // le caractère du modèle refuse ce mot
    if (bad) { if (!ruleMsg || c === K.target) ruleMsg = bad; return; }
    var rank = (c === K.target ? 8 : 0) +
               (((h1 && h2) || (h1 && c.got2) || (h2 && c.got1)) ? 4 : 0) +
               ((c.got1 || c.got2 || c.n1 || c.n2) ? 2 : 0);
    if (!best || rank > best.rank) best = { c: c, h1: h1, h2: h2, rank: rank };
  });
  if (!best) {
    return reject(ruleMsg ? '<b>' + w.toUpperCase() + '</b> — ' + ruleMsg
                : used ? '<b>' + w.toUpperCase() + '</b> — déjà utilisé sur ce parking.'
                       : '<b>' + w.toUpperCase() + '</b> ne va sur aucune plaque.');
  }
  if (!P.isWord(w)) return reject('<b>' + w.toUpperCase() + '</b> — inconnu du dictionnaire.');

  var c = best.c, hit = best.h1 || best.h2;
  var ws = P.wordScore(w, hit), tier = ws.tier, rare = ws.rare;
  var sport = isSport(c.shape);
  var pts = Math.round(ws.pts * K.combo * P.sportBonus(c.shape) * (c.gold ? GOLD_MULT : 1) * multiplier());
  var both = best.h1 && best.h2;
  if (both) pts *= 2;
  c.used.push(w);
  var half = false;                                // le camion : la paire n'est qu'à moitié lue
  if (best.h1) { half = !P.hitPair(c, 1, w) || half; flashPair(c, 1); }
  if (best.h2) { half = !P.hitPair(c, 2, w) || half; flashPair(c, 2); }
  if (c.hidden && c.got1) reveal(c);
  if (inFever() && !(c.got1 && c.got2)) {
    if (!c.got1) { c.got1 = '🔥'; flashPair(c, 1); } else { c.got2 = '🔥'; flashPair(c, 2); }
    if (c.hidden) reveal(c);
  }
  c.words += both ? 2 : 1; c.pts += pts; K.score += pts;
  var wasMax = K.combo >= 5;
  K.combo = Math.min(5, K.combo + 1);
  gainTime(WORD_TIME);
  P.track.word(w, pts, tier, K.combo);
  var who = '<b class="mono">' + c.p1.p + '·' + c.num + '·' + c.p2.p + '</b>';

  if (c.got1 && c.got2) {
    var bonus = Math.round(c.value * P.carCote(c, 'parking') * (c.gold ? GOLD_MULT : 1) * multiplier());
    c.pts += bonus; K.score += bonus; K.done++;
    gainTime(PLATE_TIME + (P.trait(c.shape).give || 0) + (c.cargo === 'time' ? 8 : 0));
    P.sfx.dbl();
    P.floatPts(inp, '+' + (pts + bonus), 'float--win');
    P.bump($('pk-score').parentNode.parentNode, 'bump--big');
    P.track.plate(c.p1.p + '·' + c.num + '·' + c.p2.p, c.pts, { sport: sport, gold: c.gold, tank: c.tank, dep: c.dep.num, depName: c.dep.nom });
    feedback('💥 ' + who + ' pulvérisée ! cote <b>+' + bonus + '</b>' +
             (sport ? ' (' + P.sportTag(c.shape) + ')' : '') + (c.gold ? ' (✨ dorée ×3)' : '') + (K.rush ? ' (rush ×2)' : '') +
             P.traitLabel(c, 'parking') + ' — ' + c.dep.num + ' ' + c.dep.nom, 'ok');
    leave(c, true);
    P.guideSay(3, '💥 Sa <b>cote</b> — les trois chiffres — tombe dans votre score, et sa place garde sa couleur. Trois places alignées de même couleur : bonus.');
    checkLines(c.i);
    if (c.tank) chain(c.i);
    updateTokens();
  } else {
    (tier === 2 && rare) ? P.sfx.rare() : P.sfx.ok(K.combo);
    P.floatPts(inp, '+' + pts, tier === 2 && rare ? 'float--rare' : '');
    P.bump($('pk-score').parentNode.parentNode);
    feedback('+' + pts + ' sur ' + who +
             (both ? ' — <b>les deux paires d\'un coup</b> ×2' : '') +
             (ws.label ? ' — ' + ws.label : '') +
             (sport ? ' · <b>' + P.sportTag(c.shape) + '</b>' : '') +
             (half ? ' · <b>encore un mot</b> sur cette paire' : ' · il manque <b>' + (c.got1 ? c.p2.p : c.p1.p) + '</b>'), 'ok');
    setTarget(c);
    P.guideSay(2, 'Bien joué. Il reste <b>' + (c.got1 ? c.p2.p : c.p1.p) + '</b> sur cette voiture : un deuxième mot et elle explose. Sa place gardera sa couleur — alignez-en trois.');
  }
  if (K.combo === 3) P.guideSay(4, 'Votre <b>série</b> monte : les points sont multipliés. Une erreur la remet à ×1 — à ×5, la fièvre.');
  if (K.combo >= 5 && !wasMax && !inFever() && K.feverArmed) { K.feverArmed = false; startFever(); }
  renderHud();
}

/* la citerne souffle ses voisines : elles explosent, posent leur marque, rapportent la moitié de leur cote */
function chain(i) {
  var r = Math.floor(i / 3), col = i % 3, hit = 0;
  [[r - 1, col], [r + 1, col], [r, col - 1], [r, col + 1]].forEach(function (rc) {
    if (rc[0] < 0 || rc[0] > 2 || rc[1] < 0 || rc[1] > 2) return;
    var j = rc[0] * 3 + rc[1], c = K.spots[j];
    if (!c) return;
    var b = Math.round(c.value * 0.5 * multiplier());
    c.pts += b; K.score += b; K.done++; hit++;
    P.track.plate(c.p1.p + '·' + c.num + '·' + c.p2.p, b, { dep: c.dep.num, depName: c.dep.nom });
    setTimeout(function () { leave(c, true); checkLines(c.i); updateTokens(); renderHud(); }, 250 + hit * 140);
  });
  if (hit) setTimeout(function () { P.toast('🛢️ <b>Explosion en chaîne</b> — ' + hit + ' voiture' + (hit > 1 ? 's' : '') + ' soufflée' + (hit > 1 ? 's' : '')); }, 400);
}

/* ─────────── remorquage ─────────── */
function tow() {
  if (!K.running) return;
  var alive = K.spots.filter(Boolean);
  if (!alive.length) return;
  P.track.miss({ p1: alive[0].p1.p, p2: alive[0].p2.p, got1: alive[0].got1, got2: alive[0].got2 });
  alive.sort(function (a, b) {
    return ((a.got1 || a.got2 ? 1 : 0) + (a === K.target ? 2 : 0)) - ((b.got1 || b.got2 ? 1 : 0) + (b === K.target ? 2 : 0));
  });
  var c = alive[0];
  K.timeLeft = Math.max(0, K.timeLeft - TOW_PENALTY);
  K.combo = 1;
  P.sfx.over();
  feedback('Remorquée — <b>−' + TOW_PENALTY + ' s</b> (' + c.p1.p + ' / ' + c.p2.p + ')', 'ko');
  leave(c, false);
  updateTokens();
  renderHud();
}

/* ─────────── boucle ─────────── */
function loop() {
  var last = Date.now();
  clearInterval(K.tick);
  K.tick = setInterval(function () {
    var now = Date.now();
    K.timeLeft -= (now - last) / 1000;
    last = now;
    var rush = K.timeLeft <= RUSH;
    if (rush !== K.rush) {
      K.rush = rush;
      $('pk-lot').classList.toggle('rush', rush);
      if (rush) { P.toast('🚨 <b>RUSH</b> — dernières secondes, tout compte double'); P.sfx.over(); }
    }
    if (K.feverUntil && !inFever()) { K.feverUntil = 0; $('pk-lot').classList.remove('fever'); K.combo = 3; K.feverArmed = true; }
    P.ghostSample(played(), K.score);
    P.paintGhost($('pk-ghost'), played(), K.score);
    if (K.timeLeft <= 0) { K.timeLeft = 0; renderHud(); finish(); return; }
    // filet de sécurité : une place vide sans relais programmé se réoccupe
    K.spots.forEach(function (c, i) { if (!c && !K.timers[i]) schedulePark(i, PARK_MIN); });
    renderHud();
  }, 200);
}

function start() {
  P = window.PLAQUE;
  K.done = 0; K.seen = 0; K.lines = 0; K.score = 0; K.combo = 1; K.target = null; K.history = [];
  K.timeLeft = GAME_TIME; K.running = true;
  K.t0 = Date.now(); K.feverUntil = 0; K.feverArmed = true; K.rush = false;
  $('pk-lot').classList.remove('rush', 'fever');
  K.timers.forEach(clearTimeout); K.timers = [];
  for (var i = 0; i < SPOTS; i++) K.timers.push(null);
  $('pk-input').value = '';
  feedback('&nbsp;', '');
  buildLot();
  updateTokens();
  renderHud();
  P.guideSay(1, 'Neuf voitures, neuf plaques. Tapez un mot qui contient les deux lettres d\'une paire, dans l\'ordre — par exemple <b>' +
    K.spots[0].p1.p[0] + '</b> puis <b>' + K.spots[0].p1.p[1] + '</b> pour <b>' + K.spots[0].p1.p + '</b>. Il se valide tout seul.');
  P.screen('screen-parking');
  P.fitViewport('screen-parking', '#pk-lot', '.hud, #pk-lot, .pk-tokens, #pk-form, .feedback, .hint-line');
  $('pk-input').focus();
  loop();
}

function finish() {
  K.running = false;
  clearInterval(K.tick);
  K.timers.forEach(clearTimeout);
  var hist = K.history.slice();
  K.spots.forEach(function (c) {
    if (!c) return;
    hist.push({ p1: c.p1.p, p2: c.p2.p, dep: c.dep.num, words: c.words, pts: c.pts, reached: false });
    if (c.words < 2) P.track.miss({ p1: c.p1.p, p2: c.p2.p, got1: c.got1, got2: c.got2 });
  });
  P.state.history = hist;
  P.finishGame(
    P.row('Voitures croisées', K.seen) +
    P.row('Voitures pulvérisées', K.done, K.done === 0),
    K.score);
}

function stop() {
  K.running = false;
  clearInterval(K.tick);
  K.timers.forEach(clearTimeout);
}

window.PARKING = { start: start, stop: stop };

document.addEventListener('DOMContentLoaded', function () {
  $('pk-form').addEventListener('submit', submit);
  window.PLAQUE.autoSubmit($('pk-input'), $('pk-form'), function (w) {
    return K.spots.some(function (c) {
      return c && w !== c.got1 && w !== c.got2 &&
             ((!c.got1 && P.matchPair(w, c.p1.p)) || (!c.got2 && P.matchPair(w, c.p2.p)));
    });
  });
  $('pk-skip').addEventListener('click', tow);
  var pickSpot = function (e) {
    var g = e.target.closest('.spot, .tokgroup');
    if (!g || g.classList.contains('tokgroup--empty')) return;
    var i = g.classList.contains('spot') ? +g.id.replace('spot', '') : +g.dataset.i;
    var c = K.spots[i];
    if (c) { setTarget(c); $('pk-input').focus(); }
  };
  $('pk-lot').addEventListener('pointerdown', pickSpot);
  $('pk-tokens').addEventListener('pointerdown', pickSpot);
});

})();
