const axios = require('axios');
const molitApi = require('./molitApi');
const cache = require('./cacheService');
const { resolveLawdCode, listRegions } = require('../config/lawdCodes');

const PYEONG = 3.3058; // 1평 = 3.3058㎡

// GitHub Actions 수집기가 매일 data 브랜치에 저장한 정규화 데이터
// (국토부 API가 해외 클라우드 IP를 403 차단 → 직접 호출의 1차 대안)
const STATIC_DATA_BASE = process.env.STATIC_DATA_BASE
  || 'https://raw.githubusercontent.com/shinhyuk/Home/data';

async function fetchStatic(endpointKey, lawdCd, dealYmd) {
  const url = `${STATIC_DATA_BASE}/${endpointKey}/${lawdCd}/${dealYmd}.json`;
  const res = await axios.get(url, { timeout: 10000 });
  return Array.isArray(res.data) ? res.data : null;
}

// ───────────────────────── 캐싱 레이어 ─────────────────────────

// 거래 신고는 계약 후 30일까지 가능 → 최근 2개월은 6시간, 과거는 7일 캐시
function ttlFor(dealYmd) {
  const now = new Date();
  const ym = parseInt(dealYmd, 10);
  const recent1 = now.getFullYear() * 100 + (now.getMonth() + 1);
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const recent2 = prev.getFullYear() * 100 + (prev.getMonth() + 1);
  if (ym >= recent2 && ym <= recent1) return 6 * 60 * 60 * 1000;
  return 7 * 24 * 60 * 60 * 1000;
}

async function fetchMonthCached(endpointKey, lawdCd, dealYmd) {
  const key = `molit:${endpointKey}:${lawdCd}:${dealYmd}`;
  const cached = await cache.get(key);
  if (cached) return cached;

  // 1차: 수집된 정적 데이터 → 2차: 국토부 직접 호출 (로컬 개발 환경용)
  let items = null;
  try {
    items = await fetchStatic(endpointKey, lawdCd, dealYmd);
  } catch (e) {
    // 404(미수집) 등 → 직접 호출로 폴백
  }
  if (!items) {
    items = await molitApi.fetchMonth(endpointKey, lawdCd, dealYmd);
  }

  await cache.set(key, items, ttlFor(dealYmd));
  return items;
}

// ───────────────────────── 날짜 유틸 ─────────────────────────

// 최근 N개 "완결된" 월 목록 (YYYYMM, 최신순) — 당월은 신고 지연으로 제외
function recentMonths(n = 3) {
  const months = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 1; i <= n; i++) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    months.push(`${m.getFullYear()}${String(m.getMonth() + 1).padStart(2, '0')}`);
  }
  return months;
}

// ───────────────────────── 통계 계산 ─────────────────────────

