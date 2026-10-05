# 오름홈 백엔드 API

부동산 전략 분석 서비스의 백엔드 API 서버입니다.

## 프로젝트 구조

```
backend/
├── server.js                 # 메인 서버 파일
├── package.json
├── .env.example             # 환경변수 예시
├── .env                     # 실제 환경변수 (로컬만)
│
├── models/
│   ├── User.js              # 사용자 정보 스키마
│   └── Analysis.js          # 분석 결과 스키마
│
├── routes/
│   ├── analysis.js          # 분석 API
│   ├── realEstate.js        # 부동산 데이터 API
│   └── users.js             # 사용자 정보 API
│
└── services/
    ├── analysisService.js   # 분석 로직
    └── realEstateService.js # 부동산 데이터 처리
```

## 설치 및 실행

### 1. 환경 설정

```bash
# 패키지 설치
npm install

# .env 파일 설정
cp .env.example .env
```

### 2. MongoDB 연결

로컬에서 테스트할 경우:
```bash
# MongoDB가 실행 중이어야 함
mongod
```

또는 MongoDB Atlas 클라우드 사용:
```
MONGODB_URI=mongodb+srv://user:password@cluster.mongodb.net/ormhome
```

### 3. 서버 실행

```bash
# 개발 모드 (자동 리로드)
npm run dev

# 프로덕션 모드
npm start
```

서버는 `http://localhost:5000`에서 실행됩니다.

## API 엔드포인트

### 분석 API (`/api/analysis`)

#### POST /api/analysis/analyze
사용자 정보를 기반으로 부동산 전략 분석

**요청:**
```json
{
  "salary": "5000-7000",
  "family": "married-1child",
  "savings": "10000-20000",
  "currentHome": "jeonse",
  "experiences": ["apt"],
  "priority": "own-home",
  "timeline": "1year",
  "region": "서울 강남구",
  "saveResult": true
}
```

**응답:**
```json
{
  "strategy": {
    "title": "청약 + 전세 조합 전략",
    "description": "...",
    "type": "apartment-lease-combo",
    "score": 75
  },
  "details": {
    "qualification": ["✓ 첫 주택 구매 자격 있음", ...],
    "actions": ["청약 통장 개설 (미보유 시)", ...],
    "warnings": ["• 청약 당첨까지 1~3년...", ...],
    "risks": ["당첨 불확실성", ...]
  },
  "scores": {
    "affordability": 75,
    "readiness": 65,
    "opportunity": 80,
    "overall": 73
  },
  "regionData": {
    "name": "서울 강남구",
    "avgPrice": 8500,
    "prediction": 2
  },
  "confidence": 85
}
```

#### GET /api/analysis/loan-simulation
대출 상환 시뮬레이션

**파라미터:**
- `principal`: 대출액 (만원, 필수)
- `rate`: 연이율 (기본값: 3.5%)
- `months`: 상환 개월 (기본값: 360개월)

**예시:**
```
GET /api/analysis/loan-simulation?principal=30000&rate=3.5&months=360
```

#### GET /api/analysis/price-trend
지역별 가격 추세

**파라미터:**
- `region`: 지역명 (필수)
- `months`: 조회 개월 수 (기본값: 12)

#### GET /api/analysis/region-info
지역 상세 정보

**파라미터:**
- `region`: 지역명 (필수)

#### GET /api/analysis/stats
분석 통계 (대시보드용)

### 부동산 API (`/api/real-estate`)

#### GET /api/real-estate/regions
지원하는 지역 목록

#### GET /api/real-estate/price/:region
지역 평균 가격 정보

#### GET /api/real-estate/apartments/:region
지역의 청약 정보

#### GET /api/real-estate/trend/:region
지역의 가격 추세

**파라미터:**
- `months`: 조회 개월 (기본값: 12)

### 사용자 API (`/api/users`)

#### POST /api/users
사용자 정보 저장

#### GET /api/users/stats
익명 통계

## 환경변수 설정

```env
# 서버
PORT=5000
NODE_ENV=development

# MongoDB
MONGODB_URI=mongodb://localhost:27017/ormhome

# API 키 (추후 설정)
MOLIT_API_KEY=
PUBLIC_DATA_API_KEY=

# CORS
CORS_ORIGIN=http://localhost:3000
```

## 다음 단계

### Phase 2 (우선순위 높음)
- [ ] 국토교통부 실거래가 API 연동
- [ ] 실시간 시세 데이터 캐싱
- [ ] 지역별 예측 알고리즘 개선

### Phase 3
- [ ] 청약 정보 API 연동
- [ ] 세금 계산 로직 고도화
- [ ] 인증 시스템 (JWT)

### Phase 4
- [ ] 고급 분석 (비교, 시뮬레이션)
- [ ] 캐싱 최적화 (Redis)
- [ ] API 문서 자동화 (Swagger)

## 기술 스택

- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: MongoDB + Mongoose
- **HTTP Client**: Axios
- **Middleware**: CORS, dotenv

## 주의사항

### 개인정보 보호
- 사용자 데이터는 30일 후 자동 삭제됨 (TTL 인덱스)
- IP와 User-Agent는 분석 용도로만 저장
- 개인식별 정보는 저장하지 않음

### 데이터 정확성
- 현재는 샘플 데이터 사용 중
- 실제 API 연동 시 정확도 증가
- 예측값은 참고용이며 실제 상황은 다를 수 있음

## 개발 시 유용한 명령어

```bash
# 개발 서버 (nodemon)
npm run dev

# 프로덕션 시뮬레이션
npm start

# MongoDB 로컬 테스트
mongo test_ormhome

# API 테스트 (curl)
curl http://localhost:5000/health
curl -X POST http://localhost:5000/api/analysis/analyze \
  -H "Content-Type: application/json" \
  -d '{"salary":"5000-7000","family":"married","priority":"own-home"}'
```

## 문제 해결

### MongoDB 연결 실패
```bash
# MongoDB 서비스 시작 (Mac)
brew services start mongodb-community

# MongoDB 서비스 시작 (Linux)
sudo systemctl start mongod
```

### 포트 이미 사용 중
```bash
# 포트 변경
PORT=5001 npm run dev

# 포트 프로세스 확인
lsof -i :5000
```

## 라이센스

MIT
