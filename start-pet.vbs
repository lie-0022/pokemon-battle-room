' Pokemon Desktop Pet launcher - runs Electron in background (no console window).
' Double-click this file to show the Pokemon pets on your desktop.
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = scriptDir

electronExe = scriptDir & "\node_modules\electron\dist\electron.exe"

If fso.FileExists(electronExe) Then
  ' 0 = hidden window, False = do not wait for exit
  sh.Run """" & electronExe & """ """ & scriptDir & """", 0, False
Else
  MsgBox "Electron is not installed." & vbCrLf & _
         "Run 'npm install' in this folder first.", vbExclamation, "Pokemon Pet"
End If
