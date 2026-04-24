# 문제 해결

빈도 높은 순.

---

## 1. 학생 PC가 offline이에요

### 1-1. 네트워크 확인

```powershell
# 관리자 PC에서
ping 학생PC_IP
```

응답 없으면 물리 문제 (케이블, 스위치, 전원). 응답 오는데도 offline이면 에이전트 문제.

### 1-2. 학생 PC 에이전트 실행 여부

학생 PC에서 (**관리자 권한 PowerShell**):
```powershell
Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "*PCAgent*" }
```

없으면 → 재시작 필요:
```powershell
wscript.exe "C:\PCAgent\start-hidden.vbs"
```

또는 USB 꽂고 `DIAGNOSE-AGENT.bat` 실행.

### 1-3. 방화벽 차단

학생 PC Windows Defender 방화벽이 `node.exe`를 차단했을 수 있음:
```powershell
New-NetFirewallRule -DisplayName "PCAgent Outbound" -Direction Outbound -Program "C:\PCAgent\node.exe" -Action Allow
```

### 1-4. 서버 주소 오류

`C:\PCAgent\.env` 열기 → `SERVER_URL` 이 관리자 PC IP와 맞는지 확인. 관리자 PC가 DHCP로 IP 바뀌었으면 재설정 필요.

---

## 2. 화면이 안 뜹니다 (원격 뷰어 검정)

### 2-1. "Connecting" 상태에서 멈춤

- 서버-학생 연결은 되는데 스트림이 안 옴
- 학생 PC의 ffmpeg가 실패 중
- 학생 PC에서 `C:\PCAgent\logs\agent.log` 확인:
  ```
  tail -f C:\PCAgent\logs\agent.log
  ```
- `Encoder not available` 메시지 → 코덱 캐스케이드 실패. ffmpeg.exe 파일 누락 가능

### 2-2. 코덱 캐스케이드 실패

Agent는 H.264 HW → libx264 → MJPEG 순으로 폴백. 전부 실패 시 검정.

해결: `D:\Student-Setup\ffmpeg.exe` 가 최신 빌드인지 (v6+). 구버전은 DXGI 지원 미흡.

### 2-3. 검정 + 툴바에 FPS 0

- 브라우저의 MSE 지원 문제 (H.264 재생 안 됨)
- Chrome/Edge 최신 사용 권장 (Firefox도 OK, Safari는 H.264 일부 profile만)
- 자동 fallback MJPEG 해야 하는데 이슈: 리로드 (Ctrl+Shift+R)

---

## 3. 화면이 뚝뚝 끊겨요 / 지연 큼

### 3-1. 네트워크 대역폭 부족

30대 동시 MJPEG = 1.5Gbps+ 필요. 무선 LAN은 한계. **유선 GBE 권장**.

CCTV 모드가 활성화된 상태면 모든 PC가 3fps thumbnail 동시 송출 → 대역폭 폭증.

### 3-2. 학생 PC CPU 100%

Agent의 ffmpeg가 CPU 잡아먹을 수 있음. HW 인코더(`h264_qsv`, `h264_nvenc`)가 있으면 자동 폴백되지만, 없는 경우 `libx264`는 CPU 많이 씀.

학생 PC Task Manager에서 `node.exe` + `ffmpeg.exe` CPU 합산 확인. 20% 이상이면 품질 낮추기:
- 뷰어 툴바 → 해상도 낮추기 (720p)
- FPS 낮추기 (15fps)

### 3-3. 지연 100ms+

- 관리자-학생 간 ping 측정. 50ms+ 나오면 네트워크 문제.
- Tailscale VPN 경유면 DERP 서버 거쳐 ms 증가. Direct P2P 되도록 `tailscale netcheck` 확인.

---

## 4. Windows Script Host 에러 80070002

### 원인

`watchdog.vbs` 또는 `start-hidden.vbs` 가 존재하지 않는 `autostart.bat`을 실행하려 할 때.

### 해결 (v3.21에 이미 포함)

v3.21의 `INSTALL-STUDENT.bat`은 watchdog.vbs 생성 시 `FileExists` 가드를 추가함:
```vbscript
If fs.FileExists("C:\PCAgent\autostart.bat") Then
    ws.Run """C:\PCAgent\autostart.bat""", 0, False
End If
```

