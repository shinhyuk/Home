// 국토부 실거래 데이터 수집기 — GitHub Actions에서 실행
// (Render 등 해외 클라우드 IP는 국토부 API가 403 차단 → Actions 러너가 대신 수집)
// 사용: node backend/scripts/collect.js <출력디렉토리>
// 필요 환경변수: MOLIT_API_KEY (GitHub Secrets에 등록)
// 지역 코드: 2026.7 행정개편 반영 (전남광주통합특별시 12, 인천 재편)
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

  // 전국 지역 요약 생성 (지역 추천용 — 백엔드가 summary.json 하나만 읽으면 됨)
  const summary = buildSummary(outDir);
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary));
  console.log(`지역 요약 생성: ${summary.regions.length}개 지역`);

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

const PYEONG = 3.3058;

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return []; }
}

function median(sorted) {
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function buildSummary(outDir) {
  const nameByCode = {};
  for (const [name, code] of Object.entries(LAWD_CODES)) {
    if (!nameByCode[code]) nameByCode[code] = name;
  }

  const months6 = recentMonths(6); // 최신순
  const months2 = months6.slice(0, 2);
  const regions = [];

  for (const [code, name] of Object.entries(nameByCode)) {
    // 최근 2개월 매매 통계
    const recent = months2.flatMap((ym) => readJson(path.join(outDir, 'apt-trade', code, `${ym}.json`)))
      .filter((i) => !i.cancelled && i.dealAmount > 0);
    if (!recent.length) continue;

    const amounts = recent.map((i) => i.dealAmount).sort((a, b) => a - b);
    const withArea = recent.filter((i) => i.area > 0);
    const perP = withArea.map((i) => i.dealAmount / (i.area / PYEONG));
    const avgPerPyeong = perP.length ? Math.round(perP.reduce((a, b) => a + b, 0) / perP.length) : null;

    // 6개월 평당가 추세
    const monthly = months6.slice().reverse().map((ym) => {
      const items = readJson(path.join(outDir, 'apt-trade', code, `${ym}.json`))
        .filter((i) => !i.cancelled && i.dealAmount > 0 && i.area > 0);
      if (!items.length) return null;
      return Math.round(items.reduce((a, i) => a + i.dealAmount / (i.area / PYEONG), 0) / items.length);
    });
    const valid = monthly.filter((v) => v);
    let changeRate = null;
    if (valid.length >= 2) {
      changeRate = Math.round(((valid[valid.length - 1] - valid[0]) / valid[0]) * 1000) / 10;
    }

    // 전세 (최근 2개월)
    const rents = months2.flatMap((ym) => readJson(path.join(outDir, 'apt-rent', code, `${ym}.json`)))
      .filter((i) => i.monthlyRent === 0 && i.deposit > 0 && i.area > 0);
    const rentPerP = rents.map((i) => i.deposit / (i.area / PYEONG));
    const jeonsePerPyeong = rentPerP.length ? Math.round(rentPerP.reduce((a, b) => a + b, 0) / rentPerP.length) : null;
    const jeonseRatio = avgPerPyeong && jeonsePerPyeong
      ? Math.round((jeonsePerPyeong / avgPerPyeong) * 100) : null;

    regions.push({
      name, code,
      medianPrice: median(amounts),
      avgPrice: Math.round(amounts.reduce((a, b) => a + b, 0) / amounts.length),
      avgPerPyeong,
      tradeCount: recent.length,
      jeonseRatio,
      changeRate,
    });
  }

  return { generatedAt: new Date().toISOString(), regions };
}

main();
