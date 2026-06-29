// ============================================================
// 포켓몬 배틀룸 — v7 (실제 러닝셋·기술세팅·물리/특수·타입AI·포획·TM)
//   데이터: pokedex.js(종족값/타입/진화/스프라이트) + gamedata.js(러닝셋/기술/ TM)
//   저장: localStorage 'pkmnRoom'
// ============================================================
const $ = (id) => document.getElementById(id);
const DEX = window.POKEDEX;
const GD = window.GAMEDATA || { moves: {}, learnsets: {}, tmPool: [] };
const MOVES = GD.moves;
const LEARN = GD.learnsets;
const TM_POOL = (GD.tmPool || []).filter((k) => MOVES[k]);
const BY_EN = {};
if (DEX) DEX.pokemon.forEach((p) => { BY_EN[p.en] = p; });

const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const pick = (arr) => arr[randi(0, arr.length - 1)];
const uniq = (a) => [...new Set(a)];
const fmt = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : Math.floor(n);

const BW = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-v/black-white/animated';
const SPRITE_STATIC = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon';
const dotUrl = (sp) => `${BW}/${sp.id}.gif`;
const staticUrl = (sp) => `${SPRITE_STATIC}/${sp.id}.png`;   // 애니GIF 실패 시 폴백용 정적 png
const IMG_PLACEHOLDER = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><circle cx="24" cy="24" r="16" fill="%23394b5e"/><circle cx="24" cy="24" r="6" fill="%23556a80"/></svg>';
const ITEM_ICON = (key) => `assets/items/${key}.png`;   // 앱 내장(레이트리밋·오프라인에도 항상 표시)
// 이미지 로드 실패 전역 처리(캡처 단계): data-fb → 같은 id 정적 png → 플레이스홀더
function installImgFallback() {
  document.addEventListener('error', (e) => {
    const t = e.target;
    if (!t || t.tagName !== 'IMG') return;
    const fb = t.getAttribute('data-fb');
    if (fb && t.src !== fb && !t.dataset.fbA) { t.dataset.fbA = '1'; t.src = fb; return; }   // 1차: data-fb(정적 png)
    const m = t.src && t.src.match(/\/(\d+)\.(?:gif|png)(?:\?.*)?$/);
    if (m && !t.dataset.fbB) { const tgt = `${SPRITE_STATIC}/${m[1]}.png`; if (t.src !== tgt) { t.dataset.fbB = '1'; t.src = tgt; return; } }   // 2차: 같은 id 정적 png
    if (!t.dataset.fbC) { t.dataset.fbC = '1'; t.src = IMG_PLACEHOLDER; }   // 3차: 플레이스홀더
  }, true);
}

function statAt(base, lv, isHp) {
  return isHp ? Math.floor((2 * base * lv) / 100) + lv + 10 : Math.floor((2 * base * lv) / 100) + 5;
}
function typeEffect(moveType, defTypes) {
  let m = 1; const chart = DEX.typeChart[moveType] || {};
  for (const dt of defTypes) if (dt in chart) m *= chart[dt];
  return m;
}
const krType = (t) => DEX.typeKr[t] || t;
const typeColor = (t) => DEX.typeColor[t] || '#888';
const xpToNext = (lv) => 20 + lv * lv * 2;

// ---------- 기술/러닝셋 ----------
function learnUpTo(en, lv) {
  const L = LEARN[en]; if (!L) return ['tackle'];
  const ks = uniq(L.lv.filter((e) => e.lv <= lv && MOVES[e.move]).map((e) => e.move));
  return ks.length ? ks : ['tackle'];
}
function defaultActive(learned) {
  return learned.filter((k) => MOVES[k]).sort((a, b) => MOVES[b].power - MOVES[a].power).slice(0, 4);
}
function tmLearnable(en) { const L = LEARN[en]; return L ? (L.tm || []).filter((k) => MOVES[k]) : []; }
function bestMoveKey(types, defTypes, active) {
  let best = null, bs = -1;
  for (const k of active) { const mv = MOVES[k]; if (!mv) continue;
    const sc = mv.power * (types.includes(mv.type) ? 1.5 : 1) * typeEffect(mv.type, defTypes);
    if (sc > bs) { bs = sc; best = k; } }
  return best || (active[0]) || 'tackle';
}
function enemyActive(en, lv) {
  const ks = learnUpTo(en, lv).slice().sort((a, b) => MOVES[b].power - MOVES[a].power).slice(0, 4);
  return ks.length ? ks : ['tackle'];
}

// 변화기(자기 강화) — 보스/챔피언전에서 셋업 후 공격
const BUFF_MOVES = {
  'swords-dance': { kr: '칼춤', type: 'normal', power: 0, dclass: 'status', buff: { atk: 2 } },
  'dragon-dance': { kr: '용의춤', type: 'dragon', power: 0, dclass: 'status', buff: { atk: 1, spd: 1 } },
  'calm-mind': { kr: '명상', type: 'psychic', power: 0, dclass: 'status', buff: { atk: 1 } },
  'nasty-plot': { kr: '나쁜음모', type: 'dark', power: 0, dclass: 'status', buff: { atk: 2 } },
};
Object.assign(MOVES, BUFF_MOVES);
const isBuff = (k) => !!(MOVES[k] && MOVES[k].buff);
const stageMult = (s) => (2 + Math.min(s || 0, 6)) / 2;   // 0→×1, 1→×1.5, 2→×2 …
// 실제로 그 포켓몬이 배울 수 있는 변화기(LEARN[en].buffs) 중에서만 선택. 없으면 null(버프 없음).
function pickBuffMove(member) {
  const L = LEARN[member.en]; const avail = (L && L.buffs) ? L.buffs.filter((k) => MOVES[k]) : [];
  if (!avail.length) return null;
  const sp = spOf(member); const physMain = sp.stats.atk >= sp.stats.spa;
  const order = physMain ? ['swords-dance', 'dragon-dance', 'calm-mind', 'nasty-plot'] : ['calm-mind', 'nasty-plot', 'dragon-dance', 'swords-dance'];
  for (const b of order) if (avail.includes(b)) return b;
  return avail[0];
}

// ---------- 진행 구조 ----------
const REGIONS = ['관동', '성도', '호연', '신오', '하나', '칼로스', '알로라', '가라르'];
const CHAMPS = ['그린', '목호', '윤진', '난천', '좀무', '띠어시', '하우', '단델'];
const champName = (r) => CHAMPS[r % CHAMPS.length];
const ROUTES_PER_REGION = 6;
const WAVES_PER_ROUTE = 8;
const regionName = (r) => r < REGIONS.length ? REGIONS[r] : `${REGIONS[r % REGIONS.length]}+${Math.floor(r / REGIONS.length)}`;
const regionMult = (r) => Math.pow(1.9, r);
const BOSS_POOL = DEX ? DEX.pokemon.filter((p) => p.bst >= 500 && p.bst < 580).map((p) => p.en) : [];
const CHAMP_POOL = DEX ? DEX.pokemon.filter((p) => p.bst >= 580).map((p) => p.en) : [];
function wildEn() {
  const pool = DEX.wildPool, total = pool.reduce((s, p) => s + p.w, 0);
  let r = Math.random() * total;
  for (const p of pool) if ((r -= p.w) <= 0) return p.en;
  return pool[0].en;
}

// ---------- 상태이상 ----------
const STATUS_BY_TYPE = { fire: 'burn', electric: 'par', ice: 'freeze', poison: 'poison', grass: 'sleep' };
const STATUS_EMOJI = { burn: '🔥', poison: '☠️', par: '⚡', freeze: '❄️', sleep: '💤' };
const STATUS_DUR = { burn: 5000, poison: 5000, par: 5000, freeze: 1500, sleep: 2500 };

// ============================================================
// 장비 = 실제 포켓몬 도구 (메인/강화/정밀 3슬롯, ★1~5)
// ============================================================
const SLOT_META = [{ key: 'main', name: '메인', icon: '🔮' }, { key: 'boost', name: '강화', icon: '💠' }, { key: 'tech', name: '정밀', icon: '🎯' }];
const STAT_LABEL = { atk: '공격', hp: '체력', spd: '속도', crit: '치명' };
const STAR_MAX = 999;   // 사실상 무한 — ★ 계속 합성/상승 가능
const starStr = (n) => n <= 5 ? '★'.repeat(n) : '★' + n;   // ★6 이상은 '★7' 숫자 표기
const STAR_COLORS = ['#9aa7b3', '#9aa7b3', '#5bd75b', '#46b6ff', '#b46cff', '#ffae34', '#ff7a3d', '#ff4d6d', '#e040fb', '#26c6da', '#ffd700'];
const starColor = (n) => STAR_COLORS[Math.min(n, 10)] || '#ffd700';   // 등급 높을수록 색 변화(10+ 금색)
const PLATE = {
  'flame-plate': ['불구슬플레이트', 'fire'], 'splash-plate': ['물방울플레이트', 'water'], 'zap-plate': ['우뢰플레이트', 'electric'],
  'meadow-plate': ['초록플레이트', 'grass'], 'icicle-plate': ['고드름플레이트', 'ice'], 'fist-plate': ['주먹플레이트', 'fighting'],
  'toxic-plate': ['맹독플레이트', 'poison'], 'earth-plate': ['대지플레이트', 'ground'], 'sky-plate': ['푸른하늘플레이트', 'flying'],
  'mind-plate': ['이상한플레이트', 'psychic'], 'insect-plate': ['비단벌레플레이트', 'bug'], 'stone-plate': ['암석플레이트', 'rock'],
  'spooky-plate': ['원령플레이트', 'ghost'], 'draco-plate': ['용의플레이트', 'dragon'], 'dread-plate': ['공포플레이트', 'dark'],
  'iron-plate': ['강철플레이트', 'steel'], 'pixie-plate': ['정령플레이트', 'fairy'],
};
const ITEM_DEFS = {
  'choice-band': { name: '구애머리띠', cat: 'main', rare: 3, eff: { physAtk: [0.35, 0.09] } },
  'choice-specs': { name: '구애안경', cat: 'main', rare: 3, eff: { specAtk: [0.35, 0.09] } },
  'choice-scarf': { name: '구애스카프', cat: 'main', rare: 3, eff: { spd: [0.30, 0.075] } },
  'life-orb': { name: '생명의구슬', cat: 'main', rare: 4, eff: { offMult: [0.25, 0.06] } },
  'leftovers': { name: '먹다남은음식', cat: 'main', rare: 2, eff: { regen: [0.04, 0.01] } },
  'assault-vest': { name: '돌격조끼', cat: 'main', rare: 2, eff: { hp: [0.30, 0.07] } },
  'eviolite': { name: '진화의휘석', cat: 'main', rare: 2, eff: { reduce: [0.20, 0.05] }, unevolved: true },
  'focus-sash': { name: '기합의띠', cat: 'main', rare: 3, eff: { sash: [1, 0] } },
  'shell-bell': { name: '조개껍질방울', cat: 'main', rare: 2, eff: { lifesteal: [0.08, 0.02] } },
  'black-sludge': { name: '검은진흙', cat: 'main', rare: 2, eff: { sludge: [0.07, 0.02] } },
  'muscle-band': { name: '힘의머리띠', cat: 'boost', rare: 1, eff: { physAtk: [0.10, 0.025] } },
  'wise-glasses': { name: '지식의안경', cat: 'boost', rare: 1, eff: { specAtk: [0.10, 0.025] } },
  'expert-belt': { name: '달인의띠', cat: 'boost', rare: 2, eff: { superEff: [0.15, 0.04] } },
  'scope-lens': { name: '초점렌즈', cat: 'tech', rare: 2, eff: { crit: [0.08, 0.025] } },
  'wide-lens': { name: '광각렌즈', cat: 'tech', rare: 1, eff: { acc: [0.10, 0.03] } },
  'quick-claw': { name: '선제공격손톱', cat: 'tech', rare: 1, eff: { spd: [0.10, 0.03] } },
  'kings-rock': { name: '왕의징표석', cat: 'tech', rare: 2, eff: { flinch: [0.10, 0.025] } },
  'rocky-helmet': { name: '울퉁불퉁멧', cat: 'tech', rare: 1, eff: { thorns: [0.12, 0.03] } },
};
for (const k in PLATE) ITEM_DEFS[k] = { name: PLATE[k][0], cat: 'boost', rare: 2, ptype: PLATE[k][1], eff: { typeBoost: [0.12, 0.03] } };
const GEAR_KEYS = Object.keys(ITEM_DEFS);
const defOf = (key) => ITEM_DEFS[key];
function effVal(it, eff) { const d = defOf(it.key); if (!d || !d.eff[eff]) return 0; const [b, s] = d.eff[eff]; return b + s * (it.star - 1); }
function equippedItems(m) { const e = m.equip || {}; const out = []; for (const s of ['main', 'boost', 'tech']) if (e[s]) out.push(e[s]); return out; }
// 아직 더 진화할 수 있는가(레벨/돌/통신 어느 방법으로든) — 진화의 휘석(미진화 전용) 판정
function canEvolveMore(en) { const sp = BY_EN[en]; return !!(sp && sp.evolveTo) || !!STONE_EVO[en] || !!NONLEVEL_EVO[en]; }
function gearStat(m, eff) { let s = 0; for (const it of equippedItems(m)) { const d = defOf(it.key); if (!d) continue; if (d.unevolved && !canEvolveMore(m.en)) continue; if (d.eff[eff]) s += effVal(it, eff); } return s; }
function gearMax(m, eff) { let v = 0; for (const it of equippedItems(m)) { const d = defOf(it.key); if (d && d.eff[eff]) v = Math.max(v, effVal(it, eff)); } return v; }
function gearTypeBoost(m, t) { let s = 0; for (const it of equippedItems(m)) { const d = defOf(it.key); if (d && d.eff.typeBoost && d.ptype === t) s += effVal(it, 'typeBoost'); } return s; }
function gearSuperEff(m) { let s = 0; for (const it of equippedItems(m)) { const d = defOf(it.key); if (d && d.eff.superEff) s += effVal(it, 'superEff'); } return s; }
function hasSash(m) { for (const it of equippedItems(m)) { const d = defOf(it.key); if (d && d.eff.sash) return true; } return false; }
function starForDepth(region, boost) { let s = 1 + (Math.random() < 0.3 ? 1 : 0) + Math.floor(region / 2); if (boost && Math.random() < boost) s += 1; return clamp(s, 1, STAR_MAX); }
function makeGear(region, boost) {
  const total = GEAR_KEYS.reduce((s, k) => s + 1 / defOf(k).rare, 0);
  let t = Math.random() * total, chosen = GEAR_KEYS[0];
  for (const k of GEAR_KEYS) { if ((t -= 1 / defOf(k).rare) <= 0) { chosen = k; break; } }
  return { uid: 'g' + (++state.itemSeq), key: chosen, star: starForDepth(region, boost || 0) };
}
const INV_MAX = 500;
const BENCH_MAX = 150;   // 벤치 보관 최대치
const invFull = () => state.inv.length >= INV_MAX;
function gearSell(it) { return Math.round((25 + defOf(it.key).rare * 20) * it.star * (1 + state.prog.region * 0.3)); }
// 반환: true=가방에 넣음, false=안 넣음(자동판매됐거나 거절). 더 이상 오래된 도구를 조용히 버리지 않음.
function addGear(it, drop) {
  if (invFull()) {
    if (drop) { state.gold += gearSell(it); return false; }   // 드롭은 손실 방지 위해 자동판매로 전환
    return false;                                             // 구매/그 외는 넣지 않음(호출측에서 처리)
  }
  state.inv.push(it); return true;
}
function gearLabel(it) {
  const d = defOf(it.key); const p = [];
  for (const eff in d.eff) {
    if (eff === 'sash') p.push('전투당 1회 버팀');
    else if (eff === 'reduce') p.push(`받는 피해 -${Math.round(effVal(it, eff) * 100)}%${defOf(it.key).unevolved ? '(미진화)' : ''}`);
    else if (eff === 'acc') p.push(`명중 +${Math.round(effVal(it, eff) * 100)}%`);
    else if (eff === 'physAtk') p.push(`물리공격 +${Math.round(effVal(it, eff) * 100)}%`);
    else if (eff === 'specAtk') p.push(`특수공격 +${Math.round(effVal(it, eff) * 100)}%`);
    else if (eff === 'offMult') p.push(`공격(물리+특수) +${Math.round(effVal(it, eff) * 100)}%`);
    else if (eff === 'superEff') p.push(`상성 +${Math.round(effVal(it, eff) * 100)}%`);
    else if (eff === 'typeBoost') p.push(`${krType(d.ptype)} +${Math.round(effVal(it, eff) * 100)}%`);
    else if (eff === 'regen') p.push(`매턴회복 ${Math.round(effVal(it, eff) * 100)}%`);
    else if (eff === 'sludge') p.push(`독타입 매턴 +${Math.round(effVal(it, eff) * 100)}%·그외 피해`);
    else if (eff === 'lifesteal') p.push(`흡혈 ${Math.round(effVal(it, eff) * 100)}%`);
    else if (eff === 'flinch') p.push(`풀죽음 ${Math.round(effVal(it, eff) * 100)}%`);
    else if (eff === 'thorns') p.push(`반사 ${Math.round(effVal(it, eff) * 100)}%`);
    else p.push(`${STAT_LABEL[eff] || eff} +${Math.round(effVal(it, eff) * 100)}%`);
  }
  return p.join(' · ');
}
function heldIconsHtml(m) { return equippedItems(m).map((it) => `<img class="hitem" src="${ITEM_ICON(it.key)}" alt="" title="${defOf(it.key).name} ${starStr(it.star)}">`).join(''); }

