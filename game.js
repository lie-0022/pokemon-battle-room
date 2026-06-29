// ============================================================
// 포켓몬스터 — 전국도감 배틀
// 모든 데이터(종족값/타입상성/기술/스프라이트/포획률/진화)는
// PokéAPI(https://pokeapi.co)에서 받은 pokedex.json 실데이터 사용.
// ============================================================

const $ = (id) => document.getElementById(id);
const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ===== 전역 데이터/상태 =====
let DEX = null;          // pokedex.json
let BY_EN = {};          // en -> 도감 엔트리
const game = {
  party: [],
  balls: 5,
  seen: new Set(),       // 본 포켓몬 (en)
  caught: new Set(),     // 잡은/소유 포켓몬 (en)
  battle: null,
};

// ============================================================
// 데이터 로드
// ============================================================
async function loadDex() {
  // 1) 임베드 데이터(pokedex.js) 우선 — file:// 더블클릭으로도 동작
  if (typeof window.POKEDEX === 'object' && window.POKEDEX) {
    DEX = window.POKEDEX;
  } else {
    // 2) 폴백: pokedex.json fetch (로컬 서버 필요)
    const res = await fetch('pokedex.json');
    if (!res.ok) throw new Error('pokedex.json 로드 실패: ' + res.status);
    DEX = await res.json();
  }
  DEX.pokemon.forEach((p) => { BY_EN[p.en] = p; });
  $('dex-total').textContent = DEX.pokemon.length;
}

const krType = (en) => (DEX.typeKr[en] || en);
const typeColor = (en) => (DEX.typeColor[en] || '#888');

// ============================================================
// 능력치 / 포켓몬 인스턴스
// ============================================================
function statAt(base, lv, isHp) {
  if (isHp) return Math.floor((2 * base * lv) / 100) + lv + 10;
  return Math.floor((2 * base * lv) / 100) + 5;
}
function xpToNext(lv) { return Math.floor(12 + lv * lv * 1.6); }

function makeMon(en, lv) {
  const sp = BY_EN[en];
  const maxHp = statAt(sp.stats.hp, lv, true);
  const movePP = {};
  sp.moves.forEach((mk) => { movePP[mk] = DEX.moves[mk] ? DEX.moves[mk].pp : 20; });
  return {
    en, name: sp.name, types: sp.types.slice(),
    lv, xp: 0, maxHp, hp: maxHp,
    moves: sp.moves.slice(), movePP,
    sp,
  };
}

function recalcStats(mon) {
  const ratio = mon.hp / mon.maxHp;
  mon.maxHp = statAt(mon.sp.stats.hp, mon.lv, true);
  mon.hp = Math.max(1, Math.round(mon.maxHp * ratio));
}
const sAtk = (m) => statAt(m.sp.stats.atk, m.lv, false);
const sDef = (m) => statAt(m.sp.stats.def, m.lv, false);
const sSpa = (m) => statAt(m.sp.stats.spa, m.lv, false);
const sSpd = (m) => statAt(m.sp.stats.spd, m.lv, false);
const sSpe = (m) => statAt(m.sp.stats.spe, m.lv, false);

function typeEffect(moveType, defTypes) {
  let mult = 1;
  const chart = DEX.typeChart[moveType] || {};
  for (const dt of defTypes) {
    if (dt in chart) mult *= chart[dt];
  }
  return mult;
}

// ============================================================
// 화면/HUD
// ============================================================
function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  $(id).classList.add('active');
}
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 1800);
}
function updateHud() {
  $('ball-count').textContent = game.balls;
  $('dex-count').textContent = game.caught.size;
}
function typeBadge(en) {
  return `<span class="type-badge" style="background:${typeColor(en)}">${krType(en)}</span>`;
}
function spriteImg(mon, kind) {
  const s = mon.sp.sprites;
  const url = kind === 'back' ? (s.animBack || s.back) : (s.animFront || s.front);
  return `<img src="${url}" alt="${mon.name}" class="pkimg" onerror="this.onerror=null;this.src='${s.front}'">`;
}

