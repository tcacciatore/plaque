/* ═══════════════════════════════════════════════════════════
   PLAQUE — mode Poursuite
   Vous roulez plus vite que tout le monde. Les voitures surgissent
   à l'horizon et se rapprochent ; celles de votre voie sont des
   menaces : lisez leur plaque avant l'impact, elles explosent.
   Celles des voies voisines vous frôlent — des points à prendre.
   Trois pare-chocs, et la vitesse qui monte. Sans fin.
   ═══════════════════════════════════════════════════════════ */
(function () {
'use strict';

var P = null;
var LIVES = 3;
var LANES = [-30, 0, 30], MY_LANE = 1;
var Z_FAR = 10, Z_READ = 7, Z_HIT = 1.05, Z_PASS = 0.55;
var V0 = 0.8, V_RAMP = 0.01, V_MAX = 2.2;            // vitesse en profondeur (z/s), sa montée par seconde, son plafond
var SPAWN0 = 4.5, SPAWN_MIN = 2.2;                    // intervalle entre deux arrivées, au départ et au plus serré
var CENTER0 = 0.42, CENTER_MAX = 0.68;                // part des voitures qui arrivent sur votre voie
var FEVER = 10, MULT_MAX = 5;
var GOLD_ODDS = 22, GOLD_MULT = 3, TANK_ODDS = 12;
var SHAPES = ['berline', 'suv', 'citadine', 'pickup', 'van', 'coupe'];
var SPORT = 'coupe', SPORT_BONUS = 1.5, TANK = 'citerne';
var PLATE_Y = { berline: 71.5, suv: 73.3, citadine: 69.5, pickup: 56.8, van: 70.5, coupe: 62.7, citerne: 75.5 };
var PLATE_W = { berline: 47.3, suv: 45.0, citadine: 48.8, pickup: 43.6, van: 45.0, coupe: 43.0, citerne: 44.3 };
var SIZE = { berline: .74, suv: .70, citadine: .66, pickup: .72, van: .62, coupe: .78, citerne: .56 };
var SPRITES = 'assets/cars/';

var R = { running: false, cars: [], lives: LIVES, score: 0, km: 0, done: 0, dodged: 0, hits: 0, combo: 1,
          t0: 0, last: 0, v: V0, nextSpawn: 0, raf: null, target: null, feverUntil: 0, feverArmed: true,
          invulnUntil: 0, history: [], sceneW: 0, sceneH: 0 };
var $ = function (id) { return document.getElementById(id); };

/* ─────────── projection : la même que la route du Trafic ─────────── */
function project(lane, z) {
  return { x: 50 + LANES[lane] / z, y: 46 + 48 / z, s: 1 / z };   // x, y en % de la scène ; y = bas de la voiture
}
function place(el, lane, z, w) {
  var p = project(lane, z);
  var px = p.x / 100 * R.sceneW, py = p.y / 100 * R.sceneH;
  el.style.transform = 'translate3d(' + px.toFixed(1) + 'px,' + py.toFixed(1) + 'px,0) translate(-50%,-100%) scale(' + p.s.toFixed(4) + ')';
  el.style.zIndex = String(Math.round(1000 - z * 50));
}

/* ─────────── voitures ─────────── */
function plateHTML(c) {
  return '<div class="plate plate--car plate--pursuit" style="--plateY:' + PLATE_Y[c.shape] + '%;--plateW:' + PLATE_W[c.shape] + '%">' +
      '<div class="plate__eu"><div class="plate__f">F</div></div>' +
      '<div class="plate__body">' +
        '<span class="plate__letters" data-pair="1">' + c.p1.p + '</span>' +
        '<span class="plate__sep">·</span><span class="plate__num">' + c.num + '</span>' +
        '<span class="plate__sep">·</span>' +
        '<span class="plate__letters" data-pair="2">' + c.p2.p + '</span>' +
      '</div>' +
      '<div class="plate__dep"><div class="plate__depnum">' + c.dep.num + '</div></div>' +
    '</div>';
}
function pickShape() {
  var present = R.cars.map(function (c) { return c.shape; });
  if (present.indexOf(TANK) === -1 && R.done + R.dodged > 3 && P.rand(TANK_ODDS) === 0) return TANK;
  if (present.indexOf(SPORT) === -1 && P.rand(7) === 0) return SPORT;
  var pool = SHAPES.filter(function (s) { return s !== SPORT && present.indexOf(s) === -1; });
  return P.pick(pool.length ? pool : SHAPES);
}
function spawn() {
  var t = played();
  var centerShare = Math.min(CENTER_MAX, CENTER0 + t / 240 * (CENTER_MAX - CENTER0));
  var lane = Math.random() < centerShare ? MY_LANE : (Math.random() < 0.5 ? 0 : 2);
  // pas deux voitures trop proches sur la même voie
  var blocked = R.cars.some(function (c) { return c.lane === lane && c.z > Z_FAR - 3; });
  if (blocked) { lane = [0, 1, 2].filter(function (l) { return !R.cars.some(function (c) { return c.lane === l && c.z > Z_FAR - 3; }); })[0]; }
  if (lane == null) return;

  var plate = P.newPlate(R.cars.length === 0 && R.done === 0), shape = pickShape();
  var gold = shape !== TANK && P.rand(GOLD_ODDS) === 0;
  var c = {
    p1: plate.p1, p2: plate.p2, dep: plate.dep, value: plate.value, num: String(plate.value).padStart(3, '0'),
    shape: shape, lane: lane, z: Z_FAR, rel: 0.85 + Math.random() * 0.35, gold: gold, tank: shape === TANK,
    got1: null, got2: null, words: 0, pts: 0, gone: false, born: Date.now()
  };
  var el = document.createElement('div');
  el.className = 'pcar' + (lane === MY_LANE ? ' pcar--threat' : '') + (shape === SPORT ? ' car--sport' : '') +
                 (gold ? ' car--gold' : '') + (c.tank ? ' car--tank' : '');
  el.style.width = (SIZE[shape] * R.sceneH) + 'px';
  el.innerHTML = '<div class="car__ride">' +
                   (gold ? '<span class="sport-tag sport-tag--gold">✨ ×3</span>' : c.tank ? '<span class="sport-tag sport-tag--tank">⚠ citerne</span>' : '') +
                   '<img class="car__body" alt="" draggable="false" src="' + SPRITES + shape + '-' + (gold ? 'or' : P.pick(P.colors())) + '.webp">' +
                   '<div class="car__shadow"></div>' +
                 '</div><div class="car__fx"></div><div class="car__pop"></div>';
  var pl = document.createElement('div');
  pl.className = 'pplate';
  pl.innerHTML = plateHTML(c);
  c.el = el; c.pl = pl;
  el.addEventListener('pointerdown', function () { if (!c.gone) { setTarget(c); $('pu-input').focus(); } });
  pl.addEventListener('pointerdown', function () { if (!c.gone) { setTarget(c); $('pu-input').focus(); } });
  $('pu-cars').appendChild(el);
  $('pu-cars').appendChild(pl);
  R.cars.push(c);
  place(el, lane, c.z, 0);
  placePlate(c);
  renderTokens();
}
function placePlate(c) {
  var p = project(c.lane, c.z);
  var readable = c.z <= Z_READ;
  var s = Math.max(0.62, Math.min(1, 1 / c.z));           // la plaque reste lisible bien avant la voiture
  var px = p.x / 100 * R.sceneW;
  var carH = SIZE[c.shape] * R.sceneH * 0.66 * p.s;       // hauteur affichée de la voiture (ratio ≈ 1,5)
  var py = p.y / 100 * R.sceneH - carH * (1 - PLATE_Y[c.shape] / 100);
  c.pl.style.transform = 'translate3d(' + px.toFixed(1) + 'px,' + py.toFixed(1) + 'px,0) translate(-50%,-50%) scale(' + s.toFixed(3) + ')';
  c.pl.style.opacity = readable ? '1' : '0';
  c.pl.style.zIndex = String(Math.round(1001 - c.z * 50));
}
function removeCar(c, cls) {
  c.gone = true;
  R.cars = R.cars.filter(function (x) { return x !== c; });
  if (R.target === c) R.target = null;
  var el = c.el, pl = c.pl;
  if (cls) el.classList.add(cls);
  pl.style.opacity = '0';
  setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); if (pl.parentNode) pl.parentNode.removeChild(pl); }, cls === 'pcar--boom' ? 1400 : 700);
  R.history.push({ p1: c.p1.p, p2: c.p2.p, dep: c.dep.num, words: c.words, pts: c.pts, reached: c.words >= 2 });
  renderTokens();
}

