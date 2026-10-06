# 오름홈 배포 가이드

## 현재 구성

| 레이어 | 호스팅 | URL |
|--------|--------|-----|
| 프론트엔드 | GitHub Pages (자동배포) | https://shinhyuk.github.io/Home/ |
| 백엔드 | Render (Blueprint) | https://ormhome-backend-sirl.onrender.com |

## 백엔드 배포 (Render, 최초 1회)

1. https://dashboard.render.com 접속 → **GitHub 계정으로 가입/로그인**
2. 우측 상단 **New + → Blueprint** 클릭
3. `shinhyuk/Home` 저장소 선택 (처음이면 "Connect GitHub" 승인)
4. `render.yaml`이 자동 인식됨 → **MOLIT_API_KEY** 입력란에 공공데이터포털 인증키 붙여넣기
5. **Apply** 클릭 → 2~3분 후 배포 완료

이후에는 `backend/` 폴더에 푸시할 때마다 자동 재배포됩니다.

### 서비스 이름이 달라진 경우

`ormhome-backend` 이름이 이미 사용 중이면 Render가 다른 이름을 붙입니다.
그 경우 실제 URL을 확인한 뒤:
- 프론트 페이지 하단 **⚙ 백엔드 API 설정**에서 주소를 바꾸거나
- `frontend/api.js`의 기본값과 `.github/workflows/keepalive.yml`의 핑 주소를 수정해서 푸시

## 무료 플랜 특성

- Render 무료: 15분 무요청 시 슬립 → 첫 응답 ~1분 지연
- 완화책: `.github/workflows/keepalive.yml`이 10분마다 /health 핑 (저장소가 활성 상태일 때)
- MongoDB 없이 동작 (메모리 캐시). 영속 캐시가 필요하면 MongoDB Atlas 무료 티어 연결 후
  Render 환경변수에 `MONGODB_URI` 추가

## 배포 확인

```
https://ormhome-backend-sirl.onrender.com/health          → {"status":"OK",...}
https://ormhome-backend-sirl.onrender.com/api/real-estate/regions → 지역 목록
```

프론트(https://shinhyuk.github.io/Home/)에서 정보 입력 → 분석이 되면 끝.

## 단지 좌표 (지도 핀) 정확도 — VWorld 키 (선택)

단지 지도의 핀 위치는 매일 수집 때 아래 순서로 채워집니다.

1. **VWorld 지오코더** (국토부 공간정보 오픈플랫폼) — 지번 주소 → 정확한 위치. `VWORLD_API_KEY` 시크릿이 있을 때만.
2. OpenStreetMap(Overpass) — 동 범위 안의 이름 있는 아파트와 단지명 매칭
3. 동 중심 근사 위치 (지도에 점선 핀으로 표시)

정확한 핀을 원하면:
1. https://www.vworld.kr 회원가입 → 마이페이지 → **오픈API 인증키 발급** (서비스 URL은 `https://shinhyuk.github.io` 로)
2. GitHub 저장소 → Settings → Secrets and variables → Actions → **New repository secret**
   - Name: `VWORLD_API_KEY`, Value: 발급받은 키
3. 다음 새벽 수집부터 자동 반영 (하루 최대 4,000단지씩 정확 위치로 교체)
