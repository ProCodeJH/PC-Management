# 활동 로깅 시스템 (Activity Logging)

## 학생 활동 모니터링

실행 중인 프로그램과 활동을 자동으로 기록합니다.

---

## 사용 방법

### 로깅 시작

```powershell
# 기본 설정 (60초 간격)
.\Start-Logging.ps1

# 30초 간격
.\Start-Logging.ps1 -Interval 30

# 대시보드에 전송
.\Start-Logging.ps1 -Dashboard "http://192.168.1.100:3001"
```

### 서비스로 설치 (자동 시작)

```powershell
.\Start-Logging.ps1 -InstallService
```

---

## 기록 항목

| 항목 | 설명 |
|------|------|
| 프로그램 | 실행 중인 모든 프로그램 |
| 창 제목 | 현재 활성 창 제목 |
| CPU/메모리 | 프로세스별 리소스 사용량 |
| 타임스탬프 | 기록 시간 |

---

## 로그 파일 위치

```
C:\ProgramData\EnterprisePC\Logs\
├── Programs\
│   ├── programs-2026-01-10.csv
│   └── active-windows-2026-01-10.csv
├── Websites\
│   └── (웹 기록)
└── Reports\
    └── (생성된 리포트)
```

---

## 리포트 생성

```powershell
# 최근 7일 HTML 리포트
.\Export-Logs.ps1 -Days 7

# 최근 30일 CSV 리포트
.\Export-Logs.ps1 -Days 30 -Output CSV
```
