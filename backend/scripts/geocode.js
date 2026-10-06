// 단지 좌표 수집기 — collect.js가 호출 (GitHub Actions에서 매일 증분 실행)
//
// 좌표 소스 (우선순위):
//   1. VWorld 지오코더 (국토부 공간정보 오픈플랫폼, VWORLD_API_KEY 있을 때) — 지번 → 정확한 위치
//   2. OpenStreetMap Overpass — 동 범위 안의 이름 있는 아파트 건물/단지와 이름 매칭
//   3. 동 중심점 (Nominatim) — 위 둘 다 실패 시 근사 위치 (approx 표시)
//
// 결과는 data 브랜치의 geo.json에 누적 (이전 결과를 읽어 와서 새 단지만 추가)
const axios = require('axios');

const UA = 'OreumHome/1.0 (+https://github.com/shinhyuk/Home)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 단지명 정규화: 공백·'아파트'·괄호 제거, 제N차 → N차
function normName(s) {
  return (s || '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/제(\d+)(차|단지)/g, '$1$2')
    .replace(/아파트|apt|에이피티|\s|·|\.|-|_/g, '');
}

function complexKey(code, dong, name) {
  return `${code}|${dong}|${name}`;
}

// ── 1. VWorld (지번 주소 → 좌표) ──
async function vworldGeocode(key, address) {
  const res = await axios.get('https://api.vworld.kr/req/address', {
    params: {
      service: 'address', request: 'getcoord', version: '2.0', crs: 'epsg:4326',
      type: 'parcel', refine: 'true', simple: 'true', format: 'json',
      address, key,
    },
    headers: { 'User-Agent': UA },
    timeout: 8000,
  });
  const r = res.data?.response;
  if (r?.status === 'OK' && r.result?.point) {
    return { lat: parseFloat(r.result.point.y), lon: parseFloat(r.result.point.x) };
  }
  return null;
}

// ── 3. Nominatim: 동 중심 + 경계 박스 ──
async function nominatimDong(region, dong) {
  const res = await axios.get('https://nominatim.openstreetmap.org/search', {
    params: { format: 'json', limit: 1, countrycodes: 'kr', q: `${region} ${dong}` },
    headers: { 'User-Agent': UA },
    timeout: 10000,
  });
  const hit = res.data?.[0];
  if (!hit) return null;
  const lat = parseFloat(hit.lat), lon = parseFloat(hit.lon);
  let [s, n, w, e] = (hit.boundingbox || []).map(parseFloat);
  // 점 결과(정류장 등)면 ±1.2km 정도로 확장
  if (!(n - s > 0.004) || !(e - w > 0.004)) { s = lat - 0.011; n = lat + 0.011; w = lon - 0.014; e = lon + 0.014; }
  return { lat, lon, bbox: [s, w, n, e] };
}

// ── 2. Overpass: 동 범위 안의 이름 있는 아파트 ──
let overpassRR = 0;
const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://z.overpass-api.de/api/interpreter',
];
async function overpassApartments(bbox) {
  const [s, w, n, e] = bbox;
  // 가벼운 질의: 이름 있는 아파트 건물(way)과 주거 단지(landuse)만, 짧은 타임아웃
  const q = `[out:json][timeout:15];(
    way["name"]["building"="apartments"](${s},${w},${n},${e});
    way["name"]["landuse"="residential"](${s},${w},${n},${e});
    relation["name"]["landuse"="residential"](${s},${w},${n},${e});
  );out center 200;`;
  let res = null, lastErr = null;
  // 미러를 번갈아 사용, 동마다 최대 2회 시도 (실패 시 다음 수집 때 재시도)
  const start = overpassRR++ % OVERPASS_MIRRORS.length;
  for (let k = 0; k < 2; k++) {
    const url = OVERPASS_MIRRORS[(start + k) % OVERPASS_MIRRORS.length];
    try {
      res = await axios.post(url, `data=${encodeURIComponent(q)}`, {
        headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 20000,
      });
      break;
    } catch (err) {
      lastErr = err;
      await sleep(500);
    }
  }
  if (!res) throw lastErr || new Error('overpass unavailable');
  return (res.data?.elements || []).map((el) => {
    const c = el.center || el;
    return { name: el.tags?.name || '', norm: normName(el.tags?.name), lat: c.lat, lon: c.lon };
  }).filter((x) => x.norm && x.lat);
}

function matchOsm(name, cands) {
  const nn = normName(name);
  if (nn.length < 2) return null;
  let best = null, bestScore = 0;
  for (const c of cands) {
    let score = 0;
    if (c.norm === nn) score = 3;
    else if (c.norm.includes(nn) || nn.includes(c.norm)) score = Math.min(nn.length, c.norm.length) >= 3 ? 2 : 0;
    if (score > bestScore) { best = c; bestScore = score; }
  }
  return best;
}