// ---------- 소모품(나무열매·진화의돌) ----------
const CONSUM = {
  'oran-berry':    { name: '오랭열매', kind: 'heal', amt: 0.30, desc: 'HP 35% 이하 시 HP 30% 자동 회복' },
  'sitrus-berry':  { name: '자뭉열매', kind: 'heal', amt: 0.55, desc: 'HP 35% 이하 시 HP 55% 자동 회복' },
  'lum-berry':     { name: '리샘열매', kind: 'cure', desc: '상태이상(화상·마비·독 등) 자동 치료' },
  'fire-stone':    { name: '불꽃의돌', kind: 'stone', desc: '불꽃의돌 진화 — 🦸 멤버에서 사용' },
  'thunder-stone': { name: '천둥의돌', kind: 'stone', desc: '천둥의돌 진화 — 🦸 멤버에서 사용' },
  'water-stone':   { name: '물의돌',   kind: 'stone', desc: '물의돌 진화 — 🦸 멤버에서 사용' },
  'leaf-stone':    { name: '리프의돌', kind: 'stone', desc: '리프의돌 진화 — 🦸 멤버에서 사용' },
  'moon-stone':    { name: '달의돌',   kind: 'stone', desc: '달의돌 진화 — 🦸 멤버에서 사용' },
};
const BERRY_DROP = ['oran-berry', 'oran-berry', 'sitrus-berry', 'lum-berry'];
const STONE_KEYS = ['fire-stone', 'thunder-stone', 'water-stone', 'leaf-stone', 'moon-stone'];
// 돌 진화: 진화전 en -> { 돌 -> 진화후 en }
const STONE_EVO = {
  pikachu: { 'thunder-stone': 'raichu' },
  eevee: { 'fire-stone': 'flareon', 'thunder-stone': 'jolteon', 'water-stone': 'vaporeon' },
  vulpix: { 'fire-stone': 'ninetales' }, growlithe: { 'fire-stone': 'arcanine' },
  poliwhirl: { 'water-stone': 'poliwrath' }, shellder: { 'water-stone': 'cloyster' }, staryu: { 'water-stone': 'starmie' },
  gloom: { 'leaf-stone': 'vileplume' }, weepinbell: { 'leaf-stone': 'victreebel' }, exeggcute: { 'leaf-stone': 'exeggutor' },
  nidorina: { 'moon-stone': 'nidoqueen' }, nidorino: { 'moon-stone': 'nidoking' },
  clefairy: { 'moon-stone': 'clefable' }, jigglypuff: { 'moon-stone': 'wigglytuff' },
};
function addConsum(key) { state.items[key] = (state.items[key] || 0) + 1; }
// 전투 중 자동 소모(상태이상 치료 → HP 위기 회복)
function berryAuto(h, now) {
  if (!h.alive) return;
  if (h.lastBerry && now - h.lastBerry < 700 / SPD()) return;
  if (h.status && (state.items['lum-berry'] || 0) > 0) {
    state.items['lum-berry']--; clearStatus(h); h.lastBerry = now;
    floatDmg(parseFloat(h.el.style.left), '리샘열매!', 'heal'); return;
  }
  const mx = mMaxHp(h.member);
  if (h.hp / mx < 0.35) {
    const b = (state.items['sitrus-berry'] || 0) > 0 ? 'sitrus-berry' : (state.items['oran-berry'] || 0) > 0 ? 'oran-berry' : null;
    if (b) { state.items[b]--; const heal = Math.round(mx * CONSUM[b].amt); h.hp = Math.min(mx, h.hp + heal); updateHeroBar(h); h.lastBerry = now; floatDmg(parseFloat(h.el.style.left), '+' + heal + '🍓', 'heal'); }
  }
}
function evolveByStone(member, stone) {
  const map = STONE_EVO[member.en]; if (!map || !map[stone]) return;
  if ((state.items[stone] || 0) <= 0) return;
  state.items[stone]--; member.en = map[stone];
  member.learned = uniq(member.learned.concat(learnUpTo(member.en, member.lv)));
  banner(`✨ ${CONSUM[stone].name}! ${BY_EN[member.en].name}(으)로 진화!`);
  renderParty(); if (panelOpen === 'party') renderRoster(); save();
}

// ---------- 파생 스탯 (배지 + 트리 + 도감 + 장비) ----------
const spOf = (m) => BY_EN[m.en] || BY_EN['pikachu'];
const badgeMult = () => 1 + state.prog.badges * 0.08;
const trAtk = () => 1, trHp = () => 1, trGold = () => 1, trXp = () => 1;   // 트리 제거 → 상수
const maxParty = () => 3;
const uniqueSpecies = () => Object.keys(state.dex.kills).length;
const masteredCount = () => Object.values(state.dex.kills).filter((n) => n >= 100).length;
const collectionGold = () => uniqueSpecies() * 0.003;
const masteryAtk = () => 1 + masteredCount() * 0.01;
const goldMult = () => trGold() + collectionGold();
const critChance = () => 0.12;
// 방생 누적 보너스: 보스·챔피언 포획 확률을 영구히 아주 조금씩↑ (방생 1마리당 +0.03%, 최대 +6%)
const releaseBonus = () => Math.min(0.06, (state.released || 0) * 0.0003);

// 공통 공격배수(업글·배지·도감숙련 + 생명의구슬 offMult=물리·특수 양쪽) / 물리·특수는 각각 전용 장비 보너스 분리
const offMult = (m) => (1 + state.up.atk * 0.12) * badgeMult() * trAtk() * masteryAtk() * (1 + gearStat(m, 'offMult'));
const physAtk = (m) => Math.round(statAt(spOf(m).stats.atk, m.lv) * offMult(m) * (1 + gearStat(m, 'physAtk')));
const specAtk = (m) => Math.round(statAt(spOf(m).stats.spa, m.lv) * offMult(m) * (1 + gearStat(m, 'specAtk')));
const physDef = (m) => statAt(spOf(m).stats.def, m.lv);
const specDef = (m) => statAt(spOf(m).stats.spd, m.lv);
const mMaxHp = (m) => Math.round(statAt(spOf(m).stats.hp, m.lv, true) * (1 + state.up.hp * 0.14) * badgeMult() * trHp() * (1 + gearStat(m, 'hp')));
const mInterval = (m) => clamp((1400 - statAt(spOf(m).stats.spe, m.lv) * 3 - state.up.spd * 45) * (1 - clamp(gearStat(m, 'spd'), 0, 0.6)), 300, 1400);
function memberDPS(m) {
  const dmg = m.active.filter((k) => MOVES[k] && !isBuff(k)).reduce((mx, k) => Math.max(mx, MOVES[k].power || 0), 40);
  const off = Math.max(physAtk(m), specAtk(m));
  return Math.round(off * (dmg / 55) * (1000 / mInterval(m)));
}

