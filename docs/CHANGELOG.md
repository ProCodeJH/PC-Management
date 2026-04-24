# Changelog

## v24 — Clean Slate (2026-04-24)

**리포지토리 히스토리 초기화**. 이전 커밋은 모두 orphan으로 정리.

### 추가
- **`/remote.html`** 독립 원격 뷰어 (Parsec 스타일)
  - 자동 코덱 결정 (MSE H.264 → MJPEG 폴백)
  - Hover 툴바 (2.5s auto-hide)
  - 드래그&드롭 파일 업로드 → 학생 `C:\Users\...\Desktop`
  - 단축키: `F` 풀스크린, `Ctrl+Shift+M` 제어 토글
  - 자동 재연결 + 오버레이 토스트
- **Vercel × Parsec 다크 테마** 대시보드 (CSS 400라인 추가, 155 app.js ID 유지)
  - Pure black 배경, hairline borders, no shadows
  - 펄스 링 LED + JetBrains Mono 수치
  - 단일 accent blue
  - prefers-reduced-motion 지원
- **docs/** 폴더 (SETUP, STUDENT-DEPLOY, USAGE, TROUBLESHOOTING, CHANGELOG)

### 제거
- 세션 녹화 전체 (서버 3 엔드포인트 + 2 소켓 핸들러 + 프론트 UI)
- Admin Control Center 트레이 앱 (admin-center.ps1, launcher.vbs, Desktop bat)
- Emergency Recovery 스크립트
- 레거시 디렉토리 14개 (accounts, installer, security, remote-support, time-control, dist, release, landing 등)
- 레거시 스크립트 11개 (setup.bat, Master-Setup.ps1, Build-Installers.ps1 등)
- 테스트 JSON 파일 5개 (check-ffmpeg.json, kill-agent*.json, test-h264-*.json)
- 약 **300MB** 빌드 아티팩트

### 변경
- README 전면 재작성 (v23 + v3.21 반영)
- `.gitignore` 강화 (recordings/, temp-uploads/, input-helper.exe 등)
- `JHS 대시보드 열기.bat` 라벨 v3.8 → v3.21
- PC 카드 클릭: 모달 → 새 창 `/remote.html?pc=NAME`

---

## Server v23.0.0

### 신규 엔드포인트
- `GET /api/stream-stats` — 전체 PC 스트림 텔레메트리
- `GET /api/pcs/:name/stream-stats` — 개별 PC
- `GET /api/pcs/:name/monitors` — 멀티 모니터 열거

### 신규 소켓 이벤트
- `h264-diag` 양방향 릴레이
- `viewer-quality-${PC}` 적응 비트레이트
- `input-ping/pong-${PC}` RTT 측정
- `clipboard-changed/set-${PC}` 양방향 동기화
- `file-download-request-${PC}` (PC → 대시보드)

### 버그 수정
- `start-stream-request` 릴레이가 `mode` 드랍하던 문제 (MJPEG 강제됨)
- Self-registration 감지 strict (hostname substring → exact match)
- `_streamModeByPc` Map으로 재연결 시 모드 복원

---

## Agent v3.21 — Self-healing Edition

### 신규 (v3.20 대비)

| 기능 | 상세 |
|---|---|
| **Atomic update** | `fs.renameSync` + `fsync` — 같은 볼륨에서 단일 syscall atomic 교체 |
| **Post-write 무결성 재검증** | 디스크에서 SHA256 재해시하여 서버 해시와 매칭 |
| **Update lock 타임아웃** | `_updateInProgress` 5분 후 자동 해제 (hang 방어) |
| **HTTP 다운로드 타임아웃** | `req.setTimeout(60_000)` — 무한 대기 근절 |
| **Memory watchdog** | RSS > 600MB × 3회 연속 (3분) 시 자발적 `process.exit(2)` |
| **Crash counter** | 10분 내 5회 uncaught → `process.exit(1)` (watchdog 재기동 트리거) |
| **Backup 자동 복원** | 손상(size < 5KB) 감지 시 `agent.js.bak`에서 rollback |

### 기존 유지
- Disconnect watchdog (2분 끊김 시 강제 재연결)
- `_updateInProgress` concurrent guard
- DXGI → gdigrab cascade
- H.264 cascade (libx264 → h264_qsv/nvenc/amf/mf)
- Adaptive bitrate (viewer drop rate 기반)
- Clipboard 2s polling
- File transfer chunked (256KB)

---

## Agent v3.3 → v3.20 (참고용)

이전 히스토리는 v24 orphan commit으로 삭제됐지만, 주요 변경은:

- **v3.4-3.7**: Socket.IO 안정성 개선
- **v3.8-3.13**: 원격 제어 + 파일 전송 정리
- **v3.14-3.17**: H.264 fMP4 + MSE 스트리밍
- **v3.18**: Adaptive bitrate + 입력 RTT 측정
- **v3.19**: `_updateInProgress` guard 최초 도입
- **v3.20**: HW 인코더 캐스케이드 확장, C# InputHelper 1.2.0 (Win/Meta 키)
- **v3.21** (현재): 본 문서 상단 참조

---

## 향후 (제안)

- Agent v3.22: WebRTC direct P2P 스트리밍 (서버 relay 우회, 지연 <30ms 목표)
- Server v24: HTTP/3 + QUIC
- 모바일 원격 뷰어 (iPad Safari 지원)
- 학생별 접근 권한 그룹화 (교사/조교/관리자)
- AI 행동 이상 탐지 (예: 시험 중 특정 사이트 새 탭)
