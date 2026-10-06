// 단지 조회 · 단지별 추천/구매가능 판정 · 지도용 단지 데이터
// 데이터: 수집기가 만든 complex-index.json (검색) + complexes/{code}.json (지역별 단지 통계·좌표)
//        + 월별 실거래 원본 (상세 조회 시 거래 내역·전세)
const axios = require('axios');
const cache = require('./cacheService');
const realEstate = require('./realEstateService');
const { LAWD_CODES, resolveLawdCode } = require('../config/lawdCodes');
const { REGULATION, maxLoanCapacity, monthlyPayment, normalizeInput } = require('./analysisService');

const PYEONG = 3.3058;
const STATIC_DATA_BASE = process.env.STATIC_DATA_BASE
  || 'https://raw.githubusercontent.com/shinhyuk/Home/data';
const TTL = 6 * 60 * 60 * 1000;

const nameByCode = {};
for (const [name, code] of Object.entries(LAWD_CODES)) if (!nameByCode[code]) nameByCode[code] = name;

function normName(s) {
  return (s || '').normalize('NFC').toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/제(\d+)(차|단지)/g, '$1$2')
    .replace(/아파트|apt|\s|·|\.|-|_/g, '');
}

async function fetchJson(pathname) {
  const key = `static:${pathname}`;
  const cached = await cache.get(key);
  if (cached) return cached;
  const res = await axios.get(`${STATIC_DATA_BASE}/${pathname}`, { timeout: 15000 });
  await cache.set(key, res.data, TTL);
  return res.data;
}

async function loadIndex() {
  const data = await fetchJson('complex-index.json');
  if (!data.__norm) {
    data.__norm = data.items.map((it) => normName(it[2]));
  }
  return data;
}
async function loadRegion(code) {
  return fetchJson(`complexes/${code}.json`);
}
async function loadBargains() {
  try { return await fetchJson('bargains.json'); } catch (e) { return { items: [] }; }
}

// ───────────────────────── 검색 ─────────────────────────
// "염창동 강변힐스테이트", "강변힐스테이트", "강서구 힐스테이트" 모두 처리
async function searchComplexes(query, regionHint, limit = 30) {
  const idx = await loadIndex();
  const tokens = (query || '').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];

  let codeFilter = null;
  let dongFilter = null;
  const nameTokens = [];
  for (const t of tokens) {
    if (/(동|읍|면|리|가)$/.test(t) && t.length >= 2 && idx.items.some((it) => it[1] === t || it[1].endsWith(' ' + t))) {
      dongFilter = t; continue;
    }
    if (/(시|구|군)$/.test(t) && t.length >= 2) {
      const r = resolveLawdCode(t);
      if (r) { codeFilter = r.code; continue; }
    }
    nameTokens.push(t);
  }
  if (regionHint && !codeFilter) {
    const r = resolveLawdCode(regionHint);
    if (r) codeFilter = r.code;
  }
  const q = normName(nameTokens.join(''));

  const out = [];
  for (let i = 0; i < idx.items.length; i++) {
    const [code, dong, name, count, medianPrice, buildYear] = idx.items[i];
    if (codeFilter && code !== codeFilter) continue;
    if (dongFilter && dong !== dongFilter && !dong.endsWith(' ' + dongFilter)) continue;
    const nn = idx.__norm[i];
    let rank;
    if (!q) rank = 3;
    else if (nn === q) rank = 0;
    else if (nn.startsWith(q)) rank = 1;
    else if (nn.includes(q)) rank = 2;
    else continue;
    out.push({ code, region: nameByCode[code], dong, name, count, medianPrice, buildYear: buildYear || null, rank });
  }
  out.sort((a, b) => a.rank - b.rank || b.count - a.count);
  return out.slice(0, limit).map(({ rank, ...r }) => r);
}

// ───────────────────────── 판정 ─────────────────────────