// ============================================================
// 스타팅
// ============================================================
function renderStarters() {
  const list = $('starter-list');
  list.innerHTML = '';
  DEX.starters.forEach((en) => {
    const sp = BY_EN[en];
    const card = document.createElement('div');
    card.className = 'starter-card';
    card.style.setProperty('--mon', sp.color);
    card.innerHTML = `
      <img src="${sp.sprites.art || sp.sprites.front}" alt="${sp.name}" class="starter-img">
      <div class="starter-name">${sp.name}</div>
      <div class="dex-no">No.${String(sp.id).padStart(3, '0')}</div>
      <div class="type-row">${sp.types.map(typeBadge).join('')}</div>
      <p class="starter-note">${starterNote(en)}</p>
      <button class="btn pick">이 친구로!</button>`;
    card.querySelector('.pick').addEventListener('click', () => chooseStarter(en));
    list.appendChild(card);
  });
}
function starterNote(en) {
  return {
    bulbasaur: '풀·독 타입. 균형 잡힌 안정형.',
    charmander: '불꽃 타입. 공격적이고 빠릅니다.',
    squirtle: '물 타입. 단단한 방어가 강점.',
  }[en] || '';
}
function chooseStarter(en) {
  const mon = makeMon(en, 5);
  game.party.push(mon);
  game.seen.add(en);
  game.caught.add(en);
  updateHud();
  toast(`${mon.name}와(과) 함께 모험을 시작합니다!`);
  enterField();
}

// ============================================================
// 필드
// ============================================================
function enterField() {
  showScreen('screen-field');
  renderPartyStrip();
  const arts = ['🌳🌿🌾🌳', '🏞️🌿🦋🌿', '🌲🌿🍄🌲', '🌸🌿🐝🌿'];
  $('field-art').textContent = arts[rand(0, arts.length - 1)];
}
function renderPartyStrip() {
  const strip = $('party-strip');
  strip.innerHTML = '';
  game.party.forEach((m) => {
    const el = document.createElement('div');
    el.className = 'party-chip' + (m.hp <= 0 ? ' fainted' : '');
    el.innerHTML = `<img src="${m.sp.sprites.front}" class="chip-img" alt="">
      <span class="chip-info"><b>${m.name}</b> Lv.${m.lv}<br>
      <span class="mini-hp"><span style="width:${(m.hp / m.maxHp) * 100}%"></span></span></span>`;
    strip.appendChild(el);
  });
}
function firstHealthy() { return game.party.find((m) => m.hp > 0); }

function weightedWild() {
  const pool = DEX.wildPool;
  const total = pool.reduce((s, p) => s + p.w, 0);
  let r = Math.random() * total;
  for (const p of pool) { if ((r -= p.w) <= 0) return p.en; }
  return pool[0].en;
}

// ============================================================
// 배틀 시작
// ============================================================
function startWildBattle() {
  if (!firstHealthy()) { toast('싸울 수 있는 포켓몬이 없어요! 회복하세요.'); return; }
  const en = weightedWild();
  const playerMaxLv = Math.max(...game.party.map((m) => m.lv));
  const enemyLv = clamp(playerMaxLv + rand(-2, 3), 2, 70);
  const enemy = makeMon(en, enemyLv);

  game.battle = { enemy, me: firstHealthy(), over: false, busy: false };
  game.seen.add(en);
  updateHud();
  showScreen('screen-battle');
  clearLog();
  renderBattle();
  pushLog(`앗! 야생 ${enemy.name}(Lv.${enemy.lv})이(가) 나타났다!`);
  pushLog(`가랏, ${game.battle.me.name}!`);
  showMainMenu();
}

