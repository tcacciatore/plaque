/* ═══════════════════════════════════════════════════════════
   PLAQUE — mode Trafic
   Au volant sur trois voies : chaque voie a sa voiture, qui arrive
   à son heure, reste devant vous un moment, puis s'éloigne ou
   explose. Trois modèles toujours différents. Deux mots par plaque,
   un par paire de lettres. La partie dure deux minutes.
   ═══════════════════════════════════════════════════════════ */
(function () {
'use strict';

var P = null;                       // passerelle vers le moteur (window.PLAQUE)
var GAME_TIME = 120;                // durée d'une partie, en secondes
var CAR_TIME  = 14;                 // temps de présence d'une voiture au départ…
var CAR_TIME_END = 9;               // …et en fin de partie (la rampe)
var RUSH      = 20;                 // les dernières secondes : tout compte double
var FEVER     = 10;                 // durée de la fièvre déclenchée à ×5 : un mot suffit
var GOLD_ODDS = 25, GOLD_MULT = 3;  // voiture dorée : une sur 25, ×3
var TANK_ODDS = 14;                 // camion-citerne : un sur 14, explosion en chaîne
var WORD_TIME = 1;                  // secondes de partie gagnées par mot valide
var PLATE_TIME = 2;                 // secondes de partie gagnées en plus par plaque lue
var CAR_BONUS = 2;                  // secondes rendues à la voiture visée par mot valide
// rythme d'arrivée selon la difficulté : écart minimal entre deux apparitions,
// toutes voies confondues, puis délai avant qu'une voie libre se réalimente (ms)
var PACE = {
  facile: { gap: 7000, min: 6000, max: 8000 },
  normal: { gap: 5500, min: 4500, max: 6500 },
  expert: { gap: 4000, min: 3500, max: 5000 }
};
var SPAWN_GAP = 5500, GAP_MIN = 4500, GAP_MAX = 6500;   // réglés au démarrage d'après PACE
var TIME_CAP  = 135;                // la partie ne dépasse jamais 2 min 15
var LANES3    = [-30, 0, 30];       // décalage de chaque voie, en % de la largeur de scène
var LANES2    = [-25, 25];          // sur petit écran : deux voies plus écartées, voitures plus grandes
var NARROW    = 700;                // largeur d'écran sous laquelle on passe à deux voies
var LANES     = LANES3;
var MULT_MAX  = 5;

var T = {
  running: false, timeLeft: 0, score: 0, done: 0, seen: 0,
  combo: 1, lanes: [], timers: [], lastSpawn: 0, target: null, tick: null, history: [],
  t0: 0, feverUntil: 0, fevers: 0, rush: false
};

var $ = function (id) { return document.getElementById(id); };

/* ─────────── la scène ─────────── */
/* Sprites rendus hors ligne par build/render_cars.py : une seule <img> par
   voiture, sans filtre ni fusion au runtime — c'est moins coûteux à animer
   qu'un SVG, que le navigateur devait re-rastériser à chaque échelle.       */
// le parc (silhouettes, plaques, tailles, bonus) est décrit une fois pour toutes dans js/game.js
var FLEET = window.PLAQUE.FLEET, TANK = window.PLAQUE.TANK;
var SPRITES = 'assets/cars/';
var isSport = function (s) { return !!FLEET[s].sport; };

function preloadCars(roster) {
  // seules les silhouettes de la partie sont préchargées, dans toutes leurs teintes
  roster.concat([TANK]).forEach(function (s) {
    P.colors().concat(['or']).forEach(function (c) { var im = new Image(); im.src = SPRITES + s + '-' + c + '.webp'; });
  });
}

function plateHTML(car) {
  return '<div class="plate plate--car">' +
      '<div class="plate__eu"><div class="plate__f">F</div></div>' +
      '<div class="plate__body">' +
        '<span class="plate__letters" data-pair="1">' + car.p1.p + '</span>' +
        '<span class="plate__sep">·</span>' +
        '<span class="plate__num">' + car.num + '</span>' +
        '<span class="plate__sep">·</span>' +
        '<span class="plate__letters" data-pair="2">' + car.p2.p + '</span>' +
      '</div>' +
      '<div class="plate__dep"><div class="plate__depnum">' + car.dep.num + '</div></div>' +
    '</div>';
}

/* ─────────── cycle de vie d'une voiture ─────────── */
function pickShape() {
  // un modèle différent de ceux déjà en piste ; le coupé reste rare, le camion-citerne plus encore
  var present = T.lanes.filter(Boolean).map(function (c) { return c.shape; });
  var late = played() > 60;                       // en fin de partie, les coupés se multiplient
  if (present.indexOf(TANK) === -1 && T.seen > 2 && P.rand(TANK_ODDS) === 0) return TANK;
  var sports = T.roster.filter(function (s) { return isSport(s) && present.indexOf(s) === -1; });
  if (sports.length && P.rand(late ? 4 : 8) === 0) return P.pick(sports);
  var pool = T.roster.filter(function (s) { return !isSport(s) && present.indexOf(s) === -1; });
  return P.pick(pool);
}

function spawnLane(lane) {
  if (!T.running || T.lanes[lane]) return;
  var since = Date.now() - T.lastSpawn;
  if (since < SPAWN_GAP) { scheduleLane(lane, SPAWN_GAP - since + 30); return; }   // jamais deux arrivées rapprochées
  T.lastSpawn = Date.now();
  var plate = P.newPlate(T.seen === 0), shape = pickShape();
  var gold = shape !== TANK && P.rand(GOLD_ODDS) === 0;
  var car = {
    p1: plate.p1, p2: plate.p2, dep: plate.dep, shape: shape, lane: lane,
    value: plate.value, num: String(plate.value).padStart(3, '0'),
    gold: gold, tank: shape === TANK,
    got1: null, got2: null, words: 0, pts: 0, gone: false,
    born: Date.now(), extra: 0
  };
  var el = document.createElement('div');
  el.className = 'car car--in' + (isSport(shape) ? ' car--sport' : '') + (gold ? ' car--gold' : '') + (car.tank ? ' car--tank' : '');
  var F = FLEET[shape];
  el.style.setProperty('--w', (F.size - 0.06 * Math.random()).toFixed(3));
  el.style.setProperty('--lane', LANES[lane] + '%');
  el.style.setProperty('--plateY', F.plateY + '%');
  el.style.setProperty('--plateW', F.plateW + '%');
  el.style.setProperty('--ride', (3.4 + Math.random() * 2.2).toFixed(2) + 's');
  el.style.setProperty('--ridePhase', (-Math.random() * 5).toFixed(2) + 's');
  el.innerHTML = '<div class="car__ride">' +
                   (gold ? '<span class="sport-tag sport-tag--gold">✨ ×3</span>' : car.tank ? '<span class="sport-tag sport-tag--tank">⚠ citerne</span>' : '') +
                   '<img class="car__body" alt="" draggable="false" src="' +
                   SPRITES + shape + '-' + (gold ? 'or' : P.pick(P.colors())) + '.webp">' +
                   '<div class="car__shadow"></div>' + plateHTML(car) +
                   '<div class="car__timer"><i></i></div>' +
                 '</div>' +
                 '<div class="car__fx"></div><div class="car__pop"></div>';
  car.el = el;
  el.addEventListener('pointerdown', function () {
    if (!car.gone) { setTarget(car); $('tr-input').focus(); }
  });
  $('tr-cars-layer').appendChild(el);
  T.lanes[lane] = car;
  T.seen++;
  renderPairs();
  renderHud();
  if (T.seen === 1) P.guideSay(1, 'Cette plaque porte deux paires de lettres : <b>' + car.p1.p + '</b> et <b>' + car.p2.p +
    '</b>. Tapez un mot qui contient <b>' + car.p1.p[0] + '</b> puis <b>' + car.p1.p[1] + '</b>, dans l\'ordre — il se valide tout seul.');
}

function setTarget(car) {
  T.target = car;
  T.lanes.forEach(function (c) { if (c) c.el.classList.toggle('car--target', c === car); });
  renderPairs();
}

function scheduleLane(lane, delay) {
  clearTimeout(T.timers[lane]);
  T.timers[lane] = setTimeout(function () { T.timers[lane] = null; spawnLane(lane); }, delay);
}

function leaveCar(car, success) {
  if (car.gone) return;
  car.gone = true;
  var el = car.el;
  el.classList.remove('car--in');
  if (success) {
    el.classList.add('car--boom');
    P.explode(el.querySelector('.car__fx'), document.querySelector('.road'));
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 1500);
  } else {
    el.classList.add('car--away');
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 2100);
  }

  T.history.push({
    p1: car.p1.p, p2: car.p2.p, dep: car.dep.num,
    words: car.words, pts: car.pts, reached: success
  });
  T.lanes[car.lane] = null;
  if (T.target === car) T.target = null;
  renderPairs();
  if (T.running) scheduleLane(car.lane, GAP_MIN + Math.random() * (GAP_MAX - GAP_MIN));
}

