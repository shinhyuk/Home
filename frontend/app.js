/* 오름홈 올인원 앱 — 탭 + 공유 프로필 + (분석·레이더·급매·대시보드) */

/* ═══════════ 공통 유틸 ═══════════ */
const FEASIBLE_LABEL = { possible: '가능', tight: '빠듯함', hard: '어려움', ineligible: '자격 없음', unknown: '정보 부족' };
const pyeongOfM2 = (m2) => Math.round(m2 / 3.3058);
// 전용 ㎡ → 흔히 부르는 공급 평형 (전용의 약 1.33배): 59㎡→24평, 84㎡→34평
const supplyPyeong = (m2) => Math.round((m2 * 1.33) / 3.3058);

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
const TABS = ['home', 'profile', 'analysis', 'complex', 'radar', 'bargains'];
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
  if (name === 'complex' && !tabInited.complex) { tabInited.complex = true; cxInit(); }
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
// 단지별 외부 링크 묶음: 매물(네이버부동산) · 호갱노노 · 지도
function extLinks(region, dong, name) {
  const q = encodeURIComponent(`${dong} ${name}`);
  const full = encodeURIComponent(`${region} ${dong} ${name}`);
  const enc = encodeURIComponent;
  return `<a href="#complex" onclick="cxOpen('${enc(region)}','${enc(dong)}','${enc(name)}');return false" class="ext ext-an">🔍 분석</a>`
    + ` <a href="https://new.land.naver.com/search?sk=${q}" target="_blank" rel="noopener" class="ext">매물</a>`
    + ` <a href="https://hogangnono.com/search?q=${q}" target="_blank" rel="noopener" class="ext">호갱노노</a>`
    + ` <a href="https://map.naver.com/p/search/${full}" target="_blank" rel="noopener" class="ext">지도</a>`;
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

// 분석 탭 지도: 목표 지역 전체 단지를 내 예산 기준으로 색칠
let AN_MAP_REGION = '';
async function anMapLoad() {
  if (!AN_MAP_REGION || typeof L === 'undefined') return;
  const card = document.getElementById('mapCard');
  card.hidden = false;
  const band = document.getElementById('mapBand').value;
  const onlyOk = document.getElementById('mapOnlyOk').checked;
  document.getElementById('mapSub').textContent = '불러오는 중…';
  try {
    const data = await cxFetchMap({ region: AN_MAP_REGION, band });
    document.getElementById('mapSub').textContent = `${data.region} · ${BAND_LABEL[band]} · ${data.total}개 단지`;
    drawComplexMap('map', data, { onlyOk, legendId: 'mapLegend', listId: 'mapList', listN: 8 });
  } catch (e) {
    document.getElementById('mapSub').textContent = '단지 지도 데이터 준비 중 (다음 수집 사이클)';
  }
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
        <td><a href="${naverLink(c)}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none"><b style="border-bottom:1.5px dotted var(--brand)">${c.name}</b></a> <span class="badge" style="margin-left:4px">${c.type || '아파트'}</span><span class="minor">${c.dong} · ${c.buildYear ? c.buildYear + '년' : ''} · ${areaToPyeong(c.areaRange)} · ${extLinks(CX_REGION, c.dong, c.name)}</span></td>
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
  }
  // 단지 지도 (추천·구매 가능 여부) — 추천 단지가 없어도 지역 전체를 보여줌
  AN_MAP_REGION = (cx && cx.regionName) || rd.name;
  const pband = (getProfile() || {}).areaBand;
  if (pband && BAND_LABEL[pband]) document.getElementById('mapBand').value = pband;
  anMapLoad();

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

/* ═══════════ 단지 조회 · 단지 지도 ═══════════ */
const BAND_LABEL = { small: '소형 (~60㎡)', mid84: '국민평형 (60~85㎡)', large: '중대형 (85~135㎡)', xlarge: '대형 (135㎡~)', any: '전체 평형' };
const ST_COLOR = { possible: '#0e9f6e', tight: '#c27803', hard: '#d64545', unknown: '#7b8794' };
const ST_LABEL = { possible: '구매 가능', tight: '빠듯함', hard: '예산 초과', unknown: '판정 불가' };
const scoreCls = (sc) => sc >= 75 ? 's3' : sc >= 60 ? 's2' : sc >= 45 ? 's1' : 's0';
const CX_MAP_CACHE = {};
let CX_CUR = null; // 현재 열려 있는 단지 {region, dong, name}

function profileForApi() {
  const p = getProfile();
  if (!p || !p.salaryAmount) return null;
  return { salaryAmount: p.salaryAmount, savingsAmount: p.savingsAmount, jeonseDeposit: p.jeonseDeposit, currentHome: p.currentHome, family: p.family, childrenCount: p.childrenCount };
}
async function cxFetchMap({ region, band, dong }) {
  const key = `${region}|${band}|${dong || ''}|${JSON.stringify(profileForApi())}`;
  if (CX_MAP_CACHE[key]) return CX_MAP_CACHE[key];
  const data = await apiFetch('/api/real-estate/complex/map', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ region, band, dong, profile: profileForApi(), limit: 500 }),
  });
  CX_MAP_CACHE[key] = data;
  return data;
}