function renderBattle() {
  const b = game.battle;
  setSide('enemy', b.enemy);
  setSide('player', b.me);
  $('player-sprite').innerHTML = spriteImg(b.me, 'back');
  $('enemy-sprite').innerHTML = spriteImg(b.enemy, 'front');
  const need = xpToNext(b.me.lv);
  $('player-xpfill').style.width = `${clamp((b.me.xp / need) * 100, 0, 100)}%`;
}
function setSide(side, mon) {
  $(`${side}-name`).textContent = mon.name;
  $(`${side}-lv`).textContent = `Lv.${mon.lv}`;
  $(`${side}-hp`).textContent = `${Math.max(0, mon.hp)}/${mon.maxHp}`;
  const pct = clamp((mon.hp / mon.maxHp) * 100, 0, 100);
  const fill = $(`${side}-hpfill`);
  fill.style.width = `${pct}%`;
  fill.style.background = pct > 50 ? '#4caf50' : pct > 20 ? '#ffb300' : '#e53935';
}

// ============================================================
// 로그/메뉴
// ============================================================
function clearLog() { $('battle-log').innerHTML = ''; }
function pushLog(msg) {
  const log = $('battle-log');
  const p = document.createElement('div');
  p.className = 'log-line';
  p.textContent = msg;
  log.appendChild(p);
  log.scrollTop = log.scrollHeight;
}
function hideAllMenus() {
  ['menu-main', 'menu-moves', 'menu-switch'].forEach((id) => $(id).classList.add('hidden'));
}
function showMainMenu() {
  if (game.battle.over) return;
  hideAllMenus();
  $('menu-main').classList.remove('hidden');
}
function showMoves() {
  hideAllMenus();
  const wrap = $('menu-moves');
  wrap.innerHTML = '';
  const me = game.battle.me;
  me.moves.forEach((mk) => {
    const mv = DEX.moves[mk];
    const pp = me.movePP[mk];
    const btn = document.createElement('button');
    btn.className = 'btn move-btn';
    btn.style.borderColor = typeColor(mv.type);
    btn.disabled = pp <= 0;
    btn.innerHTML = `<span class="mv-name">${mv.kr}</span>
      <span class="mv-meta"><span class="move-type" style="background:${typeColor(mv.type)}">${krType(mv.type)}</span>
      <span class="mv-pp">PP ${pp}/${mv.pp}</span></span>`;
    btn.addEventListener('click', () => playerMove(mk));
    wrap.appendChild(btn);
  });
  const back = document.createElement('button');
  back.className = 'btn back-btn';
  back.textContent = '⬅ 뒤로';
  back.addEventListener('click', showMainMenu);
  wrap.appendChild(back);
  wrap.classList.remove('hidden');
}
function showSwitch(forced = false) {
  hideAllMenus();
  const wrap = $('menu-switch');
  wrap.innerHTML = '';
  game.party.forEach((m, i) => {
    const btn = document.createElement('button');
    const dead = m.hp <= 0;
    const active = m === game.battle.me;
    btn.className = 'btn switch-btn' + (dead ? ' fainted' : '') + (active ? ' active' : '');
    btn.disabled = dead || active;
    btn.innerHTML = `<img src="${m.sp.sprites.front}" class="sw-img" alt="">
      <span>${m.name} <small>Lv.${m.lv} · ${Math.max(0, m.hp)}/${m.maxHp}</small></span>`;
    btn.addEventListener('click', () => doSwitch(i, forced));
    wrap.appendChild(btn);
  });
  if (!forced) {
    const back = document.createElement('button');
    back.className = 'btn back-btn';
    back.textContent = '⬅ 뒤로';
    back.addEventListener('click', showMainMenu);
    wrap.appendChild(back);
  }
  wrap.classList.remove('hidden');
}

