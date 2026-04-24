Set ws = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

Dim backendDir
backendDir = "C:\Users\exodia\.local\bin\PC-Management\dashboard\backend"

' Check if port 3001 is already in use
Dim result
Set result = ws.Exec("netstat -ano")
Dim output
output = result.StdOut.ReadAll()
If InStr(output, ":3001") > 0 And InStr(output, "LISTENING") > 0 Then
    WScript.Quit 0
End If

' Start server
ws.CurrentDirectory = backendDir
ws.Run "node server.js", 0, False
