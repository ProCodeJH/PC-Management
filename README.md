# JHS PC Manager

학원/교실 PC 관리 플랫폼 — 실시간 모니터링, 원격 제어(TeamViewer 대체),
사이트/프로그램 차단, 배경화면 잠금, 드래그앤드롭 파일 전송.

**Server v23.0.0** · **Agent v3.21 (self-healing)** · **Frontend: Vercel × Parsec dark**

## 📚 문서

| 문서 | 용도 |
|---|---|
| [docs/SETUP.md](docs/SETUP.md) | 관리자 PC + 서버 셋업 (npm install → 첫 실행) |
| [docs/STUDENT-DEPLOY.md](docs/STUDENT-DEPLOY.md) | 학생 PC USB 배포 단계별 가이드 |
| [docs/USAGE.md](docs/USAGE.md) | 일상 사용 매뉴얼 (원격 뷰어, 파일 전송, 차단, CCTV) |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | 자주 겪는 문제 11가지 해결법 |
| [docs/CHANGELOG.md](docs/CHANGELOG.md) | 버전 기록 (v24 / v23 / Agent v3.21) |

---

## Quick Start

```bash
git clone https://github.com/ProCodeJH/PC-Management.git
cd PC-Management
```

### 사전 요구사항

| 항목 | 버전 | 비고 |
|---|---|---|
| Windows | 10 / 11 | x64 |
| Node.js | 20+ (권장 24) | 관리자 PC만 |
| ffmpeg | 6.x | 학생 PC용 (Student-Setup에 배치) |

### 초기 셋업 (관리자 PC)

```powershell
# 관리자 권한 PowerShell
cd PC-Management\dashboard\backend
npm install

# 서버 첫 실행
node server.js
```

대시보드 접근: <http://localhost:3001>   (기본 로그인 `admin` / `admin123` — 변경 권장)

### 학생 PC 바이너리 준비

`.gitignore`에 의해 큰 바이너리는 저장소에 포함되지 않는다. 직접 받아 `build-out/Student-Setup/` 에 복사:

1. **ffmpeg.exe** — <https://www.gyan.dev/ffmpeg/builds/> 의 "essentials" 빌드의 `bin/ffmpeg.exe` 추출
2. **node.exe** — <https://nodejs.org/dist/v20.x.x/node-v20.x.x-win-x64.zip> 에서 `node.exe` 추출
3. **input-helper.exe** — `admin-setup.ps1` 실행 시 C# 소스에서 자동 컴파일

---

## 구조

```
PC-Management/
├── dashboard/
│   ├── backend/            Express + Socket.IO 서버 (포트 3001)
│   │   ├── server.js       메인 서버 v23.0 — 142KB, 소켓 + REST
│   │   ├── license.js      HMAC-SHA256 라이선스 검증
│   │   ├── config.js       서버 설정
│   │   └── routes/         API 라우트
│   ├── frontend/           Vanilla JS + Tailwind (CDN)
│   │   ├── index.html      대시보드 (Vercel dark theme)
│   │   ├── remote.html     원격 뷰어 (Parsec style) — 독립 풀스크린 페이지
│   │   └── app.js          PCManager 클래스
│   └── agent/              학생 PC 에이전트
│       └── agent.js        v3.21 — 자가 복구 에디션
├── build-out/              USB 배포용
│   ├── INSTALL-STUDENT.bat 학생 PC 원클릭 설치
│   ├── CLEAN-OLD.bat       구버전 제거 도구
│   ├── DIAGNOSE-AGENT.bat  진단 스크립트
│   └── Student-Setup/      에이전트 번들 (+ 바이너리 별도)
├── admin-setup.ps1         관리자 PC 풀 셋업 (UAC)
├── start-server.bat        서버 빠른 실행
├── .gitignore
└── README.md
```

---

## 서버 (관리자 PC)

### 실행

```powershell
# 수동
cd dashboard\backend
node server.js

# 또는 자동화
.\start-server.bat
```

부팅 시 자동 실행: `admin-setup.ps1`이 All Users Startup에 `JHS-Server.lnk` 바로가기 등록.

### 환경변수 — `dashboard/backend/.env`

| 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `3001` | 서버 포트 |
| `JWT_SECRET` | (auto) | JWT 서명 키 — 프로덕션은 반드시 변경 |
| `SERVER_URL` | — | 학생 agent가 보는 서버 주소 (에이전트 `.env`) |

### 주요 엔드포인트

- `GET  /api/health` — 서버 헬스 + 스케줄러 + DB 레이턴시
- `GET  /api/pcs` — 등록된 PC 목록
- `POST /api/pcs/:name/command` — 개별 명령
- `POST /api/pcs/:name/send-file` — 파일 전송 (→ 학생 Desktop)
- `GET  /remote.html?pc=NAME` — 독립 원격 뷰어
- 상세: `GET /api/docs`

