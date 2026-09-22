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
var LANES3 = [-50, 0, 50], LANES2 = [0, 50];        // trois voies bien écartées ; deux sur un petit écran (la vôtre et une de dépassement)
var LANES = LANES3, MY_LANE = 1;
var NARROW = 700;
var HERO_Z = 1.15, HERO_K = 0.55;                    // votre voiture : bas dans le cadre, réduite juste assez pour
                                                     // laisser voir la plaque de celle qui vous suit
var Z_FAR = 10, Z_HIT = HERO_Z + 0.55, Z_PASS = 1.0;  // l'impact au contact de votre pare-chocs ; le dépassement sort du cadre
/* Une voiture arrive vite de l'horizon, se cale derrière vous à Z_HOLD — plaque nette, taille
   fixe, un emplacement par voie — y reste HOLD secondes, puis fonce : sur vous si elle est
   sur votre voie, sinon elle vous double. Pas de zoom pendant la lecture.                  */
var Z_HOLD_MINE = 3.0, Z_HOLD_SIDE = 2.4;             // profondeur d'attente : derrière vous sur votre voie ; sur les côtés, un peu plus près, aux bords
var V_IN = 5.0, V_RUSH = 2.2;                         // vitesses d'approche et de charge (z/s)
var PLATE_K = 1.9;                                    // la plaque, posée sur la voiture, est grossie d'autant pour rester lisible
function holdZ(lane) { return lane === MY_LANE ? Z_HOLD_MINE : Z_HOLD_SIDE; }
var HOLD0 = 10, HOLD_MIN = 6;                         // temps d'attente au départ, puis au plus court (après 3 min)
var HOLD_DIFF = { facile: 1.3, normal: 1, expert: 0.75 };
var V0 = 0.68, V_RAMP = 0.005, V_MAX = 1.7;          // vitesse affichée au compteur et kilométrage
var SPAWN0 = 5.5, SPAWN_MIN = 3.4;                    // intervalle entre deux arrivées, au départ et au plus serré
var CENTER0 = 0.40, CENTER_MAX = 0.55;                // part des voitures qui arrivent sur votre voie
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
/* votre voiture : projetée comme les autres, à HERO_Z sur la voie du milieu ; elle louvoie un peu */
function placeHero(now) {
  var p = project(MY_LANE, HERO_Z);
  var sway = Math.sin(now / 900) * 2.2 + Math.sin(now / 173) * 0.5;
  var px = p.x / 100 * R.sceneW + sway, py = p.y / 100 * R.sceneH;
  var el = $('pu-me');
  el.style.transform = 'translate3d(' + px.toFixed(1) + 'px,' + py.toFixed(1) + 'px,0) translate(-50%,-100%) scale(' + p.s.toFixed(4) + ') rotate(' + (sway * 0.15).toFixed(2) + 'deg)';
  el.style.zIndex = String(Math.round(1000 - HERO_Z * 50));
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
  var others = LANES.map(function (_, i) { return i; }).filter(function (i) { return i !== MY_LANE; });
  var lane = Math.random() < centerShare ? MY_LANE : P.pick(others);
  // une voie n'accueille qu'une voiture à la fois tant qu'elle n'a pas chargé
  var free = function (l) { return !R.cars.some(function (c) { return c.lane === l && !c.gone && c.phase !== 'rush'; }); };
  if (!free(lane)) { lane = others.concat([MY_LANE]).filter(free)[0]; }
  if (lane == null) return;

  var plate = P.newPlate(R.cars.length === 0 && R.done === 0), shape = pickShape();
  var gold = shape !== TANK && P.rand(GOLD_ODDS) === 0;
  var c = {
    p1: plate.p1, p2: plate.p2, dep: plate.dep, value: plate.value, num: String(plate.value).padStart(3, '0'),
    shape: shape, lane: lane, z: Z_FAR, gold: gold, tank: shape === TANK, phase: 'in',
    hold: Math.max(HOLD_MIN, HOLD0 - t / 180 * (HOLD0 - HOLD_MIN)) * (HOLD_DIFF[P.state.diff] || 1) * (0.9 + Math.random() * 0.2),
    got1: null, got2: null, words: 0, pts: 0, gone: false, born: Date.now()
  };
  P.initCar(c, 'poursuite');
  c.hold *= P.carTime(shape);                      // le camping-car traîne derrière vous, la supercar charge vite
  if (c.cargo === 'joker') c.got2 = null;          // en Poursuite un mot suffit : pas de paire offerte
  var el = document.createElement('div');
  el.className = 'pcar' + (lane === MY_LANE ? ' pcar--threat' : '') + (isSport(shape) ? ' car--sport' : '') +
                 (gold ? ' car--gold' : '') + (c.tank ? ' car--tank' : '');
  el.style.width = (FLEET[shape].size * R.sceneH) + 'px';
  el.innerHTML = '<div class="car__ride">' +
                   (gold ? '<span class="sport-tag sport-tag--gold">✨ ×3</span>' : c.tank ? '<span class="sport-tag sport-tag--tank">⚠ citerne</span>' :
                    c.tag ? '<span class="sport-tag sport-tag--trait">' + c.tag + '</span>' : '') +
                   '<img class="car__body" alt="" draggable="false" src="' + SPRITES + shape + '-' + (gold ? 'or' : P.pick(P.colors())) + '-front.webp">' +
                   '<div class="car__shadow"></div>' + plateHTML(c) +
                   '<div class="car__timer"><i></i></div>' +
                 '</div><div class="car__fx"></div><div class="car__pop"></div>';
  // la plaque est rivée au pare-chocs avant : elle tangue, grossit et s'éloigne avec la voiture
  var F = FLEET[shape];
  el.style.setProperty('--plateY', F.front.y + '%');
  el.style.setProperty('--pw', Math.round(F.size * R.sceneH * F.front.w / 100 * PLATE_K) + 'px');
  c.el = el; c.pl = el.querySelector('.plate');
  el.addEventListener('pointerdown', function () { if (!c.gone) { setTarget(c); $('pu-input').focus(); } });
  $('pu-cars').appendChild(el);
  R.cars.push(c);
  place(el, lane, c.z, 0);
  placePlate(c);
  renderTokens();
}
function readable(c) { return !c.gone && c.phase !== 'in'; }
function placePlate(c) {                          // la plaque est là dès l'apparition, floue tant qu'on est trop loin
  c.pl.style.opacity = '1';
  c.pl.classList.toggle('plate--far', !readable(c));
  // la barre de temps : ce qu'il reste avant qu'elle charge
  var bar = c.el.querySelector('.car__timer');
  if (!bar) return;
  bar.style.opacity = c.phase === 'hold' ? '1' : '0';
  if (c.phase === 'hold') bar.firstChild.style.transform = 'scaleX(' + Math.max(0, Math.min(1, (c.until - played()) / c.hold)).toFixed(3) + ')';
}
function removeCar(c, cls) {
  c.gone = true;
  R.cars = R.cars.filter(function (x) { return x !== c; });
  if (R.target === c) R.target = null;
  var el = c.el;
  if (cls) el.classList.add(cls);
  setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, cls === 'pcar--boom' ? 1400 : 700);
  R.history.push({ p1: c.p1.p, p2: c.p2.p, dep: c.dep.num, words: c.words, pts: c.pts, reached: c.words >= 2 });
  renderTokens();
}

