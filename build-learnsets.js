// PokéAPI에서 1~151 레벨업 러닝셋 + TM 학습목록 + 기술사전(물리/특수/한글)을 받아
// gamedata.json / gamedata.js 생성.  실행: node build-learnsets.js
const fs = require('fs');
const API = 'https://pokeapi.co/api/v2';
const GEN1_MAX = 151;

// 기술머신(TM) 풀 — 파밍으로 배울 수 있는 대표 공격기 (영문 키)
const TM_POOL = [
  'flamethrower', 'fire-blast', 'fire-punch', 'thunderbolt', 'thunder', 'thunder-punch',
  'ice-beam', 'blizzard', 'ice-punch', 'surf', 'hydro-pump', 'scald', 'waterfall',
  'earthquake', 'bulldoze', 'dig', 'psychic', 'shadow-ball', 'energy-ball', 'giga-drain',
  'solar-beam', 'sludge-bomb', 'poison-jab', 'dazzling-gleam', 'play-rough', 'dragon-claw',
  'dragon-pulse', 'dark-pulse', 'crunch', 'flash-cannon', 'iron-tail', 'brick-break',
  'rock-slide', 'rock-tomb', 'body-slam', 'hyper-beam', 'aerial-ace', 'air-slash',
  'x-scissor', 'bug-buzz', 'shadow-claw', 'zen-headbutt', 'fire-fang', 'thunder-fang', 'ice-fang',
];
// 전투용 변화기(버프) — 포켓몬이 실제로 배울 수 있는지 학습셋에서 판정용
const BUFF_SET = new Set(['swords-dance', 'dragon-dance', 'calm-mind', 'nasty-plot']);

async function fetchJson(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); }
    catch (e) { if (i === tries - 1) throw e; await new Promise(s => setTimeout(s, 400 * (i + 1))); }
  }
}
async function pool(items, limit, worker) {
  const out = new Array(items.length); let idx = 0;
  async function run() { while (idx < items.length) { const c = idx++; out[c] = await worker(items[c], c); if (c % 25 === 0) process.stdout.write(`  ...${c}/${items.length}\n`); } }
  await Promise.all(Array.from({ length: limit }, run));
  return out;
}
const krName = (names) => { const k = names.find(n => n.language.name === 'ko'); return k ? k.name : null; };

(async function main() {
  console.log('1) 포켓몬별 러닝셋/TM목록 수집 (1~151)...');
  const ids = Array.from({ length: GEN1_MAX }, (_, i) => i + 1);
  const tmSet = new Set(TM_POOL);
  const moveNames = new Set();
  const perMon = await pool(ids, 12, async (id) => {
    const p = await fetchJson(`${API}/pokemon/${id}`);
    // 버전그룹별 level-up 개수 → 가장 많은(=현행에 가까운) VG 선택
    const vgLevelCount = {};
    for (const mv of p.moves) for (const d of mv.version_group_details)
      if (d.move_learn_method.name === 'level-up') vgLevelCount[d.version_group.name] = (vgLevelCount[d.version_group.name] || 0) + 1;
    const bestVg = Object.keys(vgLevelCount).sort((a, b) => vgLevelCount[b] - vgLevelCount[a])[0];

    const levelup = [];   // {move, lv}
    const tms = [];       // moveName (TM_POOL ∩ machine)
    const buffs = [];     // 이 포켓몬이 실제로 배울 수 있는 변화기(버프) — 어떤 방법으로든
    for (const mv of p.moves) {
      const name = mv.move.name;
      let lvHere = null, isMachine = false;
      for (const d of mv.version_group_details) {
        if (d.version_group.name === bestVg && d.move_learn_method.name === 'level-up') lvHere = lvHere == null ? d.level_learned_at : Math.min(lvHere, d.level_learned_at);
        if (d.move_learn_method.name === 'machine') isMachine = true;
      }
      if (lvHere != null) { levelup.push({ move: name, lv: lvHere }); moveNames.add(name); }
      if (isMachine && tmSet.has(name)) { tms.push(name); moveNames.add(name); }
      if (BUFF_SET.has(name)) buffs.push(name);   // 학습법 무관 — 실제 배울 수 있으면 포함
    }
    levelup.sort((a, b) => a.lv - b.lv || a.move.localeCompare(b.move));
    return { en: p.name, levelup, tms, buffs: [...new Set(buffs)] };
  });

  console.log(`2) 기술 상세 수집 (고유 ${moveNames.size}종)...`);
  const moves = {};
  await pool([...moveNames], 14, async (name) => {
    try {
      const m = await fetchJson(`${API}/move/${name}`);
      moves[name] = {
        kr: krName(m.names) || name,
        type: m.type.name,
        power: m.power,                         // null 가능(변화기)
        dclass: m.damage_class ? m.damage_class.name : 'status',  // physical/special/status
        pp: m.pp || 15,
        acc: m.accuracy || 100,
      };
    } catch (e) {}
  });

  // 데미지기만 남기고 러닝셋/TM 정리 (변화기 제외 — 전투가 데미지 기반)
  const isDmg = (k) => moves[k] && moves[k].power != null && (moves[k].dclass === 'physical' || moves[k].dclass === 'special');
  const learnsets = {};
  for (const m of perMon) {
    const lv = m.levelup.filter((e) => isDmg(e.move));
    const tm = [...new Set(m.tms.filter(isDmg))];
    if (lv.length === 0) lv.push({ move: 'tackle', lv: 1 });   // 최소 보장
    learnsets[m.en] = { lv, tm, buffs: m.buffs || [] };   // 실제 학습 가능한 변화기만
  }
  // tackle 보장 시 사전에 없으면 추가
  if (!moves['tackle']) { try { const t = await fetchJson(`${API}/move/tackle`); moves['tackle'] = { kr: krName(t.names) || 'tackle', type: t.type.name, power: t.power, dclass: t.damage_class.name, pp: t.pp, acc: t.accuracy || 100 }; } catch (e) {} }
  // 사전에서 변화기 제거(용량 절감)
  for (const k of Object.keys(moves)) if (!isDmg(k) && k !== 'tackle') delete moves[k];

  const result = {
    source: 'PokeAPI level-up learnsets + TM pool',
    tmPool: TM_POOL.filter((k) => moves[k]),
    moves, learnsets,
  };
  const json = JSON.stringify(result);
  fs.writeFileSync('gamedata.json', json);
  fs.writeFileSync('gamedata.js', 'window.GAMEDATA = ' + json + ';');
  const kb = (fs.statSync('gamedata.json').size / 1024).toFixed(0);
  console.log(`\n완료! gamedata.json / gamedata.js (${kb} KB)`);
  console.log(`  기술 ${Object.keys(moves).length}종, 러닝셋 ${Object.keys(learnsets).length}마리, TM ${result.tmPool.length}종`);
})().catch((e) => { console.error('빌드 실패:', e); process.exit(1); });
