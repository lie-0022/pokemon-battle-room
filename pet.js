// ============================================================
// 포켓몬 데스크톱 펫 — 렌더러
//  선명한 도트(5세대 흑백 애니메이션 픽셀 스프라이트)가
//  바탕화면 위를 걷고/쉬고/자고/점프하고, 마우스로 집어 옮길 수 있다.
//  데이터: pokedex.js (PokéAPI 실데이터)
// ============================================================

const stage = document.getElementById('stage');
const DEBUG = false;  // 디버그 HUD (마우스 전달/통과상태 확인용)
let _hud = null;
function hud(t) {
  if (!DEBUG) return;
  if (!_hud) {
    _hud = document.createElement('div');
    _hud.style.cssText = 'position:fixed;top:8px;left:8px;z-index:99999;background:#000;color:#0f0;font:14px monospace;padding:6px 10px;border:1px solid #0f0;pointer-events:none;';
    document.body.appendChild(_hud);
  }
  _hud.textContent = t;
}
const DEX = window.POKEDEX;
const BY_EN = {};
if (DEX) DEX.pokemon.forEach((p) => { BY_EN[p.en] = p; });

const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const pick = (arr) => arr[randi(0, arr.length - 1)];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const SIZES = { small: 56, medium: 80, large: 120 };
let SIZE = SIZES.small;   // 기본 크기: 작게

const pets = [];
let interact = true;       // 펫 만지기(클릭·드래그) 기본 ON
let drag = null;           // { pet, dx, dy, moved, sx, sy }
let mx = -1, my = -1;      // 마지막 커서 위치(정지 상태에서도 히트테스트 위해 추적)
let petsHidden = false;    // 펫 보이기/숨기기
let roomZone = null;       // {x, w} 펫이 피해 다닐 배틀룸 구간(오버레이 로컬 좌표)

const W = () => window.innerWidth;
const H = () => window.innerHeight;
const ground = () => H() - 2;   // 펫 발끝 y

// ---- 도트 스프라이트 URL ----
// 5세대 흑백 애니메이션(선명한 픽셀, 움직임). 1~649 존재 → 1세대 전부 OK.
const BW = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-v/black-white/animated';
function dotUrl(entry) { return `${BW}/${entry.id}.gif`; }

// ============================================================
// 마우스 클릭 통과 제어 (메인 프로세스에 위임)
// ============================================================
let _ignore = true;
function setIgnore(v) {
  if (v === _ignore) return;
  _ignore = v;
  if (window.petAPI) window.petAPI.setIgnoreMouse(v);
}

// ============================================================
// Pet
// ============================================================
class Pet {
  constructor(entry) {
    this.entry = entry;
    this.size = SIZE;

    this.el = document.createElement('div');
    this.el.className = 'pet';

    this.shadow = document.createElement('div');
    this.shadow.className = 'shadow';

    this.img = document.createElement('img');
    this.img.className = 'sprite';
    this.img.width = this.size; this.img.height = this.size;
    this.img.draggable = false;
    // 선명한 도트 → 실패 시 클래식 도트 → 일러스트 순으로 폴백
    this._fallbacks = [dotUrl(entry), entry.sprites.front, entry.sprites.animFront, entry.sprites.art].filter(Boolean);
    this._fi = 0;
    this.img.src = this._fallbacks[0];
    this.img.onerror = () => {
      this._fi++;
      if (this._fi < this._fallbacks.length) this.img.src = this._fallbacks[this._fi];
      else this.img.onerror = null;
    };

    this.bubble = document.createElement('div');
    this.bubble.className = 'bubble';
    this.bubble.textContent = entry.name;

    this.el.appendChild(this.bubble);
    this.el.appendChild(this.img);
    this.el.appendChild(this.shadow);
    stage.appendChild(this.el);

    this.x = rand(0, Math.max(0, W() - this.size));
    this.y = -this.size - rand(0, 160);
    this.vy = 0;
    this.dir = pick([-1, 1]);
    this.speed = rand(0.5, 1.4);
    this.state = 'fall';
    this.stateUntil = 0;
    this.landed = false;

    // 드래그 시작
    this.el.addEventListener('mousedown', (e) => {
      if (!interact) return;
      e.preventDefault();
      const r = this.el.getBoundingClientRect();
      drag = { pet: this, dx: e.clientX - r.left, dy: e.clientY - r.top, moved: false, sx: e.clientX, sy: e.clientY };
      this.state = 'held';
      this.el.classList.add('grabbed');
      setIgnore(false);
    });

    this.applyTransform();
  }