function cxInit() {
  const p = getProfile() || {};
  const inp = document.getElementById('cxMapRegion');
  if (!inp.value) inp.value = p.region || '서울 강서구';
  if (p.areaBand && BAND_LABEL[p.areaBand]) document.getElementById('cxMapBand').value = p.areaBand;
  if (!CX_CUR) cxMapLoad();
}

/* ── 검색 ── */
async function cxSearch() {
  const q = document.getElementById('cxQuery').value.trim();
  const box = document.getElementById('cxResults');
  if (!q) return;
  box.innerHTML = '<p class="muted">검색 중…</p>';
  try {
    const rows = await apiFetch('/api/real-estate/complex/search?q=' + encodeURIComponent(q));
    if (!rows.length) { box.innerHTML = '<p class="muted">최근 1년 실거래에 없는 단지입니다. 동 이름을 붙이거나 다른 표기(예: "동아3" / "동아3차")로 시도해보세요.</p>'; return; }
    box.innerHTML = rows.map((r) => `
      <div class="cx-result" onclick="cxOpen('${encodeURIComponent(r.region)}','${encodeURIComponent(r.dong)}','${encodeURIComponent(r.name)}')">
        <div><span class="nm">${esc(r.name)}</span> <span class="mt">${esc(r.region)} ${esc(r.dong)}${r.buildYear ? ' · ' + r.buildYear + '년' : ''}</span></div>
        <div class="mt" style="text-align:right;white-space:nowrap"><b style="color:var(--ink)">${fmtMoney(r.medianPrice)}</b><br>1년 ${r.count}건</div>
      </div>`).join('');
    if (rows.length === 1) cxOpen(encodeURIComponent(rows[0].region), encodeURIComponent(rows[0].dong), encodeURIComponent(rows[0].name));
  } catch (e) {
    box.innerHTML = `<p class="muted">검색 실패: ${esc(e.message)} — 단지 인덱스는 매일 새벽 수집 때 생성됩니다.</p>`;
  }
}

/* ── 상세 ── */
async function cxOpen(regionEnc, dongEnc, nameEnc) {
  const region = decodeURIComponent(regionEnc), dong = decodeURIComponent(dongEnc), name = decodeURIComponent(nameEnc);
  CX_CUR = { region, dong, name };
  switchTab('complex');
  const det = document.getElementById('cxDetail');
  det.hidden = false;
  det.innerHTML = '<div class="card"><div class="spinner"></div><p style="text-align:center" class="muted">실거래 분석 중…</p></div>';
  det.scrollIntoView({ behavior: 'smooth', block: 'start' });
  try {
    const d = await apiFetch('/api/real-estate/complex/detail', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ region, dong, name, profile: profileForApi() }),
    });
    document.getElementById('cxMapRegion').value = d.region;
    cxRenderDetail(d); // 평형 선택 시 지도 평형도 맞춰 로드
    cxMapLoad({ focus: d });
  } catch (e) {
    det.innerHTML = `<div class="card"><div class="error-box">${esc(e.message)}</div></div>`;
  }
}

let CX_DETAIL = null;
function cxDefaultUnit(d) {
  const band = (getProfile() || {}).areaBand;
  if (band && band !== 'any') {
    const inBand = d.units.filter((u) => {
      const a = u.area;
      return band === 'small' ? a <= 60 : band === 'mid84' ? a > 60 && a <= 85 : band === 'large' ? a > 85 && a <= 135 : a > 135;
    });
    if (inBand.length) return inBand[0].key;
  }
  return d.units[0]?.key;
}