// ============================================================
// 상태 저장/복원
// ============================================================
const SAVE_KEY = 'pkmnRoom';
function newMember(en, lv) {
  lv = lv || 5;
  const learned = learnUpTo(en, lv);
  const buff = pickBuffMove({ en, lv });
  if (buff && !learned.includes(buff)) learned.push(buff);
  const active = defaultActive(learned);
  if (buff && !active.includes(buff)) { if (active.length < 4) active.push(buff); else active[active.length - 1] = buff; }
  return { en, lv, xp: 0, learned, active, equip: { main: null, boost: null, tech: null } };
}
function ensureMember(m) {
  if (!m.equip || !('main' in m.equip)) m.equip = { main: null, boost: null, tech: null };
  if (!Array.isArray(m.learned) || !m.learned.length) m.learned = learnUpTo(m.en, m.lv);
  const okBuffs = (LEARN[m.en] && LEARN[m.en].buffs) || [];
  m.learned = m.learned.filter((k) => MOVES[k] && (!isBuff(k) || okBuffs.includes(k)));   // 무효기·비학습 버프 제거
  if (!m.learned.length) m.learned = ['tackle'];
  const buff = pickBuffMove(m); if (buff && !m.learned.includes(buff)) m.learned.push(buff);   // 실제 학습 가능한 버프만 보유
  if (!Array.isArray(m.active) || !m.active.length) m.active = defaultActive(m.learned);
  m.active = m.active.filter((k) => m.learned.includes(k)).slice(0, 4); if (!m.active.length) m.active = m.learned.slice(0, 4);
  return m;
}
function defaultState() {
  return {
    version: 7, gold: 0, candy: 0, started: false, itemSeq: 0, inv: [], tms: {}, items: {},
    released: 0,   // 누적 방생 수 → 보스·챔피언 포획 확률 영구 보너스
    settings: { speed: 1, autosell: false },
    party: [newMember('pikachu', 5)], bench: [],
    up: { atk: 0, hp: 0, spd: 0 },
    trainer: { atk: 0, hp: 0, gold: 0, xp: 0, crit: 0, slot: 0 },
    dex: { kills: {} },
    prog: { region: 0, route: 1, wave: 1, clears: 0, maxClears: 0, badges: 0 },
    lastSeen: Date.now(),
  };
}
function loadState() {
  for (const k of ['pkmnRoom']) {
    try {
      const s = JSON.parse(localStorage.getItem(k));
      if (s && s.version >= 2 && Array.isArray(s.party) && s.party.length) {
        s.up = s.up || { atk: 0, hp: 0, spd: 0 };
        if (!s.prog) s.prog = { region: 0, route: 1, wave: 1, clears: 0, maxClears: 0, badges: 0 };
        s.candy = s.candy || 0;
        s.trainer = s.trainer || { atk: 0, hp: 0, gold: 0, xp: 0, crit: 0, slot: 0 };
        s.dex = s.dex || { kills: {} };
        s.inv = Array.isArray(s.inv) ? s.inv.filter((it) => it && it.key && ITEM_DEFS[it.key] && it.star) : [];
        s.itemSeq = s.itemSeq || 0;
        s.released = s.released || 0;
        s.tms = s.tms || {};
        s.items = s.items || {};
        s.settings = s.settings || { speed: 1 }; if (!s.settings.speed) s.settings.speed = 1; if (s.settings.autosell === undefined) s.settings.autosell = false;
        s.bench = Array.isArray(s.bench) ? s.bench : [];
        if (s.started === undefined) s.started = true;
        s.party.forEach(ensureMember); s.bench.forEach(ensureMember);
        delete s.stage; delete s.best; s.version = 7;
        return s;
      }
    } catch (e) {}
  }
  return defaultState();
}
let state = loadState();
function save() { state.lastSeen = Date.now(); try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) {} }

// ============================================================
// 런타임 전투 객체
// ============================================================
const HERO_X = [26, 17, 8, 0];
let heroes = [];
let enemy = null;
let pauseUntil = 0, spawnAt = 0;
let panelOpen = null;   // 'party'|'tree'|'dex'|'bag'|'shop'|null
let bagSel = 0;
let bagFilter = 'all';   // 가방 인벤토리 분류 필터: all|main|boost|tech
let lastPulls = [];      // 상점 최근 뽑기 결과(세션 한정, 저장 안 함)
let rosterSel = null;   // 선택된 멤버(파티/벤치) 참조
let pendingRelease = null;   // 방생 2단계 확인용
let benchSort = 'dex';       // 벤치 정렬: 'dex'(도감순) | 'level'(레벨순)
let releaseMode = false;     // 벤치 선택 방생 모드
const releaseSel = new Set();// 선택 방생 대상(멤버 참조)
const SPD = () => (state.settings && state.settings.speed) || 1;   // 배속(1/2/4)
const heroesEl = () => $('heroes');
const enemiesEl = () => $('enemies');
const getMax = (f) => (f === enemy ? f.maxHp : mMaxHp(f.member));

function renderParty() {
  // HP·기절 상태는 멤버 식별자 기준으로 보존(파티 순서 변경 시 엉뚱한 멤버에 적용되는 버그 방지)
  const prev = new Map(heroes.map((h) => [h.member, h.alive ? h.hp / mMaxHp(h.member) : 0]));
  heroesEl().innerHTML = '';
  heroes = state.party.map((member, idx) => {
    ensureMember(member);
    const sp = spOf(member);
    const el = document.createElement('div');
    el.className = 'fighter hero';
    el.style.left = HERO_X[idx] + '%'; el.style.bottom = (12 + idx * 3) + 'px'; el.style.zIndex = 10 - idx;
    el.innerHTML = `<div class="helditems">${heldIconsHtml(member)}</div>
       <div class="namebar"><span>${sp.name}</span> <small>Lv.${member.lv}</small></div>
       <div class="hpbar"><div class="hpfill"></div></div>
       <img class="fsprite" draggable="false"><div class="sbadge"></div>`;
    const img = el.querySelector('.fsprite'); img.dataset.fb = staticUrl(sp); img.src = dotUrl(sp);
    heroesEl().appendChild(el);
    const ratio = prev.has(member) ? prev.get(member) : 1;
    return { member, sp, el, img, hpfill: el.querySelector('.hpfill'), nameEl: el.querySelector('.namebar'),
      sbadge: el.querySelector('.sbadge'), hp: Math.max(1, Math.round(mMaxHp(member) * ratio)),
      lastAtk: 0, alive: ratio > 0, status: null, sashOk: true, lastRegen: 0, lastBerry: 0,
      atkStage: 0, spdStage: 0, buffTurns: 0 };
  });
  heroes.forEach(updateHeroBar);
  updateFront();
}
function updateHeroBar(h) { const r = clamp(h.hp / mMaxHp(h.member), 0, 1); h.hpfill.style.width = (r * 100) + '%'; setBarColor(h.hpfill, r); h.el.classList.toggle('faint', !h.alive); }
function setBarColor(el, r) { el.style.background = r > 0.5 ? '#4caf50' : r > 0.2 ? '#ffb300' : '#e53935'; }
function frontHero() { return heroes.find((h) => h.alive) || null; }
function updateFront() { const f = frontHero(); heroes.forEach((h) => h.el.classList.toggle('front', h === f)); }
function healHero(h) { h.hp = mMaxHp(h.member); h.alive = true; h.sashOk = true; clearStatus(h); updateHeroBar(h); }

// ---------- 적 스폰 ----------
function currentKind() { const p = state.prog; if (p.route > ROUTES_PER_REGION) return 'champion'; if (p.wave > WAVES_PER_ROUTE) return 'boss'; return 'wave'; }
function spawnEnemy() {
  const p = state.prog, kind = currentKind();
  const en = kind === 'champion' ? pick(CHAMP_POOL.length ? CHAMP_POOL : BOSS_POOL)
    : kind === 'boss' ? pick(BOSS_POOL.length ? BOSS_POOL : DEX.wildPool.map((x) => x.en)) : wildEn();
  const sp = BY_EN[en];
  const lv = clamp(5 + p.region * 20 + p.route * 2 + Math.floor(p.wave / 2), 1, 999);
  const mult = regionMult(p.region) * (1 + (p.route - 1) * 0.10);
  const hpMult = mult * (kind === 'champion' ? 6 : kind === 'boss' ? 2.4 : 1);
  // 적 레벨 무한 해제 후 재밸런싱: 레벨이 이미 지방 진행을 반영하므로 공격력의 지수계수를 낮춤(0.55)
  // + 종류별 계수 하향 → 보스/챔피언이 즉사시키지 않고 '깎는 싸움'이 되도록(생존시간 확보)
  const aMult = Math.pow(regionMult(p.region), 0.55) * (1 + (p.route - 1) * 0.06) * (kind === 'champion' ? 0.28 : kind === 'boss' ? 0.24 : 0.16);
  const big = kind !== 'wave';
  const el = document.createElement('div');
  el.className = 'fighter enemy' + (big ? ' boss' : '');
  el.style.left = '100%'; el.style.bottom = '12px';
  const tag = kind === 'champion' ? ' 🏆' : kind === 'boss' ? ' 👑' : '';
  el.innerHTML = `<div class="namebar"><span>${sp.name}${tag}</span> <small>Lv.${lv}</small></div>
     <div class="hpbar"><div class="hpfill"></div></div><img class="fsprite" draggable="false"><div class="sbadge"></div>`;
  { const es = el.querySelector('.fsprite'); es.dataset.fb = staticUrl(sp); es.src = dotUrl(sp); }
  enemiesEl().appendChild(el);
  const maxHp = Math.round(statAt(sp.stats.hp, lv, true) * hpMult);
  enemy = {
    en, sp, lv, kind, maxHp, hp: maxHp,
    patk: Math.round(statAt(sp.stats.atk, lv) * aMult), satk: Math.round(statAt(sp.stats.spa, lv) * aMult),
    def: statAt(sp.stats.def, lv), sdef: statAt(sp.stats.spd, lv),
    interval: clamp(1500 - statAt(sp.stats.spe, lv) * 2, 650, 1600),
    active: enemyActive(en, lv),
    el, img: el.querySelector('.fsprite'), hpfill: el.querySelector('.hpfill'), sbadge: el.querySelector('.sbadge'),
    lastAtk: 0, status: null, flinch: false,
  };
  heroes.forEach((h) => { h.atkStage = 0; h.spdStage = 0; h.buffTurns = 0; });   // 강화는 전투마다 초기화
  requestAnimationFrame(() => { el.style.left = big ? '70%' : '72%'; });
  updateEnemyBar();
  if (kind === 'champion') banner(`🏆 ${regionName(p.region)} 챔피언 ${champName(p.region)}의 ${sp.name}!`);
  else if (kind === 'boss') banner(`👑 루트 보스 ${sp.name}!`);
}
function updateEnemyBar() { if (!enemy) return; const r = clamp(enemy.hp / enemy.maxHp, 0, 1); enemy.hpfill.style.width = (r * 100) + '%'; setBarColor(enemy.hpfill, r); }

// ---------- 상태이상 ----------
function applyStatus(f, kind) { f.status = { kind, until: performance.now() + STATUS_DUR[kind] / SPD(), lastTick: performance.now() }; if (f.sbadge) f.sbadge.textContent = STATUS_EMOJI[kind]; f.el.classList.add('st-' + kind); }
function clearStatus(f) { f.status = null; if (f.sbadge) f.sbadge.textContent = ''; f.el.classList.remove('st-burn', 'st-poison', 'st-par', 'st-freeze', 'st-sleep'); }
function maybeStatus(target, atkType) { const kind = STATUS_BY_TYPE[atkType]; if (!kind || target.status) return; if (Math.random() < 0.16) applyStatus(target, kind); }
function canMove(f, now) { if (f.status) { if (now >= f.status.until) { clearStatus(f); return true; } if (f.status.kind === 'freeze' || f.status.kind === 'sleep') return false; } return true; }
function statusTick(f, now) {
  if (!f.status) return;
  if (now >= f.status.until) { clearStatus(f); return; }
  const k = f.status.kind;
  if ((k === 'burn' || k === 'poison') && now - f.status.lastTick >= 1000 / SPD()) {
    f.status.lastTick = now;
    const dmg = Math.max(1, Math.round(getMax(f) * (k === 'burn' ? 0.03 : 0.04)));
    if (f === enemy) { enemy.hp -= dmg; floatDmg(72, '-' + dmg, 'eff'); updateEnemyBar(); if (enemy.hp <= 0) enemyDefeated(); }
    else { f.hp -= dmg; floatDmg(parseFloat(f.el.style.left), '-' + dmg, 'eff'); if (f.hp <= 0) { f.hp = 0; f.alive = false; updateHeroBar(f); updateFront(); if (!frontHero()) partyWipe(); } else updateHeroBar(f); }
  }
}

// ---------- 데미지/이펙트 ----------
function calcDamage(atk, def, atkType, defTypes, critBonus) {
  const eff = typeEffect(atkType, defTypes);
  let dmg = atk * (100 / (100 + def)) * eff * rand(0.85, 1.05);
  const crit = Math.random() < (critChance() + (critBonus || 0));
  if (crit) dmg *= 1.6;
  return { dmg: Math.max(1, Math.floor(dmg)), eff, crit };
}
function floatDmg(leftPct, text, cls) { const el = document.createElement('div'); el.className = 'dmg ' + (cls || ''); el.textContent = text; el.style.left = leftPct + '%'; el.style.bottom = '48%'; $('fx').appendChild(el); setTimeout(() => el.remove(), 800); }
function lunge(el, dir) { el.classList.add(dir > 0 ? 'attack-r' : 'attack-l'); setTimeout(() => el.classList.remove('attack-r', 'attack-l'), 130); }
function flashHurt(el) { el.classList.add('hurt'); setTimeout(() => el.classList.remove('hurt'), 200); }