// 프로필 → 자금 요약 (대출은 가격에 따라 달라지므로 판정 때 계산)
function profileCapital(profile) {
  if (!profile || !(Number(profile.salaryAmount) > 0)) return null;
  const n = normalizeInput(profile);
  return {
    income: n.annualIncome,
    own: n.capital + n.jeonseDeposit,
    currentHome: profile.currentHome || 'none',
  };
}

// 특정 가격에 대한 구매 가능 여부
function judgePrice(price, cap) {
  if (!cap || !price) return { status: 'unknown' };
  const loan = maxLoanCapacity(cap.income, price, { currentHome: cap.currentHome });
  const budget = cap.own + loan;
  const ratio = budget / price;
  const loanNeeded = Math.max(0, price - cap.own);
  const usable = Math.min(loanNeeded, loan);
  const shortfall = Math.max(0, price - cap.own - loan);
  const status = cap.currentHome === 'multi' && loanNeeded > 0 ? 'hard'
    : ratio >= 1 ? 'possible' : ratio >= 0.85 ? 'tight' : 'hard';
  return {
    status,
    budget: Math.round(budget),
    maxLoan: loan,
    loanNeeded: Math.round(loanNeeded),
    monthly: usable > 0 ? Math.round(monthlyPayment(usable, REGULATION.mortgageRate, REGULATION.maxTermYears)) : 0,
    shortfall: Math.round(shortfall),
    ratio: Math.round(ratio * 100),
  };
}

// 실거주 관점 추천 점수 (0~100) + 근거
function scoreComplex(c, price, judge, ctx) {
  let s = 50;
  const why = [];
  const neg = [];

  if (judge.status === 'possible') { s += judge.ratio >= 115 ? 20 : 15; why.push(judge.ratio >= 115 ? '예산 여유 있음' : '예산 안'); }
  else if (judge.status === 'tight') { s += 3; neg.push(`예산 빠듯 (${judge.ratio}%)`); }
  else if (judge.status === 'hard') { s -= 25; neg.push(`예산 초과 (부족 ${Math.round(judge.shortfall / 10000)}억대)`); }

  const thin = c.count < 3;
  if (ctx.dongPP && c.pp) {
    const rel = c.pp / ctx.dongPP;
    if (rel <= 0.9) { s += thin ? 3 : 10; why.push(`동네 평당가 대비 ${Math.round((1 - rel) * 100)}% 저렴${thin ? ' (표본 적음)' : ''}`); }
    else if (rel >= 1.15) { s -= 4; neg.push(`동네 평당가 대비 ${Math.round((rel - 1) * 100)}% 프리미엄`); }
  }

  if (c.count >= 10) { s += 10; why.push(`거래 활발 (6개월 ${c.count}건)`); }
  else if (c.count >= 5) { s += 5; }
  else if (thin) { s -= 8; neg.push(`표본 부족 (${c.count}건) — 소규모 단지일 수 있음`); }

  if (c.trend != null) {
    if (c.trend >= 3) { s += 5; why.push(`최근 3개월 평당가 +${c.trend}%`); }
    else if (c.trend <= -3) { s -= 3; neg.push(`최근 3개월 평당가 ${c.trend}% (협상 여지)`); }
  }

  if (c.buildYear) {
    const age = new Date().getFullYear() - c.buildYear;
    if (age <= 10) { s += 8; why.push(`준신축 (${c.buildYear}년)`); }
    else if (age <= 20) { s += 3; }
    else if (age >= 30) { s -= 4; neg.push(`구축 ${age}년차 (관리상태 확인)`); }
  }

  if (c.bargains > 0) { s += 4; why.push(`급매 체결 ${c.bargains}회 → 협상 앵커 있음`); }

  if (ctx.jeonseRatio != null) {
    if (ctx.jeonseRatio >= 60) { s += 4; why.push(`전세가율 ${ctx.jeonseRatio}% (실수요 탄탄)`); }
    else if (ctx.jeonseRatio < 45) { s -= 3; neg.push(`전세가율 ${ctx.jeonseRatio}% (매매가 고평가 주의)`); }
  }

  s = Math.max(0, Math.min(100, Math.round(s)));
  if (thin) s = Math.min(s, 58); // 표본 부족 단지는 '추천' 등급 불가
  const label = judge.status === 'hard' ? '예산 초과'
    : judge.status === 'unknown' ? (s >= 65 ? '관심' : '보통')
    : s >= 75 ? '강력 추천' : s >= 60 ? '추천' : s >= 45 ? '보통' : '신중';
  return { score: s, label, why, neg };
}