// ── 메인: 증분 지오코딩 ──
// complexes: [{ code, region, dong, name, jibun, count }]
// prev: 이전 geo.json ({ dongs:{}, complexes:{} })
async function geocodeComplexes(complexes, prev, opts = {}) {
  const {
    vworldKey = process.env.VWORLD_API_KEY || '',
    budgetMs = 25 * 60 * 1000,
    maxVworld = 4000,
    maxOverpassDongs = 250,
    maxNominatim = 700,
    log = console.log,
  } = opts;

  const geo = {
    dongs: { ...(prev?.dongs || {}) },
    complexes: { ...(prev?.complexes || {}) },
  };
  const t0 = Date.now();
  const timeLeft = () => Date.now() - t0 < budgetMs;
  const now = new Date().toISOString().slice(0, 10);

  // 우선순위: 서울 → 경기·인천 → 나머지, 거래 많은 단지부터
  const pri = (code) => (code.startsWith('11') ? 0 : /^(41|28)/.test(code) ? 1 : 2);
  const todo = complexes
    .filter((c) => {
      const g = geo.complexes[complexKey(c.code, c.dong, c.name)];
      if (!g) return true;
      // 근사 위치뿐인 단지는 VWorld 키가 생겼을 때 다시 시도
      return g.src === 'dong' && vworldKey && !g.vw;
    })
    .sort((a, b) => pri(a.code) - pri(b.code) || b.count - a.count);
  log(`지오코딩 대상 ${todo.length}개 (기존 ${Object.keys(geo.complexes).length}개 보유)`);

  let nVw = 0, nOsm = 0, nDong = 0, nNomi = 0;

  // 1) VWorld — 지번이 있는 단지
  if (vworldKey) {
    for (const c of todo) {
      if (nVw >= maxVworld || !timeLeft()) break;
      const key = complexKey(c.code, c.dong, c.name);
      if (geo.complexes[key]?.src === 'vworld') continue;
      if (!c.jibun) continue;
      try {
        const pt = await vworldGeocode(vworldKey, `${c.region} ${c.dong} ${c.jibun}`);
        nVw++;
        if (pt) geo.complexes[key] = { ...pt, src: 'vworld', at: now };
        else geo.complexes[key] = { ...(geo.complexes[key] || {}), vw: 1 };
      } catch (e) {
        log(`VWorld 실패 ${key}: ${e.message}`);
        if (/40[13]/.test(e.message)) break; // 키 문제면 중단
      }
      await sleep(60);
    }
    log(`VWorld ${nVw}건 호출`);
  }

  // 2) 동 중심 (Nominatim) — 싸고 빠르므로 먼저 모든 동에 근사 좌표부터 부여
  const remaining = todo.filter((c) => {
    const g = geo.complexes[complexKey(c.code, c.dong, c.name)];
    return !g || g.src === 'dong' || !g.src;
  });
  const byDong = new Map();
  for (const c of remaining) {
    const dk = `${c.code}|${c.dong}`;
    if (!byDong.has(dk)) byDong.set(dk, { region: c.region, dong: c.dong, code: c.code, list: [] });
    byDong.get(dk).list.push(c);
  }
  const dongList = [...byDong.values()].sort((a, b) => pri(a.code) - pri(b.code) || b.list.length - a.list.length);

  for (const d of dongList) {
    if (!timeLeft()) break;
    const dk = `${d.code}|${d.dong}`;
    let dg = geo.dongs[dk];
    if (!dg) {
      if (nNomi >= maxNominatim) continue;
      try {
        await sleep(1100); // Nominatim 정책: 1초 1건
        nNomi++;
        const r = await nominatimDong(d.region, d.dong);
        if (!r) { geo.dongs[dk] = { miss: 1, at: now }; continue; }
        dg = geo.dongs[dk] = { ...r, at: now };
      } catch (e) {
        log(`Nominatim 실패 ${dk}: ${e.message}`);
        continue;
      }
    }
    if (dg.miss) continue;
    for (const c of d.list) {
      const key = complexKey(c.code, c.dong, c.name);
      if (!geo.complexes[key]) { geo.complexes[key] = { lat: dg.lat, lon: dg.lon, src: 'dong', at: now }; nDong++; }
    }
  }

  // 3) Overpass 정밀화 — 남은 시간 동안, 아직 OSM 조회 안 한 동부터 (서울 우선)
  let osmDongs = 0;
  const needOsm = dongList.filter((d) => {
    const dg = geo.dongs[`${d.code}|${d.dong}`];
    if (!dg || dg.miss || !dg.bbox) return false;
    const stale = dg.osm && dg.at && (Date.now() - Date.parse(dg.at)) > 30 * 86400000;
    return !dg.osm || stale;
  });
  for (const d of needOsm) {
    if (!timeLeft() || osmDongs >= maxOverpassDongs) break;
    const dk = `${d.code}|${d.dong}`;
    const dg = geo.dongs[dk];
    let cands;
    try {
      await sleep(1200);
      cands = await overpassApartments(dg.bbox);
    } catch (e) {
      log(`Overpass 실패 ${dk}: ${e.message}`);
      continue;
    }
    osmDongs++;
    dg.osm = 1; dg.osmN = cands.length; dg.at = now;
    for (const c of d.list) {
      const key = complexKey(c.code, c.dong, c.name);
      const cur = geo.complexes[key];
      if (cur && cur.src === 'vworld') continue;
      const m = matchOsm(c.name, cands);
      if (m) { geo.complexes[key] = { lat: m.lat, lon: m.lon, src: 'osm', at: now, vw: cur?.vw }; nOsm++; if (cur?.src === 'dong') nDong--; }
    }
  }

  log(`지오코딩 결과: VWorld ${nVw} · OSM 매칭 ${nOsm} · 동중심 ${nDong} · Nominatim ${nNomi}회 · Overpass ${osmDongs}개 동 · ${Math.round((Date.now() - t0) / 1000)}초`);
  geo.updatedAt = new Date().toISOString();
  return geo;
}

module.exports = { geocodeComplexes, normName, complexKey };
