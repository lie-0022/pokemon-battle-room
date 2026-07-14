// 홍보 GIF 생성기 — 실제 배틀룸(room.html)을 Electron capturePage로 캡처해 gifenc로 인코딩.
// 실행: electron capture-gif.js   (실행 전 앱을 반드시 종료 — localStorage 잠금)
// 산출물: promo.gif
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { GIFEncoder, quantize, applyPalette } = require('gifenc');

app.setName('pokemon-desktop-pet');                       // 실제 세이브 폴더와 동일 → r60 진행 로드
app.commandLine.appendSwitch('force-device-scale-factor', '1');   // HiDPI 배율 제거(getSize=비트맵 픽셀 일치)

const W = 460, H = 660;
const WARMUP = 5000;          // 로드+전투 시작 대기
const FRAMES = 45, INTERVAL = 110;   // ≈5초 @ ~9fps

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: W, height: H, show: true, frame: false, transparent: false,
    backgroundColor: '#0e0f1a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
    },
  });
  await win.loadFile('room.html');
  await new Promise((r) => setTimeout(r, WARMUP));
  // 배속 올려 전투를 생동감 있게, 혹시 패널 열려있으면 닫기
  try {
    await win.webContents.executeJavaScript(
      `(function(){try{ if(window.state){ state.settings=state.settings||{}; state.settings.speed=4; } if(typeof closePanel==='function') closePanel(); }catch(e){}})()`
    );
  } catch (e) {}
  await new Promise((r) => setTimeout(r, 800));

  const gif = GIFEncoder();
  let n = 0;
  for (let i = 0; i < FRAMES; i++) {
    const img = await win.webContents.capturePage();
    const { width, height } = img.getSize();
    const bmp = img.toBitmap();          // BGRA
    const rgba = Buffer.allocUnsafe(bmp.length);
    for (let j = 0; j < bmp.length; j += 4) { rgba[j] = bmp[j + 2]; rgba[j + 1] = bmp[j + 1]; rgba[j + 2] = bmp[j]; rgba[j + 3] = 255; }
    const data = new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.length);
    const palette = quantize(data, 256);
    const index = applyPalette(data, palette);
    gif.writeFrame(index, width, height, { palette, delay: INTERVAL });
    n++;
    await new Promise((r) => setTimeout(r, INTERVAL));
  }
  gif.finish();
  fs.writeFileSync(path.join(__dirname, 'promo.gif'), Buffer.from(gif.bytes()));
  const kb = Math.round(fs.statSync(path.join(__dirname, 'promo.gif')).size / 1024);
  console.log(`promo.gif 완료 — ${n}프레임, ${kb}KB`);
  app.quit();
});