// 동네 평당 중위가 — bucket을 주면 같은 평형 버킷끼리만 비교 (소형일수록 평당가가 높아 왜곡 방지)
// 거래량 가중 중위 (나홀로 단지 다수가 기준을 끌어내리지 않도록, 단지당 최대 20건 가중)
function dongMedianPP(complexes, dong, bucket) {
  const pps = [];
  for (const c of complexes) {
    if (c.dong !== dong) continue;
    let pp = null, n = 0;
    if (bucket != null) { const b = c.buckets?.[bucket]; if (b) { pp = b.pp; n = b.count; } }
    else { pp = c.pp; n = c.count; }
    if (!pp) continue;
    for (let i = 0; i < Math.min(n, 20); i++) pps.push(pp);
  }
  pps.sort((a, b) => a - b);
  if (!pps.length) return null;
  const m = Math.floor(pps.length / 2);
  return pps.length % 2 ? pps[m] : Math.round((pps[m - 1] + pps[m]) / 2);
}

// 평형대에 맞는 버킷(= round(㎡/10)) 중 거래 많은 것 (버킷 대표 면적으로 판정)
function pickBucket(c, band) {
  let best = null;
  for (const [b, v] of Object.entries(c.buckets || {})) {
    if (band !== 'any' && !realEstate.inBand(v.area, band)) continue;
    if (!best || v.count > best.v.count) best = { id: Number(b), v };
  }
  return best;
}

// ───────────────────────── 지도용 단지 목록 ─────────────────────────
// opts: { region, dong?, band, profile, limit }
async function mapComplexes(opts) {
  const r = resolveLawdCode(opts.region || '');
  if (!r) return { error: `지역을 찾을 수 없습니다: ${opts.region}` };
  let data;
  try { data = await loadRegion(r.code); } catch (e) { return { error: '단지 데이터가 아직 생성되지 않았습니다 (다음 수집 사이클에 생성)' }; }

  const cap = profileCapital(opts.profile);
  const band = opts.band || 'any';
  const list = opts.dong ? data.complexes.filter((c) => c.dong === opts.dong) : data.complexes;
  const ppByDong = {};

  const items = list.map((c) => {
    const bk = pickBucket(c, band);
    const price = bk ? bk.v.median : (band === 'any' ? c.medianPrice : null);
    if (!price) return null;
    const pk = `${c.dong}|${bk ? bk.id : ''}`;
    if (!(pk in ppByDong)) ppByDong[pk] = dongMedianPP(data.complexes, c.dong, bk ? bk.id : null);
    const judge = judgePrice(price, cap);
    const sc = scoreComplex({ ...c, pp: bk ? bk.v.pp : c.pp, count: bk ? bk.v.count : c.count }, price, judge, { dongPP: ppByDong[pk] });
    return {
      name: c.name, dong: c.dong, jibun: c.jibun, buildYear: c.buildYear,
      lat: c.lat ?? null, lon: c.lon ?? null, geo: c.geo || null,
      count: c.count, bargains: c.bargains || 0, trend: c.trend,
      area: bk ? bk.v.area : null, areaCount: bk ? bk.v.count : null,
      price, pp: bk ? bk.v.pp : c.pp, min: bk ? bk.v.min : c.minPrice, max: bk ? bk.v.max : c.maxPrice,
      last: bk ? bk.v.last : c.last,
      status: judge.status, budget: judge.budget, monthly: judge.monthly, shortfall: judge.shortfall, ratio: judge.ratio,
      score: sc.score, label: sc.label, why: sc.why, neg: sc.neg,
    };
  }).filter(Boolean);

  items.sort((a, b) => b.score - a.score || b.count - a.count);
  const limit = opts.limit || 400;
  return {
    region: data.region, code: r.code, band, generatedAt: data.generatedAt,
    total: items.length,
    located: items.filter((i) => i.lat != null).length,
    capital: cap ? { own: cap.own, income: cap.income } : null,
    items: items.slice(0, limit),
  };
}