// ---------- 전투 ----------
function heroAttack(h) {
  if (!enemy) return;
  if (h.status && h.status.kind === 'par' && Math.random() < 0.25) { floatDmg(parseFloat(h.el.style.left), '마비!', ''); return; }
  // 변화기: 보스/챔피언전에서 셋업(최대 2회) — 단, 체력이 넉넉할 때만(셋업 중 전멸 방지)
  const buffKey = h.member.active.find(isBuff);
  if (buffKey && enemy.kind !== 'wave' && h.buffTurns < 2 && h.atkStage < 4 && h.hp > mMaxHp(h.member) * 0.55) {
    const bm = MOVES[buffKey]; lunge(h.el, +1); h.buffTurns++;
    if (bm.buff.atk) h.atkStage = Math.min(6, h.atkStage + bm.buff.atk);
    if (bm.buff.spd) h.spdStage = Math.min(6, h.spdStage + bm.buff.spd);
    floatDmg(parseFloat(h.el.style.left), bm.kr + '!', 'heal');
    return;
  }
  const key = bestMoveKey(h.sp.types, enemy.sp.types, h.member.active);
  const mv = MOVES[key] || { type: h.sp.types[0], power: 40, dclass: 'physical' };
  lunge(h.el, +1);
  if (mv.acc && Math.random() * 100 > Math.min(100, mv.acc + gearStat(h.member, 'acc') * 100)) { floatDmg(72, '빗나감!', ''); return; }   // 광각렌즈(acc)로 명중↑
  const phys = mv.dclass === 'physical';
  const stab = h.sp.types.includes(mv.type) ? 1.5 : 1;
  let A = (phys ? physAtk(h.member) : specAtk(h.member)) * (mv.power / 55) * stab * (1 + gearTypeBoost(h.member, mv.type)) * stageMult(h.atkStage);
  if (h.status && h.status.kind === 'burn' && phys) A *= 0.7;
  const D = phys ? enemy.def : enemy.sdef;
  const r = calcDamage(A, D, mv.type, enemy.sp.types, gearStat(h.member, 'crit'));
  if (r.eff >= 2) r.dmg = Math.round(r.dmg * (1 + gearSuperEff(h.member)));
  enemy.hp -= r.dmg; flashHurt(enemy.el);
  floatDmg(72, '-' + r.dmg, r.crit ? 'crit' : (r.eff >= 2 ? 'eff' : ''));
  if (r.eff >= 2 && Math.random() < 0.4) floatDmg(74, '굉장!', 'eff');
  else if (r.eff > 0 && r.eff < 1 && Math.random() < 0.3) floatDmg(74, '별로...', '');
  maybeStatus(enemy, mv.type);
  const ls = gearStat(h.member, 'lifesteal');
  if (ls > 0) { const mx = mMaxHp(h.member); if (h.hp < mx) { h.hp = Math.min(mx, h.hp + Math.max(1, Math.round(r.dmg * ls))); updateHeroBar(h); } }
  const fl = gearStat(h.member, 'flinch');
  if (fl > 0 && enemy && Math.random() < fl) enemy.flinch = true;
  updateEnemyBar();
  if (enemy.hp <= 0) enemyDefeated();
}
function enemyAttack(target) {
  if (!enemy || !target) return;
  if (enemy.flinch) { enemy.flinch = false; floatDmg(72, '풀죽음!', ''); return; }
  if (enemy.status && enemy.status.kind === 'par' && Math.random() < 0.25) { floatDmg(72, '마비!', ''); return; }
  const key = bestMoveKey(enemy.sp.types, target.sp.types, enemy.active);
  const mv = MOVES[key] || { type: enemy.sp.types[0], power: 40, dclass: 'physical' };
  lunge(enemy.el, -1);
  if (mv.acc && Math.random() * 100 > mv.acc) { floatDmg(parseFloat(target.el.style.left), '빗나감!', ''); return; }
  const phys = mv.dclass === 'physical';
  const stab = enemy.sp.types.includes(mv.type) ? 1.5 : 1;
  let A = (phys ? enemy.patk : enemy.satk) * (mv.power / 55) * stab;
  if (enemy.status && enemy.status.kind === 'burn' && phys) A *= 0.7;
  const D = phys ? physDef(target.member) : specDef(target.member);
  const r = calcDamage(A, D, mv.type, target.sp.types, 0);
  let dmg = r.dmg;
  const red = clamp(gearStat(target.member, 'reduce'), 0, 0.7);   // 진화의 휘석(미진화) = 받는 피해 감소
  if (red > 0) dmg = Math.max(1, Math.round(dmg * (1 - red)));
  // 기합의 띠: 전투당 1회, 치명적 일격을 1 HP로 버팀(풀피 조건 없음 — 클러치 생존 보장)
  if (dmg >= target.hp && hasSash(target.member) && target.sashOk) { dmg = target.hp - 1; target.sashOk = false; floatDmg(parseFloat(target.el.style.left), '기합!', 'heal'); }
  target.hp -= dmg; flashHurt(target.el);
  floatDmg(parseFloat(target.el.style.left), '-' + dmg, r.crit ? 'crit' : '');
  maybeStatus(target, mv.type);
  const th = gearStat(target.member, 'thorns');
  if (th > 0 && enemy) { const rd = Math.max(1, Math.round(dmg * th)); enemy.hp -= rd; floatDmg(72, '-' + rd, 'eff'); updateEnemyBar(); if (enemy.hp <= 0) enemyDefeated(); }
  if (target.hp <= 0) { target.hp = 0; target.alive = false; updateHeroBar(target); updateFront(); if (!frontHero()) partyWipe(); } else updateHeroBar(target);
}

function enemyDefeated() {
  const p = state.prog, kind = enemy.kind, een = enemy.en, elv = enemy.lv;
  const baseGold = 5 + p.region * 8 + p.route * 2;
  const gold = Math.round(baseGold * regionMult(p.region) * (kind === 'champion' ? 20 : kind === 'boss' ? 6 : 1) * goldMult());
  const xp = Math.round((elv * 3 + (kind === 'champion' ? 120 : kind === 'boss' ? 30 : 0)) * trXp());
  state.gold += gold;
  floatDmg(72, '+' + fmt(gold) + '💰', 'heal');
  enemy.el.classList.add('dead'); const dead = enemy.el; setTimeout(() => dead.remove(), 400); enemy = null;

  state.dex.kills[een] = (state.dex.kills[een] || 0) + 1;
  if (state.dex.kills[een] === 100) banner(`🌟 ${BY_EN[een].name} 마스터! (처치 100)`);

  // 포획: 야생 5% / 보스·챔피언(강한·전설급) 1% + 방생 누적 보너스
  if (Math.random() < (kind === 'wave' ? 0.05 : 0.01 + releaseBonus())) catchSpecies(een, elv);
  // 장비 드롭
  const dc = kind === 'champion' ? 1 : kind === 'boss' ? 0.6 : 0.12;
  if (Math.random() < dc) { const it = makeGear(p.region, kind === 'champion' ? 0.9 : kind === 'boss' ? 0.45 : 0); const kept = addGear(it, true); floatDmg(72, '🎁', 'heal'); logEvent(kept ? `🎁 ${defOf(it.key).name} ${starStr(it.star)}` : `🎁 ${defOf(it.key).name} ${starStr(it.star)} → 💰(가방 가득)`); if (panelOpen === 'bag') renderBag(); }
  // 기술머신 드롭
  if (TM_POOL.length && Math.random() < (kind === 'wave' ? 0.05 : 0.3)) { const tk = pick(TM_POOL); state.tms[tk] = (state.tms[tk] || 0) + 1; banner(`💿 기술머신 [${MOVES[tk].kr}] 획득!`); if (panelOpen === 'party') renderRoster(); }
  // 소모품 드롭: 나무열매(흔함)·진화의돌(희귀)
  if (Math.random() < 0.10) addConsum(pick(BERRY_DROP));
  if (Math.random() < (kind === 'wave' ? 0.015 : 0.06)) { const st = pick(STONE_KEYS); addConsum(st); banner(`💎 ${CONSUM[st].name} 획득!`); }

  state.party.forEach((m) => gainXp(m, xp));

  if (kind === 'champion') { p.region++; p.route = 1; p.wave = 1; p.badges++; heroes.forEach(healHero); banner(`🎉 챔피언 격파! ${regionName(p.region)} 입성 · 🎖${p.badges}!`); }
  else if (kind === 'boss') { p.route++; p.wave = 1; banner(`✅ 루트 클리어! ${regionName(p.region)} R${p.route}`); }
  else p.wave++;
  p.clears++; p.maxClears = Math.max(p.maxClears, p.clears);
  spawnAt = performance.now() + (kind === 'wave' ? 600 : 1100) / SPD();
  heroes.forEach(updateHeroBar);
  updateHud(); save();
}
const partyAvgLv = () => state.party.length ? Math.round(state.party.reduce((s, m) => s + m.lv, 0) / state.party.length) : 5;
function catchSpecies(en, lv) {
  // 중복 허용. 벤치 가득 차면 미획득. 파티 자동 합류 X — 항상 벤치에 보관(직접 세팅해야 파티 합류)
  if (state.bench.length >= BENCH_MAX) return;
  const joinLv = clamp(Math.max(lv, partyAvgLv()), 5, 999);   // 파티 평균 수준으로(레벨차 최소화)
  const m = newMember(en, joinLv);
  evolveToEligible(m);
  state.bench.push(m);
  banner(`🎉 ${BY_EN[en].name} 포획! 🦸 벤치에 보관 (파티 세팅에서 넣으세요)`);
  if (panelOpen === 'party') renderRoster();
}

function gainXp(member, amount) {
  const oldLv = member.lv;
  member.xp += amount;
  let need = xpToNext(member.lv), leveled = false;
  while (member.xp >= need && member.lv < 999) { member.xp -= need; member.lv++; leveled = true; tryEvolve(member); need = xpToNext(member.lv); }
  if (leveled) {
    checkLearn(member, oldLv);
    const h = heroes.find((x) => x.member === member);
    if (h) { healHero(h); h.nameEl.innerHTML = `<span>${h.sp.name}</span> <small>Lv.${member.lv}</small>`; }
  }
}
function checkLearn(member, fromLv) {
  const L = LEARN[member.en]; if (!L) return;
  for (const e of L.lv) {
    if (e.lv > fromLv && e.lv <= member.lv && MOVES[e.move] && !member.learned.includes(e.move)) {
      member.learned.push(e.move);
      if (member.active.length < 4) member.active.push(e.move);
      banner(`📘 ${spOf(member).name} 새 기술 [${MOVES[e.move].kr}] 습득!`);
    }
  }
}
// 원작에서 돌/통신 등 비(非)레벨 진화 → 게임에선 레벨로도 진화(최종진화까지). [진화후, 레벨]
// 통신진화(돌·아이템 없음)만 레벨진화로 매핑. 돌 진화 포켓몬은 STONE_EVO(진화의 돌)로만 진화 → 돌 사용처 유지.
const NONLEVEL_EVO = {
  kadabra: ['alakazam', 37], machoke: ['machamp', 37], graveler: ['golem', 37], haunter: ['gengar', 38],
};
// 현재 레벨로 진화 가능한 대상 영문키 반환(레벨진화 + 비레벨진화 매핑), 없으면 null
function evoTargetOf(member) {
  const sp = spOf(member);
  if (sp.evolveTo && sp.evolveLevel && member.lv >= sp.evolveLevel && BY_EN[sp.evolveTo]) return sp.evolveTo;
  const ne = NONLEVEL_EVO[member.en];
  if (ne && member.lv >= ne[1] && BY_EN[ne[0]]) return ne[0];
  return null;
}
function applyEvolve(member, to) {   // 진화 적용 + 새 기술 흡수 + 살아있는 영웅 스프라이트 갱신
  member.en = to;
  member.learned = uniq((member.learned || []).concat(learnUpTo(to, member.lv)));
  const h = heroes.find((x) => x.member === member);
  if (h) { h.sp = BY_EN[to]; h.img.dataset.fb = staticUrl(h.sp); h.img.src = dotUrl(h.sp); h.hp = mMaxHp(member); }
}
function tryEvolve(member) {   // 레벨업 순간 호출(checkLearn이 기술 추가하므로 배너만)
  const to = evoTargetOf(member);
  if (to) { applyEvolve(member, to); banner(`✨ ${BY_EN[to].name}(으)로 진화!`); }
}
function evolveToEligible(member) {   // 현재 레벨로 갈 수 있는 단계까지 연속 진화(포획/합류 시)
  let to, guard = 0;
  while ((to = evoTargetOf(member)) && guard++ < 10) applyEvolve(member, to);
}
function manualEvolve(member) {   // 🦸 창에서 수동 진화(이미 레벨 넘긴 경우)
  const to = evoTargetOf(member); if (!to) return;
  applyEvolve(member, to); banner(`✨ ${BY_EN[to].name}(으)로 진화!`);
  renderParty(); if (panelOpen === 'party') renderRoster(); save();
}
function partyWipe() {
  banner('💀 파티 전멸! 회복 중...');
  pauseUntil = performance.now() + 2000 / SPD();
  const p = state.prog; p.wave = Math.max(1, Math.min(p.wave, WAVES_PER_ROUTE) - 2);
  if (enemy) { enemy.el.remove(); enemy = null; }
  spawnAt = pauseUntil + 200 / SPD();
  setTimeout(() => { heroes.forEach(healHero); updateFront(); updateHud(); }, 2000 / SPD());
  save();
}

