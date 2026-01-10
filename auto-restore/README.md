# 자동 복원 시스템 (Auto-Restore System)

## PC방 스타일 자동 복원

학생이 무엇을 설치하거나 변경해도, 매일 자정과 재부팅 시 자동으로 깨끗한 상태로 복원됩니다.

---

## 파일 구성

```
auto-restore/
├── Create-Snapshot.ps1       - 마스터 스냅샷 생성
├── Restore-Snapshot.ps1      - 스냅샷으로 복원
├── Enable-AutoRestore.ps1    - 자동 복원 활성화
├── Disable-AutoRestore.ps1   - 자동 복원 비활성화
└── README.md                 - 이 파일
```

---

## 사용 방법

### 초기 설정 (1회만)

```powershell
# 1. 시스템을 깨끗한 상태로 만들기
#    - USB-Complete-Setup.ps1 실행
#    - 필요한 교육 프로그램 설치
#    - 모든 설정 완료

# 2. 마스터 스냅샷 생성
.\Create-Snapshot.ps1
# "YES" 입력하여 확인
```

이제 자동 복원이 활성화되었습니다!

---

## 자동 복원 스케줄

| 트리거 | 실행 시간 | 설명 |
|--------|----------|------|
| **매일** | 자정 (00:00) | 하루 동안의 모든 변경사항 제거 |
| **재부팅** | PC 시작 시 | 부팅할 때마다 깨끗한 상태 |

---

## 작동 방식

```
학생이 게임 설치
↓
사용...
↓
자정 또는 재부팅
↓
자동으로 원래 상태로 복원!
↓
게임 삭제됨 ✅
```

---

## 관리자 작업 시

### 일시 중지 (시스템 변경 작업)

```powershell
# 자동 복원 비활성화
.\Disable-AutoRestore.ps1

# 필요한 작업 수행
# - 프로그램 설치
# - 설정 변경
# 등등...

# 작업 완료 후 재활성화
.\Enable-AutoRestore.ps1
```

### 새로운 마스터 스냅샷 생성

```powershell
# 영구적인 변경사항을 적용하려면
.\Create-Snapshot.ps1
# 현재 상태가 새 기준점이 됨
```

---

## 작동 확인

### 상태 확인

```powershell
# Scheduled Tasks 확인
Get-ScheduledTask | Where-Object { $_.TaskName -like "AutoRestore*" }

# 마지막 복원 기록
Get-Content C:\ProgramData\EnterprisePC\AutoRestore\restore-log.txt -Tail 10
```

### 수동 복원 테스트

```powershell
# 즉시 복원
.\Restore-Snapshot.ps1
```

---

## 기술 상세

**사용 기술:**
- Windows Volume Shadow Copy Service (VSS)
- Task Scheduler
- PowerShell Automation

**디스크 공간:**
- 스냅샷 저장: 최대 50GB
- 실제 사용: 10-20GB (압축)

**복원 속도:**
- USB 스크립트 재실행: 5-10분
- 전체 시스템 복원 시간

---

## 주의사항

> [!WARNING]
> **중요한 파일 저장**
> 
> 학생들의 과제나 프로젝트는 반드시:
> - USB에 저장
> - 클라우드(OneDrive, Google Drive)에 저장
> - 서버에 업로드
> 
> 로컬 PC에만 저장하면 자정에 사라집니다!

> [!IMPORTANT]
> **관리자 작업**
> 
> 영구적인 변경 작업 시:
> 1. `Disable-AutoRestore.ps1` 실행
> 2. 작업 수행
> 3. `Create-Snapshot.ps1` 실행 (새 기준점)
> 4. `Enable-AutoRestore.ps1` 실행

---

## 문제 해결

### 자동 복원이 작동하지 않음

```powershell
# Task 상태 확인
Get-ScheduledTask -TaskName "AutoRestore-Daily"
Get-ScheduledTask -TaskName "AutoRestore-Startup"

# 재등록
.\Create-Snapshot.ps1
```

### VSS 서비스 문제

```powershell
# VSS 서비스 재시작
Restart-Service VSS

# VSS 상태 확인
vssadmin list shadows
```

---

## 상용 제품과 비교

| 기능 | Deep Freeze | 우리 시스템 |
|------|-------------|-------------|
| 자동 복원 | ✅ 즉시 (재부팅) | ✅ 자정 + 재부팅 |
| 비용 | ₩90,000/PC | ✅ 무료 |
| 설정 변경 | 어려움 | ✅ 쉬움 |
| 커스터마이징 | 제한적 | ✅ 자유 |

---

## 다음 단계

자동 복원 시스템이 설정되었으면:

1. **사용 시간 제한** 추가
   - 학원 운영시간만 PC 사용
   
2. **웹 활동 로깅** 추가
   - 학생 활동 모니터링
   
3. **중앙 관리 대시보드** 구축
   - 모든 PC 한눈에 관리