function cxRenderDetail(d) {
  CX_DETAIL = d;
  const cap = d.capital;
  const links = extLinks(d.region, d.dong, d.name);
  const capLine = cap
    ? `내 기준: 자기자금 <b>${fmtMoney(cap.own)}</b> · 연소득 <b>${fmtMoney(cap.income)}</b> · ${cap.currentHome === 'multi' ? '다주택 (추가 주담대 불가)' : '주담대 LTV·DSR·가격구간 상한 적용'} · ${d.regulation.asOf} 규제 · 금리 ${d.regulation.rate}%`
    : `<a href="#profile" onclick="switchTab('profile');return false"><b>내 정보</b></a>를 입력하면 이 단지를 살 수 있는지(대출·월상환 포함) 판정해드립니다.`;

  const bg = d.bargains.length ? `
    <div class="card">
      <h2>🔥 이 단지 급매 체결 이력 <span class="sub">최근 2개월</span></h2>
      <div class="table-wrap"><table><tr><th>일자</th><th>전용/층</th><th>체결가</th><th>할인율</th></tr>
      ${d.bargains.map((b) => `<tr><td>${b.date.slice(5)}</td><td>${b.area}㎡ ${b.floor ?? '-'}층${b.direct ? ' <span class="badge hard">직거래</span>' : ''}</td><td><b>${fmtMoney(b.price)}</b></td><td><b style="color:var(--bad)">${b.discount}%</b></td></tr>`).join('')}
      </table></div>
      <p class="muted">급매가 터진 단지 = 그 가격을 앵커로 협상 가능. 단, 직거래·저층은 할인 사유 확인.</p>
    </div>` : '';

  document.getElementById('cxDetail').innerHTML = `
    <div class="card">
      <div class="cx-head">
        <div>
          <h2>🏢 ${esc(d.name)} <span class="badge">아파트</span></h2>
          <p style="margin:4px 0 0;color:var(--sub);font-size:13.5px">${esc(d.region)} ${esc(d.dong)} ${esc(d.jibun)} · ${d.buildYear ? d.buildYear + '년 준공 (' + (new Date().getFullYear() - d.buildYear) + '년차)' : '준공년도 미상'} · 최근 1년 ${d.tradeCount}건 (6개월 ${d.tradeCount6}건) · ${links}</p>
        </div>
        <div class="notice" style="margin:0;max-width:420px">${capLine}</div>
      </div>
    </div>
    <div class="card">
      <h2>📐 평형 선택 <span class="sub">최근 1년 거래가 있는 세부 평형만 · 전용면적 기준</span></h2>
      <div class="unit-chips" id="cxUnitChips"></div>
      <div id="cxUnitBox"></div>
      ${d.rents.filter((r) => r.type === '월세').length ? `<p class="muted">월세 체결 ${d.rents.filter((r) => r.type === '월세').length}건 (최근 2개월): ${d.rents.filter((r) => r.type === '월세').slice(0, 3).map((r) => `${r.area}㎡ ${fmtMoney(r.deposit)}/${r.monthlyRent}만`).join(' · ')}</p>` : ''}
    </div>
    ${bg}
    <div id="cxNbBox"></div>`;

  cxSelectUnit(cxDefaultUnit(d));
}