function played() { return (Date.now() - T.t0) / 1000; }
function carTime() {                             // la rampe : de 18 s à 12 s sur deux minutes de jeu
  var k = Math.min(1, played() / 120);
  return CAR_TIME + (CAR_TIME_END - CAR_TIME) * k;
}
function multiplier() {                          // rush ×2, dorée ×3, coupé ×1,5
  return T.rush ? 2 : 1;
}
function startFever() {
  T.feverUntil = Date.now() + FEVER * 1000;
  T.fevers++;
  P.track.fever();
  document.querySelector('.road').classList.add('fever');
  P.toast('🔥 <b>FIÈVRE</b> — pendant ' + FEVER + ' s, un seul mot suffit à lire une plaque');
  P.sfx.win();
}
function inFever() { return Date.now() < T.feverUntil; }

function gainTime(sec) {
  T.timeLeft = Math.min(TIME_CAP, T.timeLeft + sec);
  var g = $('tr-gain');
  g.textContent = '+' + sec + ' s';
  g.classList.remove('go');
  void g.offsetWidth;
  g.classList.add('go');
  P.sfx.time();
}

/* ─────────── affichage ─────────── */
function fmt(s) {
  var m = Math.floor(s / 60), r = Math.floor(s % 60);
  return m + ':' + (r < 10 ? '0' : '') + r;
}
function renderHud() {
  $('tr-time').textContent = fmt(Math.max(0, T.timeLeft));
  P.tweenNumber($('tr-score'), T.score, 450);
  $('tr-cars').innerHTML = T.done + (T.combo > 1 ? ' <i class="combo combo--' + T.combo + '">×' + T.combo + '</i>' : '');
  $('tr-timebox').classList.toggle('low', T.timeLeft <= 15);
}
function renderPairs() {
  var alive = T.lanes.filter(function (c) { return c && !c.gone; });
  var box = $('tr-pairs');
  if (!alive.length) { box.innerHTML = '<span class="tok tok--wait">…</span>'; return; }
  box.innerHTML = alive.map(function (c) {
    var sp = isSport(c.shape) ? ' tok--sport' : '';
    var tg = c === T.target ? ' tok--target' : '';
    return '<span class="tokgroup' + tg + '" data-lane="' + c.lane + '">' +
           '<span class="tok' + sp + (c.got1 ? ' tok--on' : '') + '">' + (c.got1 ? '✓' : c.p1.p) + '</span>' +
           '<span class="tok' + sp + (c.got2 ? ' tok--on' : '') + '">' + (c.got2 ? '✓' : c.p2.p) + '</span>' +
           '</span>';
  }).join('');
}
function pop(car, txt, cls) {
  var p = car.el.querySelector('.car__pop');
  p.textContent = txt;
  p.className = 'car__pop ' + (cls || '');
  void p.offsetWidth;
  p.classList.add('go');
}
function flashPair(car, which) {
  var el = car.el.querySelector('[data-pair="' + which + '"]');
  if (!el) return;
  el.classList.add('hit');
  setTimeout(function () { el.classList.remove('hit'); }, 500);
}
function feedback(msg, cls) {
  var f = $('tr-feedback');
  f.innerHTML = msg;
  f.className = 'feedback ' + (cls || '');
}