// ============================================================
// 전투 계산
// ============================================================
function damageCalc(attacker, defender, move) {
  const power = move.power;
  const physical = move.cls === 'physical';
  const A = physical ? sAtk(attacker) : sSpa(attacker);
  const D = physical ? sDef(defender) : sSpd(defender);
  const lv = attacker.lv;
  let dmg = Math.floor((Math.floor((2 * lv) / 5 + 2) * power * A / D) / 50) + 2;
  if (attacker.types.includes(move.type)) dmg *= 1.5;       // STAB
  const eff = typeEffect(move.type, defender.types);
  dmg *= eff;
  dmg *= rand(85, 100) / 100;
  dmg = Math.max(eff === 0 ? 0 : 1, Math.floor(dmg));
  return { dmg, eff };
}
function effText(eff) {
  if (eff === 0) return '효과가 없는 것 같다...';
  if (eff >= 2) return '효과가 굉장했다!';
  if (eff > 1) return '효과가 좋다!';
  if (eff < 1) return '효과가 별로인 듯하다...';
  return '';
}

async function playerMove(moveKey) {
  const b = game.battle;
  if (b.busy || b.over) return;
  b.busy = true;
  hideAllMenus();
  b.me.movePP[moveKey] = Math.max(0, b.me.movePP[moveKey] - 1);

  const enemyMove = pickEnemyMove(b.enemy);
  const playerFirst = sSpe(b.me) >= sSpe(b.enemy);

  if (playerFirst) {
    await doAttack(b.me, b.enemy, moveKey, 'enemy');
    if (b.over) return;
    await doAttack(b.enemy, b.me, enemyMove, 'player');
  } else {
    await doAttack(b.enemy, b.me, enemyMove, 'player');
    if (b.over) return;
    if (b.me.hp <= 0) return;   // 강제 교체 대기
    await doAttack(b.me, b.enemy, moveKey, 'enemy');
  }
  resumeAfterEnemy();
}

function pickEnemyMove(enemy) {
  const usable = enemy.moves.filter((mk) => enemy.movePP[mk] > 0);
  const list = usable.length ? usable : enemy.moves;
  const mk = list[rand(0, list.length - 1)];
  if (enemy.movePP[mk] > 0) enemy.movePP[mk]--;
  return mk;
}

function resumeAfterEnemy() {
  const b = game.battle;
  if (!b || b.over) return;
  if (b.me.hp <= 0) return;     // onPlayerFaint 가 강제 교체 메뉴를 띄운 상태
  b.busy = false;
  showMainMenu();
}

async function doAttack(attacker, defender, moveKey, defSide) {
  const b = game.battle;
  const move = DEX.moves[moveKey];
  pushLog(`${attacker.name}의 ${move.kr}!`);
  await sleep(280);
  // 명중 판정
  if (rand(1, 100) > (move.acc || 100)) {
    pushLog(`하지만 빗나갔다!`);
    await sleep(380);
    return;
  }
  await flashSprite(defSide);
  const { dmg, eff } = damageCalc(attacker, defender, move);
  defender.hp = clamp(defender.hp - dmg, 0, defender.maxHp);
  setSide(defSide, defender);
  const ef = effText(eff);
  if (ef) pushLog(ef);
  await sleep(420);

  if (defender.hp <= 0) {
    pushLog(`${defender.name}은(는) 쓰러졌다!`);
    await sleep(320);
    if (defender === b.enemy) await onEnemyFaint();
    else await onPlayerFaint();
  }
}
async function flashSprite(side) {
  const el = $(`${side}-sprite`);
  el.classList.add('hit');
  await sleep(200);
  el.classList.remove('hit');
}

