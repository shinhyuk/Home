/* 오름홈 올인원 앱 — 탭 + 공유 프로필 + (분석·레이더·급매·대시보드) */

/* ═══════════ 공통 유틸 ═══════════ */
const FEASIBLE_LABEL = { possible: '가능', tight: '빠듯함', hard: '어려움', ineligible: '자격 없음', unknown: '정보 부족' };
const pyeongOfM2 = (m2) => Math.round(m2 / 3.3058);

function kv(label, value, big) {
  return `<div class="kv"><span>${label}</span><b class="${big ? 'big' : ''}">${value}</b></div>`;
}
function toggleExtra(btn, tableId) {
  const tb = document.getElementById(tableId);
  const on = tb.classList.toggle('show-extra');
  btn.textContent = on ? '접기 ▲' : btn.dataset.more;
}
function moreBtn(tableId, hiddenCount) {
  if (hiddenCount <= 0) return '';
  const label = `더 보기 (+${hiddenCount}) ▼`;
  return `<button type="button" class="more-btn" data-more="${label}" onclick="toggleExtra(this,'${tableId}')">${label}</button>`;
}
function getProfile() {
  try { return JSON.parse(localStorage.getItem('ormhome_input') || 'null'); } catch (e) { return null; }
}
function profileComplete(p) {
  return p && p.salaryAmount && p.region && p.priority && p.family && p.currentHome && p.timeline;
}

/* ═══════════ 탭 ═══════════ */
const TABS = ['home', 'profile', 'analysis', 'radar', 'bargains'];
const tabInited = {};

function switchTab(name) {
  if (!TABS.includes(name)) name = 'home';
  TABS.forEach((t) => {
    document.getElementById('tab-' + t).classList.toggle('active', t === name);
  });
  document.querySelectorAll('#tabBar .tab-btn').forEach((b) =>
    b.classList.toggle('active', b.dataset.tab === name));
  try { history.replaceState(null, '', '#' + name); } catch (e) { location.hash = name; }
  window.scrollTo({ top: 0 });

  if (name === 'analysis' && !window.REPORT_DATA && !analysisBusy) runAnalysis(false);
  if (name === 'radar' && !tabInited.radar) { tabInited.radar = true; rdScan(); }
  if (name === 'bargains' && !tabInited.bargains) { tabInited.bargains = true; bgLoad(); }
  if (name === 'home') renderHome();
}

/* ═══════════ 프로필 폼 ═══════════ */
function restoreForm() {
  const saved = getProfile();
  if (!saved) return;
  for (const [k, v] of Object.entries(saved)) {
    const el = document.querySelector(`[name="${k}"]`);
    if (el && v !== undefined && v !== null) el.value = v;
  }
  if (saved.family) {
    document.getElementById('maritalStatus').value = saved.family.startsWith('married') ? 'married' : 'single';
  }
}

document.getElementById('infoForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  const children = parseInt(data.childrenCount) || 0;
  data.family = data.maritalStatus === 'married'
    ? (children === 0 ? 'married-no-child' : children === 1 ? 'married-1child' : 'married-2plus')
    : 'single';
  ['salaryAmount', 'savingsAmount', 'jeonseDeposit', 'childrenCount', 'homelessYears', 'subscriptionYears'].forEach((k) => {
    data[k] = data[k] === '' || data[k] === undefined ? undefined : Number(data[k]);
  });
  try { localStorage.setItem('ormhome_input', JSON.stringify(data)); } catch (err) { /* 무시 */ }
  switchTab('analysis');
  runAnalysis(true);
});

/* ═══════════ 분석 (전략) ═══════════ */
let CX_REGION = '';
let analysisBusy = false;

function naverLink(c) {
  return 'https://map.naver.com/p/search/' + encodeURIComponent(`${CX_REGION} ${c.dong} ${c.name}`);
}

function trackCard(t, extraHtml) {
  const cls = t.feasible || 'unknown';
  return `
    <div class="card track ${cls}" style="margin:0 0 12px; box-shadow:none">
      <h3>${t.name} <span class="badge ${cls}">${FEASIBLE_LABEL[cls] || cls}</span></h3>
      ${extraHtml}
      <p style="font-size:13px;margin:10px 0 0;color:var(--sub)">${t.note || ''}</p>
      ${t.warning ? `<p class="warn-text" style="font-size:13px">⚠ ${t.warning}</p>` : ''}
    </div>`;
}

const SCOPES = {
  seoul: { label: '서울만', test: (n) => n.startsWith('서울') },
  near: { label: '서울+근교', test: (n) => n.startsWith('서울') ||
    ['경기 과천시','경기 광명시','경기 하남시','경기 구리시','경기 성남시 수정구','경기 성남시 중원구','경기 성남시 분당구'].includes(n) },
  metro: { label: '수도권', test: (n) => /^(서울|경기|인천)/.test(n) },
  all: { label: '전국', test: () => true },
};
let REGION_ALL = [];

