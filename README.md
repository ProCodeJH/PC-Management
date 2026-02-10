# Enterprise PC Management Dashboard 🖥️

> 학원/교실 PC를 실시간으로 모니터링하고 원격 제어하는 대시보드

## ⚡ 빠른 시작

```bash
# 1. 서버 설치 & 실행
cd dashboard/backend
npm install
npm start

# 2. 브라우저에서 열기
# http://localhost:3001
```

**기본 관리자 계정:** `admin` / `admin123`

## 📦 구조

```
├── dashboard/
│   ├── backend/          # Express + Socket.IO 서버 (포트 3001)
│   ├── frontend/         # 대시보드 UI (v4.0 Premium Dark)
│   └── agent/            # 학생 PC에 설치하는 에이전트
├── deployment/           # 네트워크 배포 스크립트
└── logging/              # 프로그램/웹 사용 로거
```

## 🎯 주요 기능

| 기능 | 설명 |
|------|------|
| 📊 실시간 모니터링 | CPU, 메모리, 프로세스 실시간 확인 |
| 📺 화면 스트리밍 | Socket.IO 기반 실시간 화면 보기 |
| ⌨️ 커맨드 팔레트 | `Ctrl+K`로 빠른 액션 실행 |
| 🔒 프로그램 차단 | 게임, 유튜브 등 차단 |
| 🚀 원클릭 배포 | 에이전트 자동 설치 |
| 📡 네트워크 스캔 | 서브넷 자동 PC 탐색 |
| 💬 메시지 전송 | 학생 PC에 팝업 메시지 |
| 📸 스크린샷 | 원격 스크린샷 캡처 |

## 🖥️ 학생 PC 에이전트 설치

```bash
cd dashboard/agent
npm install
node agent.js
```

환경변수 `SERVER_URL`로 서버 주소 설정 (기본: `http://localhost:3001`)

## ⌨️ 단축키

| 키 | 동작 |
|----|------|
| `Ctrl+K` | 커맨드 팔레트 열기 |
| `R` | 전체 새로고침 |
| `?` | 단축키 도움말 |
| `Esc` | 모달/팔레트 닫기 |

## 🛠️ 환경 설정

`.env` 파일은 선택사항입니다. 없어도 기본값으로 실행됩니다.

```env
PORT=3001
JWT_SECRET=your-secret-key
DEFAULT_ADMIN_PASSWORD=admin123
```

## 📋 기술 스택

- **Backend:** Node.js, Express, Socket.IO, SQLite3
- **Frontend:** Vanilla JS, Chart.js, CSS3 (Glassmorphism)
- **Security:** JWT, bcrypt, Helmet, Rate Limiting
- **Agent:** Node.js, screenshot-desktop, systeminformation

## 📄 라이선스

MIT