/* ─────────── ciblage, jetons ─────────── */
function setTarget(c) {
  R.target = c;
  R.cars.forEach(function (x) { x.el.classList.toggle('car--target', x === c); x.pl.classList.toggle('car--target', x === c); });
  renderTokens();
}
function renderTokens() {
  var box = $('pu-pairs');
  var vis = R.cars.filter(function (c) { return !c.gone && c.z <= Z_READ + 0.6; }).sort(function (a, b) { return a.z - b.z; });
  if (!vis.length) { box.innerHTML = '<span class="tok tok--wait">…</span>'; return; }
  box.innerHTML = vis.map(function (c, i) {
    var sp = c.shape === SPORT ? ' tok--sport' : '';
    var tg = c === R.target ? ' tok--target' : '';
    var th = c.lane === MY_LANE ? ' tokgroup--threat' : '';
    return '<span class="tokgroup' + tg + th + '" data-i="' + R.cars.indexOf(c) + '">' +
           (c.lane === MY_LANE ? '<i class="tok__warn">⚠</i>' : '') +
           '<span class="tok' + sp + (c.got1 ? ' tok--on' : '') + '">' + (c.got1 ? '✓' : c.p1.p) + '</span>' +
           '<span class="tok' + sp + (c.got2 ? ' tok--on' : '') + '">' + (c.got2 ? '✓' : c.p2.p) + '</span></span>';
  }).join('');
}
function pop(c, txt, cls) {
  var p = c.el.querySelector('.car__pop');
  p.textContent = txt; p.className = 'car__pop ' + (cls || '');
  void p.offsetWidth; p.classList.add('go');
}
function flashPair(c, which) {
  var el = c.pl.querySelector('[data-pair="' + which + '"]');
  if (!el) return;
  el.classList.add('hit'); setTimeout(function () { el.classList.remove('hit'); }, 500);
}
function feedback(msg, cls) { var f = $('pu-feedback'); f.innerHTML = msg; f.className = 'feedback ' + (cls || ''); }
function played() { return (Date.now() - R.t0) / 1000; }
function inFever() { return Date.now() < R.feverUntil; }
function multiplier() { return R.lives === 1 ? 2 : 1; }             // dernier pare-chocs : tout compte double
function startFever() {
  R.feverUntil = Date.now() + FEVER * 1000;
  $('pu-road').classList.add('fever');
  P.track.fever();
  P.toast('🔥 <b>FIÈVRE</b> — pendant ' + FEVER + ' s, un seul mot suffit à lire une plaque');
  P.sfx.win();
}