/* ─────────── saisie ─────────── */
function submit(e) {
  e.preventDefault();
  if (!T.running) return;
  var inp = $('tr-input'), w = P.norm(inp.value.trim());
  inp.value = '';
  if (!w) return;
  var alive = T.lanes.filter(function (c) { return c && !c.gone; });
  if (!alive.length) { feedback('Attendez la prochaine voiture…', 'ko'); return; }
  if (T.combo < MULT_MAX) T.feverArmed = true;

  function reject(msg) {
    feedback(msg, 'ko');
    T.combo = 1;
    P.sfx.ko();
    inp.classList.add('shake');
    setTimeout(function () { inp.classList.remove('shake'); }, 320);
    renderHud();
  }
  if (w.length < 3) return reject('Trop court — 3 lettres minimum.');

  var best = null, used = false;
  alive.forEach(function (c) {
    if (w === c.got1 || w === c.got2) { used = true; return; }
    var h1 = c.got1 ? null : P.matchPair(w, c.p1.p);
    var h2 = c.got2 ? null : P.matchPair(w, c.p2.p);
    if (!h1 && !h2) return;
    var rank = (c === T.target ? 8 : 0) +                    // la voiture que le joueur a désignée
               (((h1 && h2) || (h1 && c.got2) || (h2 && c.got1)) ? 4 : 0) +   // le mot l'achève
               ((c.got1 || c.got2) ? 2 : 0);                // elle est déjà entamée
    if (!best || rank > best.rank) best = { c: c, h1: h1, h2: h2, rank: rank };
  });
  if (!best) {
    return reject(used ? '<b>' + w.toUpperCase() + '</b> — déjà joué sur une de ces voitures.'
                       : '<b>' + w.toUpperCase() + '</b> ne va sur aucune des trois plaques.');
  }
  if (!P.isWord(w)) return reject('<b>' + w.toUpperCase() + '</b> — inconnu du dictionnaire.');

  var car = best.c, hit = best.h1 || best.h2;
  var ws = P.wordScore(w, hit), tier = ws.tier, rare = ws.rare;
  var sport = isSport(car.shape);
  var pts = Math.round(ws.pts * T.combo * P.sportBonus(car.shape) * (car.gold ? GOLD_MULT : 1) * multiplier());

  var both = best.h1 && best.h2;                 // les deux paires dans le même mot
  if (both) pts *= 2;
  if (best.h1) { car.got1 = w; flashPair(car, 1); }
  if (best.h2) { car.got2 = w; flashPair(car, 2); }
  if (inFever() && !(car.got1 && car.got2)) {    // la fièvre : un mot lit la plaque entière
    if (!car.got1) { car.got1 = '🔥'; flashPair(car, 1); } else { car.got2 = '🔥'; flashPair(car, 2); }
  }
  car.words += both ? 2 : 1; car.pts += pts;
  T.score += pts;
  gainTime(WORD_TIME);
  car.extra += CAR_BONUS;
  P.track.word(w, pts, tier, T.combo);
  pop(car, '+' + pts, rare && tier === 2 ? 'rare' : '');
  P.floatPts(inp, '+' + pts, tier === 2 && rare ? 'float--rare' : '');
  P.bump($('tr-score').parentNode.parentNode);
  tier === 2 && rare ? P.sfx.rare() : P.sfx.ok(T.combo);
  var who = '<b class="mono">' + car.p1.p + '·' + car.num + '·' + car.p2.p + '</b>';
  feedback('+' + pts + ' sur ' + who +
           (both ? ' — <b>les deux paires d\'un coup</b> ×2' : '') +
           (ws.label ? ' — ' + ws.label : '') +
           (sport ? ' · <b>' + P.sportTag(car.shape) + '</b>' : '') +
           (T.combo > 1 ? ' · série <b>×' + T.combo + '</b>' : '') +
           (car.got1 && car.got2 ? '' : ' · il manque <b>' + (car.got1 ? car.p2.p : car.p1.p) + '</b>'), 'ok');
  if (!(car.got1 && car.got2)) setTarget(car);   // le mot suivant ira d'abord sur cette voiture
  if (!(car.got1 && car.got2)) P.guideSay(2, 'Bien joué. Il reste l\'autre paire, <b>' + (car.got1 ? car.p2.p : car.p1.p) + '</b> : un deuxième mot et la voiture explose.');
  if (T.combo === 3) P.guideSay(4, 'Votre <b>série</b> monte : les points sont multipliés. Une erreur la remet à ×1 — à ×5, la fièvre.');
  renderPairs();

  if (car.got1 && car.got2) readPlate(car, who, sport);
  else if (T.combo >= MULT_MAX && !inFever() && T.feverArmed) { T.feverArmed = false; startFever(); }
  renderHud();
}

