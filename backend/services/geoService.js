const axios = require('axios');
const cache = require('./cacheService');

// 주소 → 좌표 (OpenStreetMap Nominatim, 무료·키 불필요)
// 사용정책 준수: 1초 1건, 식별 가능한 User-Agent, 결과 캐싱
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const UA = 'OreumHome/1.0 (real-estate strategy service)';
const GEO_TTL = 30 * 24 * 60 * 60 * 1000; // 30일

let lastCall = 0;
async function throttle() {
  const wait = Math.max(0, lastCall + 1100 - Date.now());
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

async function geocodeOne(query) {
  const key = `geo:${query}`;
  const cached = await cache.get(key);
  if (cached) return cached === 'NONE' ? null : cached;

  await throttle();
  try {
    const res = await axios.get(NOMINATIM, {
      params: { format: 'json', limit: 1, countrycodes: 'kr', q: query },
      headers: { 'User-Agent': UA },
      timeout: 10000,
    });
    const hit = res.data?.[0];
    if (hit) {
      const coord = { lat: parseFloat(hit.lat), lon: parseFloat(hit.lon) };
      await cache.set(key, coord, GEO_TTL);
      return coord;
    }
    await cache.set(key, 'NONE', GEO_TTL);
    return null;
  } catch (err) {
    console.warn('지오코딩 실패:', query, err.message);
    return null;
  }
}

// 배치: 지번 주소 우선, 실패 시 동 단위로 폴백
async function geocodeBatch(items) {
  const results = [];
  for (const item of items.slice(0, 20)) {
    const { id, region, dong, jibun } = item;
    let coord = null;
    if (dong) {
      if (jibun) coord = await geocodeOne(`${region} ${dong} ${jibun}`);
      if (!coord) coord = await geocodeOne(`${region} ${dong}`);
    }
    results.push({ id, lat: coord?.lat ?? null, lon: coord?.lon ?? null });
  }
  return results;
}

module.exports = { geocodeOne, geocodeBatch };
