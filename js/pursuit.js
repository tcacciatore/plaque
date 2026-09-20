/* ═══════════════════════════════════════════════════════════
   PLAQUE — mode Poursuite
   Au volant, vue de l'intérieur. Vous roulez plus vite que tout le
   monde ; les voitures surgissent à l'horizon et se rapprochent.
   Un seul mot sur l'une des deux paires suffit à dégommer une
   plaque. Celles de votre voie sont des menaces : avant l'impact.
   Trois pare-chocs, la vitesse qui monte. Sans fin.
   ═══════════════════════════════════════════════════════════ */
(function () {
'use strict';

var P = null;
var LIVES = 3;
var LANES = [-30, 0, 30], MY_LANE = 1;
var Z_FAR = 10, Z_READ = 9.2, Z_HIT = 1.8, Z_PASS = 1.2;   // la plaque se lit dès l'horizon ; l'impact a lieu au bord du capot
var V0 = 0.68, V_RAMP = 0.005, V_MAX = 1.7;          // vitesse en profondeur (z/s), sa montée par seconde, son plafond
                                                     // → ~11 s pour lire une plaque au départ, ~6 s après deux minutes
var SPAWN0 = 6.0, SPAWN_MIN = 3.6;                    // intervalle entre deux arrivées, au départ et au plus serré
var CENTER0 = 0.34, CENTER_MAX = 0.50;                // part des voitures qui arrivent sur votre voie
var REL_THREAT = [0.72, 0.92], REL_OTHER = [0.85, 1.2];   // celles de votre voie freinent devant vous : plus de temps pour elles
var FEVER = 10, MULT_MAX = 5;
var GOLD_ODDS = 22, GOLD_MULT = 3, TANK_ODDS = 12;
// le parc (silhouettes, plaques, tailles, bonus) est décrit une fois pour toutes dans js/game.js
var FLEET = window.PLAQUE.FLEET, TANK = window.PLAQUE.TANK;
var SPRITES = 'assets/cars/';
var isSport = function (s) { return !!FLEET[s].sport; };

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
  return '<div class="plate plate--car plate--pursuit" style="--plateY:' + FLEET[c.shape].plateY + '%;--plateW:' + FLEET[c.shape].plateW + '%">' +
      '<div class="plate__eu"><div class="plate__f">F</div></div>' +
      '<div class="plate__body">' +
        '<span class="plate__letters" data-pair="1">' + c.p1.p + '</span>' +
        '<span class="plate__sep">·</span><span class="plate__num">' + c.num + '</span>' +
        '<span class="plate__sep">·</span>' +
        '<span class="plate__letters" data-pair="2">' + (c.hidden ? '??' : c.p2.p) + '</span>' +
      '</div>' +
      '<div class="plate__dep"><div class="plate__depnum">' + c.dep.num + '</div></div>' +
    '</div>';
}
function pickShape() {
  var present = R.cars.map(function (c) { return c.shape; });
  if (!R.cars.length && !R.done && !R.dodged) return R.roster[0];   // la première : une silhouette neutre
  if (present.indexOf(TANK) === -1 && R.done + R.dodged > 3 && P.rand(TANK_ODDS) === 0) return TANK;
  var sports = R.roster.filter(function (s) { return isSport(s) && present.indexOf(s) === -1; });
  if (sports.length && P.rand(7) === 0) return P.pick(sports);
  var pool = R.roster.filter(function (s) { return !isSport(s) && present.indexOf(s) === -1; });
  return P.pick(pool.length ? pool : R.roster);
}
function spawn() {
  var t = played();
  var centerShare = Math.min(CENTER_MAX, CENTER0 + t / 240 * (CENTER_MAX - CENTER0));
  var lane = Math.random() < centerShare ? MY_LANE : (Math.random() < 0.5 ? 0 : 2);
  // pas deux voitures trop proches sur la même voie : leurs plaques se chevaucheraient
  var free = function (l) { return !R.cars.some(function (c) { return c.lane === l && c.z > Z_FAR - 5.5; }); };
  if (!free(lane)) { lane = [0, 2, 1].filter(free)[0]; }
  if (lane == null) return;

  var plate = P.newPlate(R.cars.length === 0 && R.done === 0), shape = pickShape();
  var gold = shape !== TANK && P.rand(GOLD_ODDS) === 0;
  var c = {
    p1: plate.p1, p2: plate.p2, dep: plate.dep, value: plate.value, num: String(plate.value).padStart(3, '0'),
    shape: shape, lane: lane, z: Z_FAR, gold: gold, tank: shape === TANK,
    rel: (function (r) { return r[0] + Math.random() * (r[1] - r[0]); })(lane === MY_LANE ? REL_THREAT : REL_OTHER),
    got1: null, got2: null, words: 0, pts: 0, gone: false, born: Date.now()
  };
  P.initCar(c, 'poursuite');
  c.rel /= P.carTime(shape);                       // le camping-car approche lentement, la supercar fond sur vous
  if (c.cargo === 'joker') c.got2 = null;          // en Poursuite un mot suffit : pas de paire offerte
  var el = document.createElement('div');
  el.className = 'pcar' + (lane === MY_LANE ? ' pcar--threat' : '') + (isSport(shape) ? ' car--sport' : '') +
                 (gold ? ' car--gold' : '') + (c.tank ? ' car--tank' : '');
  el.style.width = (FLEET[shape].size * R.sceneH) + 'px';
  el.innerHTML = '<div class="car__ride">' +
                   (gold ? '<span class="sport-tag sport-tag--gold">✨ ×3</span>' : c.tank ? '<span class="sport-tag sport-tag--tank">⚠ citerne</span>' :
                    c.tag ? '<span class="sport-tag sport-tag--trait">' + c.tag + '</span>' : '') +
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
  // loin, les voies convergent et les plaques se recouvriraient : on les écarte
  // latéralement, d'autant plus que la voiture est loin ; l'écart se referme à l'approche
  var spread = (c.lane - MY_LANE) * 0.15 * Math.max(0, 1 - Z_HIT / c.z);
  var px = (p.x / 100 + spread) * R.sceneW;
  var F = FLEET[c.shape];
  var carH = F.size * R.sceneH / F.ratio * p.s;            // hauteur affichée de la voiture
  var py = p.y / 100 * R.sceneH - carH * (1 - F.plateY / 100);
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
    var sp = isSport(c.shape) ? ' tok--sport' : '';
    var tg = c === R.target ? ' tok--target' : '';
    var th = c.lane === MY_LANE ? ' tokgroup--threat' : '';
    return '<span class="tokgroup' + tg + th + '" data-i="' + R.cars.indexOf(c) + '">' +
           (c.lane === MY_LANE ? '<i class="tok__warn">⚠</i>' : '') +
           '<span class="tok' + sp + (c.got1 ? ' tok--on' : '') + '">' + (c.got1 ? '✓' : c.p1.p + (c.used.length ? '½' : '')) + '</span>' +
           '<span class="tok' + sp + (c.got2 ? ' tok--on' : '') + '">' + (c.got2 ? '✓' : c.hidden ? '??' : c.p2.p + (c.used.length ? '½' : '')) + '</span></span>';
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
  P.toast('🔥 <b>FIÈVRE</b> — pendant ' + FEVER + ' s, tout compte double');
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

  var best = null, used = false, ruleMsg = null, ruleCar = null;
  alive.forEach(function (c) {
    if (c.used.indexOf(w) !== -1) { used = true; return; }
    var h1 = c.got1 ? null : P.matchPair(w, c.p1.p);
    var h2 = (c.got2 || c.hidden) ? null : P.matchPair(w, c.p2.p);   // le 4×4 : seule la première paire se lit
    if (!h1 && !h2) return;
    var bad = P.wordRule(c, w, 'poursuite');                 // le caractère du modèle refuse ce mot
    if (bad) { if (!ruleMsg || c === R.target) { ruleMsg = bad; ruleCar = c; } return; }
    var rank = (c === R.target ? 16 : 0) +
               (((h1 && h2) || (h1 && c.got2) || (h2 && c.got1)) ? 8 : 0) +
               (c.lane === MY_LANE ? 4 : 0) +                       // la menace d'abord
               ((c.got1 || c.got2) ? 2 : 0) + (1 - c.z / 20);       // puis la plus proche
    if (!best || rank > best.rank) best = { c: c, h1: h1, h2: h2, rank: rank };
  });
  if (ruleMsg && !best) P.refuse(ruleCar, ruleMsg, ruleCar.el);
  if (!best) return reject(ruleMsg ? '<b>' + w.toUpperCase() + '</b> — ' + ruleMsg
                         : used ? '<b>' + w.toUpperCase() + '</b> — déjà joué.' : '<b>' + w.toUpperCase() + '</b> ne va sur aucune plaque en vue.');
  if (!P.isWord(w)) return reject('<b>' + w.toUpperCase() + '</b> — inconnu du dictionnaire.');

  var c = best.c, hit = best.h1 || best.h2;
  var ws = P.wordScore(w, hit), tier = ws.tier, rare = ws.rare;
  var sport = isSport(c.shape);
  var both = best.h1 && best.h2;                                  // les deux paires dans le même mot : ×2
  var fever = inFever() ? 2 : 1;
  var pts = Math.round(ws.pts * R.combo * P.sportBonus(c.shape) * (c.gold ? GOLD_MULT : 1) * multiplier() * (both ? 2 : 1) * fever);
  if (best.h1) { c.got1 = w; flashPair(c, 1); }
  if (best.h2) { c.got2 = w; flashPair(c, 2); }
  c.used.push(w);
  c.words += both ? 2 : 1; c.pts += pts; R.score += pts;
  var wasMax = R.combo >= MULT_MAX;
  R.combo = Math.min(MULT_MAX, R.combo + 1);
  P.track.word(w, pts, tier, R.combo);
  var who = '<b class="mono">' + c.p1.p + '·' + c.num + '·' + c.p2.p + '</b>';
  if (c.need > 1 && c.used.length < c.need) {      // le camion blindé : il faut un second mot
    c.got1 = null; c.got2 = null;
    (tier === 2 && rare) ? P.sfx.rare() : P.sfx.ok(R.combo);
    P.floatPts(inp, '+' + pts, '');
    feedback('+' + pts + ' sur ' + who + ' — 🚚 <b>camion blindé</b> : encore un mot, sur l\'une ou l\'autre paire.', 'ok');
    setTarget(c);
    renderTokens(); renderHud();
    return;
  }

  var extremis = c.lane === MY_LANE && c.z < Z_HIT + 0.8;
  var bonus = Math.round(c.value * P.carCote(c, 'poursuite') * (c.gold ? GOLD_MULT : 1) * (extremis ? 1.5 : 1) * (both ? 2 : 1) * multiplier() * fever);
  c.pts += bonus; R.score += bonus; R.done++;
  c.words = 2;
  var extra = '';
  if (P.trait(c.shape).give && R.lives < LIVES) { R.lives++; extra = ' · 🔧 <b>pare-chocs réparé</b>'; }
  if (c.cargo === 'fever' && !inFever()) { startFever(); extra += ' · 🔥 la benne était pleine de fièvre'; }
  P.track.plate(c.p1.p + '·' + c.num + '·' + c.p2.p, c.pts, { sport: sport, gold: c.gold, tank: c.tank, dep: c.dep.num, depName: c.dep.nom });
  pop(c, (extremis ? 'IN EXTREMIS ' : 'COTE ') + '+' + bonus, 'win');
  P.floatPts(inp, '+' + (pts + bonus), 'float--win');
  P.bump($('pu-score').parentNode.parentNode, 'bump--big');
  feedback('💥 <b>Dégommée !</b> ' + who + ' — <b>+' + (pts + bonus) + '</b>' +
           (ws.label ? ' · ' + ws.label : '') + (both ? ' · les deux paires ×2' : '') +
           (extremis ? ' · 🫀 in extremis ×1,5' : '') + (sport ? ' · ' + P.sportTag(c.shape) : '') + (c.gold ? ' · ✨ dorée ×3' : '') +
           P.traitLabel(c, 'poursuite') + extra +
           (fever > 1 ? ' · 🔥 fièvre ×2' : '') + (R.lives === 1 ? ' · dernier pare-chocs ×2' : ''), 'ok');
  P.guideSay(2, '💥 Dégommée ! Un seul mot suffit, sur l\'une ou l\'autre paire. Sa <b>cote</b> tombe dans votre score. Les voitures sur <b>votre voie</b> (⚠) doivent sauter avant l\'impact.');
  explodeCar(c);
  if (c.tank) chain(c);
  if (R.combo === 3) P.guideSay(4, 'Votre <b>série</b> monte. Une erreur ou un impact la remet à ×1 — à ×5, dix secondes de fièvre où tout compte double.');
  if (R.combo >= MULT_MAX && !wasMax && !inFever() && R.feverArmed) { R.feverArmed = false; startFever(); }
  renderHud();
}
/* l'explosion est dessinée à l'échelle de l'écran, au point projeté de la voiture,
   sinon elle rétrécit avec elle et devient invisible à distance */
function explodeCar(c) {
  var p = project(c.lane, c.z);
  var fx = document.createElement('div');
  fx.className = 'pfx';
  var s = Math.max(0.55, Math.min(1.1, 1 / c.z + 0.25));
  fx.style.left = (p.x / 100 * R.sceneW) + 'px';
  fx.style.top = (p.y / 100 * R.sceneH) + 'px';
  fx.style.transform = 'translate(-50%,-60%) scale(' + s.toFixed(2) + ')';
  $('pu-cars').appendChild(fx);
  P.explode(fx, $('pu-road'));
  setTimeout(function () { fx.remove(); }, 1500);
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
  explodeCar(c);
  if (Date.now() < R.invulnUntil) return;
  R.lives--;
  R.invulnUntil = Date.now() + 2000;
  var ck = $('pu-cockpit');
  ck.classList.remove('cockpit--hit'); void ck.offsetWidth; ck.classList.add('cockpit--hit');
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
  $('pu-badge').src = P.myCar();
  R.cars.forEach(function (c) { c.el.style.width = (FLEET[c.shape].size * R.sceneH) + 'px'; place(c.el, c.lane, c.z); placePlate(c); });
}

/* ─────────── boucle ─────────── */
function frame(now) {
  if (!R.running) return;
  var dt = Math.min(0.05, (now - R.last) / 1000); R.last = now;
  R.v = Math.min(V_MAX, R.v + V_RAMP * dt);
  R.km += R.v * dt * 0.063;      // même kilométrage qu'avant le ralentissement
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
  $('pu-cockpit').classList.toggle('cockpit--blink', Date.now() < R.invulnUntil);
  // le volant vit : léger balancement, et l'aiguille suit la vraie vitesse
  var sway = Math.sin(now / 900) * 2.2 + Math.sin(now / 173) * 0.5;
  $('pu-wheel').style.transform = 'translateX(-50%) rotate(' + sway.toFixed(2) + 'deg)';
  $('pu-needle').style.transform = 'rotate(' + (-110 + (R.v / V_MAX) * 220).toFixed(1) + 'deg)';
  $('pu-speed').textContent = Math.round(R.v * 78);
  if (Math.floor(now / 200) !== Math.floor((now - dt * 1000) / 200)) {
    P.ghostSample(played(), R.score); P.paintGhost($('pu-ghost'), played(), R.score); renderHud();
  }
  R.raf = requestAnimationFrame(frame);
}

function start() {
  P = window.PLAQUE;
  R.running = true; R.cars = []; R.lives = LIVES; R.score = 0; R.km = 0; R.done = 0; R.dodged = 0; R.hits = 0;
  R.combo = 1; R.v = V0; R.nextSpawn = 1.2; R.target = null; R.feverUntil = 0; R.feverArmed = true; R.invulnUntil = 0; R.history = [];
  R.roster = P.fleetRoster();
  R.roster.concat([TANK]).forEach(function (s) {      // préchargement du roster de la partie
    P.colors().concat(['or']).forEach(function (c) { var im = new Image(); im.src = SPRITES + s + '-' + c + '.webp'; });
  });
  R.t0 = Date.now(); R.last = performance.now();
  $('pu-cars').innerHTML = '';
  $('pu-input').value = '';
  $('pu-road').classList.remove('rush', 'fever');
  feedback('&nbsp;', '');
  P.screen('screen-pursuit');
  P.fitViewport('screen-pursuit', '.road', '.road, .tr-pairs, #pu-form, .feedback, .hint-line');
  measure();
  renderHud(); renderTokens();
  P.guideSay(1, 'Vous roulez plus vite que tout le monde. Les voitures arrivent de l\'horizon : <b>un mot</b> qui contient l\'une des deux paires, et la voiture explose. Celles de <b>votre voie</b> doivent sauter avant le capot.');
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
