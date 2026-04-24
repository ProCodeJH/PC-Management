# 학생 PC USB 배포 가이드

학생 PC 1대당 약 **3분**. 30대 기준 1시간 반.

---

## 0. 준비물

- USB 스틱 (4GB+, NTFS 또는 exFAT 포맷)
- 학생 PC의 **로컬 관리자 비밀번호**
- 관리자 PC IP 주소 (예: `192.168.0.5`)

---

## 1. USB 빌드 (첫 1회만)

### 1-1. 저장소 복사

```powershell
# 관리자 PC에서
xcopy /E /I C:\...\PC-Management\build-out\* D:\
```

(D:\가 USB 드라이브 문자라고 가정)

### 1-2. 바이너리 다운로드 (git에 포함 안 됨)

`D:\Student-Setup\` 에 다음 3개 파일 배치:

| 파일 | 출처 | 크기 |
|---|---|---|
| `ffmpeg.exe` | <https://www.gyan.dev/ffmpeg/builds/> 의 `ffmpeg-release-essentials.zip`의 `bin\ffmpeg.exe` | ~200MB |
| `node.exe` | <https://nodejs.org/dist/v20.18.0/node-v20.18.0-win-x64.zip> 의 `node.exe` | ~85MB |
| `input-helper.exe` | `dashboard/agent/input-helper.cs` 를 PowerShell의 `Add-Type`으로 컴파일 (admin-setup.ps1 실행 시 자동) | 10KB |

### 1-3. 서버 주소 설정

`D:\Student-Setup\.env` 편집:

```env
SERVER_URL=http://192.168.0.5:3001
```

### 1-4. 검증

USB 안에 아래 파일이 다 있는지 확인:
```
D:\
├── INSTALL-STUDENT.bat
├── CLEAN-OLD.bat
├── DIAGNOSE-AGENT.bat
└── Student-Setup\
    ├── agent.js          ← 126 KB (v3.21)
    ├── node.exe          ← ~85 MB
    ├── ffmpeg.exe        ← ~200 MB
    ├── input-helper.exe  ← ~10 KB
    ├── package.json
    ├── .env              ← SERVER_URL 설정됨
    ├── autostart.bat
    └── start-hidden.vbs
```

---

## 2. 학생 PC 설치 (매 PC마다)

### 2-1. USB 연결 → 관리자 권한 실행

1. 학생 PC에 USB 꽂기
2. `D:\INSTALL-STUDENT.bat` 우클릭 → **관리자 권한으로 실행**
3. UAC 프롬프트 승인

### 2-2. 진행 관찰

10단계 진행:
```
[1/10] Kill agent              ← 구버전 정지
[2/10] Remove old install
[3/10] Create C:\PCAgent
[4/10] Copy files
[5/10] Install schtask
[6/10] Startup folder shortcut
[7/10] Firewall rules
[8/10] Test connectivity
[9/10] Start agent
[10/10] Verify
```

### 2-3. 완료 확인

마지막 메시지:
```
========================================
  INSTALLATION COMPLETE
  Agent v3.21 running
  Connected to http://192.168.0.5:3001
========================================
```

**USB 뽑지 말고** 관리자 PC 대시보드에서 해당 학생 PC가 "online"으로 뜨는지 확인 (보통 5-10초 내).

### 2-4. 이름 확인

관리자 PC 대시보드에서:
- PC 이름 형식: `<hostname>-<ip마지막자리>` (예: `DESKTOP-42A0B1-42`)
- 좌석 번호와 매칭시켜 `display_name` 설정 (카드 더블클릭 → 이름 편집)

---

## 3. 문제 생겼을 때

### 3-1. 설치 실패 → 재시도

```
D:\CLEAN-OLD.bat  (관리자 권한)
D:\INSTALL-STUDENT.bat  (관리자 권한)
```

CLEAN-OLD가:
- `C:\PCAgent` 삭제
- schtask 제거
- Startup 바로가기 제거
- 레지스트리 Run 항목 제거
- hosts 파일 차단 해제

### 3-2. 연결 안 됨 → 진단

```
D:\DIAGNOSE-AGENT.bat  (관리자 권한)
```

체크 항목:
- node.exe 실행 중인지
- `C:\PCAgent\agent.js` 존재 + 크기 5KB+
- `C:\PCAgent\logs\agent.log` 최근 기록
- `SERVER_URL` ping 도달
- 방화벽 규칙 활성

### 3-3. 완전 초기화 → 재설치

```
D:\CLEAN-OLD.bat  (관리자 권한)
shutdown /r /t 0   # 재부팅
# 재부팅 후
D:\INSTALL-STUDENT.bat  (관리자 권한)
```

---

## 4. 설치 후 확인사항

관리자 PC 대시보드에서:

1. **online LED (녹색 펄스)** — 10초 이내 점등
2. **CPU/RAM** 값 → 실시간 갱신
3. **PC 카드 클릭** → 원격 뷰어 열림 (`/remote.html?pc=NAME`)
4. **화면 표시** → 2-3초 내 학생 PC 화면 나타남

안 되면 [TROUBLESHOOTING.md](TROUBLESHOOTING.md) 참조.

---

## 5. Agent v3.21 자가 복구 특징

한번 설치하면:
- 업데이트는 **자동** (서버에 새 버전 올리면 10분 내 전 PC 반영)
- 크래시해도 watchdog이 10초 내 재기동
- 메모리 누수 시 (600MB+) 자발적 재시작
- 디스크 쓰기 손상 시 backup에서 자동 복원

**재방문 거의 불필요**. USB는 초기 설치 + 극한 복구용.
