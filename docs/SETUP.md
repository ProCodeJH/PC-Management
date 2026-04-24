# 관리자 PC 셋업 가이드

서버와 대시보드를 실행하는 **관리자 PC** 구축 단계. 학생 PC 셋업은 [STUDENT-DEPLOY.md](STUDENT-DEPLOY.md) 참조.

---

## 0. 요구사항

| 항목 | 버전 | 비고 |
|---|---|---|
| Windows | 10 / 11 x64 | |
| Node.js | 20+ (권장 24 LTS) | <https://nodejs.org/> |
| RAM | 8 GB+ | PC 30대 동시 스트리밍 시 |
| 네트워크 | 학생 PC와 동일 LAN | 또는 Tailscale VPN |
| 관리자 권한 | 필수 | UAC 승인 |

---

## 1. 클론 & 설치

```powershell
# PowerShell (관리자 권한)
cd C:\Users\<본인>\  # 원하는 위치
git clone https://github.com/ProCodeJH/PC-Management.git
cd PC-Management\dashboard\backend
npm install
```

`npm install`은 1-2분 걸린다. `better-sqlite3` 네이티브 컴파일이 오래 걸릴 수 있다.

---

## 2. 환경변수 설정 — `.env`

`dashboard/backend/.env` 파일 생성:

```env
PORT=3001
JWT_SECRET=<openssl rand -hex 32 로 생성한 긴 문자열>
WS_RATE_LIMIT_PER_SECOND=100
LOG_LEVEL=info
```

**중요**:
- `JWT_SECRET`은 반드시 **새로 생성**. 기본값 쓰면 토큰 위조 가능.
- `.env`는 `.gitignore`에 있어서 커밋 안 됨. 공유 금지.

---

## 3. 첫 실행

```powershell
cd C:\...\PC-Management\dashboard\backend
node server.js
```

출력 예시:
```
[server] v23.0.0 listening on :3001
[db] schema applied, 12 indexes ready, WAL on
[scheduler] 6 jobs registered
```

브라우저에서 <http://localhost:3001> 열기.

### 기본 로그인

- ID: `admin`
- PW: `admin123`

**즉시 변경**: 상단 우측 사용자 메뉴 → `비밀번호 변경`.

---

## 4. 자동 시작 등록 (부팅 시 서버 실행)

방법 1 — **admin-setup.ps1 사용 (권장)**:

```powershell
# PowerShell (관리자 권한)
cd C:\...\PC-Management
.\admin-setup.ps1
```

이 스크립트가:
- 기존 에이전트/구버전 서버 정리
- All Users Startup 폴더에 `JHS-Server.lnk` 등록
- hosts 파일 차단 정리
- 서버 v23 즉시 시작

방법 2 — **수동 바로가기**:

1. `Win + R` → `shell:common startup` 입력
2. 새 바로가기 → 대상: `"C:\Program Files\nodejs\node.exe" server.js`
3. 시작 위치: `C:\...\PC-Management\dashboard\backend`
4. 창 스타일: 최소화

---

## 5. 방화벽

Windows Defender 방화벽이 3001 포트를 막지 않는지 확인:

```powershell
# 관리자 권한 PowerShell
New-NetFirewallRule -DisplayName "JHS PC Manager" -Direction Inbound -Protocol TCP -LocalPort 3001 -Action Allow
```

학생 PC에서 **관리자 PC의 IP**로 접속해야 한다. 확인:

```powershell
ipconfig | findstr IPv4
```

---

## 6. 학생 PC용 `.env` 준비

`build-out/Student-Setup/.env`에 관리자 PC IP 기록:

```env
SERVER_URL=http://192.168.0.5:3001
```

IP가 바뀌면 USB 재빌드 필요. DHCP라면 **관리자 PC에 고정 IP 권장**.

---

## 7. Startup 검증

관리자 PC를 **재부팅**해서 자동 실행 확인:

```powershell
# 재부팅 후
curl http://localhost:3001/api/health
```

`"status":"healthy"`가 나오면 성공.

---

## 8. 다음 단계

- 학생 PC 배포 → [STUDENT-DEPLOY.md](STUDENT-DEPLOY.md)
- 일상 사용법 → [USAGE.md](USAGE.md)
- 문제 생기면 → [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
