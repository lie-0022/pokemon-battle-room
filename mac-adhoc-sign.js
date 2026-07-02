// electron-builder afterPack: macOS ad-hoc 서명
// 서명이 아예 없으면 Apple Silicon(arm64)에서 "손상되었기 때문에 열 수 없습니다"로 실행 자체가 차단됨.
// ad-hoc(-) 서명을 넣으면 우클릭→열기(또는 xattr -cr)로 실행 가능해짐. (Windows 빌드에는 영향 없음)
const { execSync } = require('child_process');
const path = require('path');

exports.default = async function (context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  try {
    execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: 'inherit' });
    console.log(`[mac-adhoc-sign] ad-hoc signed: ${appPath}`);
  } catch (e) {
    console.warn('[mac-adhoc-sign] codesign 실패(무시하고 진행):', e.message);
  }
};
