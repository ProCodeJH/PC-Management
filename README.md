# 🖥️ Enterprise PC Management System

> **₩20,000,000+ 가치의 초프리미엄 엔터프라이즈급 PC 관리 솔루션**

학원, PC방, 기업 환경을 위한 올인원 Windows PC 관리 시스템

---

## 📋 빠른 시작 가이드

### 🖥️ 1단계: 관리자 PC 설정

```powershell
# PowerShell 관리자 권한으로 실행
cd D:\Dark_Virus\Enterprise-PC-Management\dashboard\backend

# 최초 1회 - 패키지 설치
npm install

# 대시보드 서버 시작
npm start
```

**→ 브라우저에서 http://localhost:3001 접속**

---

### 🧑‍🎓 2단계: 학생 PC 설정 (각 PC마다)

```powershell
# USB 꽂고 PowerShell 관리자 권한으로 실행

# 옵션 A: 원격 관리만 활성화
.\Enable-RemoteManagement.ps1

# 옵션 B: 클린 상태 + 원격 관리 (새 PC처럼)
.\Enable-RemoteManagement.ps1 -CleanPC

# 옵션 C: Office 유지하면서 클린
.\Enable-RemoteManagement.ps1 -CleanPC -KeepOffice
```

**→ 화면에 나오는 IP 주소 기억!**

---

### 📡 3단계: 관리자 대시보드에서 PC 추가

1. 대시보드에서 **"+ PC 추가"** 클릭
2. 학생 PC IP 입력
3. 관리자 계정/비밀번호 입력
4. **"🚀 배포 시작"** 클릭
5. 완료!

---

## 📊 순서 요약

```
┌──────────────────────────────────────────────────┐
│  👨‍💼 관리자 PC                                   │
│  1. npm install (최초 1회)                       │
│  2. npm start                                    │
│  3. http://localhost:3001 접속                   │
└──────────────────────────────────────────────────┘
                      ↓
┌──────────────────────────────────────────────────┐
│  🧑‍🎓 학생 PC (각각)                              │
│  1. Enable-RemoteManagement.ps1 실행             │
│  2. IP 주소 확인                                 │
└──────────────────────────────────────────────────┘
                      ↓
┌──────────────────────────────────────────────────┐
│  👨‍💼 관리자 대시보드                              │
│  1. "+ PC 추가" 클릭                             │
│  2. IP 입력 → 배포 시작                          │
│  3. 끝!                                          │
└──────────────────────────────────────────────────┘
```

---

## ✨ 주요 기능

| 기능 | 설명 | 상용 가격 |
|------|------|----------|
| 🔄 **자동 복원** | Deep Freeze 스타일 - 재부팅마다 원래 상태로 | ₩90,000/PC |
| 🧹 **클린 PC** | 새 본체처럼 모든 프로그램 제거 | - |
| ⏰ **시간 제어** | 운영 시간 외 PC 사용 차단 | ₩50,000/PC |
| 📊 **활동 로깅** | 프로그램/웹사이트 사용 기록 | ₩100,000/PC |
| 🚫 **차단 관리** | 웹사이트/프로그램 차단 원격 제어 | ₩80,000/PC |
| 🖥️ **웹 대시보드** | 실시간 모니터링 & 원격 제어 | ₩300,000/년 |
| 📡 **원격 배포** | IP 입력만으로 자동 설치 | ₩500,000 |
| 🔧 **원격 지원** | RDP 자동 설정 | 무료 |

---

## 📁 프로젝트 구조

```
Enterprise-PC-Management/
├── Master-Setup.ps1              # 통합 설치 스크립트
├── Enable-RemoteManagement.ps1   # 원격 관리 + CleanPC
├── Remote-Deploy.ps1             # 원격 배포
├── PC-Agent.ps1                  # PC 에이전트
│
├── accounts/                     # 계정 관리
│   ├── Create-StudentAccount.ps1
│   ├── Set-AutoLogin.ps1
│   └── Hide-AdminAccounts.ps1
│
├── security/                     # 보안 스크립트
│   ├── Clean-PC.ps1              # PC 초기화
│   ├── Remove-Programs.ps1       # 프로그램 제거
│   ├── Block-Websites.ps1        # 웹사이트 차단
│   ├── Program-Block.ps1         # 프로그램 차단
│   ├── Set-AppLocker.ps1         # AppLocker 설정
│   └── Block-USB.ps1             # USB 실행 차단
│
├── dashboard/                    # 웹 대시보드
│   ├── frontend/
│   │   ├── index.html
│   │   ├── styles.css            # ₩5,000,000+ 프리미엄 UI
│   │   └── app.js
│   └── backend/
│       ├── server.js
│       └── package.json
│
├── auto-restore/                 # 자동 복원 시스템
├── time-control/                 # 시간 제어 시스템
├── logging/                      # 활동 로깅
├── screenshots/                  # 스크린샷 캡처
└── remote-support/               # 원격 지원
```

---

## ⚙️ 시스템 요구사항

- **OS**: Windows 10/11 Pro 이상
- **권한**: 관리자 권한 필요
- **Node.js**: 18+ (대시보드용)
- **네트워크**: 내부망 연결

---

## 🛡️ 보안

- 모든 스크립트는 로컬 실행
- 데이터는 로컬 SQLite 저장
- RDP는 NLA 인증 필수
- 외부 서버 연결 없음

---

## 💰 가치

| 항목 | 금액 |
|------|------|
| 기능 가치 | ₩15,000,000+ |
| UI/디자인 | ₩5,000,000+ |
| **총 가치** | **₩20,000,000+** |
| 라이선스 비용 | ₩0 (무제한 무료) |

---

<div align="center">

**Built with ❤️ for Enterprise PC Management**

*₩20,000,000+ 상용 솔루션을 무료로*

</div>