// ============================================================
// UI / 상점 바
// ============================================================
function locLabel() { const p = state.prog; if (p.route > ROUTES_PER_REGION) return `${regionName(p.region)} · 챔피언`; if (p.wave > WAVES_PER_ROUTE) return `${regionName(p.region)} · R${p.route} 보스`; return `${regionName(p.region)} · R${p.route} · ${p.wave}/${WAVES_PER_ROUTE}`; }
function updateHud() {
  $('gold').textContent = fmt(state.gold);
  $('loc').textContent = locLabel(); $('badges').textContent = state.prog.badges;
  const pn = $('party-n'); if (pn) pn.textContent = state.party.length;
  const pm = $('party-max'); if (pm) pm.textContent = maxParty();
  if (panelOpen === 'map') renderRoadmap();
  updateShop();
}
let bannerT = null;
function banner(text) { const b = $('banner'); b.textContent = text; b.classList.remove('hidden'); clearTimeout(bannerT); bannerT = setTimeout(() => b.classList.add('hidden'), 2000); logEvent(text); }
function logEvent(text) { const l = $('log'); if (!l) return; const d = document.createElement('div'); d.className = 'logline'; d.textContent = text; l.prepend(d); while (l.children.length > 4) l.lastChild.remove(); }
function costs() { return { atk: Math.round(10 * Math.pow(1.55, state.up.atk)), hp: Math.round(10 * Math.pow(1.55, state.up.hp)), spd: Math.round(12 * Math.pow(1.65, state.up.spd)) }; }
function updateShop() {
  const c = costs();
  ['atk', 'hp', 'spd'].forEach((k) => { const e = $('cost-' + k); if (e) e.textContent = fmt(c[k]); });
  ['atk', 'hp', 'spd'].forEach((k) => { const e = $('lv-' + k); if (e) e.textContent = state.up[k]; });
  document.querySelectorAll('.up').forEach((b) => { const k = b.dataset.up; if (c[k] != null) b.classList.toggle('cant', state.gold < c[k]); });
}
function buy(kind) {
  const c = costs(); if (c[kind] == null) return;
  if (state.gold < c[kind]) { banner('골드가 부족해요'); return; }
  state.gold -= c[kind];
  if (kind === 'atk') state.up.atk++;
  else if (kind === 'hp') { state.up.hp++; heroes.forEach((h) => { h.hp = mMaxHp(h.member); updateHeroBar(h); }); }
  else if (kind === 'spd') state.up.spd++;
  const btn = document.querySelector(`.up[data-up="${kind}"]`);
  if (btn) { btn.classList.remove('flash'); void btn.offsetWidth; btn.classList.add('flash'); }
  updateHud(); save();
}

// ============================================================
// 패널
// ============================================================
function openPanel(which) { panelOpen = which; $('panel').classList.remove('hidden'); renderPanel(); }
function closePanel() { panelOpen = null; $('panel').classList.add('hidden'); stopGachaHold(); }
function renderPanel() {
  if (panelOpen === 'party') renderRoster();
  else if (panelOpen === 'dex') renderDex();
  else if (panelOpen === 'bag') renderBag();
  else if (panelOpen === 'shop') renderShop();
  else if (panelOpen === 'map') renderRoadmap();
}

// ---------- 🦸 파티 · 기술 세팅 ----------
function moveTypeChip(t) { return `<span class="tchip" style="background:${typeColor(t)}">${krType(t)}</span>`; }
function renderRoster() {
  $('panel-title').textContent = `🦸 파티 · 기술 세팅`;
  pendingRelease = null;   // 멤버 목록 다시 그릴 때 개별 방생 확인 해제
  const body = $('panel-body');
  const slotsN = maxParty();
  // 파티 슬롯
  let partyHtml = '<div class="rsec">파티 (' + state.party.length + '/' + slotsN + ')</div><div class="rrow">';
  for (let i = 0; i < slotsN; i++) {
    const m = state.party[i];
    if (m) { const sp = spOf(m); partyHtml += `<button class="rcard ${rosterSel === m ? 'sel' : ''}" data-party="${i}"><img src="${sp.sprites.front}" data-fb="${sp.sprites.art || staticUrl(sp)}" alt=""><span>${sp.name}</span><small>Lv.${m.lv}</small></button>`; }
    else partyHtml += `<div class="rcard empty">＋<small>빈 슬롯</small></div>`;
  }
  partyHtml += '</div>';
  // 벤치(도감순/레벨순 정렬) + 다중 선택 방생
  const benchSorted = state.bench.slice().sort(benchSort === 'level'
    ? (a, b) => b.lv - a.lv || BY_EN[a.en].id - BY_EN[b.en].id
    : (a, b) => BY_EN[a.en].id - BY_EN[b.en].id || b.lv - a.lv);
  const benchTools = state.bench.length ? `<span class="bench-tools"><button class="bsort ${benchSort === 'dex' ? 'on' : ''}" data-bsort="dex">도감순</button><button class="bsort ${benchSort === 'level' ? 'on' : ''}" data-bsort="level">레벨순</button><button class="bench-release ${releaseMode ? 'arm' : ''}" id="bench-relmode">${releaseMode ? '✖ 선택 취소' : '🗑 선택 방생'}</button></span>` : '';
  let benchHtml = '<div class="rsec">보유 포켓몬 (벤치 ' + state.bench.length + '/' + BENCH_MAX + ')' + benchTools + '</div>';
  benchHtml += `<div class="bench-bonus">🎈 방생 누적 <b>${state.released || 0}</b>마리 → 보스·챔피언 포획 확률 <b>+${(releaseBonus() * 100).toFixed(1)}%</b> (영구 · 최대 +6%)</div>`;
  if (releaseMode) benchHtml += `<div class="rctrl"><button class="rmove rel ${releaseSel.size ? '' : 'off'}" id="bench-relgo">👋 선택한 ${releaseSel.size}마리 놓아주기</button></div>`;
  benchHtml += state.bench.length ? '<div class="rrow wrap">' + benchSorted.map((m, i) => { const sp = spOf(m); const picked = releaseMode && releaseSel.has(m); return `<button class="rcard sm ${picked ? 'relpick' : (rosterSel === m ? 'sel' : '')}" data-bench="${i}">${picked ? '<span class="pickmark">✓</span>' : ''}<img src="${sp.sprites.front}" data-fb="${sp.sprites.art || staticUrl(sp)}" alt=""><span>${sp.name}</span><small>Lv.${m.lv}</small></button>`; }).join('') + '</div>'
    : '<div class="dex-sum">야생 포켓몬을 처치하면 일정 확률로 잡혀서 여기 모입니다.</div>';
  const controls = '<div class="rctrl"><button class="rmove" id="auto-all">✨ 파티 전체 자동 (장비 + 기술)</button></div>';
  // 선택 정보(roster-detail)를 벤치 위에 배치 — 파티 누르면 바로 위에서 보임
  body.innerHTML = partyHtml + controls + '<div id="roster-detail"></div>' + benchHtml;

  body.querySelectorAll('[data-party]').forEach((b) => b.addEventListener('click', () => { const mem = state.party[+b.dataset.party]; rosterSel = (rosterSel === mem) ? null : mem; renderRoster(); }));   // 다시 누르면 정보창 닫힘
  body.querySelectorAll('[data-bench]').forEach((b) => b.addEventListener('click', () => {
    const mem = benchSorted[+b.dataset.bench];
    if (releaseMode) { if (releaseSel.has(mem)) releaseSel.delete(mem); else releaseSel.add(mem); renderRoster(); }
    else { rosterSel = (rosterSel === mem) ? null : mem; renderRoster(); }   // 다시 누르면 정보창 닫힘
  }));
  body.querySelectorAll('[data-bsort]').forEach((b) => b.addEventListener('click', () => { benchSort = b.dataset.bsort; renderRoster(); }));
  const rm = $('bench-relmode'); if (rm) rm.addEventListener('click', () => { releaseMode = !releaseMode; if (!releaseMode) releaseSel.clear(); renderRoster(); });
  const rg = $('bench-relgo'); if (rg && !rg.classList.contains('off')) rg.addEventListener('click', releaseSelected);
  const aa = $('auto-all'); if (aa) aa.addEventListener('click', () => { autoAllParty(); renderRoster(); });
  renderRosterDetail();
}
function renderRosterDetail() {
  const wrap = $('roster-detail'); if (!wrap) return;
  const m = rosterSel; if (!m) { wrap.innerHTML = '<div class="dex-sum">포켓몬을 선택하면 능력치·기술 4개·기술머신을 세팅할 수 있어요.</div>'; return; }
  ensureMember(m);
  const sp = spOf(m);
  const inParty = state.party.includes(m);
  const moveBtn = inParty
    ? (state.party.length > 1 ? `<button class="rmove" data-tobench="1">↓ 벤치로</button>` : `<span class="dex-sum">마지막 파티원은 뺄 수 없어요</span>`)
    : (state.party.length < maxParty() ? `<button class="rmove" data-toparty="1">↑ 파티에 넣기</button>` : `<span class="dex-sum">파티가 가득 참</span>`);
  // 능력치
  const stats = `<div class="statline">공격 <b>${physAtk(m)}</b> · 방어 <b>${physDef(m)}</b> · 특공 <b>${specAtk(m)}</b> · 특방 <b>${specDef(m)}</b> · 속도 <b>${statAt(sp.stats.spe, m.lv)}</b> · HP <b>${mMaxHp(m)}</b></div><div class="statline">⚔ 전투력 <b style="color:var(--gold)">${fmt(memberDPS(m))}</b>/초</div>`;
  // 세팅된 기술 4개
  const activeHtml = `<div class="rsub">세팅 기술 (${m.active.length}/4) <button class="miniauto" data-automoves="1">✨ 자동</button><small class="auto-note">배운 기술 중에서만 (기술머신 제외)</small></div><div class="movegrid">` +
    [0, 1, 2, 3].map((i) => { const k = m.active[i]; if (!k) return `<div class="mvslot empty">비어있음</div>`; const mv = MOVES[k]; return `<div class="mvslot" style="border-color:${typeColor(mv.type)}"><b>${mv.kr}</b><small>${moveTypeChip(mv.type)} ${isBuff(k) ? '강화' : (mv.dclass === 'physical' ? '물리' : '특수') + ' 위력' + mv.power + ' · 명중' + (mv.acc || 100)}</small></div>`; }).join('') + '</div>';
  // 배운 기술(토글)
  const learnedHtml = `<div class="rsub">배운 기술 (클릭해서 4개 세팅)</div><div class="chips">` +
    m.learned.filter((k) => MOVES[k]).sort((a, b) => MOVES[b].power - MOVES[a].power).map((k) => { const mv = MOVES[k]; const on = m.active.includes(k); return `<button class="mchip ${on ? 'on' : ''}" data-toggle="${k}" style="border-color:${typeColor(mv.type)}">${mv.kr} <small>${isBuff(k) ? '강화' : '위' + mv.power + '·명' + (mv.acc || 100)}</small></button>`; }).join('') + '</div>';
  // TM 학습
  const teachable = TM_POOL.filter((k) => (state.tms[k] || 0) > 0 && tmLearnable(m.en).includes(k) && !m.learned.includes(k));
  const tmHtml = `<div class="rsub">기술머신 (보유 TM으로 학습)</div>` + (
    Object.keys(state.tms).filter((k) => state.tms[k] > 0).length
      ? '<div class="chips">' + Object.keys(state.tms).filter((k) => state.tms[k] > 0).map((k) => {
        const mv = MOVES[k]; const canTeach = tmLearnable(m.en).includes(k) && !m.learned.includes(k);
        return `<button class="mchip tm ${canTeach ? '' : 'off'}" data-teach="${k}" style="border-color:${typeColor(mv.type)}">💿 ${mv.kr} <small>위${mv.power}·명${mv.acc || 100}</small> ×${state.tms[k]} ${m.learned.includes(k) ? '(보유중)' : canTeach ? '' : '(불가)'}</button>`;
      }).join('') + '</div>'
      : '<div class="dex-sum">기술머신이 없어요. 전투에서 💿 드롭으로 얻으세요.</div>');

  // 진화의 돌
  const evoMap = STONE_EVO[m.en];
  const stoneHtml = evoMap ? `<div class="rsub">진화의 돌</div><div class="chips">` +
    Object.keys(evoMap).map((st) => { const have = state.items[st] || 0; return `<button class="mchip ${have > 0 ? '' : 'off'}" data-stone="${st}" style="border-color:#ffae34">💎 ${CONSUM[st].name} ×${have} → ${BY_EN[evoMap[st]].name}</button>`; }).join('') + `</div>` : '';

  // 진화(이미 레벨 넘긴 경우 수동 진화) + 방생
  const evoTo = evoTargetOf(m);
  const evoBtn = evoTo ? `<button class="rmove evo" data-evolve="1">✨ 진화 → ${BY_EN[evoTo].name}</button>` : '';
  const relBtn = `<button class="rmove rel" data-release="1">${pendingRelease === m ? '⚠ 정말? 다시 클릭' : '👋 놓아주기'}</button>`;
  const ctrl = `<div class="rdetail-ctrl">${evoBtn}${relBtn}</div>`;

  wrap.innerHTML = `<div class="rdetail"><div class="rhead"><img src="${sp.sprites.art || sp.sprites.front}" data-fb="${staticUrl(sp)}" alt=""><div><div class="rname">${sp.name} <small>Lv.${m.lv}</small></div><div>${sp.types.map(moveTypeChip).join('')}</div></div><div class="ractions">${moveBtn}</div></div>${stats}${ctrl}${activeHtml}${learnedHtml}${tmHtml}${stoneHtml}</div>`;

  const ev = wrap.querySelector('[data-evolve]'); if (ev) ev.addEventListener('click', () => manualEvolve(m));
  const rl = wrap.querySelector('[data-release]'); if (rl) rl.addEventListener('click', () => releaseMember(m));
  const tb = wrap.querySelector('[data-tobench]'); if (tb) tb.addEventListener('click', () => toBench(m));
  const tp = wrap.querySelector('[data-toparty]'); if (tp) tp.addEventListener('click', () => toParty(m));
  const am = wrap.querySelector('[data-automoves]'); if (am) am.addEventListener('click', () => { autoSetMoves(m); renderRosterDetail(); save(); banner('✨ 기술 자동세팅'); });
  wrap.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', () => toggleActive(m, b.dataset.toggle)));
  wrap.querySelectorAll('[data-teach]').forEach((b) => b.addEventListener('click', () => { if (!b.classList.contains('off')) teachTM(m, b.dataset.teach); }));
  wrap.querySelectorAll('[data-stone]').forEach((b) => b.addEventListener('click', () => { if (!b.classList.contains('off')) evolveByStone(m, b.dataset.stone); }));
}
function toggleActive(m, key) {
  if (!m.learned.includes(key)) return;
  const i = m.active.indexOf(key);
  if (i >= 0) { if (m.active.length <= 1) { banner('최소 1개는 세팅돼야 해요'); return; } m.active.splice(i, 1); }
  else { if (m.active.length >= 4) { banner('기술은 4개까지'); return; } m.active.push(key); }
  renderRosterDetail(); save();
}
function teachTM(m, key) {
  if ((state.tms[key] || 0) <= 0 || m.learned.includes(key) || !tmLearnable(m.en).includes(key)) return;
  state.tms[key]--; m.learned.push(key);
  if (m.active.length < 4) m.active.push(key);
  banner(`💿 ${spOf(m).name} [${MOVES[key].kr}] 학습!`);
  renderRoster(); save();
}
function unequipAllToInv(m) {   // 장착 도구를 모두 보유 도구(가방)로 회수
  if (!m || !m.equip) return 0;
  let n = 0;
  for (const s of ['main', 'boost', 'tech']) { if (m.equip[s]) { state.inv.push(m.equip[s]); m.equip[s] = null; n++; } }
  return n;
}
function toBench(m) {
  if (!state.party.includes(m) || state.party.length <= 1) return;
  const n = unequipAllToInv(m);   // 벤치로 내리면 장비는 자동으로 가방에 회수
  state.party = state.party.filter((x) => x !== m); state.bench.push(m);
  renderParty(); renderRoster(); updateHud(); save();
  banner(n ? `${spOf(m).name} 벤치로 — 장비 ${n}개 가방 회수` : `${spOf(m).name} 벤치로 이동`);
}
function releaseSelected() {
  if (!releaseSel.size) return;
  const n = releaseSel.size;
  releaseSel.forEach((m) => unequipAllToInv(m));   // 방생 전 장비 회수(분실 방지)
  state.bench = state.bench.filter((m) => !releaseSel.has(m));
  if (rosterSel && releaseSel.has(rosterSel)) rosterSel = null;
  releaseSel.clear(); releaseMode = false;
  state.released = (state.released || 0) + n;
  banner(`👋 ${n}마리를 놓아줬어요 · 방생보너스 +${(releaseBonus() * 100).toFixed(1)}%`);
  renderParty(); renderRoster(); updateHud(); save();
}
function releaseMember(m) {
  const inParty = state.party.includes(m);
  if (inParty && state.party.length <= 1) { banner('마지막 파티원은 놓아줄 수 없어요'); pendingRelease = null; renderRosterDetail(); return; }
  if (pendingRelease !== m) { pendingRelease = m; renderRosterDetail(); return; }   // 1차 클릭=확인 무장
  pendingRelease = null;
  unequipAllToInv(m);   // 방생 전 장비 회수(분실 방지)
  if (inParty) state.party = state.party.filter((x) => x !== m); else state.bench = state.bench.filter((x) => x !== m);
  if (rosterSel === m) rosterSel = null;
  state.released = (state.released || 0) + 1;
  banner(`👋 ${spOf(m).name}을(를) 놓아줬어요 · 방생보너스 +${(releaseBonus() * 100).toFixed(1)}%`);
  renderParty(); renderRoster(); updateHud(); save();
}
function toParty(m) {
  if (state.party.length >= maxParty()) { banner('파티가 가득 찼어요'); return; }
  state.bench = state.bench.filter((x) => x !== m); state.party.push(m);
  renderParty(); renderRoster(); updateHud(); save();
}