// ============================================================
// 승패/경험치/진화
// ============================================================
async function onEnemyFaint() {
  const b = game.battle;
  b.over = true;
  const gain = Math.floor((b.enemy.sp.bst * b.enemy.lv) / 60) + b.enemy.lv;
  pushLog(`${b.me.name}은(는) 경험치 ${gain}를 얻었다!`);
  await gainXp(b.me, gain);
  renderPartyStrip();
  await sleep(600);
  endBattle();
}
async function gainXp(mon, amount) {
  mon.xp += amount;
  let need = xpToNext(mon.lv);
  while (mon.xp >= need && mon.lv < 100) {
    mon.xp -= need;
    mon.lv++;
    recalcStats(mon);
    mon.hp = mon.maxHp;
    pushLog(`🎉 ${mon.name}은(는) Lv.${mon.lv}이(가) 되었다!`);
    setSide('player', mon);
    await sleep(450);
    await tryEvolve(mon);
    need = xpToNext(mon.lv);
  }
  const fill = $('player-xpfill');
  if (fill) fill.style.width = `${clamp((mon.xp / xpToNext(mon.lv)) * 100, 0, 100)}%`;
}
async function tryEvolve(mon) {
  const sp = mon.sp;
  if (sp.evolveTo && sp.evolveLevel && mon.lv >= sp.evolveLevel && BY_EN[sp.evolveTo]) {
    pushLog(`...어라? ${mon.name}의 상태가...!`);
    await sleep(700);
    const newSp = BY_EN[sp.evolveTo];
    mon.en = newSp.en;
    mon.name = newSp.name;
    mon.types = newSp.types.slice();
    mon.sp = newSp;
    // 진화 시 새 기술 습득
    mon.moves = newSp.moves.slice();
    mon.movePP = {};
    mon.moves.forEach((mk) => { mon.movePP[mk] = DEX.moves[mk] ? DEX.moves[mk].pp : 20; });
    recalcStats(mon);
    mon.hp = mon.maxHp;
    game.seen.add(newSp.en);
    game.caught.add(newSp.en);
    updateHud();
    renderBattle();
    pushLog(`축하합니다! ${mon.name}(으)로 진화했다!`);
    await sleep(850);
  }
}
async function onPlayerFaint() {
  const b = game.battle;
  renderPartyStrip();
  if (firstHealthy()) {
    pushLog('다음 포켓몬을 선택하세요!');
    await sleep(300);
    b.busy = false;
    showSwitch(true);
  } else {
    b.over = true;
    pushLog('눈앞이 깜깜해졌다...');
    await sleep(900);
    toast('모든 포켓몬이 쓰러졌습니다. 회복센터로 이동합니다.');
    healAll();
    endBattle();
  }
}
async function doSwitch(index, forced) {
  const b = game.battle;
  const mon = game.party[index];
  if (mon.hp <= 0 || mon === b.me) return;
  b.me = mon;
  hideAllMenus();
  renderBattle();
  pushLog(`가랏, ${mon.name}!`);
  if (forced) {
    b.busy = false;
    await sleep(200);
    showMainMenu();
  } else {
    b.busy = true;
    await sleep(300);
    const em = pickEnemyMove(b.enemy);
    await doAttack(b.enemy, b.me, em, 'player');
    resumeAfterEnemy();
  }
}

// ============================================================
// 몬스터볼 (실제 포획 공식 근사)
// ============================================================
async function throwBall() {
  const b = game.battle;
  if (b.busy || b.over) return;
  if (game.balls <= 0) { toast('몬스터볼이 없습니다!'); return; }
  b.busy = true;
  hideAllMenus();
  game.balls--;
  updateHud();
  pushLog(`${b.enemy.name}에게 몬스터볼을 던졌다!`);
  await sleep(500);

  const e = b.enemy;
  const rate255 = clamp(Math.round(e.sp.catchRate * 255), 1, 255);
  // 클래식 포획 공식 (몬스터볼 보정 1)
  const a = ((3 * e.maxHp - 2 * e.hp) * rate255) / (3 * e.maxHp);
  let shakes = 0;
  if (a >= 255) {
    shakes = 4;
  } else {
    const bVal = 1048560 / Math.sqrt(Math.sqrt(16711680 / a));
    for (let i = 0; i < 4; i++) { if (rand(0, 65535) < bVal) shakes++; else break; }
  }
  const shown = Math.min(shakes, 3);
  for (let i = 0; i < Math.max(1, shown); i++) { pushLog('흔들흔들...'); await sleep(450); }

  if (shakes >= 4) {
    pushLog(`찰칵! ${e.name}을(를) 잡았다!`);
    b.over = true;
    const caught = makeMon(e.en, e.lv);
    if (game.party.length < 6) {
      game.party.push(caught);
      toast(`${caught.name}이(가) 파티에 합류했습니다!`);
    } else {
      toast(`${caught.name}을(를) 잡았지만 파티가 가득 찼습니다(보관).`);
    }
    game.caught.add(e.en);
    updateHud();
    await sleep(800);
    endBattle();
  } else {
    pushLog(`이런! ${e.name}이(가) 튀어나왔다!`);
    await sleep(400);
    const em = pickEnemyMove(e);
    await doAttack(e, b.me, em, 'player');
    resumeAfterEnemy();
  }
}

