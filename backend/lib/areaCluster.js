// 전용면적 세부 평형 클러스터링 — 수집기와 백엔드가 같은 규칙을 씀
// 84.93 / 84.97 처럼 거의 같은 면적은 한 평형으로, 59.9 / 84.9 / 101.8 은 각각 분리
// 규칙: 면적 오름차순으로 훑으며 클러스터 시작값에서 1.5㎡ 넘게 벌어지면 새 클러스터
const GAP = 1.5;

// items: 배열, getArea: (item) => ㎡
// 반환: { keyOf: Map(item → key), clusters: [{ key, area, items }] }  (key = 대표면적 문자열 "84.9")
function clusterAreas(items, getArea) {
  const sorted = items.slice().sort((a, b) => getArea(a) - getArea(b));
  const groups = [];
  let cur = null;
  for (const it of sorted) {
    const a = getArea(it);
    if (!cur || a - cur.start > GAP) { cur = { start: a, items: [] }; groups.push(cur); }
    cur.items.push(it);
  }
  const keyOf = new Map();
  const clusters = groups.map((g) => {
    const areas = g.items.map(getArea).sort((x, y) => x - y);
    const mid = Math.floor(areas.length / 2);
    const typ = areas.length % 2 ? areas[mid] : (areas[mid - 1] + areas[mid]) / 2;
    const area = Math.round(typ * 10) / 10;
    const key = String(area);
    for (const it of g.items) keyOf.set(it, key);
    return { key, area, items: g.items };
  });
  return { keyOf, clusters };
}

// 버킷 맵({ "84.9": {area,...} })에서 목표 면적에 가장 가까운 버킷 (±tol ㎡ 이내)
function nearestBucket(buckets, area, tol = 4) {
  let best = null;
  for (const [key, v] of Object.entries(buckets || {})) {
    const d = Math.abs((v.area ?? Number(key)) - area);
    if (d <= tol && (!best || d < best.d)) best = { key, v, d };
  }
  return best;
}

module.exports = { clusterAreas, nearestBucket, GAP };