---

## 학생 PC 에이전트

### USB 설치 (1회)

1. `build-out/` 전체 복사 → USB
2. ffmpeg.exe / node.exe / input-helper.exe 를 `Student-Setup/` 에 배치 (위 "사전 요구사항" 참조)
3. 학생 PC 에서 `INSTALL-STUDENT.bat` → **관리자 권한 실행**
4. 10단계 진행, 완료 후 재부팅 없이 즉시 동작

### Agent v3.21 자가 복구 기능

| 기능 | 상세 |
|---|---|
| Atomic update | `renameSync` + fsync, 부분쓰기 방지 |
| Post-write 재검증 | 디스크에서 SHA256 재해시 |
| Backup 복원 | agent.js.bak, 손상 감지 시 자동 rollback |
| Update lock 5분 타임아웃 | 다운로드 hang 방어 |
| HTTP 다운로드 60초 타임아웃 | 무한 대기 방지 |
| Memory watchdog | RSS > 600MB × 3분 → 자발적 재시작 |
| Crash counter | 10분 5회 초과 → watchdog 재기동 트리거 |
| Disconnect watchdog | 2분 끊김 → 강제 재연결 |

### 설치 결과

- `C:\PCAgent\` — 에이전트 파일
- schtask + Startup 이중화 (로그인 시 자동 실행, 숨김 vbs)
- Windows Defender 방화벽 규칙 추가
- `C:\PCAgent\logs\` — 순환 로그

---

## 대시보드 기능

| 범주 | 기능 |
|---|---|
| **모니터링** | 온/오프라인, CPU, 메모리, 업타임, 스트림 통계 |
| **원격 뷰어** | `/remote.html` 독립 페이지, 자동 코덱 (H.264 → MJPEG), hover 툴바, FPS/지연 실시간 |
| **원격 제어** | 마우스/키보드/스크롤, Win/Meta 키 지원, 클립보드 양방향 동기화 |
| **파일 전송** | 원격 뷰어 창에 드래그 → 학생 `C:\Users\...\Desktop` 저장, 진행바 토스트 |
| **CCTV 모드** | 모든 PC 동시 감시 grid |
| **사이트 차단** | hosts 파일 기반, 25개 서브도메인 변형 |
| **프로그램 차단** | 프로세스명 + 시험 모드 (user-space만 kill) |
| **배경화면 잠금** | 3초 주기 레지스트리 체크, DB 영속 |
| **출석/WOL** | 접속 기반 자동 기록, MAC 기반 원격 부팅 |
| **에이전트 업데이트** | 소켓 이벤트 트리거, 자가 교체 |

---

## 원격 뷰어 사용법

1. 대시보드에서 online PC 카드 클릭 → 새 창에 `/remote.html?pc=NAME` 열림
2. 초기: 스트림 자동 시작 (H.264 지원 브라우저면 fMP4, 아니면 MJPEG)
3. 상단 hover → 툴바 표시 (PC명, LED, 지연, FPS, 해상도, 전체화면/제어/닫기)
4. **단축키**:
   - `F` — 전체화면 토글
   - `Ctrl+Shift+M` — 원격 제어 ON/OFF
   - `Esc` — 전체화면 해제
5. **파일 업로드**: 윈도우에 파일 드래그 → 학생 Desktop 자동 저장 (100MB까지)

---

## 기술 스택

- **서버**: Node.js v20+, Express 4, Socket.IO 4, better-sqlite3
- **프론트**: Vanilla JS, Tailwind CSS (CDN), MediaSource Extensions (H.264 fMP4)
- **에이전트**: Node.js, ffmpeg (DXGI Desktop Duplication → gdigrab 폴백), C# InputHelper (SendInput API)
- **인증**: JWT, HMAC-SHA256 라이선스
- **DB**: SQLite WAL 모드, 12 인덱스, mmap 512MB, LRU 500
- **디자인**: Pretendard Variable + JetBrains Mono, OKLCH 토큰 (Vercel/Parsec 참고)

---

## 주의사항

- 에이전트는 **사용자 세션**에서 실행해야 화면 캡처 가능 (SYSTEM 서비스 불가)
- `INSTALL-STUDENT.bat`은 반드시 **관리자 권한**
- 선생 PC에는 에이전트 설치 금지 (사이트 차단이 본인 PC에 적용됨)
- `license.key`, `.env`, `*.db`, `*.log` — `.gitignore` 처리, 공유 금지
- BAT 파일은 EUC-KR + CRLF 인코딩 필수 (chcp 65001 프롤로그로 UTF-8 OK)

---

## 라이선스

학원 내부 사용. 외부 배포 금지.
