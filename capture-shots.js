// 홍보용 기능별 스크린샷 생성기 — 실제 세이브로 각 화면을 PNG로 저장
// 실행: npx electron capture-shots.js   (실행 전 앱 종료 — localStorage 잠금)
// 산출물: shots/01-battle.png … (기능별)
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.setName('pokemon-desktop-pet');                     // 실제 세이브 폴더와 동일
app.commandLine.appendSwitch('force-device-scale-factor', '1');

const W = 480, H = 820;                                  // 세로로 넉넉히 — 패널 내용이 많이 보이게
const OUT = path.join(__dirname, 'shots');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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
  await wait(5000);                                      // 세이브 로드 + 전투 시작

  const js = (code) => win.webContents.executeJavaScript(code).catch(() => null);
  const shot = async (name, ms = 900) => {
    await wait(ms);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT, name + '.png'), img.toPNG());
    console.log('  saved', name);
  };

  // 웰컴백/스타터 오버레이 닫기 + 배속 올려 전투가 활발한 순간을 잡기
  await js(`(function(){try{var c=document.getElementById('charselect'); if(c) c.classList.add('hidden');}catch(e){}
    try{state.settings.speed=4;updateSpeedBtn&&updateSpeedBtn();}catch(e){}})()`);
  await wait(1200);

  console.log('캡처 시작');
  await js(`(function(){try{closePanel()}catch(e){}})()`);
  await shot('01-battle', 2000);                          // 전투 화면

  await js(`openPanel('party')`);
  await shot('02-party');                                 // 파티 · 기술 세팅

  // 멤버 상세(능력치·기술 4개·개체치) — 첫 파티원 선택
  await js(`(function(){try{rosterSel=state.party[0];renderRosterDetail();}catch(e){}})()`);
  await shot('03-member-stats');

  await js(`openPanel('bag')`);
  await shot('04-gear');                                  // 도구/장비

  await js(`openPanel('shop')`);
  await shot('05-shop');                                  // 상점 · 뽑기

  await js(`openPanel('dex')`);
  await shot('06-dex');                                   // 도감 · 이로치 · 개체치31

  await js(`openPanel('raid')`);
  await shot('07-raid');                                  // 레이드 편성

  // 랭킹: 본명 노출 방지 — 게임용 닉네임으로 바꿔 저장한 뒤 캡처
  await js(`(function(){try{ state.settings.nick='트레이너'; save(); }catch(e){}})()`);
  await js(`openPanel('rank')`);
  await shot('08-rank', 3000);                            // 온라인 랭킹(네트워크 대기)

  await js(`openPanel('map')`);
  await shot('09-roadmap');                               // 로드맵 · 일일 미션

  // 이로치 보유 여부 확인용 정보 출력
  const info = await js(`JSON.stringify({
    region: state.prog.region, badges: state.prog.badges,
    shinies: [...state.party, ...state.bench].filter(m=>m.shiny).map(m=>spOf(m).name).slice(0,10),
    iv31: [...state.party, ...state.bench].filter(m=>(m.iv|0)>=31).length,
    dex: Object.keys(state.dex.kills).length, gold: state.gold, raidTier: state.raid.maxTier
  })`);
  console.log('세이브 정보:', info);
  console.log('완료 →', OUT);
  app.quit();
});
