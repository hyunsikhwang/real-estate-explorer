# 부동산 실거래가·연속지적도 조회

국토교통부 실거래가와 VWorld 공간정보를 한 화면에서 조회하는 React·Express 애플리케이션입니다.

## 주요 기능

- 아파트 매매·전월세 실거래가 기간 조회
- 지역, 단지명, 가격, 전용면적, 층수 필터
- 가격 추이와 거래량 차트
- 선택 거래의 지번 주소 검색과 PNU 확인
- VWorld WMS 기반 연속지적도 본번·부번 레이어 표시
- VWorld Data API 기반 선택 필지 GeoJSON 경계 강조
- VWorld 장애 시 OpenStreetMap 배경 유지 및 오류 상태 표시

## API 키 설정

`.env.example`을 `.env`로 복사한 뒤 아래 값을 설정합니다.

```env
DATA_GO_KR_SERVICE_KEY=공공데이터포털_디코딩_인증키
VWORLD_API_KEY=브이월드_API_인증키
VWORLD_DOMAIN=http://localhost:3000
```

`VWORLD_DOMAIN`은 VWorld 인증키를 발급할 때 등록한 서비스 도메인과 정확히 같아야 합니다. 배포 환경에서는 실제 서비스의 `https://` 도메인으로 변경해야 합니다.

API 키는 서버에서만 사용하며 브라우저 응답이나 번들에는 포함하지 않습니다. 기존 `VITE_VWORLD_API_KEY`도 이전 설정과의 호환을 위해 읽지만, 새 설정에는 `VWORLD_API_KEY` 사용을 권장합니다.

## 실행

```bash
npm install
npm run dev
```

브라우저에서 `http://localhost:3000`에 접속합니다.

## 검증

```bash
npm run lint
npm test
npm run build
```

연속지적도는 위치 확인용입니다. 경계와 면적에 관한 법적 판단에는 토지대장·지적도 등 공적 장부를 확인해야 합니다.
