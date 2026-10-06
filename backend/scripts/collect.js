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

  // 급매 체결 탐지 (단지 평당 중위가 대비 -7% 이상 저가 체결)
  const bargains = buildBargains(outDir);
  fs.writeFileSync(path.join(outDir, 'bargains.json'), JSON.stringify(bargains));
  console.log(`급매 탐지: ${bargains.items.length}건`);

  // 단지 인덱스 (단지 조회·지도용) + 좌표 증분 수집
  await buildComplexes(outDir, bargains);

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

// 급매 체결 탐지: 최근 2개월 거래 중, 같은 단지 6개월 평당 중위가 대비 -7% 이상 저가
function buildBargains(outDir) {
  const nameByCode = {};
  for (const [name, code] of Object.entries(LAWD_CODES)) {
    if (!nameByCode[code]) nameByCode[code] = name;
  }
  const months6 = recentMonths(6);
  const recent2 = new Set(months6.slice(0, 2));
  const items = [];

  for (const [code, regionName] of Object.entries(nameByCode)) {
    // 단지별 평당가 수집
    const groups = new Map();
    for (const ym of months6) {
      for (const i of readJson(path.join(outDir, 'apt-trade', code, `${ym}.json`))) {
        if (i.cancelled || !(i.dealAmount > 0) || !(i.area > 0) || !i.name) continue;
        // 평당가는 면적이 클수록 낮아지므로, 같은 단지라도 10㎡ 버킷 내에서만 비교
        const key = `${i.name}|${i.dong}|${Math.round(i.area / 10)}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ ...i, ym, pp: i.dealAmount / (i.area / PYEONG) });
      }
    }

    const regionBargains = [];
    for (const [key, list] of groups) {
      if (list.length < 5) continue; // 표본 부족 단지 제외
      const pps = list.map((t) => t.pp).sort((a, b) => a - b);
      const medPP = median(pps.map(Math.round));
      if (!medPP) continue;

      for (const t of list) {
        if (!recent2.has(t.ym)) continue;
        const discount = Math.round(((t.pp / medPP) - 1) * 1000) / 10;
        if (discount > -7) continue;
        regionBargains.push({
          region: regionName,
          name: t.name,
          dong: t.dong,
          jibun: t.jibun || '',
          area: Math.round(t.area * 10) / 10,
          floor: t.floor ?? null,
          price: t.dealAmount,
          date: `${t.dealYear}-${String(t.dealMonth).padStart(2, '0')}-${String(t.dealDay).padStart(2, '0')}`,
          discount,
          medianPP: medPP,
          pp: Math.round(t.pp),
          samples: list.length,
          direct: (t.dealingType || '').includes('직거래'),
        });
      }
    }

    regionBargains.sort((a, b) => a.discount - b.discount);
    items.push(...regionBargains.slice(0, 25)); // 지역당 상한
  }

  items.sort((a, b) => a.discount - b.discount);
  return { generatedAt: new Date().toISOString(), basis: '단지 6개월 평당 중위가 대비, 최근 2개월 체결', items: items.slice(0, 800) };
}

// ───────────────────────── 단지 인덱스 + 좌표 ─────────────────────────

// 지역별 단지 집계 (아파트 6개월 매매): 평형 버킷(10㎡)별 통계 포함
function collectComplexes(outDir) {
  const nameByCode = {};
  for (const [name, code] of Object.entries(LAWD_CODES)) {
    if (!nameByCode[code]) nameByCode[code] = name;
  }
  const months6 = recentMonths(6); // 최신순
  const half = new Set(months6.slice(0, 3));
  const byRegion = {};

  for (const [code, region] of Object.entries(nameByCode)) {
    const groups = new Map();
    for (const ym of months6) {
      for (const i of readJson(path.join(outDir, 'apt-trade', code, `${ym}.json`))) {
        if (i.cancelled || !(i.dealAmount > 0) || !(i.area > 0) || !i.name) continue;
        const key = `${i.name}|${i.dong}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ ...i, ym, pp: i.dealAmount / (i.area / PYEONG) });
      }
    }
    const list = [];
    for (const [key, trades] of groups) {
      const [name, dong] = key.split('|');
      const amounts = trades.map((t) => t.dealAmount).sort((a, b) => a - b);
      const pps = trades.map((t) => Math.round(t.pp)).sort((a, b) => a - b);
      trades.sort((a, b) => (b.dealYear * 10000 + b.dealMonth * 100 + b.dealDay) - (a.dealYear * 10000 + a.dealMonth * 100 + a.dealDay));

      // 평형 버킷
      const buckets = {};
      for (const t of trades) {
        const b = Math.round(t.area / 10);
        if (!buckets[b]) buckets[b] = { trades: [] };
        buckets[b].trades.push(t);
      }
      const bk = {};
      for (const [b, v] of Object.entries(buckets)) {
        const am = v.trades.map((t) => t.dealAmount).sort((x, y) => x - y);
        const ar = v.trades.map((t) => t.area).sort((x, y) => x - y);
        const pp = v.trades.map((t) => Math.round(t.pp)).sort((x, y) => x - y);
        const last = v.trades[0];
        bk[b] = {
          count: v.trades.length,
          area: Math.round(median(ar) * 10) / 10,
          median: median(am), min: am[0], max: am[am.length - 1],
          pp: median(pp),
          last: `${last.dealYear}-${String(last.dealMonth).padStart(2, '0')}-${String(last.dealDay).padStart(2, '0')}`,
          lastPrice: last.dealAmount,
        };
      }

      // 추세: 최근 3개월 vs 이전 3개월 평당 중위 (각 3건 이상일 때)
      const recentPP = trades.filter((t) => half.has(t.ym)).map((t) => Math.round(t.pp)).sort((a, b) => a - b);
      const olderPP = trades.filter((t) => !half.has(t.ym)).map((t) => Math.round(t.pp)).sort((a, b) => a - b);
      let trend = null;
      if (recentPP.length >= 3 && olderPP.length >= 3) {
        trend = Math.round(((median(recentPP) - median(olderPP)) / median(olderPP)) * 1000) / 10;
      }

      const last = trades[0];
      list.push({
        name, dong,
        jibun: trades.find((t) => t.jibun)?.jibun || '',
        buildYear: trades.find((t) => t.buildYear)?.buildYear || null,
        count: trades.length,
        medianPrice: median(amounts),
        minPrice: amounts[0], maxPrice: amounts[amounts.length - 1],
        pp: median(pps),
        trend,
        last: `${last.dealYear}-${String(last.dealMonth).padStart(2, '0')}-${String(last.dealDay).padStart(2, '0')}`,
        buckets: bk,
      });
    }
    list.sort((a, b) => b.count - a.count);
    byRegion[code] = { region, code, complexes: list };
  }
  return byRegion;
}