function renderRegionRecs(scopeKey) {
  try { localStorage.setItem('ormhome_scope', scopeKey); } catch (e) {}
  document.getElementById('scopeBtns').innerHTML = Object.entries(SCOPES).map(([k, v]) =>
    `<button type="button" class="seg ${k === scopeKey ? 'active' : ''}" onclick="renderRegionRecs('${k}')">${v.label}</button>`).join('');

  const rows = REGION_ALL.filter((x) => SCOPES[scopeKey].test(x.name));
  document.getElementById('regionEmpty').hidden = rows.length > 0;
  const oldBtn = document.getElementById('regionMoreBtn');
  if (oldBtn) oldBtn.remove();
  document.getElementById('regionRecTable').classList.remove('show-extra');
  document.getElementById('regionRecTable').innerHTML = !rows.length ? '' :
    '<tr><th>지역</th><th>중위가</th><th>평당가</th><th>전세가율</th><th>6개월</th><th>예산충족률</th></tr>' +
    rows.map((x, i) => {
      const trendCls = x.changeRate > 1 ? 'up' : x.changeRate < -1 ? 'down' : '';
      const fitCls = x.fit >= 120 ? 'style="color:var(--good);font-weight:700"' : x.fit >= 100 ? 'style="font-weight:700"' : 'style="color:var(--warn)"';
      return `<tr class="${i >= 8 ? 'extra' : ''}">
        <td><b>${x.name}</b></td>
        <td>${fmtMoney(x.medianPrice)}</td>
        <td>${fmtMoney(x.avgPerPyeong)}</td>
        <td>${x.jeonseRatio ?? '-'}%</td>
        <td class="${trendCls}">${x.changeRate > 0 ? '+' : ''}${x.changeRate ?? '-'}%</td>
        <td ${fitCls}>${x.fit}%</td>
      </tr>`;
    }).join('');
  if (rows.length > 8) {
    const wrap = document.getElementById('regionRecTable').closest('.table-wrap');
    wrap.insertAdjacentHTML('afterend',
      `<span id="regionMoreBtn">${moreBtn('regionRecTable', rows.length - 8)}</span>`);
  }
}

let mapInstance = null;
async function initMap(cx) {
  if (typeof L === 'undefined') return;
  const all = [
    ...(cx.within || []).map((c) => ({ ...c, grp: 'within' })),
    ...(cx.stretch || []).map((c) => ({ ...c, grp: 'stretch' })),
  ].slice(0, 15);
  if (!all.length) return;

  const dongs = [...new Set(all.map((c) => c.dong).filter(Boolean))];
  const items = dongs.map((d, i) => ({ id: i, region: cx.regionName, dong: d }));
  let coords;
  try {
    coords = await apiFetch('/api/real-estate/geo/batch', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
  } catch (e) { return; }

  const byDong = {};
  coords.forEach((g) => { if (g.lat != null) byDong[dongs[g.id]] = g; });
  if (!Object.keys(byDong).length) return;

  document.getElementById('mapCard').hidden = false;
  if (mapInstance) { mapInstance.remove(); mapInstance = null; }
  const map = L.map('map', { scrollWheelZoom: false });
  mapInstance = map;
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);

  const pts = [];
  const used = {};
  all.forEach((c) => {
    const g = byDong[c.dong];
    if (!g) return;
    const n = used[c.dong] = (used[c.dong] || 0) + 1;
    const ang = n * 2.4;
    const lat = g.lat + (n > 1 ? Math.sin(ang) * 0.002 : 0);
    const lon = g.lon + (n > 1 ? Math.cos(ang) * 0.0025 : 0);
    const color = c.grp === 'within' ? '#0e9f6e' : '#c27803';
    L.circleMarker([lat, lon], { radius: 9, color: '#fff', fillColor: color, fillOpacity: .95, weight: 2 })
      .addTo(map)
      .bindPopup(`<b>${c.name}</b> <small>${c.type || '아파트'}</small><br>${c.dong} · 중위 ${fmtMoney(c.medianPrice)}<br><a href="${naverLink(c)}" target="_blank" rel="noopener">네이버지도에서 보기 →</a>`);
    pts.push([lat, lon]);
  });
  if (pts.length) map.fitBounds(pts, { padding: [36, 36], maxZoom: 15 });
}