// ───────────────────────── 단지 상세 ─────────────────────────
async function complexDetail({ region, dong, name, profile }) {
  const r = resolveLawdCode(region || '');
  if (!r) return { error: `지역을 찾을 수 없습니다: ${region}` };
  let data = null;
  try { data = await loadRegion(r.code); } catch (e) { /* 인덱스 없이도 원본으로 진행 */ }
  const entry = data?.complexes.find((c) => c.name === name && c.dong === dong) || null;

  // 원본 실거래 (아파트 6개월) + 전세 (2개월)
  const months6 = realEstate.recentMonths(6);
  const trades = [];
  for (const ym of months6) {
    let items = [];
    try { items = await realEstate.fetchMonthCached('apt-trade', r.code, ym); } catch (e) { items = []; }
    for (const i of items) {
      if (i.name === name && i.dong === dong && !i.cancelled && i.dealAmount > 0 && i.area > 0) {
        trades.push({
          bucket: Math.round(i.area / 10),
          area: Math.round(i.area * 10) / 10, floor: i.floor ?? null, price: i.dealAmount,
          date: `${i.dealYear}-${String(i.dealMonth).padStart(2, '0')}-${String(i.dealDay).padStart(2, '0')}`,
          ym, pp: Math.round(i.dealAmount / (i.area / PYEONG)),
          direct: (i.dealingType || '').includes('직거래'),
        });
      }
    }
  }
  const rents = [];
  for (const ym of months6.slice(0, 2)) {
    let items = [];
    try { items = await realEstate.fetchMonthCached('apt-rent', r.code, ym); } catch (e) { items = []; }
    for (const i of items) {
      if (i.name === name && i.dong === dong && i.area > 0) {
        rents.push({
          bucket: Math.round(i.area / 10),
          area: Math.round(i.area * 10) / 10, floor: i.floor ?? null, deposit: i.deposit, monthlyRent: i.monthlyRent,
          type: i.monthlyRent > 0 ? '월세' : '전세',
          date: `${i.dealYear}-${String(i.dealMonth).padStart(2, '0')}-${String(i.dealDay).padStart(2, '0')}`,
        });
      }
    }
  }
  if (!trades.length && !entry) return { error: '최근 6개월 실거래가 없는 단지입니다.' };
  trades.sort((a, b) => b.date.localeCompare(a.date));
  rents.sort((a, b) => b.date.localeCompare(a.date));

  const cap = profileCapital(profile);
  const med = (arr) => { if (!arr.length) return null; const s = arr.slice().sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };

  // 평형별 분석
  const byBucket = new Map();
  for (const t of trades) {
    if (!byBucket.has(t.bucket)) byBucket.set(t.bucket, []);
    byBucket.get(t.bucket).push(t);
  }
  const half = new Set(months6.slice(0, 3));
  const units = [...byBucket.entries()].map(([b, list]) => {
    const prices = list.map((t) => t.price);
    const pps = list.map((t) => t.pp);
    const areaTyp = med(list.map((t) => t.area));
    const jeonse = rents.filter((x) => x.type === '전세' && x.bucket === b);
    const dongPP = data ? dongMedianPP(data.complexes, dong, b) : null;
    const jeonseMed = med(jeonse.map((x) => x.deposit));
    const medPrice = med(prices);
    const jeonseRatio = jeonseMed && medPrice ? Math.round((jeonseMed / medPrice) * 100) : null;
    const recentPP = list.filter((t) => half.has(t.ym)).map((t) => t.pp);
    const olderPP = list.filter((t) => !half.has(t.ym)).map((t) => t.pp);
    const trend = recentPP.length >= 2 && olderPP.length >= 2
      ? Math.round(((med(recentPP) - med(olderPP)) / med(olderPP)) * 1000) / 10 : null;
    const judge = judgePrice(medPrice, cap);
    const sc = scoreComplex({
      pp: med(pps), count: list.length, trend, buildYear: entry?.buildYear, bargains: entry?.bargains || 0,
    }, medPrice, judge, { dongPP, jeonseRatio });
    const monthly = {};
    for (const t of list) { (monthly[t.ym] = monthly[t.ym] || []).push(t.pp); }
    return {
      bucket: b, area: areaTyp, pyeong: Math.round(areaTyp / PYEONG),
      count: list.length, median: medPrice, min: Math.min(...prices), max: Math.max(...prices), pp: med(pps),
      dongPP, relPP: dongPP ? Math.round((med(pps) / dongPP - 1) * 100) : null,
      trend, jeonseCount: jeonse.length, jeonseMedian: jeonseMed, jeonseRatio,
      judge, score: sc.score, label: sc.label, why: sc.why, neg: sc.neg,
      monthly: months6.slice().reverse().map((ym) => ({ month: `${ym.slice(0, 4)}-${ym.slice(4)}`, count: (monthly[ym] || []).length, pp: med(monthly[ym] || []) })),
      trades: list.slice(0, 12),
    };
  }).sort((a, b) => b.count - a.count);

  // 같은 동 이웃 단지 — 이 단지의 주력 평형과 같은 버킷끼리 비교
  const mainBucket = units[0]?.bucket ?? null;
  const dongPP = data ? dongMedianPP(data.complexes, dong, mainBucket) : null;
  const neighbors = (data?.complexes || [])
    .filter((c) => c.dong === dong && c.name !== name)
    .map((c) => {
      const b = mainBucket != null ? c.buckets?.[mainBucket] : null;
      return {
        name: c.name, buildYear: c.buildYear, count: c.count, trend: c.trend, lat: c.lat, lon: c.lon, geo: c.geo,
        sameBand: Boolean(b), area: b ? b.area : null, bandCount: b ? b.count : null,
        medianPrice: b ? b.median : c.medianPrice, pp: b ? b.pp : c.pp,
        relPP: dongPP && b ? Math.round((b.pp / dongPP - 1) * 100) : null,
      };
    })
    .sort((a, b) => Number(b.sameBand) - Number(a.sameBand) || b.count - a.count)
    .slice(0, 12);

  // 급매 이력
  const bg = await loadBargains();
  const bargains = bg.items.filter((b) => b.name === name && b.dong === dong && b.region === r.name);

  return {
    region: r.name, code: r.code, dong, name,
    jibun: entry?.jibun || '', buildYear: entry?.buildYear || null,
    lat: entry?.lat ?? null, lon: entry?.lon ?? null, geo: entry?.geo || null,
    tradeCount: trades.length, medianPrice: med(trades.map((t) => t.price)), pp: med(trades.map((t) => t.pp)),
    mainBucket, dongPP, relPP: units[0]?.relPP ?? null,
    capital: cap ? { own: cap.own, income: cap.income, currentHome: cap.currentHome } : null,
    units, rents: rents.slice(0, 10), bargains, neighbors,
    regulation: { asOf: REGULATION.asOf, rate: REGULATION.mortgageRate },
  };
}

module.exports = { searchComplexes, mapComplexes, complexDetail, judgePrice, scoreComplex };