/* ─────────── saisie ─────────── */
function submit(e) {
  e.preventDefault();
  if (!R.running) return;
  var inp = $('pu-input'), w = P.norm(inp.value.trim());
  inp.value = '';
  if (!w) return;
  var alive = R.cars.filter(function (c) { return !c.gone && c.z <= Z_READ + 0.6; });
  if (!alive.length) { feedback('Rien à lire encore…', 'ko'); return; }
  function reject(msg) {
    feedback(msg, 'ko'); R.combo = 1; R.feverArmed = true; P.sfx.ko();
    inp.classList.add('shake'); setTimeout(function () { inp.classList.remove('shake'); }, 320); renderHud();
  }
  if (w.length < 3) return reject('Trop court — 3 lettres minimum.');

  var best = null, used = false;
  alive.forEach(function (c) {
    if (w === c.got1 || w === c.got2) { used = true; return; }
    var h1 = c.got1 ? null : P.matchPair(w, c.p1.p);
    var h2 = c.got2 ? null : P.matchPair(w, c.p2.p);
    if (!h1 && !h2) return;
    var rank = (c === R.target ? 16 : 0) +
               (((h1 && h2) || (h1 && c.got2) || (h2 && c.got1)) ? 8 : 0) +
               (c.lane === MY_LANE ? 4 : 0) +                       // la menace d'abord
               ((c.got1 || c.got2) ? 2 : 0) + (1 - c.z / 20);       // puis la plus proche
    if (!best || rank > best.rank) best = { c: c, h1: h1, h2: h2, rank: rank };
  });
  if (!best) return reject(used ? '<b>' + w.toUpperCase() + '</b> — déjà joué.' : '<b>' + w.toUpperCase() + '</b> ne va sur aucune plaque en vue.');
  if (!P.isWord(w)) return reject('<b>' + w.toUpperCase() + '</b> — inconnu du dictionnaire.');

  var c = best.c, hit = best.h1 || best.h2;
  var ws = P.wordScore(w, hit), tier = ws.tier, rare = ws.rare;
  var sport = c.shape === SPORT;
  var pts = Math.round(ws.pts * R.combo * (sport ? SPORT_BONUS : 1) * (c.gold ? GOLD_MULT : 1) * multiplier());
  var both = best.h1 && best.h2;
  if (both) pts *= 2;
  if (best.h1) { c.got1 = w; flashPair(c, 1); }
  if (best.h2) { c.got2 = w; flashPair(c, 2); }
  if (inFever() && !(c.got1 && c.got2)) { if (!c.got1) { c.got1 = '🔥'; flashPair(c, 1); } else { c.got2 = '🔥'; flashPair(c, 2); } }
  c.words += both ? 2 : 1; c.pts += pts; R.score += pts;
  var wasMax = R.combo >= MULT_MAX;
  R.combo = Math.min(MULT_MAX, R.combo + 1);
  P.track.word(w, pts, tier, R.combo);
  P.floatPts(inp, '+' + pts, tier === 2 && rare ? 'float--rare' : '');
  P.bump($('pu-score').parentNode.parentNode);
  pop(c, '+' + pts, rare && tier === 2 ? 'rare' : '');
  var who = '<b class="mono">' + c.p1.p + '·' + c.num + '·' + c.p2.p + '</b>';

  if (c.got1 && c.got2) {
    var extremis = c.lane === MY_LANE && c.z < 1.7;
    var bonus = Math.round(c.value * (sport ? SPORT_BONUS : 1) * (c.gold ? GOLD_MULT : 1) * (extremis ? 1.5 : 1) * multiplier());
    c.pts += bonus; R.score += bonus; R.done++;
    P.track.plate(c.p1.p + '·' + c.num + '·' + c.p2.p, c.pts, { sport: sport, gold: c.gold, tank: c.tank, dep: c.dep.num, depName: c.dep.nom });
    pop(c, (extremis ? 'IN EXTREMIS ' : 'COTE ') + '+' + bonus, 'win');
    P.floatPts(inp, '+' + bonus, 'float--win');
    P.bump($('pu-score').parentNode.parentNode, 'bump--big');
    feedback('💥 <b>Dégommée !</b> ' + who + ' — cote <b>+' + bonus + '</b>' +
             (extremis ? ' (🫀 in extremis ×1,5)' : '') + (sport ? ' (🏎️ coupé ×1,5)' : '') + (c.gold ? ' (✨ dorée ×3)' : '') +
             (R.lives === 1 ? ' (dernier pare-chocs ×2)' : ''), 'ok');
    P.guideSay(3, '💥 Dégommée ! Sa <b>cote</b> tombe dans votre score. Les voitures sur <b>votre voie</b> (⚠) sont des menaces : lisez-les avant l\'impact.');
    explodeCar(c);
    if (c.tank) chain(c);
  } else {
    (tier === 2 && rare) ? P.sfx.rare() : P.sfx.ok(R.combo);
    feedback('+' + pts + ' sur ' + who + (ws.label ? ' — ' + ws.label : '') + (sport ? ' · 🏎️ <b>coupé ×1,5</b>' : '') +
             ' · il manque <b>' + (c.got1 ? c.p2.p : c.p1.p) + '</b>', 'ok');
    setTarget(c);
    P.guideSay(2, 'Bien joué. Il reste <b>' + (c.got1 ? c.p2.p : c.p1.p) + '</b> : un deuxième mot et elle explose.');
  }
  if (R.combo === 3) P.guideSay(4, 'Votre <b>série</b> monte. Une erreur ou un impact la remet à ×1 — à ×5, la fièvre.');
  if (R.combo >= MULT_MAX && !wasMax && !inFever() && R.feverArmed) { R.feverArmed = false; startFever(); }
  renderHud();
}
function explodeCar(c) {
  P.explode(c.el.querySelector('.car__fx'), $('pu-road'));
  removeCar(c, 'pcar--boom');
}
function chain(tank) {
  setTimeout(function () {
    var hit = 0;
    R.cars.slice().forEach(function (c) {
      if (c.gone || Math.abs(c.z - tank.z) > 3.5) return;
      var b = Math.round(c.value * 0.5 * multiplier());
      c.pts += b; R.score += b; R.done++; hit++;
      P.track.plate(c.p1.p + '·' + c.num + '·' + c.p2.p, b, { dep: c.dep.num, depName: c.dep.nom });
      pop(c, 'SOUFFLÉE +' + b, 'win');
      explodeCar(c);
    });
    if (hit) { P.toast('🛢️ <b>Explosion en chaîne</b> — ' + hit + ' voiture' + (hit > 1 ? 's' : '') + ' soufflée' + (hit > 1 ? 's' : '')); renderHud(); }
  }, 350);
}

