' ============================================================
'  포켓몬 데스크톱 펫 실행기
'  이 파일을 더블클릭하면 콘솔 창 없이 바로 펫이 실행됩니다.
'  종료는 화면 오른쪽 아래 시스템 트레이의 몬스터볼 아이콘 우클릭 → 종료
' ============================================================
Dim sh, fso, dir
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
' 이 스크립트가 있는 폴더
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
' electron 을 콘솔 창 없이(0) 비동기로 실행
sh.Run """" & dir & "\node_modules\.bin\electron.cmd"" .", 0, False