function renderScenarios(list) {
  if (!list || !list.length) return;
  document.getElementById('scenarioCard').hidden = false;
  document.getElementById('scenarioBox').innerHTML = list.map((sc) => {
    const candTable = sc.candidates && sc.candidates.length ? `
      <div class="table-wrap"><table>
        <tr><th>후보지</th><th>중위가</th><th>전세가율</th>${sc.candidates[0].gap != null ? '<th>갭(필요자금)</th><th>취득세 포함</th>' : '<th>예산충족률</th>'}<th>6개월</th></tr>
        ${sc.candidates.map((c) => `<tr>
          <td><b>${c.name}</b>${c.affordable === false ? ' <span class="badge hard">자금 부족</span>' : ''}</td>
          <td>${fmtMoney(c.medianPrice)}</td>
          <td>${c.jeonseRatio ?? '-'}%</td>
          ${c.gap != null
            ? `<td><b>${fmtMoney(c.gap)}</b></td><td>${fmtMoney(c.cost)}</td>`
            : `<td><b>${c.fitPct ?? '-'}%</b></td>`}
          <td class="${c.changeRate > 1 ? 'up' : c.changeRate < -1 ? 'down' : ''}">${c.changeRate > 0 ? '+' : ''}${c.changeRate ?? '-'}%</td>
        </tr>`).join('')}
      </table></div>` : '';

    return `
    <details class="scenario ${sc.recommended ? 'top' : ''}" ${sc.recommended ? 'open' : ''}>
      <summary>
        <span class="sc-rank">${sc.recommended ? '⭐ 추천' : sc.rank + '순위'}</span>
        <span class="sc-title">${sc.icon} ${sc.title}</span>
        <span class="sc-fit">적합도 ${sc.fit}</span>
      </summary>
      <div class="sc-body">
        <p class="sc-one">${sc.oneLiner}</p>
        <div class="sc-steps">${sc.steps.map((st, i) => `<div class="sc-step"><span class="sc-n">${i + 1}</span>${st}</div>`).join('')}</div>
        <div class="kv-wrap">${sc.numbers.map((n) => kv(n.k, n.v)).join('')}</div>
        ${candTable}
        <div class="sc-pc">
          <div><b style="color:var(--good)">👍 장점</b><ul>${sc.pros.map((x) => `<li>${x}</li>`).join('')}</ul></div>
          <div><b style="color:var(--bad)">⚠ 리스크</b><ul>${sc.cons.map((x) => `<li>${x}</li>`).join('')}</ul></div>
        </div>
      </div>
    </details>`;
  }).join('');
}

function areaToPyeong(range) {
  if (!range) return '-';
  const p = pyeongOfM2;
  return p(range[0]) === p(range[1]) ? `${p(range[0])}평형` : `${p(range[0])}~${p(range[1])}평형`;
}

async function runAnalysis(force) {
  const input = getProfile();
  const show = (id) => ['loading', 'noProfile', 'error', 'result'].forEach((x) =>
    document.getElementById(x).hidden = x !== id);

  if (!profileComplete(input)) { show('noProfile'); return; }
  if (analysisBusy) return;
  if (!force && window.REPORT_DATA) { show('result'); return; }

  analysisBusy = true;
  show('loading');
  try {
    const r = await apiFetch('/api/analysis/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...input, saveResult: true }),
    });
    window.REPORT_DATA = { r, input };
    renderAnalysis(r);
    renderHome();
  } catch (err) {
    show('error');
    document.getElementById('errorMsg').textContent =
      '분석 실패: ' + err.message + ' — 잠시 후 다시 시도하거나, 하단 ⚙ API 설정을 확인하세요.';
  } finally {
    analysisBusy = false;
  }
}