/* ─────────── impact ─────────── */
function crash(c) {
  R.hits++;
  R.combo = 1; R.feverArmed = true;
  P.track.miss({ p1: c.p1.p, p2: c.p2.p, got1: c.got1, got2: c.got2 });
  P.explode(c.el.querySelector('.car__fx'), $('pu-road'));
  removeCar(c, 'pcar--boom');
  if (Date.now() < R.invulnUntil) return;
  R.lives--;
  R.invulnUntil = Date.now() + 2000;
  $('pu-me').classList.remove('me--hit'); void $('pu-me').offsetWidth; $('pu-me').classList.add('me--hit');
  P.sfx.over();
  feedback('💢 <b>Impact !</b> ' + (R.lives > 0 ? 'Il vous reste ' + R.lives + ' pare-choc' + (R.lives > 1 ? 's' : '') + (R.lives === 1 ? ' — tout compte double' : '') : 'Plus de pare-chocs…'), 'ko');
  renderHud();
  if (R.lives <= 0) setTimeout(finish, 900);
}

/* ─────────── affichage ─────────── */
function renderHud() {
  var hearts = '';
  for (var i = 0; i < LIVES; i++) hearts += i < R.lives ? '🛡️' : '<i>·</i>';
  $('pu-lives').innerHTML = hearts;
  P.tweenNumber($('pu-score'), R.score, 450);
  $('pu-km').innerHTML = R.km.toFixed(1) + ' <i>km</i>' + (R.combo > 1 ? ' <i class="combo combo--' + R.combo + '">×' + R.combo + '</i>' : '');
  $('pu-timebox').classList.toggle('low', R.lives === 1);
}
function measure() {
  var r = $('pu-road').getBoundingClientRect();
  R.sceneW = r.width; R.sceneH = r.height;
  var me = $('pu-me');                                    // votre voiture : bas de cadre, on voit son toit et son coffre
  me.style.width = (0.40 * R.sceneH) + 'px';
  place(me, MY_LANE, 0.72, 0);
  R.cars.forEach(function (c) { c.el.style.width = (SIZE[c.shape] * R.sceneH) + 'px'; place(c.el, c.lane, c.z); placePlate(c); });
}

