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

function pokeballPNG(N) {
  const cx = (N - 1) / 2, cy = (N - 1) / 2, R = N / 2 - 1;
  const band = Math.max(1, Math.round(N * 0.09));
  const btnOuter = N * 0.18, btnInner = N * 0.11;
  const raw = Buffer.alloc(N * (N * 4 + 1));
  let p = 0;
  for (let y = 0; y < N; y++) {
    raw[p++] = 0; // filter
    for (let x = 0; x < N; x++) {
      const dx = x - cx, dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      let r = 0, g = 0, b = 0, a = 0;
      if (d <= R + 0.5) {
        a = 255;
        if (d >= R - 1.4) { r = g = b = 20; }                    // 외곽선
        else if (d <= btnInner) { r = g = b = 245; }             // 가운데 버튼(흰)
        else if (d <= btnOuter) { r = g = b = 20; }              // 버튼 테두리(검)
        else if (Math.abs(dy) <= band) { r = g = b = 20; }       // 가운데 밴드
        else if (dy < 0) { r = 237; g = 40; b = 57; }            // 위(빨강)
        else { r = 245; g = 245; b = 245; }                      // 아래(흰)
      }
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

fs.writeFileSync('tray.png', pokeballPNG(32));
fs.writeFileSync('tray@2x.png', pokeballPNG(64));
fs.writeFileSync('icon.png', pokeballPNG(256));
fs.writeFileSync('icon512.png', pokeballPNG(512));   // 맥 빌드용(≥512 필요)
console.log('생성 완료: tray.png(32), tray@2x.png(64), icon.png(256), icon512.png(512)');
