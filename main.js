// ============================================================
// 포켓몬 데스크톱 — Electron 메인 프로세스
//  1) 펫 오버레이: 투명/클릭통과 전체화면, 도트 포켓몬이 바탕화면을 돌아다님
//  2) 배틀룸: 화면 하단 도킹 작은 창, 자동전투 아이들 RPG (Task Bar Hero 스타일)
//  시스템 트레이로 둘 다 제어.
// ============================================================
const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage } = require('electron');
const path = require('path');

let petWin = null;
let roomWin = null;
let tray = null;
let interact = true;
let petSize = 'small';        // 펫 기본 크기: 작게
let petsVisible = true;
let roomVisible = true;

const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
// 배틀룸 크기: 가로/세로 자유. 프리셋 + 그립 자유 리사이즈(비율 고정 없음).
const PRESETS = {
  'h-s': [600, 168], 'h-m': [820, 210], 'h-l': [1080, 270],   // 가로
  'v-s': [380, 520], 'v-m': [460, 660], 'v-l': [560, 800],    // 세로
};
let roomSize = 'v-m';            // 기본: 세로 모드
let roomCurW = 460, roomCurH = 660;

// ---------- 펫 오버레이 창 ----------
function createPetWindow() {
  const wa = screen.getPrimaryDisplay().workArea;
  petWin = new BrowserWindow({
    x: wa.x, y: wa.y, width: wa.width, height: wa.height,
    transparent: true, frame: false, resizable: false, movable: false,
    minimizable: false, maximizable: false, skipTaskbar: true,
    alwaysOnTop: true, hasShadow: false, focusable: false, fullscreenable: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
    },
  });
  petWin.setAlwaysOnTop(true, 'floating');   // 룸보다 아래 레벨 → 펫이 룸 뒤로 지나감
  petWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  petWin.setIgnoreMouseEvents(true, { forward: true });
  petWin.loadFile('pet.html');
  petWin.on('closed', () => { petWin = null; });

  const resize = () => {
    if (!petWin) return;
    const w = screen.getPrimaryDisplay().workArea;
    petWin.setBounds({ x: w.x, y: w.y, width: w.width, height: w.height });
    sendPet({ type: 'resize' });
    broadcastRoomRect();
  };
  screen.on('display-metrics-changed', resize);
  screen.on('display-added', resize);
  screen.on('display-removed', resize);

  petWin.webContents.on('did-finish-load', () => {
    sendPet({ type: 'interact', value: interact });
    sendPet({ type: 'size', value: petSize });
    broadcastRoomRect();
  });
}

// ---------- 배틀룸 창 ----------
function createRoomWindow() {
  const wa = screen.getPrimaryDisplay().workArea;
  const w = roomCurW, h = roomCurH;
  const x = Math.round(wa.x + wa.width - w - 6);    // 오른쪽 도킹
  const y = Math.round(wa.y + wa.height - h - 6);   // 아래 도킹
  roomWin = new BrowserWindow({
    x, y, width: w, height: h,
    transparent: true, frame: false,
    resizable: true,                       // 창 가장자리 드래그로 자유 리사이즈 + 커스텀 그립 병행
    minWidth: 220, minHeight: 110,
    movable: true, minimizable: false, maximizable: false, skipTaskbar: true,
    alwaysOnTop: true, hasShadow: false, fullscreenable: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
    },
  });
  roomWin.setAlwaysOnTop(true, 'screen-saver');
  roomWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  roomWin.loadFile('room.html');
  roomWin.on('closed', () => { roomWin = null; });
  roomWin.on('move', broadcastRoomRect);
  roomWin.on('resize', () => { const b = roomWin.getBounds(); roomCurW = b.width; roomCurH = b.height; broadcastRoomRect(); });
  if (!roomVisible) roomWin.hide();
}

// 오른쪽 아래 도킹 재배치(프리셋/초기화)
function applyRoomBounds() {
  if (!roomWin || roomWin.isDestroyed()) return;
  const wa = screen.getPrimaryDisplay().workArea;
  const w = clampN(roomCurW, 300, wa.width);
  const h = clampN(roomCurH, 150, Math.round(wa.height * 0.95));
  roomCurW = w; roomCurH = h;
  const x = Math.round(wa.x + wa.width - w - 6);    // 오른쪽
  const y = Math.round(wa.y + wa.height - h - 6);   // 아래
  roomWin.setBounds({ x, y, width: w, height: h });
  broadcastRoomRect();
}

// 트레이 프리셋 (가로/세로)
function setRoomSize(key) {
  const p = PRESETS[key]; if (p) { roomSize = key; roomCurW = p[0]; roomCurH = p[1]; }
  applyRoomBounds();
}

function sendPet(cmd) { if (petWin && !petWin.isDestroyed()) petWin.webContents.send('cmd', cmd); }
function sendRoom(cmd) { if (roomWin && !roomWin.isDestroyed()) roomWin.webContents.send('cmd', cmd); }