/* ─────────── boucle ─────────── */
function frame(now) {
  if (!R.running) return;
  var dt = Math.min(0.05, (now - R.last) / 1000); R.last = now;
  R.v = Math.min(V_MAX, R.v + V_RAMP * dt);
  R.km += R.v * dt * 0.045;
  R.nextSpawn -= dt;
  if (R.nextSpawn <= 0) {
    spawn();
    var t = played(), gap = Math.max(SPAWN_MIN, SPAWN0 - t / 60 * 0.6);
    R.nextSpawn = gap * (0.8 + Math.random() * 0.4);
  }
  R.cars.slice().forEach(function (c) {
    if (c.gone) return;
    var wasFar = c.z > Z_READ;
    c.z -= R.v * c.rel * dt;
    place(c.el, c.lane, c.z); placePlate(c);
    if (wasFar && c.z <= Z_READ) { renderTokens(); if (c.lane === MY_LANE) c.el.classList.add('pcar--near'); }
    if (c.lane === MY_LANE) {
      if (c.z <= Z_HIT) crash(c);
    } else if (c.z <= Z_PASS) {
      R.dodged++; P.track.miss({ p1: c.p1.p, p2: c.p2.p, got1: c.got1, got2: c.got2 });
      removeCar(c, 'pcar--pass');
    }
  });
  if (R.feverUntil && !inFever()) { R.feverUntil = 0; $('pu-road').classList.remove('fever'); R.combo = 3; R.feverArmed = true; }
  $('pu-road').classList.toggle('rush', R.lives === 1);
  $('pu-me').classList.toggle('me--blink', Date.now() < R.invulnUntil);
  if (Math.floor(now / 200) !== Math.floor((now - dt * 1000) / 200)) {
    P.ghostSample(played(), R.score); P.paintGhost($('pu-ghost'), played(), R.score); renderHud();
  }
  R.raf = requestAnimationFrame(frame);
}