// ============================================================
// 도망
// ============================================================
async function tryRun() {
  const b = game.battle;
  if (b.busy || b.over) return;
  const success = sSpe(b.me) >= sSpe(b.enemy) || Math.random() < 0.6;
  if (success) {
    pushLog('무사히 도망쳤다!');
    b.over = true;
    await sleep(600);
    endBattle();
  } else {
    pushLog('도망칠 수 없었다!');
    b.busy = true;
    hideAllMenus();
    await sleep(300);
    const em = pickEnemyMove(b.enemy);
    await doAttack(b.enemy, b.me, em, 'player');
    resumeAfterEnemy();
  }
}
function endBattle() {
  game.battle = null;
  renderPartyStrip();
  enterField();
}

// ============================================================
// 회복 / 파티 화면
// ============================================================
function healAll() {
  game.party.forEach((m) => {
    m.hp = m.maxHp;
    m.moves.forEach((mk) => { m.movePP[mk] = DEX.moves[mk] ? DEX.moves[mk].pp : m.movePP[mk]; });
  });
  renderPartyStrip();
}
function renderPartyFull() {
  const wrap = $('party-full');
  wrap.innerHTML = '';
  game.party.forEach((m) => {
    const card = document.createElement('div');
    card.className = 'mon-card';
    card.style.setProperty('--mon', m.sp.color);
    card.innerHTML = `
      <div class="mon-card-head">
        <img src="${m.sp.sprites.art || m.sp.sprites.front}" class="mon-card-img" alt="">
        <div>
          <div class="mon-card-name">${m.name} <small>Lv.${m.lv}</small></div>
          <div class="dex-no">No.${String(m.sp.id).padStart(3, '0')}</div>
          <div class="type-row">${m.types.map(typeBadge).join('')}</div>
        </div>
      </div>
      <div class="hp-text">HP ${Math.max(0, m.hp)}/${m.maxHp}</div>
      <div class="hpbar"><div class="hpfill" style="width:${(m.hp / m.maxHp) * 100}%"></div></div>
      <div class="stat-grid">
        <span>공격 ${sAtk(m)}</span><span>방어 ${sDef(m)}</span><span>특공 ${sSpa(m)}</span>
        <span>특방 ${sSpd(m)}</span><span>스피드 ${sSpe(m)}</span>
      </div>
      <div class="move-list">${m.moves.map((k) => {
        const mv = DEX.moves[k];
        return `<span class="mini-move" style="background:${typeColor(mv.type)}">${mv.kr}</span>`;
      }).join('')}</div>`;
    wrap.appendChild(card);
  });
}

