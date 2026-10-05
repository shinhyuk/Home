// 국토부 실거래 데이터 수집기 — GitHub Actions에서 실행
// (Render 등 해외 클라우드 IP는 국토부 API가 403 차단 → Actions 러너가 대신 수집)
// 사용: node backend/scripts/collect.js <출력디렉토리>
const fs = require('fs');
const path = require('path');
const molitApi = require('../services/molitApi');
const { LAWD_CODES } = require('../config/lawdCodes');

// 수집 범위: 분석 엔진이 실제로 쓰는 (유형 × 개월수)
const PLAN = [
  { type: 'apt-trade', months: 6 },  // 추세 분석용
  { type: 'apt-rent', months: 2 },
  { type: 'offi-trade', months: 2 },
  { type: 'rh-trade', months: 2 },
];

function recentMonths(n) {
  const list = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 1; i <= n; i++) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    list.push(`${m.getFullYear()}${String(m.getMonth() + 1).padStart(2, '0')}`);
  }
  return list;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const outDir = process.argv[2] || 'out';
  if (!process.env.MOLIT_API_KEY) {
    console.error('MOLIT_API_KEY 환경변수가 없습니다. GitHub Secrets에 등록하세요.');
    process.exit(1);
  }

  const codes = [...new Set(Object.values(LAWD_CODES))];
  let ok = 0, fail = 0;

  for (const { type, months } of PLAN) {
    for (const ym of recentMonths(months)) {
      for (const code of codes) {
        try {
          const items = await molitApi.fetchMonth(type, code, ym);
          const dir = path.join(outDir, type, code);
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, `${ym}.json`), JSON.stringify(items));
          ok++;
        } catch (err) {
          fail++;
          console.error(`FAIL ${type}/${code}/${ym}: ${err.message}`);
        }
        await sleep(150); // 공공서버 배려
      }
      console.log(`${type} ${ym} 완료 (누적 성공 ${ok} / 실패 ${fail})`);
    }
  }

  fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify({
    collectedAt: new Date().toISOString(),
    files: ok,
    failures: fail,
    usage: molitApi.getDailyUsage(),
  }, null, 2));

  console.log(`수집 완료: 성공 ${ok}, 실패 ${fail}`);
  // 성공이 하나도 없으면 실패 처리 (키 오류 등)
  if (ok === 0) process.exit(1);
}

main();
