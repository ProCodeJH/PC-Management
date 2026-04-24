# 중앙 관리 웹 대시보드

## 실시간 PC 모니터링 및 제어

모든 학생 PC를 한눈에 관리하는 웹 기반 대시보드

---

## 설치 방법

### 1. Node.js 설치

https://nodejs.org 에서 LTS 버전 다운로드 및 설치

### 2. 백엔드 설치

```powershell
cd C:\Users\MIN\Downloads\Enterprise-PC-Management\dashboard\backend
npm install
```

### 3. 백엔드 실행

```powershell
npm start
```

서버가 http://localhost:3001 에서 실행됩니다.

### 4. 프론트엔드 열기

브라우저에서:
```
http://localhost:3001
또는
C:\Users\MIN\Downloads\Enterprise-PC-Management\dashboard\frontend\index.html
```

### 5. 각 PC에 에이전트 설치

학생 PC에서:
```powershell
cd D:\Dark_Virus  # 또는 C:\Enterprise-PC-Management
.\PC-Agent.ps1
```

---

## 기능

### 실시간 모니터링
- 온라인/오프라인 상태
- CPU 사용률
- 메모리 사용률
- 마지막 응답 시간

### 원격 제어
- PC 잠금
- 강제 재부팅
- 메시지 전송 (추가 예정)
- 프로그램 실행 (추가 예정)

### 통계
- 전체 PC 수
- 온라인 PC 수
- 오늘 활동 수

---

## 사용 시나리오

### 관리자 PC에서
```
1. 대시보드 실행 (npm start)
2. 브라우저 열기
3. 실시간 모니터링
4. 필요 시 원격 제어
```

### 학생 PC에서
```
1. PC-Agent.ps1 자동 시작 (Task Scheduler)
2. 30초마다 상태 전송
3. 명령 대기
4. 명령 수신 시 실행
```

---

## API 엔드포인트

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | /api/pcs | PC 목록 조회 |
| POST | /api/pcs/:name/command | 명령 전송 |
| GET | /api/logs | 활동 로그 |
| GET | /api/stats | 통계 |

---

## WebSocket 이벤트

| 이벤트 | 방향 | 설명 |
|--------|------|------|
| register-pc | PC → Server | PC 등록 |
| update-status | PC → Server | 상태 업데이트 |
| log-activity | PC → Server | 활동 기록 |
| pc-updated | Server → All | PC 업데이트 알림 |
| command-{pcname} | Server → PC | 명령 실행 |

---

## 데이터베이스

SQLite (enterprise-pc.db)

**테이블:**
- pc_status: PC 상태
- activity_logs: 활동 로그
- settings: 시스템 설정

---

## 다음 단계

대시보드 완성! Week 2-3 나머지 기능 구현 중...
