# BRIGHTEM 출퇴근·급여관리 시스템

BRIGHTEM REALTY CORP.(세부, 필리핀 건설현장)의 주급 출퇴근·급여 관리 웹 애플리케이션입니다.
출퇴근 입력 → 급여 계산 → 급여명세서 발행까지 하나의 흐름으로 이어집니다.

## 구성 (모노레포)

```
payroll-app/
  packages/shared   @brightem/shared  — 공용 도메인 타입 + 기본 설정(DEFAULT_CONFIG)
  packages/engine   @brightem/engine  — 순수 급여 계산 엔진 (Vitest 단위테스트)
  apps/api          @brightem/api     — Express + SQLite REST API (포트 4000)
  apps/web          @brightem/web     — React + Vite + Tailwind UI (포트 5173)
```

세 패키지는 모두 `@brightem/shared`의 타입을 가져다 쓰며, 도메인 타입은 한 곳
(`packages/shared/src/types.ts`)에서만 정의합니다.

## 사전 준비

- Node.js 18 이상 (권장: 20 / 22 LTS)
- npm 9 이상

## 설치

프로젝트 루트(`payroll-app/`)에서 한 번만 실행하면 워크스페이스 전체가 설치됩니다.

```bash
npm install
```

> 참고: `apps/api`는 `better-sqlite3`(네이티브 모듈)를 사용합니다. 설치 시
> 컴파일이 필요하므로 인터넷 연결과 빌드 도구(예: Windows는 "Desktop
> development with C++", macOS는 Xcode Command Line Tools)가 있어야 합니다.

## 실행

터미널 두 개를 사용합니다.

```bash
# 1) API 서버 (포트 4000) — 최초 실행 시 seed.json으로 DB 자동 시드
npm run dev:api

# 2) 웹 UI (포트 5173) — 브라우저에서 http://localhost:5173 접속
npm run dev:web
```

웹은 `VITE_API_URL` 환경변수로 API 주소를 바꿀 수 있습니다(기본값
`http://localhost:4000`).

## 테스트

```bash
# 급여 계산 엔진 단위 테스트 (Vitest, 15개)
npm test
```

알려진 검증 케이스: 일당 540원 × 6일 = 기본급 3,240원, 인센티브 60원,
총지급 3,300원.

## 급여 계산 규칙 설정 (중요)

법정 공제율(SSS · PhilHealth · Pag-IBIG)과 각종 할증 배수(OT, 야간, 휴일 등)는
`packages/shared/src/config.ts`의 `DEFAULT_CONFIG`에 **임시 기본값(placeholder)**
으로 들어 있습니다. 이 값들은 실제 회사 공식 수치가 아니며, 다음 두 방법으로
교체할 수 있습니다.

1. 웹 UI의 "규칙 설정" 화면에서 입력 (API `PUT /api/config`로 저장)
2. `config.ts`의 기본값을 직접 수정

엔진에는 어떤 수치도 하드코딩되어 있지 않으며, 모두 이 설정 객체에서 읽습니다.

## API 엔드포인트 (base URL `/api`)

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| GET | `/api/employees` | 인부 목록(반/직종/일당 포함) |
| GET | `/api/crews` | 반(crew) 목록 |
| GET | `/api/periods` | 급여 기간 목록 |
| GET | `/api/attendance?period=` | 해당 기간 출퇴근 표 |
| POST | `/api/attendance` | 출퇴근 기록 등록/수정 |
| GET | `/api/payroll?period=` | 전 인원 급여 계산 결과 |
| GET | `/api/payslip/:employeeId?period=` | 개인 급여명세서 |
| GET | `/api/config` | 급여 규칙 설정 조회 |
| PUT | `/api/config` | 급여 규칙 설정 저장 |

## 화면 / Screens (English default, Korean toggle)

Dashboard · Attendance · Payroll · Payslip · Employees · Settings
(대시보드 · 출퇴근 입력 · 급여표 · 급여명세서 · 인부 관리 · 규칙 설정)

기본 언어는 **영어**이며, 상단 바의 `EN / 한국어` 토글로 전체 UI(메뉴·폼·표)를
한국어로 전환할 수 있습니다. 선택한 언어는 브라우저에 저장됩니다. 문자열은
`apps/web/src/i18n.tsx` 한 곳에서 관리합니다. (색상: 기본 #2E75B6, 진한색 #15304e)

## 시드 데이터

`apps/api/src/seed.json` — 회사/주소, 급여기간 "JUNE 19-25, 2026",
반 7개, 인부 143명, 각 인부의 해당 기간 출퇴근이 포함되어 있습니다.
API 최초 실행 시 DB가 비어 있으면 자동으로 시드됩니다.

## 실제 데이터 반영 (엑셀 → 시드) / Import a real workbook

회사 주간 엑셀 워크북(`BRIGHTEM CONSTRUCTION PAYROLL <기간>.xlsx`)을 그대로
시드로 변환합니다. `PAYROLL SHEET` 탭이 급여의 최종 권위 소스입니다(실제 명세서를
만드는 시트). 결근/인센티브/요율 컬럼을 그대로 읽습니다.

```bash
# 1) 엑셀 → seed.json 생성 (기본 출력: apps/api/src/seed.json)
npm run import -- "/경로/BRIGHTEM CONSTRUCTION PAYROLL JUNE 19-25, 2026.xlsx"

# 원본 시드를 덮어쓰지 않고 임시 파일로 먼저 확인하려면 두 번째 인자로 출력 경로 지정
npm run import -- "/경로/워크북.xlsx" /tmp/seed-new.json

# 2) DB 재시드 (기존 DB가 있으면 apps/api/data/brightem.db 삭제 후 실행)
rm -f apps/api/data/brightem.db
npm run dev:api      # 최초 실행 시 seed.json 자동 로드
```

읽는 컬럼(PAYROLL SHEET, 데이터는 7행부터): H 이름 · I 닉네임 · L 직급 ·
N 일당 · O 근무일수 · Q 휴무근무(DRD) · S 특별공휴일 · U 법정공휴일 ·
W 잔업시간 · AI 야간시간 · AR 출근일수 · AS 인센티브 일당 · AU 결근 · AW 지각.
출근일수(AR)·결근(AU)은 반일(예: 4.5)을 지원하며, 소수 0.5는 `half`(반일)로
기록되어 시트의 기본급(= 일당 × 출근일수)과 정확히 일치합니다. 인센티브 칸이
비어 있으면 0으로(요율 대체가 아님) 처리하여 시트와 동일하게 계산합니다.

> 검증: 실제 워크북(JUNE 19-25, 2026)의 인부 141명 전원에 대해 엔진의 총지급액
> (GROSS)과 실지급액(NET)이 시트의 AY·K 컬럼과 100% 일치함을 확인했습니다.