function renderDex() {
  const kills = state.dex.kills, ens = Object.keys(kills).sort((a, b) => BY_EN[a].id - BY_EN[b].id);
  $('panel-title').textContent = `📖 도감 수집`;
  const sum = `<div class="dex-sum">수집 <b>${uniqueSpecies()}</b>종 · 마스터(100킬) <b>${masteredCount()}</b>종<br>골드 <b>+${(collectionGold() * 100).toFixed(1)}%</b> · 마스터 공격 <b>+${((masteryAtk() - 1) * 100).toFixed(0)}%</b></div>`;
  const grid = ens.length ? `<div class="dexgrid">${ens.map((en) => { const sp = BY_EN[en], k = kills[en], master = k >= 100; return `<div class="dcell ${master ? 'master' : ''}">${master ? '<span class="dstar">🌟</span>' : ''}<img src="${sp.sprites.front}" data-fb="${sp.sprites.art || staticUrl(sp)}" alt="" loading="lazy"><div class="dn">${sp.name}</div><div class="dk">${k >= 100 ? 'MAX' : k}</div></div>`; }).join('')}</div>` : '<div class="dex-sum">아직 처치한 포켓몬이 없어요.</div>';
  $('panel-body').innerHTML = sum + grid;
}

// ---------- 🗺 로드맵 (진행 구조) ----------
function rmNextGoal() {
  const p = state.prog;
  if (p.route > ROUTES_PER_REGION) return `다음 목표: ${regionName(p.region)} 챔피언 ${champName(p.region)} 격파 → ${regionName(p.region + 1)} 입성 (🎖배지 +1)`;
  if (p.wave > WAVES_PER_ROUTE) return `다음 목표: R${p.route} 보스 격파 → R${p.route + 1}`;
  return `다음 목표: R${p.route} ${p.wave}/${WAVES_PER_ROUTE} 클리어 → R${p.route} 보스`;
}
function renderRoadmap() {
  const p = state.prog;
  $('panel-title').textContent = `🗺 로드맵 · 🎖${p.badges}`;
  const maxR = Math.max(REGIONS.length - 1, p.region);
  let html = `<div class="rm-now">📍 현재 <b>${locLabel()}</b><div class="rm-goal">${rmNextGoal()}</div></div><div class="rm-list">`;
  for (let r = 0; r <= maxR; r++) {
    const rst = p.region > r ? 'done' : p.region === r ? 'cur' : 'todo';
    const rico = rst === 'done' ? '✅' : rst === 'cur' ? '▶️' : '🔒';
    html += `<div class="rm-region ${rst}"><div class="rm-rhead"><span>${rico} ${r + 1}. ${regionName(r)}</span><span class="rm-champ">🏆 ${champName(r)}</span></div><div class="rm-routes">`;
    for (let rt = 1; rt <= ROUTES_PER_REGION; rt++) {
      const routeDone = p.region > r || (p.region === r && p.route > rt);
      const routeCur = p.region === r && p.route === rt;
      let dots = '';
      for (let w = 1; w <= WAVES_PER_ROUTE; w++) {
        const wd = routeDone || (routeCur && p.wave > w);
        const wc = routeCur && p.wave === w && p.wave <= WAVES_PER_ROUTE;
        dots += `<i class="rm-w ${wd ? 'd' : wc ? 'c' : ''}"></i>`;
      }
      const bd = routeDone, bc = routeCur && p.wave > WAVES_PER_ROUTE;
      html += `<div class="rm-route ${routeDone ? 'done' : routeCur ? 'cur' : 'todo'}"><span class="rm-rn">R${rt}</span><span class="rm-dots">${dots}</span><span class="rm-boss ${bd ? 'd' : bc ? 'c' : ''}" title="루트 보스">👑</span></div>`;
    }
    const cd = p.region > r, cc = p.region === r && p.route > ROUTES_PER_REGION;
    html += `</div><div class="rm-champline ${cd ? 'done' : cc ? 'cur' : 'todo'}">${cd ? '✅' : cc ? '🏆' : '🔒'} 챔피언전 — 승리 시 🎖배지 +1 · 다음 지방</div></div>`;
  }
  html += `</div><div class="rm-info">🔸 지방이 오를수록 적 체력 ×1.9·보상도 비례 증가 · 🔸 챔피언 격파 = 🎖배지(파티 공격·체력 +8%/개) · 🔸 ●=클리어 ◐=진행중 ○=대기</div>`;
  $('panel-body').innerHTML = html;
}

