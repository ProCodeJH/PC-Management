# 시간 제어 시스템 (Time Control)

## PC 사용 시간 제한

학원/PC방 운영 시간에만 PC 사용을 허용합니다.

---

## 사용 방법

### 시간 제한 설정

```powershell
# 기본 설정 (09:00 - 22:00, 월-토)
.\Set-TimeRestriction.ps1 -StartTime "09:00" -EndTime "22:00"

# 평일만 (월-금)
.\Set-TimeRestriction.ps1 -StartTime "08:00" -EndTime "20:00" -DaysOfWeek "Mon,Tue,Wed,Thu,Fri"

# 주말 포함
.\Set-TimeRestriction.ps1 -StartTime "10:00" -EndTime "18:00" -DaysOfWeek "Mon,Tue,Wed,Thu,Fri,Sat,Sun"
```

### 시간 제한 해제

```powershell
.\Set-TimeRestriction.ps1 -Remove
```

---

## 작동 방식

```
현재 시간 체크 (5분마다)
↓
허용 시간인가?
├─ YES → 정상 사용
└─ NO → 화면 잠금 + 메시지 표시
```

---

## 파일 구성

```
time-control/
├── Set-TimeRestriction.ps1   - 시간 제한 설정
└── README.md                 - 이 파일

자동 생성 파일:
C:\ProgramData\EnterprisePC\TimeControl\
├── time-config.json          - 설정 파일
└── Check-TimeLimit.ps1       - 체크 스크립트
```

---

## 주의사항

> [!WARNING]
> **관리자 작업 시**
> 
> 관리자가 시간 외 작업을 해야 할 경우:
> ```powershell
> .\Set-TimeRestriction.ps1 -Remove
> # 작업 후 재설정
> .\Set-TimeRestriction.ps1 -StartTime "09:00" -EndTime "22:00"
> ```