function cxSelectUnit(key) {
  const d = CX_DETAIL;
  if (!d) return;
  const u = d.units.find((x) => x.key === key) || d.units[0];
  document.getElementById('cxUnitChips').innerHTML = d.units.map((x) => {
    const st = x.judge?.status || 'unknown';
    return `<button type="button" class="unit-chip ${x.key === u?.key ? 'active' : ''}" onclick="cxSelectUnit('${x.key}')">
      <i class="dot" style="background:${ST_COLOR[st]}"></i><b>전용 ${x.area}㎡</b> <span>약 ${supplyPyeong(x.area)}평형</span><small>${fmtMoney(x.median)} · ${x.count}건</small></button>`;
  }).join('') + (d.units.length ? '' : '<p class="muted">최근 1년 실거래가 없습니다.</p>');
  if (!u) { document.getElementById('cxUnitBox').innerHTML = ''; document.getElementById('cxNbBox').innerHTML = ''; return; }

  const j = u.judge || {};
  const st = j.status || 'unknown';
  const money = st === 'unknown' ? '<p class="muted">내 정보를 입력하면 대출·월상환·부족분이 계산됩니다.</p>' : `
    ${kv('내 최대 예산 (이 가격대 기준)', fmtMoney(j.budget))}
    ${kv('필요 대출', fmtMoney(j.loanNeeded) + (j.loanNeeded > j.maxLoan ? ` <span class="warn-text">(한도 ${fmtMoney(j.maxLoan)})</span>` : ''))}
    ${kv('월 상환 (30년·' + d.regulation.rate + '%)', fmtMoney(j.monthly))}
    ${j.shortfall > 0 ? kv('부족 자금', `<span class="warn-text"><b>${fmtMoney(j.shortfall)}</b></span>`) : kv('예산 충족률', `<b>${j.ratio}%</b>`)}`;
  const trades = u.trades.map((t) => `<tr><td>${t.date.slice(2)}</td><td>${t.floor ?? '-'}층</td><td>${t.area}㎡</td><td><b>${fmtMoney(t.price)}</b></td><td>${fmtMoney(t.pp)}</td><td>${t.direct ? '<span class="badge hard">직거래</span>' : ''}</td></tr>`).join('');
  const basisTxt = u.basis === '6m' ? `최근 6개월 ${u.count6}건 중위` : `최근 1년 ${u.count}건 중위 (6개월 내 거래 ${u.count6}건)`;

  document.getElementById('cxUnitBox').innerHTML = `
    <div class="unit ${st}">
      <div class="unit-head">
        <span class="py">전용 ${u.area}㎡ <span style="font-weight:500;font-size:14px;color:var(--sub)">(약 ${supplyPyeong(u.area)}평형${u.areas.length > 1 ? ' · ' + u.areas.join('/') + '㎡' : ''})</span></span>
        <span class="badge ${st}" style="margin:0">${ST_LABEL[st]}</span>
        <span class="score-pill ${scoreCls(u.score)}">${esc(u.label)} · ${u.score}점</span>
      </div>
      <div class="why">${u.why.map((w) => `<span>✓ ${esc(w)}</span>`).join('')}${u.neg.map((w) => `<span class="neg">! ${esc(w)}</span>`).join('')}</div>
      <div class="unit-grid">
        <div>
          ${kv('실거래 중위가 <span class="muted">(' + basisTxt + ')</span>', `<span class="big">${fmtMoney(u.median)}</span>`)}
          ${u.basis === '6m' && u.median12 !== u.median ? kv('1년 전체 중위 (' + u.count + '건)', fmtMoney(u.median12)) : ''}
          ${kv('범위 (1년 최저~최고)', `${fmtMoney(u.min)} ~ ${fmtMoney(u.max)}`)}
          ${kv('평당가 (전용)', fmtMoney(u.pp) + (u.relPP != null ? ` <span class="${u.relPP > 0 ? 'warn-text' : ''}" style="font-size:12px">동네 같은 평형 대비 ${u.relPP > 0 ? '+' : ''}${u.relPP}%</span>` : ''))}
          ${u.trend != null ? kv('최근 6개월 vs 이전 6개월', `<span class="${u.trend > 1 ? 'up' : u.trend < -1 ? 'down' : ''}">${u.trend > 0 ? '+' : ''}${u.trend}%</span>`) : ''}
          ${u.jeonseMedian ? kv('전세 중위 (최근 2개월 ' + u.jeonseCount + '건)', `${fmtMoney(u.jeonseMedian)} <span class="muted">전세가율 ${u.jeonseRatio}%</span>`) : kv('전세 체결 (최근 2개월)', '<span class="muted">없음</span>')}
        </div>
        <div>${money}</div>
      </div>
      <div class="table-wrap" style="margin-top:10px"><table>
        <tr>${u.monthly.map((m) => `<th>${m.month.slice(2)}</th>`).join('')}</tr>
        <tr>${u.monthly.map((m) => `<td>${m.count ? `<b>${fmtMoney(m.pp)}</b><span class="minor">${m.count}건</span>` : '<span class="muted">-</span>'}</td>`).join('')}</tr>
      </table></div>
      <p class="muted" style="margin:6px 0 0">월별 평당가 (전용 기준) · 거래 건수</p>
      <details style="margin-top:8px" open><summary class="muted" style="cursor:pointer">이 평형 체결 ${u.trades.length}건${u.count > u.trades.length ? ' (최근 ' + u.trades.length + '건만)' : ''}</summary>
        <div class="table-wrap"><table><tr><th>일자</th><th>층</th><th>전용</th><th>가격</th><th>평당</th><th></th></tr>${trades}</table></div>
      </details>
    </div>`;

  const nb = u.neighbors || [];
  document.getElementById('cxNbBox').innerHTML = nb.length ? `
    <div class="card">
      <h2>🏘 ${esc(d.dong)} 이웃 단지 — 전용 ${u.area}㎡급 비교 <span class="sub">동네 같은 평형 평당 중위 ${fmtMoney(u.dongPP)}</span></h2>
      <div class="table-wrap"><table id="cxNbT">
        <tr><th>단지</th><th>전용</th><th>중위가</th><th>평당</th><th>동네 대비</th><th>1년</th></tr>
        <tr style="background:var(--brand-soft)"><td><b>${esc(d.name)}</b> <span class="minor">${d.buildYear ? d.buildYear + '년' : ''} · 이 단지</span></td><td>${u.area}㎡</td><td><b>${fmtMoney(u.median)}</b></td><td>${fmtMoney(u.pp)}</td><td class="${(u.relPP ?? 0) > 0 ? 'warn-text' : ''}">${u.relPP != null ? (u.relPP > 0 ? '+' : '') + u.relPP + '%' : '-'}</td><td>${u.count}건</td></tr>
        ${nb.map((n, i) => `<tr class="${i >= 6 ? 'extra' : ''}" style="${n.sameBand ? '' : 'opacity:.6'}">
          <td><a href="#complex" onclick="cxOpen('${encodeURIComponent(d.region)}','${encodeURIComponent(d.dong)}','${encodeURIComponent(n.name)}');return false" style="color:inherit"><b style="border-bottom:1.5px dotted var(--brand)">${esc(n.name)}</b></a><span class="minor">${n.buildYear ? n.buildYear + '년' : ''}${n.sameBand ? '' : ' · 이 평형 거래 없음 (전체)'}</span></td>
          <td>${n.area ? n.area + '㎡' : '-'}</td><td><b>${fmtMoney(n.medianPrice)}</b></td><td>${fmtMoney(n.pp)}</td>
          <td class="${(n.relPP ?? 0) > 0 ? 'warn-text' : (n.relPP ?? 0) < 0 ? 'down' : ''}">${n.relPP != null ? (n.relPP > 0 ? '+' : '') + n.relPP + '%' : '-'}</td>
          <td>${n.bandCount ?? n.count}건${n.trend != null ? `<span class="minor ${n.trend > 1 ? 'up' : n.trend < -1 ? 'down' : ''}">${n.trend > 0 ? '+' : ''}${n.trend}%</span>` : ''}</td>
        </tr>`).join('')}
      </table></div>${moreBtn('cxNbT', nb.length - 6)}
    </div>` : '';

  // 지도 평형도 선택 평형에 맞춤
  const bandSel = document.getElementById('cxMapBand');
  const b = u.area <= 60 ? 'small' : u.area <= 85 ? 'mid84' : u.area <= 135 ? 'large' : 'xlarge';
  if (bandSel.value !== b) { bandSel.value = b; cxMapLoad({ focus: d }); }
}

