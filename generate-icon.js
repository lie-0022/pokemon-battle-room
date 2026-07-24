// 트레이용 몬스터볼 PNG(32x32) + 64x64 를 외부 라이브러리 없이 생성한다.
// 실행: node generate-icon.js  ->  tray.png, tray@2x.png
const fs = require('fs');
const zlib = require('zlib');

function crcTable() {
  const t = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
}
const CRC = crcTable();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

// 픽셀 하나를 8x8로 쪼개 평균 내는 슈퍼샘플링 — 어떤 크기로 뽑아도 테두리가 매끈하다.
const SS = 8;

// 모든 치수를 반지름 R 기준 비율로 정의 → 16px든 512px든 같은 모양이 나온다.
const RING = 0.90;   // 이 바깥은 검은 외곽선
const BTN_O = 0.34;  // 가운데 버튼 바깥(검)
const BTN_I = 0.21;  // 가운데 버튼 안(흰)
const BAND = 0.17;   // 가운데 가로 밴드 반폭

// (sx, sy)에서의 색을 [r,g,b,a]로. 원 바깥은 완전 투명.
function sample(sx, sy, cx, cy, R) {
  const dx = (sx - cx) / R, dy = (sy - cy) / R;
  const u = Math.sqrt(dx * dx + dy * dy);
  if (u > 1) return null;
  if (u >= RING) return [20, 20, 20];                 // 외곽선
  if (u <= BTN_I) return [245, 245, 245];             // 버튼(흰)
  if (u <= BTN_O) return [20, 20, 20];                // 버튼 테두리(검)
  if (Math.abs(dy) <= BAND) return [20, 20, 20];      // 가운데 밴드
  if (dy < 0) return [237, 40, 57];                   // 위(빨강)
  return [245, 245, 245];                             // 아래(흰)
}

function pokeballPNG(N) {
  const cx = N / 2, cy = N / 2, R = N / 2;
  const raw = Buffer.alloc(N * (N * 4 + 1));
  let p = 0;
  for (let y = 0; y < N; y++) {
    raw[p++] = 0; // filter
    for (let x = 0; x < N; x++) {
      // 서브픽셀 평균 — 색은 알파를 곱해 누적(프리멀티플라이)해야 경계에 검은 테가 안 생긴다.
      let ar = 0, ag = 0, ab = 0, hit = 0;
      for (let j = 0; j < SS; j++) {
        for (let i = 0; i < SS; i++) {
          const c = sample(x + (i + 0.5) / SS, y + (j + 0.5) / SS, cx, cy, R);
          if (c) { ar += c[0]; ag += c[1]; ab += c[2]; hit++; }
        }
      }
      const total = SS * SS;
      const a = Math.round((hit / total) * 255);
      const r = hit ? Math.round(ar / hit) : 0;
      const g = hit ? Math.round(ag / hit) : 0;
      const b = hit ? Math.round(ab / hit) : 0;
      raw[p++] = r; raw[p++] = g; raw[p++] = b; raw[p++] = a;
    }
  }
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// 트레이는 100% DPI에서 16px가 실제 표시 크기 — 기본을 16으로 두고 배율본을 함께 깔아야
// 윈도우가 큰 이미지를 뭉개서 줄이지 않는다. (Electron이 @1.5x·@2x·@3x를 자동으로 골라 씀)
fs.writeFileSync('tray.png', pokeballPNG(16));
fs.writeFileSync('tray@1.5x.png', pokeballPNG(24));
fs.writeFileSync('tray@2x.png', pokeballPNG(32));
fs.writeFileSync('tray@3x.png', pokeballPNG(48));
fs.writeFileSync('icon.png', pokeballPNG(256));
fs.writeFileSync('icon512.png', pokeballPNG(512));   // 맥 빌드용(≥512 필요)
console.log('생성 완료: tray 16/24/32/48, icon.png(256), icon512.png(512)');