// ============================================================
// 전국도감 화면
// ============================================================
function renderDex() {
  const grid = $('dex-grid');
  grid.innerHTML = '';
  DEX.pokemon.forEach((p) => {
    const caught = game.caught.has(p.en);
    const seen = game.seen.has(p.en) || caught;
    const cell = document.createElement('div');
    cell.className = 'dex-cell' + (caught ? ' caught' : seen ? ' seen' : ' unknown');
    cell.innerHTML = `
      <div class="dex-no-sm">No.${String(p.id).padStart(3, '0')}</div>
      <img src="${p.sprites.front}" class="dex-img" alt="" loading="lazy">
      <div class="dex-name">${seen ? p.name : '???'}</div>
      ${caught ? '<span class="dex-mark">🔴</span>' : ''}`;
    if (seen) cell.addEventListener('click', () => openDexModal(p));
    grid.appendChild(cell);
  });
}
function openDexModal(p) {
  const total = p.bst;
  const bar = (v) => `<div class="stat-row"><span>${v.label}</span>
    <span class="stat-bar"><span style="width:${clamp(v.val / 200 * 100, 4, 100)}%;background:${p.color}"></span></span>
    <b>${v.val}</b></div>`;
  $('dex-modal-card').innerHTML = `
    <button class="modal-close" id="modal-close">✕</button>
    <div class="modal-top" style="--mon:${p.color}">
      <img src="${p.sprites.art || p.sprites.front}" class="modal-img" alt="">
      <div>
        <div class="dex-no">No.${String(p.id).padStart(3, '0')}</div>
        <h3>${p.name}</h3>
        <div class="type-row">${p.types.map(typeBadge).join('')}</div>
      </div>
    </div>
    <div class="modal-stats">
      ${bar({ label: 'HP', val: p.stats.hp })}
      ${bar({ label: '공격', val: p.stats.atk })}
      ${bar({ label: '방어', val: p.stats.def })}
      ${bar({ label: '특공', val: p.stats.spa })}
      ${bar({ label: '특방', val: p.stats.spd })}
      ${bar({ label: '스피드', val: p.stats.spe })}
      <div class="bst">종족값 합계 <b>${total}</b></div>
    </div>
    <div class="modal-moves">대표 기술: ${p.moves.map((k) => DEX.moves[k] ? DEX.moves[k].kr : k).join(', ')}</div>
    ${p.evolveTo && BY_EN[p.evolveTo] ? `<div class="modal-evo">⬆ Lv.${p.evolveLevel} 에서 <b>${BY_EN[p.evolveTo].name}</b>(으)로 진화</div>` : ''}`;
  $('dex-modal').classList.remove('hidden');
  $('modal-close').addEventListener('click', closeDexModal);
}
function closeDexModal() { $('dex-modal').classList.add('hidden'); }

// ============================================================
// 이벤트
// ============================================================
function bindEvents() {
  $('btn-explore').addEventListener('click', startWildBattle);
  $('btn-party').addEventListener('click', () => { renderPartyFull(); showScreen('screen-party'); });
  $('btn-party-back').addEventListener('click', enterField);
  $('btn-dex').addEventListener('click', () => { renderDex(); showScreen('screen-dex'); });
  $('btn-dex-back').addEventListener('click', enterField);
  $('btn-heal').addEventListener('click', () => {
    healAll();
    toast('포켓몬센터: 모든 포켓몬이 완전히 회복되었습니다! ♥');
  });
  $('dex-modal').addEventListener('click', (e) => { if (e.target.id === 'dex-modal') closeDexModal(); });

  document.querySelectorAll('#menu-main .btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const act = btn.dataset.act;
      if (act === 'fight') showMoves();
      else if (act === 'ball') throwBall();
      else if (act === 'switch') showSwitch(false);
      else if (act === 'run') tryRun();
    });
  });
}

// ============================================================
// 시작
// ============================================================
async function init() {
  bindEvents();
  try {
    await loadDex();
  } catch (e) {
    $('loading-text').textContent = '데이터 로드 실패: ' + e.message + ' (build-dex.js 로 pokedex.json 생성 필요)';
    return;
  }
  renderStarters();
  updateHud();
  showScreen('screen-start');
}
init();