function start() {
  P = window.PLAQUE;
  R.running = true; R.cars = []; R.lives = LIVES; R.score = 0; R.km = 0; R.done = 0; R.dodged = 0; R.hits = 0;
  R.combo = 1; R.v = V0; R.nextSpawn = 1.2; R.target = null; R.feverUntil = 0; R.feverArmed = true; R.invulnUntil = 0; R.history = [];
  R.t0 = Date.now(); R.last = performance.now();
  $('pu-cars').innerHTML = '';
  $('pu-input').value = '';
  $('pu-me').querySelector('img').src = P.myCar();
  $('pu-road').classList.remove('rush', 'fever');
  feedback('&nbsp;', '');
  P.screen('screen-pursuit');
  P.fitViewport('screen-pursuit', '.road', '.hud, .road, .tr-pairs, #pu-form, .feedback, .hint-line');
  measure();
  renderHud(); renderTokens();
  P.guideSay(1, 'Vous roulez plus vite que tout le monde. Les voitures arrivent de l\'horizon : tapez un mot pour chaque paire de la plaque et la voiture explose. Celles de <b>votre voie</b> doivent sauter avant l\'impact.');
  $('pu-input').focus();
  cancelAnimationFrame(R.raf);
  R.raf = requestAnimationFrame(frame);
}
function finish() {
  if (!R.running) return;
  R.running = false;
  cancelAnimationFrame(R.raf);
  R.cars.slice().forEach(function (c) { removeCar(c, 'pcar--pass'); });
  P.state.history = R.history;
  P.finishGame(
    P.row('Distance', R.km.toFixed(1) + ' km') +
    P.row('Voitures dégommées', R.done, R.done === 0) +
    P.row('Frôlées sans les lire', R.dodged, true) +
    P.row('Impacts', R.hits, true),
    R.score);
}
function stop() { R.running = false; cancelAnimationFrame(R.raf); R.cars = []; $('pu-cars').innerHTML = ''; }

window.PURSUIT = { start: start, stop: stop, measure: measure };

document.addEventListener('DOMContentLoaded', function () {
  $('pu-form').addEventListener('submit', submit);
  window.PLAQUE.autoSubmit($('pu-input'), $('pu-form'), function (w) {
    return R.cars.some(function (c) {
      return !c.gone && c.z <= Z_READ + 0.6 && w !== c.got1 && w !== c.got2 &&
             ((!c.got1 && P.matchPair(w, c.p1.p)) || (!c.got2 && P.matchPair(w, c.p2.p)));
    });
  });
  $('pu-quit').addEventListener('click', function () { finish(); });
  $('pu-pairs').addEventListener('pointerdown', function (e) {
    var g = e.target.closest('.tokgroup'); if (!g) return;
    var c = R.cars[+g.dataset.i]; if (c && !c.gone) { setTarget(c); $('pu-input').focus(); }
  });
  window.addEventListener('resize', function () { if (R.running) measure(); });
  if (window.visualViewport) window.visualViewport.addEventListener('resize', function () { if (R.running) setTimeout(measure, 50); });
});

})();
