// 렌더러(pet.js)와 메인 프로세스 사이의 안전한 IPC 다리
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petAPI', {
  // 트레이 메뉴 명령 수신
  onCommand: (cb) => ipcRenderer.on('cmd', (_e, data) => cb(data)),
  // 펫 위에 마우스가 올라갔을 때만 클릭을 받도록 메인에 알림
  setIgnoreMouse: (ignore) => ipcRenderer.send('set-ignore-mouse', ignore),
  // 배틀룸 커스텀 리사이즈(그립 드래그 델타 전달)
  resizeRoom: (dx, dy) => ipcRenderer.send('room-resize-delta', { dx, dy }),
});
