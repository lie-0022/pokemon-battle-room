// PokéAPI에서 실제 포켓몬 데이터를 받아 pokedex.json 을 생성한다.
// 데이터 출처: https://pokeapi.co  (나무위키가 문서화하는 공식 종족값/타입/기술과 동일 출처)
// 실행: node build-dex.js
const fs = require('fs');

const API = 'https://pokeapi.co/api/v2';
const GEN1_MAX = 151;

// ---- 표준 타입 색 (영문 키) ----
const TYPE_COLOR = {
  normal:'#A8A878', fire:'#F08030', water:'#6890F0', grass:'#78C850', electric:'#F8D030',
  ice:'#98D8D8', fighting:'#C03028', poison:'#A040A0', ground:'#E0C068', flying:'#A890F0',
  psychic:'#F85888', bug:'#A8B820', rock:'#B8A038', ghost:'#705898', dragon:'#7038F8',
  dark:'#705848', steel:'#B8B8D0', fairy:'#EE99AC',
};

// ---- 게임에 쓸 대표 공격기 화이트리스트 (실제 PokeAPI 기술명) ----
const MOVE_WHITELIST = [
  // normal
  'tackle','scratch','quick-attack','headbutt','body-slam','slash','take-down','hyper-beam','double-edge','swift',
  // fire
  'ember','flamethrower','fire-punch','fire-blast','fire-spin','flame-wheel',
  // water
  'water-gun','bubble-beam','surf','hydro-pump','aqua-tail','waterfall',
  // grass
  'vine-whip','razor-leaf','mega-drain','solar-beam','petal-dance','giga-drain',
  // electric
  'thunder-shock','thunderbolt','spark','thunder','discharge',
  // ice
  'ice-punch','aurora-beam','ice-beam','blizzard',
  // fighting
  'karate-chop','low-kick','brick-break','cross-chop','submission',
  // poison
  'poison-sting','acid','sludge','sludge-bomb','poison-jab',
  // ground
  'mud-slap','dig','bone-club','earthquake','bulldoze',
  // flying
  'gust','peck','wing-attack','aerial-ace','drill-peck',
  // psychic
  'confusion','psybeam','psychic','zen-headbutt',
  // bug
  'leech-life','pin-missile','twineedle','bug-bite','signal-beam',
  // rock
  'rock-throw','rock-tomb','rock-slide','ancient-power','power-gem',
  // ghost
  'shadow-ball','shadow-punch','shadow-claw',
  // dragon
  'dragon-breath','dragon-claw','twister',
  // dark
  'bite','crunch','feint-attack','dark-pulse',
  // steel
  'metal-claw','iron-tail','steel-wing','flash-cannon','bullet-punch',
  // fairy
  'fairy-wind','disarming-voice','dazzling-gleam',
];

// ---- 동시성 제한 fetch ----
async function fetchJson(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise(r => setTimeout(r, 400 * (i + 1)));
    }
  }
}

async function pool(items, limit, worker) {
  const out = new Array(items.length);
  let idx = 0;
  async function run() {
    while (idx < items.length) {
      const cur = idx++;
      out[cur] = await worker(items[cur], cur);
      if (cur % 25 === 0) process.stdout.write(`  ...${cur}/${items.length}\n`);
    }
  }
  await Promise.all(Array.from({ length: limit }, run));
  return out;
}

function krName(names) {
  const ko = names.find(n => n.language.name === 'ko');
  return ko ? ko.name : null;
}

