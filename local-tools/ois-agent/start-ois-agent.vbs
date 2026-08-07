Option Explicit

Dim shell
Dim fileSystem
Dim scriptFolder
Dim commandFile
Dim exitCode

Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")

scriptFolder = fileSystem.GetParentFolderName(WScript.ScriptFullName)
commandFile = fileSystem.BuildPath(scriptFolder, "start-ois-agent.cmd")

' 두 번째 인수 0:
' CMD / PowerShell 창을 보이지 않게 실행
'
' 세 번째 인수 True:
' CMD 안의 Node OIS Agent가 실행되는 동안
' VBS도 같이 대기한다.
'
' 이렇게 해야 작업 스케줄러가
' OIS Agent를 "실행 중"인 작업으로 계속 인식한다.
exitCode = shell.Run( _
  Chr(34) & commandFile & Chr(34), _
  0, _
  True _
)

WScript.Quit exitCode