/* la plaque est lue : la cote tombe, la voiture explose — la citerne emporte ses voisines */
function readPlate(car, who, sport) {
  var bonus = Math.round(car.value * P.sportBonus(car.shape) * (car.gold ? GOLD_MULT : 1) * multiplier());
  car.pts += bonus; T.score += bonus; T.done++;
  gainTime(PLATE_TIME);
  if (T.combo < MULT_MAX) { T.combo++; if (T.combo === MULT_MAX) T.feverArmed = true; }
  P.track.plate(car.p1.p + '·' + car.num + '·' + car.p2.p, car.pts, { sport: sport, gold: car.gold, tank: car.tank, dep: car.dep.num, depName: car.dep.nom });
  pop(car, 'COTE +' + bonus, 'win');
  P.floatPts($('tr-input'), '+' + bonus, 'float--win');
  P.bump($('tr-score').parentNode.parentNode, 'bump--big');
  P.guideSay(3, '💥 Plaque lue ! Sa <b>cote</b> — les trois chiffres — tombe dans votre score. Plus les paires sont rares, plus elle est haute.');
  feedback('💥 <b>Plaque lue !</b> ' + who + ' — cote <b>+' + bonus + '</b>' +
           (sport ? ' (🏎️ coupé ×1,5)' : '') + (car.gold ? ' (✨ dorée ×3)' : '') + (T.rush ? ' (rush ×2)' : '') +
           ' — ' + car.dep.num + ' ' + car.dep.nom, 'ok');
  leaveCar(car, true);
  if (car.tank) {
    setTimeout(function () {
      var hit = 0;
      T.lanes.forEach(function (c) {
        if (!c || c.gone) return;
        var b = Math.round(c.value * 0.5 * multiplier());
        c.pts += b; T.score += b; T.done++; hit++;
        P.track.plate(c.p1.p + '·' + c.num + '·' + c.p2.p, b, { dep: c.dep.num, depName: c.dep.nom });
        pop(c, 'SOUFFLÉE +' + b, 'win');
        leaveCar(c, true);
      });
      if (hit) { P.toast('🛢️ <b>Explosion en chaîne</b> — ' + hit + ' voiture' + (hit > 1 ? 's' : '') + ' soufflée' + (hit > 1 ? 's' : '')); renderHud(); }
    }, 350);
  }
}