// ---------- 가방 / 장비 ----------
function refreshHeroStats() { heroes.forEach((h) => { h.hp = Math.min(h.hp, mMaxHp(h.member)); updateHeroBar(h); }); }
function renderBag() {
  $('panel-title').textContent = `🎒 장비`;
  const body = $('panel-body');
  if (bagSel >= state.party.length) bagSel = 0;
  const m = state.party[bagSel]; ensureMember(m);
  const rcol = (it) => ['#b8c4d0', '#b8c4d0', '#3fa9ff', '#b46cff', '#ffae34'][defOf(it.key).rare] || '#b8c4d0';

  // 소모품(자동) 보유 스트립
  const cons = Object.keys(CONSUM).filter((k) => (state.items[k] || 0) > 0);
  const consStr = cons.length ? cons.map((k) => `<span class="cons" title="${CONSUM[k].name} — ${CONSUM[k].desc}"><img src="${ITEM_ICON(k)}" alt="">${state.items[k]}</span>`).join('') : '<span class="cons-none">없음</span>';

  // 파티 장비 한눈에
  const overview = state.party.map((mm, i) => {
    const sp = spOf(mm); ensureMember(mm);
    const slots = SLOT_META.map((s) => { const it = mm.equip[s.key]; return it
      ? `<span class="eqslot" style="border-color:${rcol(it)}"><img src="${ITEM_ICON(it.key)}" alt="" title="${defOf(it.key).name} ${starStr(it.star)}"></span>`
      : `<span class="eqslot empty">${s.icon}</span>`; }).join('');
    return `<button class="eqcard ${i === bagSel ? 'sel' : ''}" data-m="${i}"><img class="eqmon" src="${sp.sprites.front}" data-fb="${sp.sprites.art || staticUrl(sp)}" alt=""><div class="eqname">${sp.name} <small>Lv.${mm.lv}</small></div><div class="eqslots">${slots}</div></button>`;
  }).join('');

  // 선택 멤버 큰 슬롯
  const slotRow = SLOT_META.map((s) => {
    const it = m.equip[s.key];
    if (it) return `<button class="slot filled" data-uneq="${s.key}" style="border-color:${rcol(it)}"><img class="s-img" src="${ITEM_ICON(it.key)}" alt=""><span class="s-info"><b>${defOf(it.key).name} <span class="star" style="color:${starColor(it.star)}">${starStr(it.star)}</span></b><small>[${s.name}] ${gearLabel(it)} · 클릭 해제</small></span></button>`;
    return `<div class="slot empty"><span class="s-ico">${s.icon}</span><span class="s-info"><b>${s.name} 슬롯</b><small>비어 있음 — 아래 목록에서 장착</small></span></div>`;
  }).join('');

  // 보유 도구 (분류 필터)
  const groups = {};
  state.inv.forEach((it) => { if (bagFilter !== 'all' && defOf(it.key).cat !== bagFilter) return; const g = it.key + '@' + it.star; (groups[g] = groups[g] || { key: it.key, star: it.star, n: 0 }).n++; });
  // 정렬: 슬롯 → 같은 도구끼리(key) → 별 높은 순
  const arr = Object.values(groups).sort((a, b) => SLOT_META.findIndex((s) => s.key === defOf(a.key).cat) - SLOT_META.findIndex((s) => s.key === defOf(b.key).cat) || a.key.localeCompare(b.key) || b.star - a.star);
  const filterBar = '<div class="bagfilter">' + [['all', '전체'], ['main', '🔮메인'], ['boost', '💠강화'], ['tech', '🎯정밀']].map(([k, n]) => `<button class="bfbtn ${bagFilter === k ? 'on' : ''}" data-filter="${k}">${n}</button>`).join('') + '</div>';
  const itemRow = (g) => {
    const d = defOf(g.key), sample = { key: g.key, star: g.star }, canFuse = g.n >= 3, rate = Math.round(fuseRate(g.star) * 100);
    return `<div class="invrow" style="border-left-color:${rcol(sample)}"><img class="iv-img" src="${ITEM_ICON(g.key)}" alt=""><span class="iv-main"><b>${d.name} <span class="star" style="color:${starColor(g.star)}">${starStr(g.star)}</span> ${g.n > 1 ? `<span class="cnt">×${g.n}</span>` : ''}</b><small>[${SLOT_META.find((s) => s.key === d.cat).name}] ${gearLabel(sample)}</small></span><button class="iv-eq" data-eq="${g.key}|${g.star}">장착</button><button class="iv-fuse ${canFuse ? '' : 'off'}" data-fuse="${g.key}|${g.star}" title="같은 도구 3개 → ★${g.star + 1} 강화 시도 (성공률 ${rate}%)">강화${canFuse ? ' ' + rate + '%' : ''}</button><button class="iv-sell" data-sell="${g.key}|${g.star}">💰${fmt(gearSell(sample))}</button></div>`;
  };
  let list;
  if (!arr.length) list = '<div class="dex-sum">아직 도구가 없어요. 전투 🎁 드롭이나 🛒 뽑기로 얻으세요.</div>';
  else if (bagFilter !== 'all') list = arr.map(itemRow).join('');
  else list = SLOT_META.map((s) => { const items = arr.filter((g) => defOf(g.key).cat === s.key); return items.length ? `<div class="invcat">${s.icon} ${s.name} <span>${items.length}종</span></div>` + items.map(itemRow).join('') : ''; }).join('');

  body.innerHTML = `
    <div class="bag-cons"><span class="bc-label">소모품(자동)</span>${consStr}</div>
    <div class="rsec">파티 장비 한눈에 — 카드 눌러 선택</div>
    <div class="eqrow">${overview}</div>
    <div class="rsec">▼ ${spOf(m).name} 장착 슬롯 (클릭=해제)</div>
    <div class="slots">${slotRow}</div>
    <div class="inv-h">보유 도구 <b>${state.inv.length}</b>/${INV_MAX}<button class="sellall fuseall" id="bag-fuseall">🔧 일괄 강화</button><button class="sellall auto" id="bag-auto">✨ 자동장착</button><button class="sellall auto" id="bag-autoall">✨ 전체</button></div>
    ${filterBar}
    <div class="invlist">${list}</div>`;

  body.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => { bagFilter = b.dataset.filter; renderBag(); }));
  body.querySelectorAll('.eqcard').forEach((b) => b.addEventListener('click', () => { bagSel = +b.dataset.m; renderBag(); }));
  const ae = $('bag-auto'); if (ae) ae.addEventListener('click', autoEquipOne);
  const aea = $('bag-autoall'); if (aea) aea.addEventListener('click', autoEquipAll);
  body.querySelectorAll('[data-uneq]').forEach((b) => b.addEventListener('click', () => unequipSlot(b.dataset.uneq)));
  body.querySelectorAll('[data-eq]').forEach((b) => b.addEventListener('click', () => equipGear(b.dataset.eq)));
  body.querySelectorAll('[data-fuse]').forEach((b) => b.addEventListener('click', () => { if (!b.classList.contains('off')) fuseGear(b.dataset.fuse); }));
  body.querySelectorAll('[data-sell]').forEach((b) => b.addEventListener('click', () => sellGear(b.dataset.sell)));
  const fa = $('bag-fuseall'); if (fa) fa.addEventListener('click', fuseAll);
}
function findInv(key, star) { return state.inv.findIndex((x) => x.key === key && x.star === star); }
function equipGear(tag) { const [key, star] = tag.split('|'); const idx = findInv(key, +star); if (idx < 0) return; const it = state.inv[idx], cat = defOf(key).cat, m = state.party[bagSel]; ensureMember(m); const prev = m.equip[cat]; m.equip[cat] = it; state.inv.splice(idx, 1); if (prev) state.inv.push(prev); refreshHeroStats(); renderParty(); renderBag(); updateHud(); save(); }
function unequipSlot(slotKey) { const m = state.party[bagSel]; ensureMember(m); const it = m.equip[slotKey]; if (!it) return; m.equip[slotKey] = null; state.inv.push(it); refreshHeroStats(); renderParty(); renderBag(); updateHud(); save(); }
function gearScore(it, member) {
  const d = defOf(it.key); let s = 0;
  const sp = member ? spOf(member) : null;
  const physMain = sp ? sp.stats.atk >= sp.stats.spa : true;   // 물리형이면 물리공격 장비 우대, 특수형이면 특수공격 우대
  for (const e in d.eff) {
    if (e === 'sash') s += 0.4;
    else if (e === 'typeBoost') s += effVal(it, e) * (sp && sp.types.includes(d.ptype) ? 1.6 : 0.15);
    else if (e === 'physAtk') s += effVal(it, e) * (physMain ? 1.0 : 0.15);
    else if (e === 'specAtk') s += effVal(it, e) * (physMain ? 0.15 : 1.0);
    else if (e === 'offMult') s += effVal(it, e);
    else if (e === 'reduce') s += effVal(it, e) * (member && canEvolveMore(member.en) ? 1.5 : 0.02);   // 미진화에게만 가치
    else if (e === 'acc') s += effVal(it, e) * 0.6;   // 명중은 상황적
    else if (e === 'sludge') s += (sp && sp.types.includes('poison')) ? effVal(it, e) * 1.4 : -1;   // 독타입에만, 그외엔 회피
    else if (e === 'regen') s += effVal(it, e) * 1.1;
    else s += effVal(it, e);
  }
  return s;
}
function autoEquip(member) {
  ensureMember(member);
  for (const cat of ['main', 'boost', 'tech']) {
    let bestScore = member.equip[cat] ? gearScore(member.equip[cat], member) : -1, bestIdx = -1;
    state.inv.forEach((it, i) => { if (defOf(it.key).cat === cat) { const sc = gearScore(it, member); if (sc > bestScore) { bestScore = sc; bestIdx = i; } } });
    if (bestIdx >= 0) { const prev = member.equip[cat]; member.equip[cat] = state.inv[bestIdx]; state.inv.splice(bestIdx, 1); if (prev) state.inv.push(prev); }
  }
}
function autoEquipOne() { autoEquip(state.party[bagSel]); refreshHeroStats(); renderParty(); renderBag(); updateHud(); save(); banner('✨ 최적 장비 장착 완료'); }
function autoEquipAll() { state.party.forEach(autoEquip); refreshHeroStats(); renderParty(); renderBag(); updateHud(); save(); banner('✨ 파티 전체 최적 장착!'); }
// 18타입 — 공격 타입의 '커버리지'(여러 적 타입에 굉장히 효과적인 정도) 계산용
const ALL_TYPES = ['normal', 'fire', 'water', 'electric', 'grass', 'ice', 'fighting', 'poison', 'ground', 'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy'];
const _typeCov = {};
function typeCoverage(t) {   // 모든 타입 대비 평균 상성(>1이면 약점을 잘 찌름, 노말은 ~0.94)
  if (_typeCov[t] != null) return _typeCov[t];
  let sum = 0; for (const d of ALL_TYPES) sum += typeEffect(t, [d]);
  return (_typeCov[t] = sum / ALL_TYPES.length);
}
// 기술 점수 = 기대 데미지(DPS 근사): 물리/특수 중 센 스탯 × 위력 × 자속(1.5) × 명중률 × 타입커버리지
//   노말 등 '굉장히 효과적' 상대가 없는 타입은 커버리지가 낮아 자동세팅에서 후순위가 됨
function moveScore(m, key) {
  const mv = MOVES[key]; if (!mv || isBuff(key) || !mv.power) return -1;
  const off = mv.dclass === 'physical' ? physAtk(m) : specAtk(m);
  const stab = spOf(m).types.includes(mv.type) ? 1.5 : 1;
  return off * mv.power * stab * ((mv.acc || 100) / 100) * typeCoverage(mv.type);
}
// 기술 자동세팅: ①배울 수 있는 보유 TM 중 강하면 자동 학습 ②서로 다른 타입 3개(타점 다양화) + 변화기 1칸
function autoSetMoves(m) {
  ensureMember(m);
  // 이미 '배운 기술' 중에서만 세팅 — 기술머신(TM)은 자동으로 배우거나 소모하지 않음(수동 학습)
  // 타입별 '최고 점수 기술'을 뽑고, 그중 점수 상위 3개(서로 다른 타입)로 타점 다양화
  const dmgKeys = m.learned.filter((k) => !isBuff(k) && MOVES[k] && MOVES[k].power);
  const bestPerType = {};
  for (const k of dmgKeys) { const t = MOVES[k].type, sc = moveScore(m, k); if (!bestPerType[t] || sc > bestPerType[t].sc) bestPerType[t] = { k, sc }; }
  let chosen = Object.values(bestPerType).sort((a, b) => b.sc - a.sc).slice(0, 3).map((x) => x.k);
  // 서로 다른 타입이 3개 미만이면 다음 점수로 채움
  if (chosen.length < 3) for (const k of dmgKeys.filter((k) => !chosen.includes(k)).sort((a, b) => moveScore(m, b) - moveScore(m, a))) { chosen.push(k); if (chosen.length >= 3) break; }
  // 변화기 1칸(있으면), 없으면 데미지 1개 더
  const buff = m.learned.find(isBuff);
  if (buff) chosen.push(buff);
  else { const extra = dmgKeys.filter((k) => !chosen.includes(k)).sort((a, b) => moveScore(m, b) - moveScore(m, a))[0]; if (extra) chosen.push(extra); }
  m.active = chosen.length ? chosen : m.learned.slice(0, 4);
}
function autoAllMember(m) { autoEquip(m); autoSetMoves(m); }
function autoAllParty() { state.party.forEach(autoAllMember); refreshHeroStats(); renderParty(); save(); banner('✨ 파티 전체 자동(장비·기술) 완료!'); }
// 강화 확률: ★이 높을수록 성공률 감소 (★1→2 95% … ★5→6 67% … 최저 15%)
function fuseRate(star) { return clamp(0.95 - (star - 1) * 0.07, 0.15, 0.95); }
function fuseGear(tag) {
  const [key, star] = tag.split('|'); const st = +star;
  let removed = 0;
  for (let i = state.inv.length - 1; i >= 0 && removed < 3; i--) if (state.inv[i].key === key && state.inv[i].star === st) { state.inv.splice(i, 1); removed++; }
  if (removed < 3) { banner('재료 부족(3개)'); return; }
  const rate = fuseRate(st);
  if (Math.random() < rate) {
    addGear({ uid: 'g' + (++state.itemSeq), key, star: st + 1 });
    banner(`🔧 강화 성공! ${defOf(key).name} ${starStr(st + 1)} (${Math.round(rate * 100)}%)`);
  } else {
    addGear({ uid: 'g' + (++state.itemSeq), key, star: st });   // 실패: 1개 소실(2개→1개)
    addGear({ uid: 'g' + (++state.itemSeq), key, star: st });
    banner(`💥 강화 실패… ${defOf(key).name} ${starStr(st)} (1개 소실, 성공률 ${Math.round(rate * 100)}%)`);
  }
  renderBag(); updateHud(); save();
}
function sellGear(tag) { const [key, star] = tag.split('|'); const idx = findInv(key, +star); if (idx < 0) return; const it = state.inv[idx], price = gearSell(it); state.gold += price; state.inv.splice(idx, 1); banner(`💰 ${defOf(key).name} 판매 +${fmt(price)}`); renderBag(); updateHud(); save(); }
function sellJunk() { let t = 0, n = 0; state.inv = state.inv.filter((it) => { if (it.star <= 1 && defOf(it.key).rare <= 1) { t += gearSell(it); n++; return false; } return true; }); if (n) { state.gold += t; banner(`🧹 잡템 ${n}개 +${fmt(t)}`); } else banner('★1 잡템 없음'); renderBag(); updateHud(); save(); }
// 일괄 강화: 같은 도구 3개씩 확률 강화를 더 못 할 때까지 반복(실패 시 1개 소실 → 자연 수렴)
function fuseAll() {
  let succ = 0, fail = 0, guard = 0;
  while (guard++ < 20000) {
    const groups = {};
    for (const it of state.inv) { const g = it.key + '@' + it.star; (groups[g] = groups[g] || { key: it.key, star: it.star, n: 0 }).n++; }
    let did = false;
    for (const g of Object.values(groups)) {
      if (g.n >= 3) {
        let removed = 0;
        state.inv = state.inv.filter((it) => { if (removed < 3 && it.key === g.key && it.star === g.star) { removed++; return false; } return true; });
        if (Math.random() < fuseRate(g.star)) { state.inv.push({ uid: 'g' + (++state.itemSeq), key: g.key, star: g.star + 1 }); succ++; }
        else { for (let k = 0; k < 2; k++) state.inv.push({ uid: 'g' + (++state.itemSeq), key: g.key, star: g.star }); fail++; }
        did = true;
      }
    }
    if (!did) break;
  }
  if (succ || fail) banner(`🔧 일괄 강화: 성공 ${succ} · 실패 ${fail}`); else banner('강화할 도구(같은 종류 3개)가 없어요');
  renderBag(); updateHud(); save();
}