// 펫에게 룸 영역을 알려 그 구간을 피해 걷게 함
function broadcastRoomRect() {
  if (!petWin) return;
  const wa = screen.getPrimaryDisplay().workArea;
  if (roomWin && roomVisible && !roomWin.isDestroyed()) {
    const b = roomWin.getBounds();
    sendPet({ type: 'room', x: b.x - wa.x, w: b.width, visible: true });
  } else {
    sendPet({ type: 'room', visible: false });
  }
}

// ---------- 트레이 ----------
function buildTrayMenu() {
  const sizeItem = (label, val) => ({
    label, type: 'radio', checked: petSize === val,
    click: () => { petSize = val; sendPet({ type: 'size', value: val }); },
  });
  const roomSizeItem = (label, val) => ({
    label, type: 'radio', checked: roomSize === val,
    click: () => setRoomSize(val),
  });

  const menu = Menu.buildFromTemplate([
    {
      label: '📐 배틀룸 크기 / 방향',
      submenu: [
        roomSizeItem('가로 — 작게', 'h-s'), roomSizeItem('가로 — 보통', 'h-m'), roomSizeItem('가로 — 크게', 'h-l'),
        { type: 'separator' },
        roomSizeItem('세로 — 작게', 'v-s'), roomSizeItem('세로 — 보통', 'v-m'), roomSizeItem('세로 — 크게', 'v-l'),
      ],
    },
    {
      label: '🏠 배틀룸 보이기', type: 'checkbox', checked: roomVisible,
      click: (item) => {
        roomVisible = item.checked;
        if (roomVisible) { if (!roomWin) createRoomWindow(); else roomWin.show(); }
        else if (roomWin) roomWin.hide();
        broadcastRoomRect();
      },
    },
    { label: '🔄 배틀룸 위치·크기 초기화', click: resetRoomPosition },
    { label: '🗑️ 배틀룸 진행 초기화(처음부터)', click: () => sendRoom({ type: 'roomReset' }) },
    { type: 'separator' },
    {
      label: '🐾 펫 보이기', type: 'checkbox', checked: petsVisible,
      click: (item) => {
        petsVisible = item.checked;
        sendPet({ type: petsVisible ? 'show' : 'hideAll' });
      },
    },
    { label: '🎲 무작위 포켓몬 추가', click: () => sendPet({ type: 'add', which: 'random' }) },
    { label: '🐦 10마리 풀어놓기', click: () => sendPet({ type: 'add', which: 'random', count: 10 }) },
    { label: '🧹 펫 모두 치우기', click: () => sendPet({ type: 'clear' }) },
    {
      label: '펫 크기',
      submenu: [sizeItem('작게', 'small'), sizeItem('보통', 'medium'), sizeItem('크게', 'large')],
    },
    {
      label: '🖐 펫 만지기 (클릭·드래그)', type: 'checkbox', checked: interact,
      click: (item) => { interact = item.checked; sendPet({ type: 'interact', value: interact }); },
    },
    { type: 'separator' },
    { label: '❌ 종료', role: 'quit' },
  ]);
  tray.setContextMenu(menu);
}

function resetRoomPosition() { setRoomSize('v-m'); }

function createTray() {
  let img = nativeImage.createFromPath(path.join(__dirname, 'tray.png'));
  if (img.isEmpty()) img = nativeImage.createEmpty();
  tray = new Tray(img);
  tray.setToolTip('포켓몬 데스크톱 (배틀룸 + 펫)');
  buildTrayMenu();
  tray.on('click', () => { if (roomWin) { roomVisible = true; roomWin.show(); roomWin.focus(); } });
}

// 펫 창 클릭 통과 토글(렌더러 요청)
ipcMain.on('set-ignore-mouse', (e, ignore) => {
  if (petWin && !petWin.isDestroyed()) petWin.setIgnoreMouseEvents(ignore, { forward: true });
});

// 배틀룸 커스텀 리사이즈: 우하단 그립 → 가로/세로 자유(좌변·하단 고정, 모서리가 커서를 따라옴)
ipcMain.on('room-resize-delta', (e, { dx, dy }) => {
  if (!roomWin || roomWin.isDestroyed()) return;
  const wa = screen.getPrimaryDisplay().workArea;
  const b = roomWin.getBounds();
  roomCurW = clampN(b.width - dx, 220, wa.width);   // 그립이 좌하단 → 왼쪽으로 끌면 넓어짐
  roomCurH = clampN(b.height + dy, 110, wa.height);
  const right = b.x + b.width, bottom = b.y + b.height;   // 우변·하단 고정
  const x = clampN(right - roomCurW, wa.x, wa.x + wa.width - roomCurW);
  const y = clampN(bottom - roomCurH, wa.y, wa.y + wa.height - roomCurH);
  roomWin.setBounds({ x, y, width: roomCurW, height: roomCurH });
  broadcastRoomRect();
});

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) app.dock.hide();   // 맥: 독 숨김 → 메뉴바 트레이 상주(윈도우 트레이와 동일)
  createPetWindow();
  createRoomWindow();
  createTray();
});

app.on('window-all-closed', () => { /* 트레이 상주: 자동 종료 안 함 */ });

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else app.on('second-instance', () => {
  if (roomWin) { roomVisible = true; roomWin.show(); roomWin.focus(); }
});
