# Grid Shape Shooter

실시간 1:1 대전 액션 퍼즐. 8x4 그리드 두 개, 도형 유지 블록 발사, 7개 캐릭터 아키타입. Google AI Studio에서 시작한 프로젝트를 로컬 개발/배포용으로 옮긴 것이다.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/GimYH/grid-shape-shooter-)

## 실행

```sh
npm install
npm run dev      # http://localhost:3000
```

배포 빌드:

```sh
npm run build
NODE_ENV=production npm run start
```

온라인 대전은 WebSocket 서버(`server.ts`)가 필요해서 정적 호스팅만으로는 안 된다. Render 무료 웹 서비스로 올리면 된다 (위 버튼, `render.yaml` 참고). 무료 플랜은 15분 미사용 시 슬립한다.

## 조작법

- 싱글/온라인: 방향키 또는 WASD 이동, Space 발사, Shift 대시, Ctrl 스킬, X/E 타일 폐기
- 로컬 2인: P1 WASD + Space/Shift좌/Ctrl좌/X, P2 방향키 + Enter/Shift우/Ctrl우/`/`

## 멀티플레이 구조

- 방 코드 6자리, 서버가 시드 1개를 양쪽에 동일하게 내려준다.
- 위치 20Hz, 스킬·발사·폐기는 성공 후에만 전송.
- 스킬 랜덤 효과는 발동 측이 뽑은 타일을 패킷에 담아 전달하고, 상대는 그대로 적용한다.
- 보드는 3초마다 색상 해시를 교환하고, 어긋나면 스냅샷으로 맞춘다.

자세한 수정 내역은 [FIXES.md](FIXES.md) 참고.