  setSize(px) { this.size = px; this.img.width = px; this.img.height = px; }

  say(text, ms = 1500) {
    this.bubble.textContent = text;
    this.bubble.classList.add('show');
    clearTimeout(this._sayT);
    this._sayT = setTimeout(() => this.bubble.classList.remove('show'), ms);
  }
  greet() {
    this.say(pick([`${this.entry.name}!`, '반가워!', '같이 놀자~', '히힝~', '냐옹!']));
    this.jump(rand(7, 11));
  }
  jump(power) { if (this.y >= ground() - this.size - 1) { this.vy = -power; this.state = 'jump'; } }

  showZzz() {
    const z = document.createElement('div');
    z.className = 'zzz'; z.textContent = 'Z';
    this.el.appendChild(z);
    setTimeout(() => z.remove(), 2000);
  }

  pickState(now) {
    const r = Math.random();
    if (r < 0.5) { this.state = 'walk'; this.dir = pick([-1, 1]); this.speed = rand(0.5, 1.5); this.stateUntil = now + rand(1500, 4500); }
    else if (r < 0.82) { this.state = 'idle'; this.stateUntil = now + rand(1000, 2600); }
    else { this.state = 'sleep'; this.stateUntil = now + rand(3000, 6000); this._nextZ = 0; }
  }

  dragTo(cx, cy) {
    this.x = clamp(cx - drag.dx, 0, Math.max(0, W() - this.size));
    this.y = clamp(cy - drag.dy, 0, ground() - this.size);
    this.applyTransform();
  }

  update(dt, now) {
    if (this.state === 'held') { this.applyTransform(); return; }
    const gy = ground() - this.size;

    if (this.state === 'fall' || this.state === 'jump') {
      this.vy += 0.5;
      this.y += this.vy;
      if (this.y >= gy) {
        this.y = gy; this.vy = 0;
        if (!this.landed) { this.landed = true; this.say(`${this.entry.name}!`, 1100); }
        this.state = 'idle'; this.stateUntil = now + rand(700, 1700);
      }
    } else {
      if (now >= this.stateUntil) this.pickState(now);
      if (this.state === 'walk') {
        this.x += this.dir * this.speed;
        if (this.x <= 0) { this.x = 0; this.dir = 1; }
        if (this.x >= W() - this.size) { this.x = W() - this.size; this.dir = -1; }
        // 배틀룸 구간을 만나면 돌아선다(룸 앞을 가리지 않게)
        if (roomZone) {
          const rL = roomZone.x, rR = roomZone.x + roomZone.w;
          if (this.x + this.size > rL && this.x < rR) {
            if (this.dir > 0) { this.x = rL - this.size; this.dir = -1; }
            else { this.x = rR; this.dir = 1; }
          }
        }
        if (Math.random() < 0.004) this.jump(rand(5, 8));
      } else if (this.state === 'sleep') {
        if (now >= this._nextZ) { this.showZzz(); this._nextZ = now + 1400; }
      }
      this.y = gy;
    }
    this.applyTransform();
  }

  applyTransform() {
    const flip = this.dir < 0 ? -1 : 1;
    this.el.style.transform = `translate(${this.x}px, ${this.y}px) scaleX(${flip})`;
    this.bubble.style.transform = `translateX(-50%) scaleX(${flip})`;
  }
  remove() { this.el.remove(); }
}