**구버전 학생 PC에서 에러 나면**: USB로 재설치 (`CLEAN-OLD.bat` → `INSTALL-STUDENT.bat`).

---

## 5. WebSocket rate limit 경고 (서버 로그)

### 증상

서버 로그에 반복:
```
WS rate limit: DESKTOP-XXX-NN (>100/s)
```

### 원인

학생 PC에 `node.exe` **여러 개 동시 실행** 중 (구버전 + 신버전 중복). 각각 소켓 연결해 rate limit 초과.

### 해결

학생 PC에서:
```powershell
# 관리자 권한
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep 2
wscript.exe "C:\PCAgent\start-hidden.vbs"
```

또는 USB: `CLEAN-OLD.bat` → `INSTALL-STUDENT.bat`.

---

## 6. Agent 업데이트 후 0 byte 파일 (손상)

### v3.21 이전 증상

Auto-update 중 race condition으로 agent.js가 0 byte 됨 → watchdog 무한 재시작 실패.

### v3.21 해결책

- `renameSync` atomic update (부분쓰기 불가능)
- Post-write SHA256 재검증 + 디스크 재해시
- 실패 시 `agent.js.bak` 자동 복원
- Update lock 5분 타임아웃

이미 손상된 PC는 USB 재설치 (CLEAN-OLD + INSTALL).

---

## 7. 서버 시작 실패

### 7-1. 포트 충돌

```
Error: listen EADDRINUSE: address already in use :::3001
```

다른 프로세스가 3001 사용 중:
```powershell
netstat -ano | findstr :3001
taskkill /PID <pid> /F
```

### 7-2. DB 잠금

```
SqliteError: database is locked
```

SQLite WAL 파일이 이전 세션에서 잠김. 해결:
```powershell
cd dashboard\backend
del enterprise-pc.db-wal
del enterprise-pc.db-shm
```
(DB 메인 파일은 건드리지 말 것)

### 7-3. node_modules 문제

```
Error: Cannot find module 'express'
```

```powershell
cd dashboard\backend
rmdir /s /q node_modules
npm install
```

---

## 8. 클립보드 동기화 안 됨

### 원인

브라우저의 clipboard API 권한 요청. HTTPS 아니면 거부될 수 있음.

### 해결

- `localhost` 접속 시에는 허용됨
- 원격에서 접속 시 `chrome://flags` → `Insecure origins treated as secure` 에 서버 IP 추가
- 또는 self-signed cert + HTTPS 구성

---

## 9. 드래그&드롭 파일 업로드 실패

### 9-1. 100MB 초과

빨간 토스트 `100MB 초과 — 스킵` → 파일 분할 또는 zip 압축.

### 9-2. HTTP 401 / 인증 실패

세션 만료. 대시보드 재로그인 후 뷰어 리로드.

### 9-3. 학생 PC Lock 화면

학생 PC가 잠금 상태면 사용자 Desktop 경로 접근 불가. 학생이 로그인하거나 Ctrl+Alt+Del로 열어야 함.

---

## 10. 로그 보는 방법

### 서버 로그

```powershell
cd dashboard\backend\logs
Get-Content server.log -Tail 50 -Wait
```

### 학생 PC 에이전트 로그

학생 PC에서:
```
C:\PCAgent\logs\agent.log
```

크기가 500KB 넘으면 자동 rotate. 최근 에러는 맨 끝에 있음.

### 실시간 모니터링

관리자 PC에서:
```powershell
# 원격 학생 PC 로그 보기 (관리자 공유 + WinRM 구성 필요)
Invoke-Command -ComputerName 학생IP -ScriptBlock {
  Get-Content C:\PCAgent\logs\agent.log -Tail 20 -Wait
}
```

---

## 11. 그래도 안 될 때

1. GitHub 이슈 생성: <https://github.com/ProCodeJH/PC-Management/issues>
2. 포함할 것:
   - 증상 + 언제부터
   - 서버 로그 마지막 50줄
   - 문제 PC의 agent.log 마지막 50줄
   - `curl http://localhost:3001/api/health` 출력