/* ─────────── boucle ─────────── */
function loop() {
  var last = Date.now();
  clearInterval(T.tick);
  T.tick = setInterval(function () {
    var now = Date.now();
    T.timeLeft -= (now - last) / 1000;
    last = now;
    var ct = carTime();
    T.lanes.forEach(function (c, lane) {
      if (!c || c.gone) return;
      var left = ct + c.extra - (now - c.born) / 1000;
      var bar = c.el.querySelector('.car__timer i');
      if (bar) bar.style.transform = 'scaleX(' + Math.max(0, Math.min(1, left / ct)).toFixed(3) + ')';
      if (left <= 0) {
        if (!c.words) T.combo = 1;              // une voiture partie sans un mot casse la série
        P.sfx.over();
        pop(c, 'trop tard', 'miss');
        P.track.miss({ p1: c.p1.p, p2: c.p2.p, got1: c.got1, got2: c.got2 });
        leaveCar(c, false);
      }
    });
    // filet de sécurité : une voie vide sans relais programmé se réalimente
    T.lanes.forEach(function (c, lane) { if (!c && !T.timers[lane]) scheduleLane(lane, SPAWN_GAP); });
    // rush final : ciel rouge, tout compte double
    var rush = T.timeLeft <= RUSH;
    if (rush !== T.rush) {
      T.rush = rush;
      document.querySelector('.road').classList.toggle('rush', rush);
      if (rush) { P.toast('🚨 <b>RUSH</b> — dernières secondes, tout compte double'); P.sfx.over(); }
    }
    if (T.feverUntil && !inFever()) {
      T.feverUntil = 0;
      document.querySelector('.road').classList.remove('fever');
      T.combo = 3;                                // on redescend pour pouvoir remonter
    }
    P.ghostSample(played(), T.score);
    P.paintGhost($('tr-ghost'), played(), T.score);
    if (T.timeLeft <= 0) { T.timeLeft = 0; renderHud(); finish(); return; }
    renderHud();
  }, 100);
}