function median(sorted) {
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function tradeStats(items) {
  const valid = items.filter((i) => !i.cancelled && i.dealAmount > 0);
  if (!valid.length) return { count: 0 };

  const amounts = valid.map((i) => i.dealAmount).sort((a, b) => a - b);
  const withArea = valid.filter((i) => i.area > 0);
  const perPyeong = withArea.map((i) => i.dealAmount / (i.area / PYEONG));

  return {
    count: valid.length,
    avgAmount: Math.round(amounts.reduce((a, b) => a + b, 0) / amounts.length), // 만원
    medianAmount: median(amounts),
    minAmount: amounts[0],
    maxAmount: amounts[amounts.length - 1],
    avgPerPyeong: perPyeong.length
      ? Math.round(perPyeong.reduce((a, b) => a + b, 0) / perPyeong.length)
      : null, // 만원/평
  };
}

function rentStats(items) {
  const jeonse = items.filter((i) => i.rentType === '전세' && i.deposit > 0);
  const wolse = items.filter((i) => i.rentType === '월세' && i.deposit >= 0);

  const jeonseDeposits = jeonse.map((i) => i.deposit).sort((a, b) => a - b);
  const jeonseWithArea = jeonse.filter((i) => i.area > 0);
  const jeonsePerPyeong = jeonseWithArea.map((i) => i.deposit / (i.area / PYEONG));

  return {
    jeonse: {
      count: jeonse.length,
      avgDeposit: jeonse.length
        ? Math.round(jeonseDeposits.reduce((a, b) => a + b, 0) / jeonseDeposits.length)
        : null,
      medianDeposit: median(jeonseDeposits),
      avgPerPyeong: jeonsePerPyeong.length
        ? Math.round(jeonsePerPyeong.reduce((a, b) => a + b, 0) / jeonsePerPyeong.length)
        : null,
    },
    wolse: {
      count: wolse.length,
      avgDeposit: wolse.length
        ? Math.round(wolse.reduce((a, b) => a + b.deposit, 0) / wolse.length)
        : null,
      avgMonthlyRent: wolse.length
        ? Math.round(wolse.reduce((a, b) => a + b.monthlyRent, 0) / wolse.length)
        : null,
    },
  };
}

// ───────────────────────── 공개 API ─────────────────────────

// 지역 종합 시세 (아파트 중심 + 오피스텔/연립 요약)
async function getRegionSummary(regionInput) {
  const region = resolveLawdCode(regionInput);
  if (!region) {
    return { error: `지역을 찾을 수 없습니다: "${regionInput}"`, supported: listRegions() };
  }

  const months = recentMonths(2); // 최근 2개월 데이터 합산
  const [aptTrade, aptRent, offiTrade, rhTrade] = await Promise.all([
    collectMonths('apt-trade', region.code, months),
    collectMonths('apt-rent', region.code, months),
    collectMonths('offi-trade', region.code, months),
    collectMonths('rh-trade', region.code, months),
  ]);

  const apt = tradeStats(aptTrade);
  const aptJeonse = rentStats(aptRent);

  // 전세가율: 평당가 기준 (매매 평당가 대비 전세 평당가)
  const jeonseRatio = apt.avgPerPyeong && aptJeonse.jeonse.avgPerPyeong
    ? Math.round((aptJeonse.jeonse.avgPerPyeong / apt.avgPerPyeong) * 100)
    : null;

  return {
    region: region.name,
    lawdCode: region.code,
    period: `${months[months.length - 1]} ~ ${months[0]}`,
    apartment: {
      trade: apt,
      rent: aptJeonse,
      jeonseRatio, // % — 높을수록 갭투자 부담 적음 / 낮을수록 매매가 거품 가능성
    },
    officetel: { trade: tradeStats(offiTrade) },
    rowHouse: { trade: tradeStats(rhTrade) },
    dataSource: '국토교통부 실거래가 공개시스템',
    apiUsage: molitApi.getDailyUsage(),
  };
}

async function collectMonths(endpointKey, lawdCd, months) {
  const results = await Promise.all(
    months.map((ym) => fetchMonthCached(endpointKey, lawdCd, ym).catch((err) => {
      console.warn(`${endpointKey} ${ym} 조회 실패:`, err.message);
      return [];
    }))
  );
  return results.flat();
}

// 월별 추세 (최근 N개월 평균 매매가)
async function getPriceTrend(regionInput, monthCount = 6, endpointKey = 'apt-trade') {
  const region = resolveLawdCode(regionInput);
  if (!region) return { error: `지역을 찾을 수 없습니다: "${regionInput}"` };

  const months = recentMonths(Math.min(monthCount, 12)).reverse(); // 과거→최신
  const trend = [];

  for (const ym of months) {
    try {
      const items = await fetchMonthCached(endpointKey, region.code, ym);
      const stats = tradeStats(items);
      trend.push({
        month: `${ym.slice(0, 4)}-${ym.slice(4)}`,
        count: stats.count,
        avgAmount: stats.avgAmount || null,
        avgPerPyeong: stats.avgPerPyeong || null,
        medianAmount: stats.medianAmount || null,
      });
    } catch (err) {
      trend.push({ month: `${ym.slice(0, 4)}-${ym.slice(4)}`, count: 0, error: err.message });
    }
  }

  // 추세 판단: 첫 유효월 대비 마지막 유효월 평당가 변화율
  const valid = trend.filter((t) => t.avgPerPyeong);
  let direction = 'unknown';
  let changeRate = null;
  if (valid.length >= 2) {
    const first = valid[0].avgPerPyeong;
    const last = valid[valid.length - 1].avgPerPyeong;
    changeRate = Math.round(((last - first) / first) * 1000) / 10; // %
    direction = changeRate > 1 ? 'up' : changeRate < -1 ? 'down' : 'stable';
  }

  return { region: region.name, trend, direction, changeRate };
}

// 분석 엔진용 요약 데이터 (analysisService에서 사용)
async function getRegionData(regionInput) {
  const summary = await getRegionSummary(regionInput);
  if (summary.error) {
    return { name: regionInput, avgPrice: null, error: summary.error };
  }

  const trend = await getPriceTrend(regionInput, 6);

  return {
    name: summary.region,
    avgPrice: summary.apartment.trade.avgAmount, // 만원
    avgPerPyeong: summary.apartment.trade.avgPerPyeong,
    medianPrice: summary.apartment.trade.medianAmount,
    tradeCount: summary.apartment.trade.count,
    jeonseAvgDeposit: summary.apartment.rent.jeonse.avgDeposit,
    jeonseRatio: summary.apartment.jeonseRatio,
    trend: trend.direction,
    changeRate: trend.changeRate,
    monthlyTrend: trend.trend,
  };
}

// ───────────────────────── 단지별 집계 (최근 6개월 아파트 매매) ─────────────────────────

// 평형대 구간 (전용면적 ㎡)
const AREA_BANDS = {
  small: { min: 0, max: 60, label: '소형 · 전용 60㎡ 이하' },
  mid84: { min: 60, max: 85, label: '국민평형 · 전용 60~85㎡' },
  large: { min: 85, max: 135, label: '중대형 · 전용 85~135㎡' },
  xlarge: { min: 135, max: 9999, label: '대형 · 전용 135㎡ 초과' },
  any: { min: 0, max: 9999, label: '전체 평형' },
};

function inBand(area, bandKey) {
  const b = AREA_BANDS[bandKey] || AREA_BANDS.any;
  return area > b.min && area <= b.max;
}

// 평형대 기준 지역 통계 (최근 2개월 — 트랙/예산 판정용)
async function getBandedStats(regionInput, bandKey = 'any') {
  const region = resolveLawdCode(regionInput);
  if (!region) return null;
  const months = recentMonths(2);

  const trades = (await collectMonths('apt-trade', region.code, months))
    .filter((i) => !i.cancelled && i.dealAmount > 0 && i.area > 0 && inBand(i.area, bandKey));
  const rents = (await collectMonths('apt-rent', region.code, months))
    .filter((i) => i.monthlyRent === 0 && i.deposit > 0 && i.area > 0 && inBand(i.area, bandKey));

  const amounts = trades.map((i) => i.dealAmount).sort((a, b) => a - b);
  const perP = trades.map((i) => i.dealAmount / (i.area / PYEONG));
  const deposits = rents.map((i) => i.deposit).sort((a, b) => a - b);

  return {
    band: bandKey,
    label: (AREA_BANDS[bandKey] || AREA_BANDS.any).label,
    count: trades.length,
    medianPrice: median(amounts),
    avgPerPyeong: perP.length ? Math.round(perP.reduce((a, b) => a + b, 0) / perP.length) : null,
    jeonseCount: rents.length,
    jeonseAvgDeposit: deposits.length ? Math.round(deposits.reduce((a, b) => a + b, 0) / deposits.length) : null,
  };
}

// 수집 범위: 아파트 6개월, 오피스텔·연립다세대 2개월
const COMPLEX_SOURCES = {
  'apt-trade': { label: '아파트', months: 6 },
  'offi-trade': { label: '오피스텔', months: 2 },
  'rh-trade': { label: '연립다세대', months: 2 },
};

async function getComplexStats(regionInput, types = ['apt-trade'], bandKey = 'any') {
  const region = resolveLawdCode(regionInput);
  if (!region) return null;

  const valid = [];
  for (const type of types) {
    const src = COMPLEX_SOURCES[type];
    if (!src) continue;
    const items = await collectMonths(type, region.code, recentMonths(src.months));
    for (const i of items) {
      if (!i.cancelled && i.dealAmount > 0 && i.name && (bandKey === 'any' ? true : (i.area > 0 && inBand(i.area, bandKey)))) {
        valid.push({ ...i, typeLabel: src.label });
      }
    }
  }

  const groups = new Map();
  for (const i of valid) {
    const key = `${i.typeLabel}|${i.name}|${i.dong}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  }

  const complexes = [];
  for (const [key, list] of groups) {
    if (list.length < 3) continue; // 표본 3건 미만 제외
    const [typeLabel, name, dong] = key.split('|');
    const amounts = list.map((i) => i.dealAmount).sort((a, b) => a - b);
    const withArea = list.filter((i) => i.area > 0);
    const perP = withArea.map((i) => i.dealAmount / (i.area / PYEONG));
    const areas = withArea.map((i) => i.area).sort((a, b) => a - b);
    complexes.push({
      type: typeLabel, name, dong,
      jibun: list.find((i) => i.jibun)?.jibun || '',
      count: list.length,
      medianPrice: median(amounts),
      minPrice: amounts[0],
      maxPrice: amounts[amounts.length - 1],
      avgPerPyeong: perP.length ? Math.round(perP.reduce((a, b) => a + b, 0) / perP.length) : null,
      areaRange: areas.length ? [Math.round(areas[0]), Math.round(areas[areas.length - 1])] : null,
      buildYear: list.find((i) => i.buildYear)?.buildYear || null,
    });
  }

  complexes.sort((a, b) => b.count - a.count);
  return { region: region.name, complexes };
}

// ───────────────────────── 전국 지역 요약 (수집기가 생성한 summary.json) ─────────────────────────

async function getAllRegionSummaries() {
  const key = 'static:summary';
  const cached = await cache.get(key);
  if (cached) return cached;
  try {
    const res = await axios.get(`${STATIC_DATA_BASE}/summary.json`, { timeout: 10000 });
    const data = res.data;
    if (data && Array.isArray(data.regions)) {
      await cache.set(key, data, 6 * 60 * 60 * 1000);
      return data;
    }
  } catch (e) {
    console.warn('summary.json 조회 실패:', e.message);
  }
  return null;
}

module.exports = {
  AREA_BANDS,
  inBand,
  getBandedStats,
  getRegionSummary,
  getPriceTrend,
  getRegionData,
  getComplexStats,
  getAllRegionSummaries,
  fetchMonthCached,
  recentMonths,
  listRegions,
};
