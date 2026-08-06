Option Explicit

Dim shell
Dim fileSystem
Dim scriptFolder
Dim commandFile

Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")

scriptFolder = fileSystem.GetParentFolderName(WScript.ScriptFullName)
commandFile = fileSystem.BuildPath(scriptFolder, "start-ois-agent.cmd")

' 두 번째 인수 0:
' 명령 프롬프트·PowerShell 창을 보이지 않게 실행
'
' 세 번째 인수 False:
' 프로그램이 끝날 때까지 기다리지 않음
shell.Run Chr(34) & commandFile & Chr(34), 0, False