/* balises de bord de route : six par côté, décalées dans le temps, elles défilent
   sur la même projection que les voitures — c'est elles qui donnent la vitesse */
function buildPosts() {
  var html = '';
  for (var side = -1; side <= 1; side += 2) {
    for (var i = 0; i < 6; i++) {
      html += '<i class="post' + (side < 0 ? ' post--l' : ' post--r') +
              '" style="animation-delay:' + (-i * 0.22).toFixed(2) + 's"></i>';
    }
  }
  $('tr-posts').innerHTML = html;
}

function start() {
  P = window.PLAQUE;
  buildPosts();
  // deux voies sur un petit écran : les plaques y restent lisibles
  var two = Math.min(window.innerWidth, screen.width || 9999) < NARROW;
  LANES = two ? LANES2 : LANES3;
  document.querySelector('.road').classList.toggle('road--two', two);
  var pace = PACE[P.state.diff] || PACE.normal;
  SPAWN_GAP = pace.gap; GAP_MIN = pace.min; GAP_MAX = pace.max;
  T.running = true; T.timeLeft = GAME_TIME; T.score = 0;
  T.done = 0; T.seen = 0; T.combo = 1; T.lanes = LANES.map(function () { return null; }); T.history = []; T.lastSpawn = 0; T.target = null;
  T.t0 = Date.now(); T.feverUntil = 0; T.fevers = 0; T.rush = false; T.feverArmed = true;
  document.querySelector('.road').classList.remove('rush', 'fever');
  T.timers.forEach(clearTimeout); T.timers = LANES.map(function () { return null; });
  $('tr-cars-layer').innerHTML = '';
  T.roster = P.fleetRoster();
  preloadCars(T.roster);
  $('tr-input').value = '';
  feedback('&nbsp;', '');
  renderHud(); renderPairs();
  P.screen('screen-traffic');
  P.fitViewport('screen-traffic', '.road', '.hud, .road, .tr-pairs, #tr-form, .feedback, .hint-line');
  $('tr-input').focus();
  loop();
  // les trois voies s'amorcent à des instants différents
  P.shuffle(LANES.map(function (_, k) { return k; })).forEach(function (lane, i) { scheduleLane(lane, 300 + i * SPAWN_GAP); });
}

function finish() {
  T.running = false;
  clearInterval(T.tick);
  T.timers.forEach(clearTimeout);
  T.lanes.forEach(function (c) { if (c && !c.gone) leaveCar(c, false); });
  P.state.history = T.history;
  P.finishGame(
    P.row('Voitures croisées', T.seen) +
    P.row('Plaques entièrement lues', T.done + ' / ' + T.seen, T.done === 0),
    T.score);
}

function stop() {
  T.running = false;
  clearInterval(T.tick);
  T.timers.forEach(clearTimeout);
  T.lanes = LANES.map(function () { return null; });
  $('tr-cars-layer').innerHTML = '';
  document.querySelector('.road').classList.remove('rush', 'fever');
}

window.TRAFFIC = { start: start, stop: stop, submit: submit };

document.addEventListener('DOMContentLoaded', function () {
  $('tr-form').addEventListener('submit', submit);
  window.PLAQUE.autoSubmit($('tr-input'), $('tr-form'), function (w) {
    return T.lanes.some(function (c) {
      return c && !c.gone && w !== c.got1 && w !== c.got2 &&
             ((!c.got1 && P.matchPair(w, c.p1.p)) || (!c.got2 && P.matchPair(w, c.p2.p)));
    });
  });
  $('tr-pairs').addEventListener('pointerdown', function (e) {
    var g = e.target.closest('.tokgroup');
    if (!g) return;
    var car = T.lanes[+g.dataset.lane];
    if (car && !car.gone) { setTarget(car); $('tr-input').focus(); }
  });
  $('tr-quit').addEventListener('click', function () { stop(); finish(); });
});

})();