/* ── 지도 (공용) ── */
const MAPS = {};
function drawComplexMap(elId, data, opts = {}) {
  if (typeof L === 'undefined') return;
  const el = document.getElementById(elId);
  if (MAPS[elId]) { MAPS[elId].remove(); delete MAPS[elId]; }
  const map = L.map(el, { scrollWheelZoom: false });
  MAPS[elId] = map;
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>', maxZoom: 18 }).addTo(map);

  let items = data.items.filter((c) => c.lat != null);
  if (opts.onlyOk) items = items.filter((c) => c.status === 'possible' || c.status === 'tight');
  const focus = opts.focus;
  const pts = [];
  const order = { hard: 0, unknown: 1, tight: 2, possible: 3 };
  items.slice().sort((a, b) => order[a.status] - order[b.status] || a.score - b.score).forEach((c) => {
    const isFocus = focus && c.name === focus.name && c.dong === focus.dong;
    const r = isFocus ? 14 : c.score >= 75 ? 11 : c.score >= 60 ? 9 : 7;
    const m = L.circleMarker([c.lat, c.lon], {
      radius: r, color: isFocus ? '#16202e' : '#fff', weight: isFocus ? 3 : 1.5,
      fillColor: ST_COLOR[c.status] || ST_COLOR.unknown, fillOpacity: c.geo === 'approx' ? .6 : .95,
      dashArray: c.geo === 'approx' ? '3 3' : null,
    }).addTo(map);
    m.bindTooltip(`${c.name} ${fmtMoney(c.price)}`, { className: 'cx-tip', direction: 'top', offset: [0, -r] });
    m.bindPopup(cxPopup(data.region, c), { maxWidth: 300 });
    pts.push([c.lat, c.lon]);
  });

  if (focus && focus.lat != null) {
    L.circle([focus.lat, focus.lon], { radius: 90, color: '#1d4ed8', weight: 2, fill: false, className: 'focus-ring' }).addTo(map);
    map.setView([focus.lat, focus.lon], 15);
  } else if (pts.length) {
    map.fitBounds(pts, { padding: [30, 30], maxZoom: 15 });
  } else {
    map.setView([37.5665, 126.978], 11);
  }

  const cnt = (st) => data.items.filter((c) => c.status === st).length;
  const missing = data.total - data.located;
  const hasCap = Boolean(data.capital);
  document.getElementById(opts.legendId).innerHTML =
    (hasCap
      ? `<span><i class="dot" style="background:${ST_COLOR.possible}"></i>구매 가능 ${cnt('possible')}</span>
         <span><i class="dot" style="background:${ST_COLOR.tight}"></i>빠듯 ${cnt('tight')}</span>
         <span><i class="dot" style="background:${ST_COLOR.hard}"></i>예산 초과 ${cnt('hard')}</span>`
      : `<span><i class="dot" style="background:${ST_COLOR.unknown}"></i>내 정보 입력 전 — 색은 판정 없음</span>`)
    + `<span>● 크기 = 추천 점수</span>`
    + `<span><i class="dot" style="background:#fff;border:2px dashed #999"></i>점선 = 동 중심 근사 위치</span>`
    + (missing > 0 ? `<span class="muted">좌표 수집 중 ${missing}개 (표에서 확인)</span>` : '')
    + (focus && focus.lat == null ? `<span class="warn-text">이 단지 좌표는 아직 수집 전 — 동 전체를 표시</span>` : '');

  if (opts.listId) cxMapList(opts.listId, data, opts.listN || 10, opts.onlyOk);
}