function renderAnalysis(r) {
  document.getElementById('loading').hidden = true;

  const rd = r.regionData || {};
  if (rd.error || (!rd.avgPrice && !rd.tradeCount)) {
    document.getElementById('error').hidden = false;
    document.getElementById('errorMsg').innerHTML =
      '입력하신 지역을 인식하지 못했습니다.<br><b>동네/역 이름</b>(강남, 여의도, 잠실, 판교, 홍대…) 또는 <b>시군구</b>(서울 마포구)로 다시 입력해주세요.';
    window.REPORT_DATA = null;
    return;
  }

  document.getElementById('result').hidden = false;
  document.querySelectorAll('#result > .notice').forEach((n) => n.remove());
  if (r.areaBasis && r.areaBasis.applied === false && r.areaBasis.note) {
    const n = document.createElement('div');
    n.className = 'notice span-all';
    n.textContent = '📐 ' + r.areaBasis.note + ` (해당 평형 거래 ${r.areaBasis.count}건)`;
    document.getElementById('result').prepend(n);
  }

  document.getElementById('stTitle').textContent = r.strategy.title;
  document.getElementById('stDesc').textContent = r.strategy.description;
  const l = r.loanSimulation;
  const heroStats = [];
  if (l) {
    heroStats.push({ k: '내 최대 예산', v: fmtMoney(l.ownCapital + l.maxLoanByDSR) });
    heroStats.push({ k: '가능 대출', v: fmtMoney(l.maxLoanByDSR) });
    heroStats.push({ k: '월 상환 (권장대출 시)', v: fmtMoney(l.monthlyPayment) });
  }
  const ab = r.areaBasis;
  const basisTag = ab && ab.applied ? ` (${ab.label.split(' · ')[0]})` : '';
  heroStats.push({ k: `${rd.name} 중위가${basisTag}`, v: fmtMoney((ab && ab.applied && r.tracks?.buy?.medianPrice) || rd.medianPrice) });
  document.getElementById('heroStats').innerHTML =
    heroStats.map((s) => `<div class="hs"><div class="v">${s.v}</div><div class="k">${s.k}</div></div>`).join('');

  renderScenarios(r.scenarios);

  const rec = r.recommendations || {};
  const cx = rec.complexes;
  if (cx && (cx.within?.length || cx.stretch?.length)) {
    document.getElementById('complexCard').hidden = false;
    CX_REGION = cx.regionName;
    document.getElementById('complexBasis').textContent = `${cx.regionName} · ${cx.basis}` + (r.areaBasis ? ` · ${r.areaBasis.label}` : '');

    const rowOf = (c, extra, i, vis) => `
      <tr class="${i >= vis ? 'extra' : ''}">
        <td><a href="${naverLink(c)}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none"><b style="border-bottom:1.5px dotted var(--brand)">${c.name}</b></a> <span class="badge" style="margin-left:4px">${c.type || '아파트'}</span><span class="minor">${c.dong} · ${c.buildYear ? c.buildYear + '년' : ''} · ${areaToPyeong(c.areaRange)} · <a href="${naverLink(c)}" target="_blank" rel="noopener" style="color:var(--brand)">지도 🔗</a></span></td>
        <td>${c.count}건</td>
        <td><b>${fmtMoney(c.medianPrice)}</b><span class="minor">${fmtMoney(c.minPrice)}~${fmtMoney(c.maxPrice)}</span></td>
        <td>${fmtMoney(c.avgPerPyeong)}</td>
        ${extra !== undefined ? `<td class="warn-text">+${fmtMoney(extra)}</td>` : ''}
      </tr>`;

    let html = '';
    if (cx.within?.length) {
      html += `<p style="font-size:13px;margin:0 0 6px"><b style="color:var(--good)">지금 예산(${fmtMoney(rec.budget)}) 안에서 — ${cx.within.length}곳</b></p>
        <div class="table-wrap"><table id="cxWithinT">
        <tr><th>단지</th><th>거래</th><th>중위가 (범위)</th><th>평당가</th></tr>
        ${cx.within.map((c, i) => rowOf(c, undefined, i, 6)).join('')}</table></div>
        ${moreBtn('cxWithinT', cx.within.length - 6)}`;
    } else {
      html += `<p class="muted">현재 예산 안에 드는 단지가 이 지역엔 없습니다. "다른 지역"을 참고하세요.</p>`;
    }
    if (cx.stretch?.length) {
      html += `<p style="font-size:13px;margin:16px 0 6px"><b style="color:var(--warn)">조금 더 모으면 (예산 +30% 이내) — ${cx.stretch.length}곳</b></p>
        <div class="table-wrap"><table id="cxStretchT">
        <tr><th>단지</th><th>거래</th><th>중위가 (범위)</th><th>평당가</th><th>부족분</th></tr>
        ${cx.stretch.map((c, i) => rowOf(c, c.shortfall, i, 4)).join('')}</table></div>
        ${moreBtn('cxStretchT', cx.stretch.length - 4)}`;
    }
    document.getElementById('complexWithin').innerHTML = html;
    initMap(cx);
  }

  const rg = rec.regions;
  if (rg && rg.affordable?.length) {
    document.getElementById('regionRecCard').hidden = false;
    document.getElementById('regionRecSub').textContent = `전국 ${rg.totalScanned}개 시군구 스캔`;
    REGION_ALL = rg.affordable;
    let scope = 'near';
    try { scope = localStorage.getItem('ormhome_scope') || 'near'; } catch (e) {}
    if (!SCOPES[scope]) scope = 'near';
    renderRegionRecs(scope);
  }

  const t = r.tracks || {};
  let html = '';
  if (t.subscription) {
    const s = t.subscription.score || {};
    let scoreHtml = '';
    if (s.total !== null && s.total !== undefined) {
      scoreHtml = kv('청약 가점 (84점 만점)', `${s.total}점`, true)
        + kv('└ 무주택 기간', `${s.homelessPoints ?? '-'} / 32`)
        + kv('└ 부양가족', `${s.familyPoints ?? '-'} / 35`)
        + kv('└ 통장 가입기간', `${s.accountPoints ?? '-'} / 17`);
    } else if (t.subscription.eligible) {
      scoreHtml = kv('부양가족 가점', `${s.familyPoints ?? '-'} / 35`)
        + `<p class="muted">무주택 기간·통장 가입기간 입력 시 전체 가점 계산</p>`;
    }
    if (t.subscription.specialSupply?.length) {
      scoreHtml += `<p style="font-size:13px;margin:10px 0 0"><b>검토 가능 특별공급:</b> ${t.subscription.specialSupply.join(', ')}</p>`;
    }
    html += trackCard(t.subscription, scoreHtml);
  }
  if (t.jeonse && t.jeonse.feasible) {
    html += trackCard(t.jeonse,
      kv('지역 평균 전세보증금', fmtMoney(t.jeonse.avgDeposit))
      + kv('내 전세 예산 (자금+전세대출)', fmtMoney(t.jeonse.budget))
      + kv('필요 전세대출 <span class="muted">(보증 80%·수도권 한도 6억)</span>', fmtMoney(t.jeonse.loanNeeded))
      + kv('월 이자 (전세대출)', fmtMoney(t.jeonse.monthlyInterest))
      + kv('전세가율', (t.jeonse.jeonseRatio ?? '-') + '%'));
  }
  if (t.buy && t.buy.feasible) {
    html += trackCard(t.buy,
      kv('중위 매매가' + (r.areaBasis && r.areaBasis.applied ? ' <span class="muted">(' + r.areaBasis.label.split(' · ')[0] + ' 기준)</span>' : ''), fmtMoney(t.buy.medianPrice))
      + kv('내 최대 예산 (자금+대출)', fmtMoney(t.buy.budget))
      + kv('예산 충족률', t.buy.budgetRatio + '%', true)
      + kv('월 상환액', fmtMoney(t.buy.monthlyPayment))
      + (t.buy.shortfall > 0 ? kv('부족 자금', fmtMoney(t.buy.shortfall)) : ''));
  }
  document.getElementById('tracksBox').innerHTML = html || '<p class="muted">시세 데이터 부족</p>';

  document.getElementById('regionTitle').textContent = `📈 ${rd.name} 시세 (최근 2개월 실거래)`;
  const trendCls = rd.trend === 'up' ? 'up' : rd.trend === 'down' ? 'down' : '';
  const trendLabel = rd.trend === 'up' ? `상승 +${rd.changeRate}%` : rd.trend === 'down' ? `하락 ${rd.changeRate}%` : rd.trend === 'stable' ? '보합' : '-';
  document.getElementById('regionBox').innerHTML =
    kv('아파트 평균 매매가', fmtMoney(rd.avgPrice))
    + kv('중위 매매가', fmtMoney(rd.medianPrice), true)
    + kv('평당가', fmtMoney(rd.avgPerPyeong))
    + kv('평균 전세보증금', fmtMoney(rd.jeonseAvgDeposit))
    + kv('전세가율', (rd.jeonseRatio ?? '-') + '%')
    + kv('6개월 추세', `<span class="${trendCls}">${trendLabel}</span>`)
    + kv('표본 거래량', (rd.tradeCount ?? 0) + '건');

  document.getElementById('trendTable').innerHTML =
    '<tr><th>월</th><th>거래량</th><th>평균가</th><th>중위가</th><th>평당가</th></tr>' +
    (rd.monthlyTrend || []).map((m) =>
      `<tr><td>${m.month}</td><td>${m.count ?? 0}건</td><td>${fmtMoney(m.avgAmount)}</td><td>${fmtMoney(m.medianAmount)}</td><td>${fmtMoney(m.avgPerPyeong)}</td></tr>`
    ).join('');

  document.getElementById('sourceNote').textContent =
    `신뢰도 ${r.confidence}% (거래량 기반) · 데이터: 국토교통부 실거래가 공개시스템`;

  if (l) {
    document.getElementById('loanCard').hidden = false;
    document.getElementById('loanBox').innerHTML =
      kv('보유 자금 (전세금 회수 포함)', fmtMoney(l.ownCapital))
      + kv('DSR 기준 최대 대출', fmtMoney(l.maxLoanByDSR))
      + kv('= 내 최대 예산', fmtMoney(l.ownCapital + l.maxLoanByDSR), true)
      + kv('기준 주택가' + (r.areaBasis && r.areaBasis.applied ? ' <span class="muted">(' + r.areaBasis.label.split(' · ')[0] + ' 중위)</span>' : ' (지역 중위)'), fmtMoney(l.housePrice))
      + kv('권장 대출액', fmtMoney(l.recommendedLoan))
      + kv('월 상환액', fmtMoney(l.monthlyPayment))
      + kv('총 이자 (30년)', fmtMoney(l.totalInterest))
      + (l.shortfall > 0 ? kv('대출 후 부족분', `<span class="warn-text">${fmtMoney(l.shortfall)}</span>`) : '');
  }

  const d = r.details || {};
  document.getElementById('qualList').innerHTML = (d.qualification || []).map((x) => `<li>${x}</li>`).join('');
  document.getElementById('actionList').innerHTML = (d.actions || []).map((x) => `<li>${x}</li>`).join('');
  document.getElementById('warnList').innerHTML = (d.warnings || []).map((x) => `<li>${x.replace(/^•\s*/, '')}</li>`).join('');
}