/* ─────────── ciblage, jetons ─────────── */
function setTarget(c) {
  R.target = c;
  R.cars.forEach(function (x) { x.el.classList.toggle('car--target', x === c); });
  renderTokens();
}

function livePairs() {                           // les paires lisibles, rétro compris, pour les suggestions
  var out = [];
  R.cars.forEach(function (c) { if (!readable(c)) return; if (!c.got1) out.push(c.p1.p); if (!c.got2 && !c.onlyRare) out.push(c.p2.p); });
  return out;
}
function renderTokens() {
  if (R.suggest) R.suggest();
  var box = $('pu-pairs');
  var vis = R.cars.filter(readable).sort(function (a, b) { return a.lane - b.lane; });
  if (!vis.length) { box.innerHTML = '<span class="tok tok--wait">…</span>'; return; }
  box.innerHTML = vis.map(function (c, i) {
    var sp = isSport(c.shape) ? ' tok--sport' : '';
    var tg = c === R.target ? ' tok--target' : '';
    var th = c.lane === MY_LANE ? ' tokgroup--threat' : '';
    return '<span class="tokgroup' + tg + th + '" data-i="' + R.cars.indexOf(c) + '">' +
           (c.lane === MY_LANE ? '<i class="tok__warn">⚠</i>' : '') +
           '<span class="tok' + sp + (c.got1 ? ' tok--on' : '') + '">' + (c.got1 ? '✓' : c.p1.p + (c.used.length ? '½' : '')) + '</span>' +
           '<span class="tok' + sp + (c.got2 ? ' tok--on' : '') + (c.onlyRare ? ' tok--off' : '') + '">' + (c.got2 ? '✓' : c.p2.p + (c.used.length ? '½' : '')) + '</span></span>';
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
  var alive = R.cars.filter(readable);
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
    var h2 = (c.got2 || c.onlyRare) ? null : P.matchPair(w, c.p2.p);   // le 4×4 : seule sa paire rare compte
    if (!h1 && !h2) return;
    var bad = P.wordRule(c, w, 'poursuite');                 // le caractère du modèle refuse ce mot
    if (bad) { if (!ruleMsg || c === R.target) { ruleMsg = bad; ruleCar = c; } return; }
    var rank = (c === R.target ? 16 : 0) +
               (((h1 && h2) || (h1 && c.got2) || (h2 && c.got1)) ? 8 : 0) +
               (c.lane === MY_LANE ? 4 : 0) +                       // la menace d'abord
               ((c.got1 || c.got2) ? 2 : 0) + (c.phase === 'rush' ? 3 : 0) + (1 - c.z / 20);   // puis celle qui charge, puis la plus proche
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

  var extremis = c.lane === MY_LANE && c.phase === 'rush';
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
  var me = $('pu-me');
  me.classList.remove('me--hit'); void me.offsetWidth; me.classList.add('me--hit');
  P.explode($('pu-me-fx'), $('pu-road'));
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
  // la plaque garde les proportions d'une vraie plaque (≈ 4,7:1) et ne dépasse jamais
  // la moitié de la scène : sur un écran haut et étroit, la hauteur ne dicte plus sa taille
  R.myShape = (P.myCar().match(/cars\/([a-z0-9]+)-/) || [])[1] || 'berline';
  var MF = FLEET[R.myShape].front;                 // votre plaque : XXX, à sa place sur votre pare-chocs
  $('pu-me').style.setProperty('--plateY', MF.y + '%');
  $('pu-me').style.setProperty('--pw', Math.round(FLEET[R.myShape].size * R.sceneH * HERO_K * MF.w / 100) + 'px');
  $('pu-me').style.width = Math.round(FLEET[R.myShape].size * R.sceneH * HERO_K) + 'px';   // scale(1/z) fait le reste
  placeHero(performance.now());
  R.cars.forEach(function (c) {
    var F = FLEET[c.shape];
    c.el.style.width = (F.size * R.sceneH) + 'px';
    c.el.style.setProperty('--pw', Math.round(F.size * R.sceneH * F.front.w / 100 * PLATE_K) + 'px');
    place(c.el, c.lane, c.z); placePlate(c);
  });
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
    if (c.phase === 'in') {                          // elle arrive vite et se cale
      var zh = holdZ(c.lane);
      c.z = Math.max(zh, c.z - V_IN * dt);
      if (c.z <= zh) { c.phase = 'hold'; c.until = played() + c.hold; renderTokens(); if (c.lane === MY_LANE) c.el.classList.add('pcar--near'); }
    } else if (c.phase === 'hold') {                 // elle attend, plaque nette, puis charge
      if (played() >= c.until) { c.phase = 'rush'; c.el.classList.add('pcar--rush'); }
    } else {
      c.z -= V_RUSH * dt;
    }
    place(c.el, c.lane, c.z); placePlate(c);
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
  placeHero(now);
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
  var two = Math.min(window.innerWidth, screen.width || 9999) < NARROW;   // petit écran : deux voies
  LANES = two ? LANES2 : LANES3; MY_LANE = two ? 0 : 1;
  $('pu-me-img').src = P.myCar().replace('.webp', '-front.webp');   // votre véhicule de rang, vu de face
  R.roster.concat([TANK]).forEach(function (s) {      // préchargement du roster de la partie
    P.colors().concat(['or']).forEach(function (c) { var im = new Image(); im.src = SPRITES + s + '-' + c + '.webp'; });
    P.colors().concat(['or']).forEach(function (c) { var im = new Image(); im.src = SPRITES + s + '-' + c + '-front.webp'; });
  });
  R.t0 = Date.now(); R.last = performance.now();
  $('pu-cars').innerHTML = '';
  $('pu-input').value = '';
  $('pu-road').classList.remove('rush', 'fever');
  feedback('&nbsp;', '');
  P.screen('screen-pursuit');
  P.fitViewport('screen-pursuit', '.road', '.road, .tr-pairs, .suggest, #pu-form, .feedback, .hint-line');
  if (R.suggest) R.suggest();
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
  R.suggest = window.PLAQUE.attachSuggest($('pu-input'), $('pu-form'), $('pu-suggest'), livePairs);
  window.PLAQUE.autoSubmit($('pu-input'), $('pu-form'), function (w) {
    return R.cars.some(function (c) {
      return readable(c) && w !== c.got1 && w !== c.got2 &&
             ((!c.got1 && P.matchPair(w, c.p1.p)) || (!c.got2 && P.matchPair(w, c.p2.p)));
    });
  });
  $('pu-quit').addEventListener('click', function () { finish(); });
  $('pu-pairs').addEventListener('pointerdown', function (e) {
    var g = e.target.closest('.tokgroup'); if (!g) return;
    var c = R.cars[+g.dataset.i];
    if (c && !c.gone) { setTarget(c); $('pu-input').focus(); }
  });
  window.addEventListener('resize', function () { if (R.running) measure(); });
  if (window.visualViewport) window.visualViewport.addEventListener('resize', function () { if (R.running) setTimeout(measure, 50); });
});

})();