// 이름 해시 → 동 중심 근사 좌표 흩뿌리기 (같은 동 단지들이 겹치지 않게)
function jitter(name, lat, lon) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const ang = (h % 360) * Math.PI / 180;
  const r = 0.0012 + (h % 7) * 0.0004;
  return { lat: lat + Math.sin(ang) * r, lon: lon + Math.cos(ang) * r * 1.25 };
}

function writeComplexIndex(outDir, byRegion, geo, bargains) {
  const bgCount = new Map();
  for (const b of bargains.items) {
    const code = Object.entries(LAWD_CODES).find(([n]) => n === b.region)?.[1];
    if (!code) continue;
    const k = `${code}|${b.dong}|${b.name}`;
    bgCount.set(k, (bgCount.get(k) || 0) + 1);
  }

  const dir = path.join(outDir, 'complexes');
  fs.mkdirSync(dir, { recursive: true });
  const index = [];
  let located = 0, total = 0;
  for (const [code, data] of Object.entries(byRegion)) {
    for (const c of data.complexes) {
      total++;
      const g = geo.complexes[`${code}|${c.dong}|${c.name}`];
      if (g && g.lat) {
        const pt = g.src === 'dong' ? jitter(c.name, g.lat, g.lon) : g;
        c.lat = Math.round(pt.lat * 1e6) / 1e6;
        c.lon = Math.round(pt.lon * 1e6) / 1e6;
        c.geo = g.src === 'vworld' ? 'exact' : g.src === 'osm' ? 'osm' : 'approx';
        located++;
      }
      c.bargains = bgCount.get(`${code}|${c.dong}|${c.name}`) || 0;
      index.push([code, c.dong, c.name, c.count, c.medianPrice, c.buildYear || 0]);
    }
    fs.writeFileSync(path.join(dir, `${code}.json`), JSON.stringify({ ...data, generatedAt: new Date().toISOString() }));
  }
  fs.writeFileSync(path.join(outDir, 'complex-index.json'), JSON.stringify({
    generatedAt: new Date().toISOString(), fields: ['code', 'dong', 'name', 'count', 'medianPrice', 'buildYear'], items: index,
  }));
  return { total, located };
}

async function buildComplexes(outDir, bargains) {
  const byRegion = collectComplexes(outDir);
  const flat = [];
  for (const [code, data] of Object.entries(byRegion)) {
    for (const c of data.complexes) flat.push({ code, region: data.region, dong: c.dong, name: c.name, jibun: c.jibun, count: c.count });
  }

  // 이전 geo.json 가져오기 (data 브랜치) → 증분 지오코딩
  let prev = { dongs: {}, complexes: {} };
  const base = process.env.STATIC_DATA_BASE || 'https://raw.githubusercontent.com/shinhyuk/Home/data';
  try {
    const axios = require('axios');
    const res = await axios.get(`${base}/geo.json`, { timeout: 20000 });
    if (res.data && res.data.complexes) prev = res.data;
  } catch (e) {
    console.log('이전 geo.json 없음 (첫 실행이거나 로드 실패):', e.message);
  }

  let geo = prev;
  if (process.env.SKIP_GEOCODE !== '1') {
    try {
      const { geocodeComplexes } = require('./geocode');
      geo = await geocodeComplexes(flat, prev, {
        budgetMs: Number(process.env.GEOCODE_BUDGET_MS) || 25 * 60 * 1000,
      });
    } catch (e) {
      console.error('지오코딩 실패 (이전 좌표 유지):', e.message);
    }
  }
  fs.writeFileSync(path.join(outDir, 'geo.json'), JSON.stringify(geo));

  const stat = writeComplexIndex(outDir, byRegion, geo, bargains);
  console.log(`단지 인덱스: ${stat.total}개 단지, 좌표 보유 ${stat.located}개`);
}

if (require.main === module) main();
module.exports = { buildSummary, buildBargains, buildComplexes, recentMonths };