/* ═══════════ 레이더 ═══════════ */
const RD_SCOPES = {
  seoul: (n) => n.startsWith('서울'),
  metro: (n) => /^(서울|경기|인천)/.test(n),
  bigcity: (n) => /^(부산|대구|대전|광주|울산|세종)/.test(n),
  all: () => true,
};
function acqTax(p) {
  if (!p) return 0;
  if (p <= 60000) return Math.round(p * 0.011);
  if (p <= 90000) return Math.round(p * (0.011 + ((p - 60000) / 30000) * 0.022));
  return Math.round(p * 0.033);
}
function rdMaxLoan(income, price) {
  if (!income) return 0;
  const r = 0.055 / 12, n = 360;
  const factor = (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
  const dsr = ((income / 12) * 0.4) / factor;
  const cap = price <= 150000 ? 60000 : price <= 250000 ? 40000 : 20000;
  return Math.round(Math.min(dsr, price * 0.7, cap));
}

let SUMMARY = null;
async function loadSummary() {
  if (SUMMARY) return SUMMARY;
  const res = await fetch('https://raw.githubusercontent.com/shinhyuk/Home/data/summary.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error('데이터 로드 실패');
  SUMMARY = await res.json();
  return SUMMARY;
}

function rdCompute(data, { budget, income, mode, scope, minTrade }) {
  return data.regions
    .filter((r) => r.medianPrice && RD_SCOPES[scope](r.name) && r.tradeCount >= minTrade)
    .map((r) => {
      const gap = r.jeonseRatio ? Math.round(r.medianPrice * (1 - r.jeonseRatio / 100)) : null;
      const gapCost = gap != null ? gap + acqTax(r.medianPrice) : null;
      const ownNeed = Math.max(0, r.medianPrice - rdMaxLoan(income, r.medianPrice));
      const need = mode === 'gap' ? gapCost : ownNeed;
      const ok = budget > 0 && need != null ? need <= budget : null;
      const score = Math.round((r.changeRate ?? 0) * 3 + (r.jeonseRatio ?? 40) * 0.4 + Math.min(r.tradeCount, 300) / 15);
      return { ...r, gap, gapCost, ownNeed, need, ok, score };
    });
}

async function rdScan() {
  const btn = document.getElementById('scanBtn');
  btn.textContent = '스캔 중…'; btn.disabled = true;
  try {
    const data = await loadSummary();
    const opts = {
      budget: Number(document.getElementById('budget').value) || 0,
      income: Number(document.getElementById('income').value) || 0,
      mode: document.getElementById('mode').value,
      scope: document.getElementById('scope').value,
      minTrade: Number(document.getElementById('minTrade').value),
    };
    const sortKey = document.getElementById('sort').value;
    let rows = rdCompute(data, opts);

    const sorters = {
      score: (a, b) => b.score - a.score,
      changeRate: (a, b) => (b.changeRate ?? -99) - (a.changeRate ?? -99),
      gapAsc: (a, b) => (a.gapCost ?? 1e15) - (b.gapCost ?? 1e15),
      jeonseRatio: (a, b) => (b.jeonseRatio ?? -1) - (a.jeonseRatio ?? -1),
      tradeCount: (a, b) => b.tradeCount - a.tradeCount,
      priceAsc: (a, b) => a.medianPrice - b.medianPrice,
    };
    rows.sort(sorters[sortKey]);

    const okCount = rows.filter((r) => r.ok).length;
    document.getElementById('rdCard').hidden = false;
    document.getElementById('rdTitle').textContent =
      `스캔 결과 — ${rows.length}개 지역` + (opts.budget ? ` (자금 내 가능 ${okCount}곳)` : '');
    document.getElementById('rdMeta').textContent =
      `데이터 기준: ${(data.generatedAt || '').slice(0, 10)} · 전국 ${data.regions.length}개 시군구`;

    const needHead = opts.mode === 'gap' ? '갭 / 필요자금' : '필요 자기자본';
    document.getElementById('radarTable').innerHTML =
      `<tr><th>#</th><th>지역</th><th>중위가</th><th>평당가</th><th>전세가율</th><th>${needHead}</th><th>6개월</th><th>거래</th><th>매력도</th><th></th></tr>` +
      rows.map((r, i) => {
        const needCell = opts.mode === 'gap'
          ? (r.gap != null ? `${fmtMoney(r.gap)}<span class="minor">총 ${fmtMoney(r.gapCost)}</span>` : '-')
          : fmtMoney(r.ownNeed);
        const okStyle = r.ok === true ? 'style="color:var(--good);font-weight:700"' : r.ok === false ? 'style="color:var(--faint)"' : '';
        const tCls = r.changeRate > 1 ? 'up' : r.changeRate < -1 ? 'down' : '';
        return `<tr ${r.ok === false ? 'style="opacity:.55"' : ''}>
          <td>${i + 1}</td>
          <td><b>${r.name}</b></td>
          <td>${fmtMoney(r.medianPrice)}</td>
          <td>${fmtMoney(r.avgPerPyeong)}</td>
          <td>${r.jeonseRatio ?? '-'}%</td>
          <td ${okStyle}>${needCell}</td>
          <td class="${tCls}">${r.changeRate > 0 ? '+' : ''}${r.changeRate ?? '-'}%</td>
          <td>${r.tradeCount}건</td>
          <td><b>${r.score}</b></td>
          <td><button type="button" class="mini-btn" onclick="goAnalyze('${r.name}')">분석→</button></td>
        </tr>`;
      }).join('');
  } catch (e) {
    alert('스캔 실패: ' + e.message);
  } finally {
    btn.textContent = '전국 스캔 →'; btn.disabled = false;
  }
}

function goAnalyze(name) {
  const saved = getProfile() || {};
  saved.region = name;
  try { localStorage.setItem('ormhome_input', JSON.stringify(saved)); } catch (e) {}
  restoreForm();
  if (profileComplete(saved)) {
    window.REPORT_DATA = null;
    switchTab('analysis');
    runAnalysis(true);
  } else {
    switchTab('profile');
  }
}

document.getElementById('scanBtn').addEventListener('click', rdScan);

/* ═══════════ 급매 ═══════════ */
const BG_SCOPES = {
  seoul: (n) => n.startsWith('서울'),
  metro: (n) => /^(서울|경기|인천)/.test(n),
  all: () => true,
};
let BG_DATA = null;

function bgNaver(b) {
  return 'https://map.naver.com/p/search/' + encodeURIComponent(`${b.region} ${b.dong} ${b.name}`);
}

async function bgLoad() {
  try {
    const res = await fetch('https://raw.githubusercontent.com/shinhyuk/Home/data/bargains.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('404');
    BG_DATA = await res.json();
    bgRender();
    renderHome();
  } catch (e) {
    document.getElementById('bgPending').hidden = false;
  }
}

function bgFilter({ scope, minDisc, maxPrice, exDirect, exLow }) {
  if (!BG_DATA) return [];
  return BG_DATA.items.filter((b) =>
    BG_SCOPES[scope](b.region) &&
    b.discount <= minDisc &&
    b.price <= maxPrice &&
    (!exDirect || !b.direct) &&
    (!exLow || (b.floor ?? 99) > 2)
  );
}

function bgRender() {
  if (!BG_DATA) return;
  const sortKey = document.getElementById('bgSort').value;
  let rows = bgFilter({
    scope: document.getElementById('bgScope').value,
    minDisc: -Number(document.getElementById('bgMinDisc').value),
    maxPrice: Number(document.getElementById('bgMaxPrice').value) || Infinity,
    exDirect: document.getElementById('bgExDirect').checked,
    exLow: document.getElementById('bgExLow').checked,
  });
  const sorters = {
    discount: (a, b) => a.discount - b.discount,
    date: (a, b) => b.date.localeCompare(a.date),
    priceAsc: (a, b) => a.price - b.price,
  };
  rows.sort(sorters[sortKey]);
  rows = rows.slice(0, 100);

  document.getElementById('bgCard').hidden = false;
  document.getElementById('bgPending').hidden = true;
  document.getElementById('bgTitle').textContent = `🔥 급매 체결 ${rows.length}건` + (rows.length === 100 ? ' (상위 100)' : '');
  document.getElementById('bgMeta').textContent =
    `기준: ${BG_DATA.basis} · 생성 ${(BG_DATA.generatedAt || '').slice(0, 10)}`;

  document.getElementById('bTable').innerHTML =
    '<tr><th>단지</th><th>전용/층</th><th>체결가</th><th>할인율</th><th>체결일</th></tr>' +
    rows.map((b) => `<tr>
      <td><a href="${bgNaver(b)}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none">
        <b style="border-bottom:1.5px dotted var(--brand)">${b.name}</b></a>
        ${b.direct ? '<span class="badge hard">직거래</span>' : ''}
        ${(b.floor ?? 99) <= 2 ? '<span class="badge tight">저층</span>' : ''}
        <span class="minor">${b.region} ${b.dong} · 표본 ${b.samples}건</span></td>
      <td>${b.area}㎡ (${pyeongOfM2(b.area)}평)<span class="minor">${b.floor ?? '-'}층</span></td>
      <td><b>${fmtMoney(b.price)}</b><span class="minor">평당 ${fmtMoney(b.pp)} / 중위 ${fmtMoney(b.medianPP)}</span></td>
      <td><b style="color:var(--bad);font-size:15px">${b.discount}%</b></td>
      <td>${b.date.slice(5)}</td>
    </tr>`).join('');
}

['bgScope', 'bgMinDisc', 'bgMaxPrice', 'bgExDirect', 'bgExLow', 'bgSort'].forEach((id) =>
  document.getElementById(id).addEventListener('change', bgRender));

/* ═══════════ 홈 대시보드 ═══════════ */
async function renderHome() {
  const p = getProfile();
  const has = profileComplete(p);
  document.getElementById('homeWelcome').hidden = has;
  document.getElementById('homeDash').hidden = !has;
  if (!has) return;

  document.getElementById('profileChip').innerHTML =
    `<b>${p.region}</b> 목표 · 연소득 ${fmtMoney(p.salaryAmount)} · 자금 ${fmtMoney(p.savingsAmount)}` +
    (p.jeonseDeposit ? ` · 전세금 ${fmtMoney(p.jeonseDeposit)}` : '') +
    (p.workRegion1 || p.workRegion2 ? ` · 직장 ${[p.workRegion1, p.workRegion2].filter(Boolean).join('·')}` : '');

  // 분석 요약
  const rep = window.REPORT_DATA;
  if (rep) {
    const r = rep.r;
    document.getElementById('homeStTitle').textContent = r.strategy.title;
    const top = (r.scenarios || [])[0];
    document.getElementById('homeStOne').textContent = top ? `${top.icon} ${top.title} — ${top.oneLiner}` : r.strategy.description;
    const l = r.loanSimulation;
    const stats = [];
    if (l) {
      stats.push({ k: '내 최대 예산', v: fmtMoney(l.ownCapital + l.maxLoanByDSR) });
      stats.push({ k: '월 상환', v: fmtMoney(l.monthlyPayment) });
    }
    if (r.tracks?.buy?.budgetRatio) stats.push({ k: `${r.regionData.name} 충족률`, v: r.tracks.buy.budgetRatio + '%' });
    if (r.tracks?.subscription?.score?.total != null) stats.push({ k: '청약 가점', v: r.tracks.subscription.score.total + '점' });
    document.getElementById('homeStats').innerHTML =
      stats.map((s) => `<div class="hs"><div class="v">${s.v}</div><div class="k">${s.k}</div></div>`).join('');
  } else {
    document.getElementById('homeStTitle').textContent = analysisBusy ? '분석 중…' : '분석 대기 중';
    document.getElementById('homeStOne').textContent = '';
    document.getElementById('homeStats').innerHTML = '';
  }

  // 급매 TOP5 (수도권, 직거래 제외)
  if (BG_DATA) {
    const rows = bgFilter({ scope: 'metro', minDisc: -7, maxPrice: Infinity, exDirect: true, exLow: false })
      .sort((a, b) => a.discount - b.discount).slice(0, 5);
    document.getElementById('homeBgTable').innerHTML =
      '<tr><th>단지</th><th>체결가</th><th>할인</th></tr>' +
      rows.map((b) => `<tr>
        <td><a href="${bgNaver(b)}" target="_blank" rel="noopener" style="color:inherit"><b>${b.name}</b></a><span class="minor">${b.region} · ${b.area}㎡ ${b.floor ?? '-'}층 · ${b.date.slice(5)}</span></td>
        <td>${fmtMoney(b.price)}</td>
        <td><b style="color:var(--bad)">${b.discount}%</b></td>
      </tr>`).join('');
  } else {
    document.getElementById('homeBgTable').innerHTML = '<tr><td class="muted">급매 데이터 로드 중…</td></tr>';
  }

  // 레이더 TOP5 (내 자금 기준 갭투자, 수도권+광역시 중 매력도순)
  try {
    const data = await loadSummary();
    const rows = rdCompute(data, {
      budget: Number(p.savingsAmount) || 0, income: Number(p.salaryAmount) || 0,
      mode: 'gap', scope: 'all', minTrade: 30,
    }).filter((r) => r.ok !== false).sort((a, b) => b.score - a.score).slice(0, 5);
    document.getElementById('homeRdTable').innerHTML =
      '<tr><th>지역</th><th>갭</th><th>6개월</th></tr>' +
      rows.map((r) => `<tr>
        <td><b>${r.name}</b><span class="minor">중위 ${fmtMoney(r.medianPrice)} · 전세가율 ${r.jeonseRatio ?? '-'}%</span></td>
        <td>${r.gap != null ? fmtMoney(r.gap) : '-'}</td>
        <td class="${r.changeRate > 1 ? 'up' : ''}">${r.changeRate > 0 ? '+' : ''}${r.changeRate ?? '-'}%</td>
      </tr>`).join('');
  } catch (e) {
    document.getElementById('homeRdTable').innerHTML = '<tr><td class="muted">레이더 데이터 로드 중…</td></tr>';
  }
}

/* ═══════════ 초기화 ═══════════ */
apiFetch('/api/real-estate/regions')
  .then((regions) => {
    document.getElementById('regionList').innerHTML =
      regions.map((r) => `<option value="${r}">`).join('');
  })
  .catch(() => { /* 백엔드 미연결 시 자유 입력 */ });

restoreForm();

// 레이더 입력 기본값 = 프로필
(function () {
  const p = getProfile();
  if (p?.savingsAmount) document.getElementById('budget').value = p.savingsAmount;
  if (p?.salaryAmount) document.getElementById('income').value = p.salaryAmount;
})();

renderApiConfig(document.getElementById('apiConfig'));

// 홈 대시보드용 급매 데이터 선로드 + 해시 라우팅
bgLoad();
const initial = (location.hash || '').replace('#', '');
switchTab(TABS.includes(initial) ? initial : 'home');

// 프로필 있으면 백그라운드 분석 시작 (홈 요약 채움)
if (profileComplete(getProfile())) runAnalysis(false);