(async function main() {
  console.log('1) 타입 상성표 수집...');
  const typeChart = {};
  const typeKr = {};
  const typeIds = Array.from({ length: 18 }, (_, i) => i + 1);
  await pool(typeIds, 8, async (id) => {
    const t = await fetchJson(`${API}/type/${id}`);
    const en = t.name;
    typeKr[en] = krName(t.names) || en;
    const rel = t.damage_relations;
    const chart = {};
    rel.double_damage_to.forEach(x => chart[x.name] = 2);
    rel.half_damage_to.forEach(x => chart[x.name] = 0.5);
    rel.no_damage_to.forEach(x => chart[x.name] = 0);
    typeChart[en] = chart;
  });

  console.log('2) 기술 데이터 수집...');
  const moves = {};
  await pool(MOVE_WHITELIST, 10, async (name) => {
    try {
      const m = await fetchJson(`${API}/move/${name}`);
      if (m.power == null) return;                       // 위력 없는 기술 제외
      if (!['physical', 'special'].includes(m.damage_class.name)) return;
      moves[name] = {
        kr: krName(m.names) || name,
        type: m.type.name,
        power: m.power,
        cls: m.damage_class.name,
        pp: m.pp,
        acc: m.accuracy || 100,
      };
    } catch (e) { /* 일부 기술명 누락 무시 */ }
  });
  console.log(`   기술 ${Object.keys(moves).length}종 확보`);

  console.log('3) 포켓몬 + 종 정보 수집 (1~151)...');
  const ids = Array.from({ length: GEN1_MAX }, (_, i) => i + 1);
  const speciesCache = {};
  const dex = await pool(ids, 12, async (id) => {
    const p = await fetchJson(`${API}/pokemon/${id}`);
    const s = await fetchJson(`${API}/pokemon-species/${id}`);
    speciesCache[id] = s;

    const stats = {};
    p.stats.forEach(st => {
      const key = { 'hp':'hp','attack':'atk','defense':'def','special-attack':'spa',
                    'special-defense':'spd','speed':'spe' }[st.stat.name];
      if (key) stats[key] = st.base_stat;
    });
    const types = p.types.sort((a, b) => a.slot - b.slot).map(t => t.type.name);

    // 이 포켓몬이 배울 수 있는 화이트리스트 기술 모으기
    const learnable = new Set(p.moves.map(mv => mv.move.name));
    const usable = MOVE_WHITELIST.filter(n => learnable.has(n) && moves[n]);
    // 자기 타입 일치 기술 우선 + 노말기 보장
    const stab = usable.filter(n => types.includes(moves[n].type));
    const others = usable.filter(n => !types.includes(moves[n].type));
    let chosen = [...stab, ...others].slice(0, 4);
    if (chosen.length === 0) chosen = ['tackle'];          // 최후 보루
    if (!moves['tackle']) { /* tackle 없으면 첫 기술 유지 */ }

    const sp = p.sprites;
    const showdown = sp.other && sp.other.showdown ? sp.other.showdown : {};
    const art = sp.other && sp.other['official-artwork'] ? sp.other['official-artwork'].front_default : null;

    return {
      id,
      en: p.name,
      name: krName(s.names) || p.name,
      types,
      stats,
      moves: chosen,
      sprites: {
        front: sp.front_default,
        back: sp.back_default || sp.front_default,
        animFront: showdown.front_default || sp.front_default,
        animBack: showdown.back_default || sp.back_default || sp.front_default,
        art,
      },
      color: TYPE_COLOR[types[0]] || '#888',
      catchRate: +(s.capture_rate / 255).toFixed(3),  // 0~1
      bst: Object.values(stats).reduce((a, b) => a + b, 0),
      _chainUrl: s.evolution_chain ? s.evolution_chain.url : null,
    };
  });

  console.log('4) 진화 체인 수집...');
  const chainUrls = [...new Set(dex.map(d => d._chainUrl).filter(Boolean))];
  const evoMap = {};   // fromEn -> { to, level }
  await pool(chainUrls, 10, async (url) => {
    const c = await fetchJson(url);
    (function walk(node) {
      for (const next of node.evolves_to) {
        const det = next.evolution_details[0] || {};
        if (det.trigger && det.trigger.name === 'level-up' && det.min_level) {
          evoMap[node.species.name] = { to: next.species.name, level: det.min_level };
        }
        walk(next);
      }
    })(c.chain);
  });

  // 진화 정보 부착 + 임시 필드 제거
  dex.forEach(d => {
    const e = evoMap[d.en];
    if (e) { d.evolveTo = e.to; d.evolveLevel = e.level; }
    else { d.evolveTo = null; d.evolveLevel = null; }
    delete d._chainUrl;
  });

  // 야생 풀: BST 낮을수록 흔하게, 전설은 희귀
  const LEGEND = new Set(['articuno','zapdos','moltres','mewtwo','mew']);
  const wildPool = dex.map(d => {
    let w;
    if (LEGEND.has(d.en)) w = 1;
    else if (!d.evolveTo && d.bst >= 500) w = 2;          // 강한 최종진화
    else if (d.bst >= 400) w = 5;
    else w = 10;                                           // 약한/초반 포켓몬
    return { en: d.en, w };
  });

  const starters = ['bulbasaur', 'charmander', 'squirtle'];

  const result = {
    source: 'PokeAPI (https://pokeapi.co) — 공식 종족값/타입/기술/스프라이트',
    typeChart, typeKr, typeColor: TYPE_COLOR,
    moves,
    pokemon: dex,
    starters,
    wildPool,
  };

  const json = JSON.stringify(result);
  fs.writeFileSync('pokedex.json', json);
  // 더블클릭(file://) 실행용 임베드 버전도 함께 생성
  fs.writeFileSync('pokedex.js', 'window.POKEDEX = ' + json + ';');
  const sizeKb = (fs.statSync('pokedex.json').size / 1024).toFixed(0);
  console.log(`\n완료! pokedex.json / pokedex.js (${sizeKb} KB)`);
  console.log(`  포켓몬 ${dex.length}종, 기술 ${Object.keys(moves).length}종, 타입 ${Object.keys(typeChart).length}종`);
  console.log(`  진화 매핑 ${Object.keys(evoMap).length}건`);
})().catch(e => { console.error('빌드 실패:', e); process.exit(1); });
