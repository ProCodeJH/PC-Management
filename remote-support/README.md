# 원격 지원 시스템 (Remote Support)

## 관리자 원격 접속 설정

학생 PC에 원격으로 접속하여 문제를 해결합니다.

---

## 사용 방법

### RDP 활성화

```powershell
# 기본 설정
.\Install-RemoteSupport.ps1 -Tool RDP

# 특정 사용자 허용
.\Install-RemoteSupport.ps1 -Tool RDP -AllowUsers "teacher,admin"
```

### RDP 비활성화

```powershell
.\Install-RemoteSupport.ps1 -Remove
```

---

## 원격 접속 방법

1. **관리자 PC에서:**
   - `Win + R` → `mstsc` 입력
   - 학생 PC IP 주소 입력
   - 관리자 계정으로 로그인

2. **또는 대시보드에서:**
   - PC 카드 클릭 → 원격 접속 버튼

---

## 보안 설정

| 설정 | 값 |
|------|-----|
| 포트 | 3389 (기본) |
| NLA | 활성화 |
| 방화벽 | 자동 구성 |
| 암호화 | TLS 1.2+ |

---

## 주의사항

> [!WARNING]
> **보안 주의**
> 
> - 반드시 강력한 관리자 비밀번호 사용
> - 외부 네트워크 노출 금지 (내부망만)
> - 정기적으로 연결 로그 확인