function cxPopup(region, c) {
  return `<div class="pp-head">${esc(c.name)} <span class="badge ${c.status}" style="margin-left:4px">${ST_LABEL[c.status]}</span></div>
    <div class="muted">${esc(c.dong)} ${esc(c.jibun || '')} · ${c.buildYear ? c.buildYear + '년' : ''} · 전용 ${c.area ?? '-'}㎡${c.area ? ' (약 ' + supplyPyeong(c.area) + '평형)' : ''} ${c.areaCount ? c.areaCount + '건' : ''}</div>
    <span class="score-pill ${scoreCls(c.score)}" style="margin:6px 0">${esc(c.label)} · ${c.score}점</span>
    ${kv('실거래 중위', `<b>${fmtMoney(c.price)}</b>`)}
    ${kv('범위', `${fmtMoney(c.min)}~${fmtMoney(c.max)}`)}
    ${kv('평당가', fmtMoney(c.pp))}
    ${c.status !== 'unknown' ? kv(c.shortfall > 0 ? '부족 자금' : '월 상환', c.shortfall > 0 ? `<span class="warn-text">${fmtMoney(c.shortfall)}</span>` : fmtMoney(c.monthly)) : ''}
    ${kv('최근 체결', c.last)}
    ${c.units && c.units.length > 1 ? `<div class="muted" style="margin-top:4px">평형: ${c.units.map((x) => `${x.area}㎡ ${fmtMoney(x.median)}`).join(' · ')}</div>` : ''}
    <div class="why">${(c.why || []).slice(0, 3).map((w) => `<span>✓ ${esc(w)}</span>`).join('')}${(c.neg || []).slice(0, 2).map((w) => `<span class="neg">! ${esc(w)}</span>`).join('')}</div>
    <div style="margin-top:4px">${extLinks(region, c.dong, c.name)}</div>`;
}