// ============================================================
// 전역 마우스: 펫 위 = 클릭 캡처, 빈 곳 = 통과 / 드래그 이동
// ============================================================
function petAt(x, y) {
  const el = document.elementFromPoint(x, y);
  return el ? el.closest('.pet') : null;
}

document.addEventListener('mousemove', (e) => {
  mx = e.clientX; my = e.clientY;
  if (drag) {
    if (Math.abs(e.clientX - drag.sx) > 3 || Math.abs(e.clientY - drag.sy) > 3) drag.moved = true;
    drag.pet.dragTo(e.clientX, e.clientY);
    setIgnore(false);
    return;
  }
  if (!interact) { setIgnore(true); return; }
  setIgnore(!petAt(e.clientX, e.clientY));   // 펫 위면 캡처(false), 아니면 통과(true)
});

// 커서가 멈춰 있어도 펫이 그 밑으로 걸어 들어오면 잡히도록 매 프레임 재판정
function refreshIgnore() {
  if (drag || !interact || mx < 0) return;
  setIgnore(!petAt(mx, my));
}

document.addEventListener('mouseup', (e) => {
  if (!drag) return;
  const p = drag.pet;
  p.el.classList.remove('grabbed');
  if (!drag.moved) p.greet();              // 거의 안 움직였으면 클릭=인사
  else { p.vy = 0; p.state = 'fall'; }      // 옮겼으면 그 자리에서 다시 착지
  drag = null;
});

// ============================================================
// 펫 관리
// ============================================================
function addPet(which) {
  if (!DEX) return;
  petsHidden = false;
  let entry;
  if (which === 'random' || !which) entry = pick(DEX.pokemon);
  else entry = BY_EN[which] || pick(DEX.pokemon);
  const p = new Pet(entry);
  p.setSize(SIZE);
  pets.push(p);
  if (pets.length > 60) pets.shift().remove();
}
function spawnStarters() {
  ['pikachu', 'charmander', 'bulbasaur', 'squirtle'].forEach((en, i) => setTimeout(() => addPet(en), i * 280));
}
function removePet() { const p = pets.pop(); if (p) p.remove(); }
function clearPets() { while (pets.length) pets.pop().remove(); }
function setSizeAll(name) { SIZE = SIZES[name] || SIZES.medium; pets.forEach((p) => p.setSize(SIZE)); }

// ============================================================
// 메인 루프
// ============================================================
let lastT = performance.now();
function loop(now) {
  const dt = Math.min(50, now - lastT);
  lastT = now;
  for (const p of pets) p.update(dt, now);
  refreshIgnore();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ============================================================
// 트레이 명령
// ============================================================
if (window.petAPI) {
  window.petAPI.onCommand((cmd) => {
    if (!cmd) return;
    if (cmd.type === 'add') { const n = cmd.count || 1; for (let i = 0; i < n; i++) setTimeout(() => addPet(cmd.which), i * 120); }
    else if (cmd.type === 'remove') removePet();
    else if (cmd.type === 'clear') clearPets();
    else if (cmd.type === 'size') setSizeAll(cmd.value);
    else if (cmd.type === 'interact') { interact = !!cmd.value; if (!interact) setIgnore(true); }
    else if (cmd.type === 'hideAll') { petsHidden = true; clearPets(); }
    else if (cmd.type === 'show') { petsHidden = false; if (pets.length === 0) spawnStarters(); }
    else if (cmd.type === 'room') { roomZone = cmd.visible ? { x: cmd.x, w: cmd.w } : null; }
  });
}

// 시작 환영 포켓몬
window.addEventListener('DOMContentLoaded', () => {
  if (!DEX) { document.title = 'pokedex.js 없음'; return; }
  spawnStarters();
});