// ---------- 상점 ----------
function renderShop() {
  $('panel-title').textContent = `🛒 상점   💰${fmt(state.gold)}`;
  const region = state.prog.region, gachaCost = Math.round(80 * Math.pow(1.6, region)), premCost = gachaCost * 6;
  const c10 = Math.round(gachaCost * 9), p10 = Math.round(premCost * 9);   // 10연차 = 10% 할인
  const full = invFull();
  const cap = `<div class="shop-cap ${full ? 'full' : ''}">🎒 보유 도구 <b>${state.inv.length}</b> / ${INV_MAX}${full ? ' · 가득 참! 강화·판매로 정리하세요' : ''}</div>`;
  const pulls = lastPulls.length
    ? `<div class="shop-sec">최근 뽑기 결과 <button class="pull-clear" id="pull-clear">지우기</button></div><div class="pull-res">` +
      lastPulls.slice(0, 24).map((it) => `<span class="pull-chip" style="border-color:${starColor(it.star)}"><img src="${ITEM_ICON(it.key)}" alt=""><b>${defOf(it.key).name}</b> <span style="color:${starColor(it.star)}">${starStr(it.star)}</span></span>`).join('') + `</div>`
    : '';
  $('panel-body').innerHTML = cap + `<div class="shop-sec">도구 뽑기</div>
    <div class="shoprow"><span class="sh-ico">🎁</span><span class="sh-main"><b>도구 뽑기</b><small>무작위 포켓몬 도구 1개</small></span><button class="sh-buy" data-shop="gacha">💰 ${fmt(gachaCost)}</button></div>
    <div class="shoprow"><span class="sh-ico">🎁</span><span class="sh-main"><b>도구 10연차</b><small>10개 한번에 · 10% 할인</small></span><button class="sh-buy" data-shop="gacha10">💰 ${fmt(c10)}</button></div>
    <div class="shoprow"><span class="sh-ico">✨</span><span class="sh-main"><b>고급 뽑기</b><small>높은 ★ 확률↑</small></span><button class="sh-buy" data-shop="prem">💰 ${fmt(premCost)}</button></div>
    <div class="shoprow"><span class="sh-ico">✨</span><span class="sh-main"><b>고급 10연차</b><small>10개 · 높은 ★ · 10% 할인</small></span><button class="sh-buy" data-shop="prem10">💰 ${fmt(p10)}</button></div>` + pulls;
  // 꾹 누르면 연속 구매(홀드), 한 번 탭이면 1회
  $('panel-body').querySelectorAll('.sh-buy').forEach((b) => b.addEventListener('pointerdown', (e) => { if (e.button && e.button !== 0) return; e.preventDefault(); startGachaHold(b.dataset.shop); }));
  const pc = $('pull-clear'); if (pc) pc.addEventListener('click', () => { lastPulls = []; renderShop(); });
}
// 도구 뽑기 길게 누르기 = 연속 구매
function gachaCosts() {
  const region = state.prog.region, gachaCost = Math.round(80 * Math.pow(1.6, region)), premCost = gachaCost * 6;
  return { gachaCost, premCost, c10: Math.round(gachaCost * 9), p10: Math.round(premCost * 9) };
}
function shopCanBuy(act) {
  const c = gachaCosts();
  if (act === 'gacha' || act === 'prem') return state.gold >= (act === 'prem' ? c.premCost : c.gachaCost) && !invFull();
  if (act === 'gacha10' || act === 'prem10') return state.gold >= (act === 'prem10' ? c.p10 : c.c10) && (INV_MAX - state.inv.length) >= 10;
  return false;
}
let gachaHoldTimer = null, gachaHoldAct = null, gachaHoldN = 0;
function gachaHoldTick() {
  if (!gachaHoldAct) return;
  if (gachaHoldN > 0 && !shopCanBuy(gachaHoldAct)) { stopGachaHold(); return; }   // 연속 중 소진/가득 → 정지
  shopAction(gachaHoldAct, gachaCosts());                                          // 첫 틱은 무조건(불가 시 사유 배너)
  gachaHoldN++;
  if (!shopCanBuy(gachaHoldAct)) stopGachaHold();                                  // 방금 구매로 소진 → 정지
}
function startGachaHold(act) {
  stopGachaHold();
  gachaHoldAct = act; gachaHoldN = 0;
  gachaHoldTick();                                                                 // 즉시 1회(탭)
  if (gachaHoldAct) gachaHoldTimer = setInterval(gachaHoldTick, 180);              // 누르는 동안 반복
}
function stopGachaHold() { gachaHoldAct = null; if (gachaHoldTimer) { clearInterval(gachaHoldTimer); gachaHoldTimer = null; } }
function shopAction(act, c) {
  if (act === 'gacha' || act === 'prem') {
    if (invFull()) { banner('🎒 가방이 가득 찼어요 — 강화/판매로 정리 후 구매하세요'); return; }   // 차감 전 차단
    const cost = act === 'prem' ? c.premCost : c.gachaCost; if (state.gold < cost) { banner('골드 부족'); return; }
    state.gold -= cost; const it = makeGear(state.prog.region, act === 'prem' ? 0.85 : 0.2); addGear(it);
    lastPulls.unshift({ key: it.key, star: it.star }); if (lastPulls.length > 40) lastPulls.length = 40;
    banner(`🎁 ${defOf(it.key).name} ${starStr(it.star)} 획득!`);   // banner가 로그도 남김
  } else if (act === 'gacha10' || act === 'prem10') {
    const free = INV_MAX - state.inv.length;
    if (free < 10) { banner(`🎒 10연차는 빈 슬롯 10칸 필요 (현재 ${Math.max(0, free)}칸) — 정리 후 구매`); return; }
    const prem = act === 'prem10', cost = prem ? c.p10 : c.c10; if (state.gold < cost) { banner('골드 부족'); return; }
    state.gold -= cost; const items = []; for (let i = 0; i < 10; i++) { const it = makeGear(state.prog.region, prem ? 0.85 : 0.2); addGear(it); items.push(it); lastPulls.unshift({ key: it.key, star: it.star }); }
    if (lastPulls.length > 40) lastPulls.length = 40;
    const byStar = {}; let best = items[0]; for (const it of items) { byStar[it.star] = (byStar[it.star] || 0) + 1; if (it.star > best.star) best = it; }
    const summary = Object.keys(byStar).sort((a, b) => b - a).map((s) => `${starStr(+s)}×${byStar[s]}`).join(' ');
    banner(`🎁 10연차! ${summary} · 최고 ${defOf(best.key).name} ${starStr(best.star)}`);
  } else if (act === 'selljunk') { sellJunk(); return; }
  renderShop(); updateHud(); save();
}

// ============================================================
// 캐릭터(스타터) 선택
// ============================================================
const STARTERS = ['bulbasaur', 'charmander', 'squirtle', 'pikachu'];
function showCharSelect() {
  const el = $('charselect'); if (!el) return;
  el.classList.remove('hidden');
  el.innerHTML = `<div class="cs-title">⭐ 파트너를 선택하세요</div><div class="cs-cards">${STARTERS.map((en) => { const sp = BY_EN[en]; return `<button class="cs-card" data-en="${en}"><img src="${dotUrl(sp)}" data-fb="${staticUrl(sp)}" alt=""><div class="cs-name">${sp.name}</div><div class="cs-types">${sp.types.map((t) => krType(t)).join(' · ')}</div></button>`; }).join('')}</div>`;
  el.querySelectorAll('.cs-card').forEach((b) => b.addEventListener('click', () => chooseStarter(b.dataset.en)));
}
function chooseStarter(en) {
  state.party = [newMember(en, 5)]; state.started = true;
  $('charselect').classList.add('hidden');
  renderParty(); updateHud(); save(); spawnAt = performance.now() + 400 / SPD();
  banner(`${BY_EN[en].name}와(과) 함께 출발!`);
}

// ============================================================
// 루프 / 오프라인 / 그립
// ============================================================
function tick(now) {
  if (now >= pauseUntil) {
    if (state.started && !enemy && now >= spawnAt) spawnEnemy();
    if (enemy) {
      const sp = SPD();
      for (const h of heroes) {
        if (!enemy) break;
        if (h.alive) {
          const rg = gearStat(h.member, 'regen');          // 먹다남은음식 등: 모두에게 회복
          const sl = gearStat(h.member, 'sludge');          // 검은진흙: 독타입 회복 / 그 외 피해
          if ((rg > 0 || sl > 0) && now - h.lastRegen >= 1000 / sp) {
            h.lastRegen = now; const mx = mMaxHp(h.member);
            let frac = rg;
            if (sl > 0) frac += spOf(h.member).types.includes('poison') ? sl : -sl * 0.5;
            if (frac > 0 && h.hp < mx) { h.hp = Math.min(mx, h.hp + Math.max(1, Math.round(mx * frac))); updateHeroBar(h); }
            else if (frac < 0) { h.hp = Math.max(1, h.hp - Math.max(1, Math.round(mx * -frac))); updateHeroBar(h); }   // 비독타입엔 도트(치사X)
          }
        }
        berryAuto(h, now);
        statusTick(h, now);
        if (!enemy) break;
        if (h.alive && canMove(h, now) && now - h.lastAtk >= mInterval(h.member) / sp / stageMult(h.spdStage)) { h.lastAtk = now; heroAttack(h); }
      }
      if (enemy) { statusTick(enemy, now); if (enemy && now - enemy.lastAtk >= enemy.interval / sp && canMove(enemy, now)) { const t = frontHero(); if (t) { enemy.lastAtk = now; enemyAttack(t); } } }
    }
  }
  requestAnimationFrame(tick);
}
function applyOffline() {
  if (!state.lastSeen) return;
  const elapsed = clamp((Date.now() - state.lastSeen) / 1000, 0, 28800); if (elapsed < 30) return;
  const rate = (6 + state.prog.maxClears * 1.5) * regionMult(state.prog.region) / 3.2 * 0.4;
  const earned = Math.floor(rate * elapsed);
  if (earned > 0) { state.gold += earned; const mins = Math.floor(elapsed / 60); setTimeout(() => banner(`💤 자리비운 ${mins}분 +${fmt(earned)}골드!`), 600); }
}
function setupGrip() {
  const grip = $('grip'); if (!grip) return; let resizing = false;
  grip.addEventListener('pointerdown', (e) => { e.preventDefault(); resizing = true; try { grip.setPointerCapture(e.pointerId); } catch (x) {} });
  grip.addEventListener('pointermove', (e) => { if (!resizing || !window.petAPI || !window.petAPI.resizeRoom) return; if (e.movementX || e.movementY) window.petAPI.resizeRoom(e.movementX, e.movementY); });
  const end = (e) => { if (resizing) { resizing = false; try { grip.releasePointerCapture(e.pointerId); } catch (x) {} } };
  grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end);
}

// ============================================================
// 전투 배속
// ============================================================
function updateSpeedBtn() { const b = $('speed-btn'); if (b) b.textContent = '⏩×' + SPD(); }
function cycleSpeed() {
  const order = [1, 2, 4]; const cur = order.indexOf(SPD());
  state.settings.speed = order[(cur + 1) % order.length];
  updateSpeedBtn(); save();
}

// ============================================================
// 시작
// ============================================================
function init() {
  if (!DEX || !window.GAMEDATA) { document.body.innerHTML = '<p style="color:#fff;padding:20px">데이터 로드 실패 (pokedex.js / gamedata.js)</p>'; return; }
  installImgFallback();
  applyOffline();
  renderParty();
  updateHud();
  setupGrip();
  spawnAt = performance.now() + 400 / SPD();
  document.querySelectorAll('.up').forEach((b) => b.addEventListener('click', () => buy(b.dataset.up)));
  const tab = (id, key) => { const e = $(id); if (e) e.addEventListener('click', () => panelOpen === key ? closePanel() : openPanel(key)); };
  tab('tab-party', 'party'); tab('tab-bag', 'bag'); tab('tab-shop', 'shop'); tab('tab-dex', 'dex'); tab('tab-roadmap', 'map');
  const sb = $('speed-btn'); if (sb) sb.addEventListener('click', cycleSpeed); updateSpeedBtn();
  $('panel-close').addEventListener('click', closePanel);
  document.addEventListener('pointerup', stopGachaHold);
  document.addEventListener('pointercancel', stopGachaHold);
  window.addEventListener('blur', stopGachaHold);
  if (!state.started) showCharSelect();
  requestAnimationFrame(tick);
  setInterval(save, 5000);
  window.addEventListener('beforeunload', save);
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
  if (window.petAPI) window.petAPI.onCommand((cmd) => { if (cmd && cmd.type === 'roomReset') { localStorage.removeItem(SAVE_KEY); localStorage.removeItem('pkmnRoom_v2'); location.reload(); } });
}
init();