function cxMapList(listId, data, n, onlyOk) {
  let rows = data.items.slice();
  if (onlyOk) rows = rows.filter((c) => c.status === 'possible' || c.status === 'tight');
  const tid = listId + 'T';
  document.getElementById(listId).innerHTML = rows.length ? `
    <p style="font-size:13px;margin:12px 0 6px"><b>추천 순위</b> <span class="muted">— 점수 = 예산 적합 + 동네 대비 가격 + 거래량 + 추세 + 연식 + 급매 앵커</span></p>
    <div class="table-wrap"><table id="${tid}">
      <tr><th>#</th><th>단지</th><th>전용</th><th>중위가</th><th>판정</th><th>점수</th></tr>
      ${rows.map((c, i) => `<tr class="${i >= n ? 'extra' : ''}">
        <td>${i + 1}</td>
        <td><a href="#complex" onclick="cxOpen('${encodeURIComponent(data.region)}','${encodeURIComponent(c.dong)}','${encodeURIComponent(c.name)}');return false" style="color:inherit"><b style="border-bottom:1.5px dotted var(--brand)">${esc(c.name)}</b></a>${c.lat == null ? ' <span class="badge" title="좌표 수집 중">지도 X</span>' : ''}<span class="minor">${esc(c.dong)} · ${c.buildYear ? c.buildYear + '년 · ' : ''}1년 ${c.count}건${c.units && c.units.length > 1 ? ' · 평형 ' + c.units.length + '개' : ''}${c.bargains ? ' · 급매 ' + c.bargains : ''}</span></td>
        <td>${c.area ?? '-'}㎡${c.area ? `<span class="minor">${supplyPyeong(c.area)}평형</span>` : ''}</td>
        <td><b>${fmtMoney(c.price)}</b>${c.shortfall > 0 ? `<span class="minor warn-text">부족 ${fmtMoney(c.shortfall)}</span>` : c.monthly ? `<span class="minor">월 ${fmtMoney(c.monthly)}</span>` : ''}</td>
        <td><span class="badge ${c.status}" style="margin:0">${ST_LABEL[c.status]}</span></td>
        <td><span class="score-pill ${scoreCls(c.score)}">${c.score}</span><span class="minor">${esc(c.label)}</span></td>
      </tr>`).join('')}
    </table></div>${moreBtn(tid, rows.length - n)}` : '<p class="muted">조건에 맞는 단지가 없습니다.</p>';
}

