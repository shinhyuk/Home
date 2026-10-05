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
