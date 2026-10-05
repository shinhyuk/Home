# 오름홈 백엔드 API

부동산 전략 분석 서비스 백엔드. **국토교통부 실거래가 공개시스템 6종 API 실연동 완료.**

## 연동된 공공데이터 API (6종)

| 유형 | 엔드포인트 키 | 국토부 서비스 |
|------|--------------|--------------|
| 아파트 매매 | `apt-trade` | RTMSDataSvcAptTradeDev |
| 아파트 전월세 | `apt-rent` | RTMSDataSvcAptRent |
| 오피스텔 매매 | `offi-trade` | RTMSDataSvcOffiTrade |
| 오피스텔 전월세 | `offi-rent` | RTMSDataSvcOffiRent |
| 연립다세대 매매 | `rh-trade` | RTMSDataSvcRHTrade |
| 연립다세대 전월세 | `rh-rent` | RTMSDataSvcRHRent |

모두 동일한 공공데이터포털 인증키 1개 사용 (`MOLIT_API_KEY`).

## 프로젝트 구조

```
backend/
├── server.js                  # Express 서버 (MongoDB 없어도 동작)
├── config/
│   └── lawdCodes.js           # 지역명 → 법정동코드(LAWD_CD) 매핑 + 별칭("강남","판교" 등)
├── models/
│   ├── User.js                # 사용자 입력 (TTL 30일 자동삭제)
│   └── Analysis.js            # 분석 결과 (TTL 30일 자동삭제)
├── routes/
│   ├── analysis.js            # 전략 분석 / 대출 계산
│   ├── realEstate.js          # 시세 조회 / 추세 / 사용량
│   └── users.js               # 익명 통계
└── services/
    ├── molitApi.js            # 국토부 API 클라이언트 (XML 파싱, 재시도, 페이징, 사용량 추적)
    ├── cacheService.js        # 메모리 + MongoDB 2단 캐시 (트래픽 10,000/일 보호)
    ├── realEstateService.js   # 실거래 집계 (평균/중위/평당가, 전세가율, 월별 추세)
    └── analysisService.js     # 전략 엔진 (DSR/LTV 대출한도, 예산비율, 전략 결정)
```

## 설치 및 실행

```bash
cd backend
npm install
cp .env.example .env   # MOLIT_API_KEY 입력
npm start              # http://localhost:5000
```

MongoDB는 선택사항: 없으면 메모리 캐시로 동작, 있으면 캐시 영속화 + 분석 결과 저장.

## 핵심 API

### POST /api/analysis/analyze — 전략 분석 (핵심 상품)

```json
// 요청
{
  "salary": "5000-7000",
  "family": "married-1child",
  "savings": "10000-20000",
  "currentHome": "jeonse",
  "priority": "own-home",
  "timeline": "1year",
  "region": "강남"
}
```

응답에 포함되는 것:
- `strategy` — 전략 판정 (즉시매매 / 청약+전세 / 자금축적 / 투자 / 갈아타기 등)
- `details` — 자격·액션플랜·경고 (실데이터 기반: 전세가율 경고, 추세 경고)
- `scores` — 구매력(실제 중위가 대비)·준비도·기회도·예산비율
- `loanSimulation` — DSR 40% 대출한도, 월상환액, 부족자금
- `regionData` — 실거래 통계 + 6개월 월별 추세
- `confidence` — 거래량 기반 신뢰도

### 시세 조회

```
GET /api/real-estate/regions           # 지원 지역 목록 (약 80개 시군구)
GET /api/real-estate/price/강남         # 분석용 요약 시세
GET /api/real-estate/summary/강남       # 종합 (아파트+오피스텔+연립, 매매+전월세)
GET /api/real-estate/trend/강남?months=6&type=apt-trade
GET /api/real-estate/usage             # 일일 API 호출량 (10,000 한도 모니터링)
```

지역명은 유연하게 매칭: `"강남"`, `"서울 강남구"`, `"판교"`, `"분당"` 모두 인식.

### 대출 계산

```
GET /api/analysis/loan-simulation?principal=44000&rate=3.5&months=360
GET /api/analysis/loan-capacity?income=6000&housePrice=280000
```

## 트래픽 전략 (10,000/일 한도)

- (유형 × 지역 × 월) 단위 캐싱 — 같은 지역 재조회는 API 호출 0회
- 최근 2개월: 6시간 캐시 (신고 지연 반영) / 과거 월: 7일 캐시
- 신규 지역 1곳 최초 분석 ≈ 12콜 → 캐시 후 0콜
- 실측: 강남구 첫 분석 20콜, 이후 분석 0.025초/0콜

## 검증된 실측 결과 (2026-10 기준)

서울 강남구: 평균 29.0억 / 중위 28.0억 / 평당 1.14억 / 전세가율 36% / 6개월 +2.7% 상승

## 주의사항

- `.env`의 인증키는 커밋 금지 (`.gitignore` 처리됨)
- 공공망 특성상 간헐적 연결 끊김 → 지수 백오프 재시도 4회 내장
- 출처 표시 의무: "국토교통부 실거래가 공개시스템" (응답에 `dataSource` 포함)
- 사용자 데이터 30일 TTL 자동삭제 (개인정보 보호)

## 다음 단계

- [ ] 프론트엔드 연결 (프로토타입 → 실 API 호출)
- [ ] 청약홈 분양정보 API 추가
- [ ] 취득세·양도세 계산기
- [ ] 지역 비교 (2~3개 지역 나란히)
- [ ] 배포 (Railway/Render + MongoDB Atlas)