async function cxMapLoad(opts = {}) {
  const region = document.getElementById('cxMapRegion').value.trim();
  const band = document.getElementById('cxMapBand').value;
  const onlyOk = document.getElementById('cxMapOnlyOk').checked;
  if (!region) return;
  const sub = document.getElementById('cxMapSub');
  sub.textContent = '불러오는 중…';
  try {
    const focus = opts.focus || (CX_CUR && CX_CUR.region === region ? CX_CUR : null);
    const data = await cxFetchMap({ region, band });
    sub.textContent = `${data.region} · ${BAND_LABEL[band]} · ${data.total}개 단지 · 좌표 ${data.located}개`;
    drawComplexMap('cxMap', data, { onlyOk, focus, legendId: 'cxMapLegend', listId: 'cxMapList', listN: 10 });
  } catch (e) {
    sub.textContent = '';
    document.getElementById('cxMapLegend').innerHTML = `<span class="warn-text">${esc(e.message)} — 단지 지도 데이터는 매일 새벽 수집 때 생성됩니다.</span>`;
  }
}
['cxMapBand', 'cxMapOnlyOk'].forEach((id) => document.getElementById(id).addEventListener('change', () => cxMapLoad()));
document.getElementById('cxMapRegion').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); cxMapLoad(); } });

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
    huntRender();
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
        <span class="minor">${b.region} ${b.dong} · 표본 ${b.samples}건 · ${extLinks(b.region, b.dong, b.name)}</span></td>
      <td>${b.area}㎡ (${pyeongOfM2(b.area)}평)<span class="minor">${b.floor ?? '-'}층</span></td>
      <td><b>${fmtMoney(b.price)}</b><span class="minor">평당 ${fmtMoney(b.pp)} / 중위 ${fmtMoney(b.medianPP)}</span></td>
      <td><b style="color:var(--bad);font-size:15px">${b.discount}%</b></td>
      <td>${b.date.slice(5)}</td>
    </tr>`).join('');
}

['bgScope', 'bgMinDisc', 'bgMaxPrice', 'bgExDirect', 'bgExLow', 'bgSort'].forEach((id) =>
  document.getElementById(id).addEventListener('change', bgRender));

/* ── 급매 사냥터 추천 ── */
function bgNormalPrice(b) {
  return b.medianPP ? Math.round(b.medianPP * b.area / 3.3058) : null;
}

function huntRender() {
  if (!BG_DATA) return;
  const min = Number(document.getElementById('huntMin').value) || 0;
  const max = Number(document.getElementById('huntMax').value) || Infinity;
  const scope = document.getElementById('huntScope').value;

  // 밴드: 체결가 또는 정상가가 예산 안
  const band = BG_DATA.items.filter((b) => {
    if (!BG_SCOPES[scope](b.region)) return false;
    const np = bgNormalPrice(b);
    return (b.price >= min && b.price <= max) || (np && np >= min && np <= max);
  });

  // 단지별 그룹
  const byComplex = new Map();
  for (const b of band) {
    const k = `${b.region}|${b.dong}|${b.name}`;
    if (!byComplex.has(k)) byComplex.set(k, []);
    byComplex.get(k).push(b);
  }

  // 동네 핫스팟: 한 동에서 2건 이상
  const byDong = new Map();
  for (const b of band) {
    const k = `${b.region} ${b.dong}`;
    if (!byDong.has(k)) byDong.set(k, new Set());
    byDong.get(k).add(b.name);
  }
  const hotDongs = [...byDong.entries()]
    .map(([dong, names]) => ({ dong, complexes: [...names], hits: band.filter((b) => `${b.region} ${b.dong}` === dong).length }))
    .filter((d) => d.hits >= 2)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 8);

  // 단지 추천: 점수 = 반복×3 + 표본신뢰 + 할인 깊이, 직거래-only 단지는 뒤로
  const complexes = [...byComplex.entries()].map(([k, bs]) => {
    const [region, dong, name] = k.split('|');
    const best = bs.slice().sort((a, b) => a.discount - b.discount)[0];
    const cleanHits = bs.filter((b) => !b.direct && (b.floor ?? 99) > 2).length;
    const trusted = best.samples >= 10;
    const score = bs.length * 3 + (trusted ? 2 : 0) + cleanHits * 2 + Math.min(10, -best.discount / 4);
    return { region, dong, name, bs, best, hits: bs.length, cleanHits, trusted, score,
      allDirect: bs.every((b) => b.direct) };
  }).sort((a, b) => (a.allDirect === b.allDirect ? b.score - a.score : a.allDirect ? 1 : -1))
    .slice(0, 12);

  let html = '';
  if (hotDongs.length) {
    html += `<p style="font-size:13px;margin:0 0 6px"><b>🏘 동네 단위 신호</b> — 급매가 몰리는 곳 (중개사 선주문 1순위)</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">` +
      hotDongs.map((d) => `<span class="hot-chip"><b>${d.dong}</b> ${d.hits}건 <small>(${d.complexes.slice(0, 3).join(', ')}${d.complexes.length > 3 ? ' 외' : ''})</small></span>`).join('') +
      '</div>';
  }

  if (!complexes.length) {
    html += '<p class="muted">이 예산·지역 조건에 해당하는 급매 체결이 아직 없습니다. 범위를 넓혀보세요.</p>';
  } else {
    html += `<div class="table-wrap"><table id="huntTable">
      <tr><th>추천 단지</th><th>정상가 → 체결</th><th>최대 할인</th><th>신호</th></tr>` +
      complexes.map((c, i) => {
        const np = bgNormalPrice(c.best);
        const badges =
          (c.hits >= 2 ? '<span class="badge" style="background:var(--brand-soft);color:var(--brand)">반복⭐' + c.hits + '회</span>' : '') +
          (c.trusted ? '<span class="badge possible">표본↑</span>' : '<span class="badge">표본' + c.best.samples + '</span>') +
          (c.allDirect ? '<span class="badge hard">직거래만</span>' : '') +
          ((c.best.floor ?? 99) <= 2 ? '<span class="badge tight">저층</span>' : '');
        return `<tr class="${i >= 6 ? 'extra' : ''}">
          <td><a href="${bgNaver(c.best)}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none"><b style="border-bottom:1.5px dotted var(--brand)">${c.name}</b></a>
            <span class="minor">${c.region} ${c.dong} · ${c.best.area}㎡ · ${c.best.date.slice(5)} 체결 · ${extLinks(c.region, c.dong, c.name)}</span></td>
          <td>${np ? fmtMoney(np) : '-'} → <b>${fmtMoney(c.best.price)}</b></td>
          <td><b style="color:var(--bad)">${c.best.discount}%</b></td>
          <td>${badges}</td>
        </tr>`;
      }).join('') + `</table></div>${moreBtn('huntTable', Math.max(0, complexes.length - 6))}`;
  }

  document.getElementById('huntBox').innerHTML = html;
}

['huntMin', 'huntMax', 'huntScope'].forEach((id) =>
  document.getElementById(id).addEventListener('change', huntRender));

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
        <td><b>${b.name}</b><span class="minor">${b.region} · ${b.area}㎡ ${b.floor ?? '-'}층 · ${b.date.slice(5)} · ${extLinks(b.region, b.dong, b.name)}</span></td>
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
