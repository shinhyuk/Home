// 오름홈 전략 리포트 생성기 — 분석 결과를 A4 인쇄 최적화 문서로 변환
// 사용: window.REPORT_DATA = { r, input } 설정 후 downloadReportHTML() / printReport()

const FEAS_KO = { possible: '가능', tight: '빠듯함', hard: '어려움', ineligible: '자격 없음', unknown: '정보 부족' };
const PRIORITY_KO = { 'own-home': '내 집 마련', investment: '자산 증식/투자', upgrade: '갈아타기', flexible: '유연하게' };
const HOME_KO = { none: '무주택', jeonse: '무주택(전세 거주)', 'first-time': '1주택(생애 첫)', owned: '1주택', multi: '다주택' };
const TIMELINE_KO = { urgent: '6개월 내', '1year': '1년 내', '2year': '2년 내', '3plus': '3년 이상' };

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function pyeongOf(range) {
  if (!range) return '-';
  const p = (m2) => Math.round(m2 / 3.3058);
  return p(range[0]) === p(range[1]) ? `${p(range[0])}평형` : `${p(range[0])}~${p(range[1])}평형`;
}

function buildReportHTML() {
  const { r, input } = window.REPORT_DATA || {};
  if (!r) return null;
  const rd = r.regionData || {};
  const t = r.tracks || {};
  const rec = r.recommendations || {};
  const cx = rec.complexes || {};
  const l = r.loanSimulation;
  const ab = r.areaBasis;
  const d = r.details || {};
  const today = new Date();
  const dateStr = `${today.getFullYear()}.${String(today.getMonth() + 1).padStart(2, '0')}.${String(today.getDate()).padStart(2, '0')}`;

  const cxRow = (c, extra) => `<tr>
    <td><b>${esc(c.name)}</b> <span class="tag">${esc(c.type || '아파트')}</span><br>
      <small>${esc(c.dong)} · ${c.buildYear ? c.buildYear + '년' : '-'} · ${pyeongOf(c.areaRange)}</small></td>
    <td class="num">${c.count}건</td>
    <td class="num"><b>${fmtMoney(c.medianPrice)}</b><br><small>${fmtMoney(c.minPrice)}~${fmtMoney(c.maxPrice)}</small></td>
    <td class="num">${fmtMoney(c.avgPerPyeong)}</td>
    ${extra !== undefined ? `<td class="num warn">+${fmtMoney(extra)}</td>` : ''}
  </tr>`;

  const trackRow = (tr, metrics) => tr && tr.feasible ? `<tr>
    <td><b>${esc(tr.name)}</b></td>
    <td><span class="pill ${tr.feasible}">${FEAS_KO[tr.feasible] || tr.feasible}</span></td>
    <td>${metrics}</td>
    <td><small>${esc(tr.note || '')}</small></td>
  </tr>` : '';

  const regionRows = (rec.regions?.affordable || []).map((x) => `<tr>
    <td><b>${esc(x.name)}</b></td>
    <td class="num">${fmtMoney(x.medianPrice)}</td>
    <td class="num">${fmtMoney(x.avgPerPyeong)}</td>
    <td class="num">${x.jeonseRatio ?? '-'}%</td>
    <td class="num ${x.changeRate > 1 ? 'red' : x.changeRate < -1 ? 'blue' : ''}">${x.changeRate > 0 ? '+' : ''}${x.changeRate ?? '-'}%</td>
    <td class="num"><b>${x.fit}%</b></td>
  </tr>`).join('');

  const trendRows = (rd.monthlyTrend || []).map((m) =>
    `<tr><td>${m.month}</td><td class="num">${m.count ?? 0}건</td><td class="num">${fmtMoney(m.avgAmount)}</td><td class="num">${fmtMoney(m.medianAmount)}</td><td class="num">${fmtMoney(m.avgPerPyeong)}</td></tr>`
  ).join('');

  const sub = t.subscription, score = sub?.score || {};

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>오름홈 전략 리포트 — ${esc(rd.name || '')} (${dateStr})</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;900&display=swap">
<style>
  :root { --ink:#16202e; --sub:#5b6b7d; --faint:#8b98a8; --line:#dde4ec;
    --brand:#1d4ed8; --brand-deep:#16339b; --good:#0e9f6e; --warnc:#c27803; --bad:#d64545; }
  * { box-sizing: border-box; }
  body { margin:0; font-family:"Noto Sans KR",-apple-system,"Malgun Gothic",sans-serif;
    color:var(--ink); font-size:13px; line-height:1.6; background:#fff; }
  .page { max-width:800px; margin:0 auto; padding:36px 32px; }
  .cover { border-bottom:3px solid var(--brand-deep); padding-bottom:18px; margin-bottom:24px;
    display:flex; justify-content:space-between; align-items:flex-end; flex-wrap:wrap; gap:8px; }
  .brand { font-size:24px; font-weight:900; color:var(--brand-deep); letter-spacing:-0.5px; }
  .brand span { color:var(--brand); }
  .cover .meta { text-align:right; font-size:12px; color:var(--sub); }
  h1 { font-size:21px; margin:0 0 4px; letter-spacing:-0.3px; }
  h2 { font-size:15px; margin:28px 0 10px; padding-left:10px; border-left:4px solid var(--brand);
    letter-spacing:-0.2px; }
  .summary { background:#f0f4ff; border:1px solid #d7e2fb; border-radius:10px; padding:16px 18px; margin:14px 0; }
  .summary .st { font-size:17px; font-weight:800; color:var(--brand-deep); margin-bottom:4px; }
  .stats { display:flex; flex-wrap:wrap; gap:0; border:1px solid var(--line); border-radius:10px; overflow:hidden; margin:12px 0; }
  .stat { flex:1 1 25%; min-width:140px; padding:12px 14px; border-right:1px solid var(--line); border-bottom:1px solid var(--line); }
  .stat .v { font-size:17px; font-weight:800; font-variant-numeric:tabular-nums; }
  .stat .k { font-size:11px; color:var(--faint); }
  table { width:100%; border-collapse:collapse; font-size:12.5px; margin:6px 0; }
  th,td { padding:7px 9px; border-bottom:1px solid var(--line); text-align:left; vertical-align:top; }
  th { background:#f6f8fb; font-size:11px; color:var(--sub); font-weight:700; }
  td.num,th.num { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
  small { color:var(--faint); font-size:11px; }
  .tag { display:inline-block; font-size:10px; font-weight:700; background:#eef1f6; color:var(--sub);
    border-radius:8px; padding:1px 7px; vertical-align:1px; }
  .pill { display:inline-block; font-size:11px; font-weight:700; border-radius:10px; padding:2px 10px; }
  .pill.possible { background:#e3f7ef; color:var(--good); }
  .pill.tight { background:#fdf3dd; color:var(--warnc); }
  .pill.hard,.pill.ineligible { background:#fdebeb; color:var(--bad); }
  .red { color:var(--bad); font-weight:700; } .blue { color:var(--brand); font-weight:700; }
  .warn { color:var(--warnc); }
  ul { margin:6px 0; padding-left:18px; } li { margin:4px 0; }
  .two { display:flex; gap:20px; flex-wrap:wrap; } .two > div { flex:1; min-width:280px; }
  .input-grid { display:flex; flex-wrap:wrap; gap:6px 0; font-size:12px; }
  .input-grid div { flex:1 1 33%; min-width:150px; color:var(--sub); }
  .input-grid b { color:var(--ink); }
  .foot { margin-top:30px; padding-top:12px; border-top:1px solid var(--line);
    font-size:10.5px; color:var(--faint); line-height:1.7; }
  .toolbar { position:sticky; top:0; background:#16202e; color:#fff; padding:10px 16px;
    display:flex; gap:10px; align-items:center; justify-content:center; }
  .toolbar button { font-family:inherit; font-size:13px; font-weight:700; padding:8px 18px;
    border:none; border-radius:8px; cursor:pointer; background:var(--brand); color:#fff; }
  .toolbar .ghost { background:#39465a; }
  @media print {
    .toolbar { display:none; }
    .page { padding:0; max-width:none; }
    body { font-size:11.5px; }
    h2 { page-break-after:avoid; } tr { page-break-inside:avoid; }
    .summary,.stats { break-inside:avoid; }
  }
  @page { margin: 16mm 14mm; }
</style>
</head>
<body>
<div class="toolbar">
  <span style="font-size:12px;opacity:.8">오름홈 전략 리포트</span>
  <button onclick="window.print()">🖨 인쇄 / PDF로 저장</button>
  <button class="ghost" onclick="window.close()">닫기</button>
</div>
<div class="page">
  <div class="cover">
    <div>
      <div class="brand">오름<span>홈</span></div>
      <h1>${esc(rd.name || '')} 부동산 전략 리포트</h1>
      <div style="font-size:12px;color:var(--sub)">${ab ? esc(ab.label) : '전체 평형'} 기준 · 국토교통부 실거래 데이터</div>
    </div>
    <div class="meta">생성일 ${dateStr}<br>oreumhome · shinhyuk.github.io/Home</div>
  </div>

  <div class="summary">
    <div class="st">${esc(r.strategy?.title || '')}</div>
    <div>${esc(r.strategy?.description || '')}</div>
  </div>

  <div class="stats">
    ${l ? `
    <div class="stat"><div class="v">${fmtMoney(l.ownCapital + l.maxLoanByDSR)}</div><div class="k">내 최대 예산 (자금+대출)</div></div>
    <div class="stat"><div class="v">${fmtMoney(l.maxLoanByDSR)}</div><div class="k">가능 대출 (스트레스 DSR·상한 반영)</div></div>
    <div class="stat"><div class="v">${fmtMoney(l.monthlyPayment)}</div><div class="k">월 상환액 (권장대출 기준)</div></div>` : ''}
    <div class="stat"><div class="v">${fmtMoney(t.buy?.medianPrice || rd.medianPrice)}</div><div class="k">${esc(rd.name || '')} 중위가${ab && ab.applied ? ' (' + esc(ab.label.split(' · ')[0]) + ')' : ''}</div></div>
    ${t.buy ? `<div class="stat"><div class="v">${t.buy.budgetRatio}%</div><div class="k">예산 충족률</div></div>` : ''}
    <div class="stat"><div class="v">${rd.jeonseRatio ?? '-'}%</div><div class="k">전세가율</div></div>
    <div class="stat"><div class="v class">${rd.trend === 'up' ? '+' : ''}${rd.changeRate ?? '-'}%</div><div class="k">6개월 평당가 추세</div></div>
    <div class="stat"><div class="v">${r.confidence}%</div><div class="k">신뢰도 (거래량 기반)</div></div>
  </div>

  <h2>입력 정보</h2>
  <div class="input-grid">
    <div>연소득 <b>${fmtMoney(input?.salaryAmount)}</b></div>
    <div>가용 자금 <b>${fmtMoney(input?.savingsAmount)}</b></div>
    <div>전세보증금 <b>${fmtMoney(input?.jeonseDeposit || 0)}</b></div>
    <div>주택 보유 <b>${HOME_KO[input?.currentHome] || '-'}</b></div>
    <div>우선순위 <b>${PRIORITY_KO[input?.priority] || '-'}</b></div>
    <div>목표 시기 <b>${TIMELINE_KO[input?.timeline] || '-'}</b></div>
  </div>

  <h2>경로별 판정 — 청약 · 전세 · 매매</h2>
  <table>
    <tr><th style="width:70px">경로</th><th style="width:80px">판정</th><th>핵심 수치</th><th>코멘트</th></tr>
    ${trackRow(sub, sub && score.total != null
      ? `청약 가점 <b>${score.total}점</b>/84 (무주택 ${score.homelessPoints ?? '-'} · 가족 ${score.familyPoints ?? '-'} · 통장 ${score.accountPoints ?? '-'})${sub.specialSupply?.length ? '<br><small>특공: ' + sub.specialSupply.map(esc).join(', ') + '</small>' : ''}`
      : '가점 정보 부족')}
    ${trackRow(t.jeonse, t.jeonse ? `평균 보증금 <b>${fmtMoney(t.jeonse.avgDeposit)}</b> · 내 예산 ${fmtMoney(t.jeonse.budget)} (${t.jeonse.budgetRatio}%)<br><small>전세대출 ${fmtMoney(t.jeonse.loanNeeded)} · 월이자 ${fmtMoney(t.jeonse.monthlyInterest)}</small>` : '')}
    ${trackRow(t.buy, t.buy ? `중위가 <b>${fmtMoney(t.buy.medianPrice)}</b> · 내 예산 ${fmtMoney(t.buy.budget)} (${t.buy.budgetRatio}%)<br><small>월 상환 ${fmtMoney(t.buy.monthlyPayment)}${t.buy.shortfall > 0 ? ' · 부족 ' + fmtMoney(t.buy.shortfall) : ''}</small>` : '')}
  </table>

  ${(r.scenarios && r.scenarios.length) ? `
  <h2>전략 시나리오 — 한 판 정리 <small>(상황 기반 추천도 순)</small></h2>
  ${r.scenarios.map((sc) => `
    <div class="summary" style="background:${sc.recommended ? '#f0f4ff' : '#f8fafc'};border-color:${sc.recommended ? '#d7e2fb' : 'var(--line)'};page-break-inside:avoid">
      <div class="st" style="font-size:14px">${sc.recommended ? '⭐ 추천 — ' : sc.rank + '순위 — '}${esc(sc.icon)} ${esc(sc.title)} <small style="font-weight:400">적합도 ${sc.fit}</small></div>
      <div style="margin:4px 0 8px">${esc(sc.oneLiner)}</div>
      <ol style="margin:4px 0;padding-left:20px">${sc.steps.map((st) => `<li>${esc(st)}</li>`).join('')}</ol>
      <div style="font-size:12px;color:var(--sub)">${sc.numbers.map((n) => `${esc(n.k)}: <b>${esc(n.v)}</b>`).join(' · ')}</div>
      ${sc.candidates && sc.candidates.length ? `
      <table style="margin-top:8px">
        <tr><th>후보지</th><th class="num">중위가</th><th class="num">전세가율</th>${sc.candidates[0].gap != null ? '<th class="num">갭</th><th class="num">취득세 포함</th>' : '<th class="num">충족률</th>'}<th class="num">6개월</th></tr>
        ${sc.candidates.map((c) => `<tr>
          <td>${esc(c.name)}${c.affordable === false ? ' <small>(자금부족)</small>' : ''}</td>
          <td class="num">${fmtMoney(c.medianPrice)}</td>
          <td class="num">${c.jeonseRatio ?? '-'}%</td>
          ${c.gap != null ? `<td class="num"><b>${fmtMoney(c.gap)}</b></td><td class="num">${fmtMoney(c.cost)}</td>` : `<td class="num"><b>${c.fitPct ?? '-'}%</b></td>`}
          <td class="num">${c.changeRate > 0 ? '+' : ''}${c.changeRate ?? '-'}%</td>
        </tr>`).join('')}
      </table>` : ''}
      <div class="two" style="margin-top:8px;font-size:12px">
        <div><b style="color:var(--good)">장점</b><ul>${sc.pros.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
        <div><b style="color:var(--bad)">리스크</b><ul>${sc.cons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
      </div>
    </div>`).join('')}` : ''}

  ${(cx.within?.length || cx.stretch?.length) ? `
  <h2>단지 추천 — ${esc(cx.regionName || '')} <small>(${esc(cx.basis || '')})</small></h2>
  ${cx.within?.length ? `
  <p style="margin:4px 0"><b style="color:var(--good)">지금 예산(${fmtMoney(rec.budget)}) 안에서 — ${cx.within.length}곳</b></p>
  <table>
    <tr><th>단지</th><th class="num">거래</th><th class="num">중위가 (범위)</th><th class="num">평당가</th></tr>
    ${cx.within.map((c) => cxRow(c)).join('')}
  </table>` : ''}
  ${cx.stretch?.length ? `
  <p style="margin:10px 0 4px"><b style="color:var(--warnc)">조금 더 모으면 (예산 +30% 이내) — ${cx.stretch.length}곳</b></p>
  <table>
    <tr><th>단지</th><th class="num">거래</th><th class="num">중위가 (범위)</th><th class="num">평당가</th><th class="num">부족분</th></tr>
    ${cx.stretch.map((c) => cxRow(c, c.shortfall)).join('')}
  </table>` : ''}` : ''}

  ${regionRows ? `
  <h2>예산에 맞는 다른 지역 <small>(전국 ${rec.regions?.totalScanned ?? '-'}개 시군구 스캔 · 6개월 상승률순)</small></h2>
  <table>
    <tr><th>지역</th><th class="num">중위가</th><th class="num">평당가</th><th class="num">전세가율</th><th class="num">6개월</th><th class="num">예산충족률</th></tr>
    ${regionRows}
  </table>` : ''}

  <h2>${esc(rd.name || '')} 월별 실거래 추세 <small>(아파트 매매 · 전체 평형)</small></h2>
  <table>
    <tr><th>월</th><th class="num">거래량</th><th class="num">평균가</th><th class="num">중위가</th><th class="num">평당가</th></tr>
    ${trendRows}
  </table>

  <div class="two">
    <div>
      <h2>자격 · 현황</h2>
      <ul>${(d.qualification || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      <h2>액션 플랜</h2>
      <ul>${(d.actions || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    </div>
    <div>
      <h2>주의사항</h2>
      <ul>${(d.warnings || []).map((x) => `<li>${esc(x.replace(/^•\s*/, ''))}</li>`).join('')}</ul>
    </div>
  </div>

  <div class="foot">
    데이터 출처: 국토교통부 실거래가 공개시스템 (매일 자동 수집) · 대출 계산은 2026.10 규제(가격구간별 상한·스트레스 DSR·다주택 제한) 기준의 추정치입니다.<br>
    본 리포트는 참고용 정보 제공이며 투자 권유가 아닙니다. 실제 거래 전 금융기관·공인중개사·세무사 확인을 권장합니다. · © 오름홈
  </div>
</div>
</body>
</html>`;
}

function reportFileName() {
  const { r } = window.REPORT_DATA || {};
  const d = new Date();
  const ds = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `오름홈_전략리포트_${(r?.regionData?.name || '지역').replace(/\s+/g, '')}_${ds}.html`;
}

function downloadReportHTML() {
  const html = buildReportHTML();
  if (!html) { alert('분석 결과가 없습니다.'); return; }
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = reportFileName();
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function printReport() {
  const html = buildReportHTML();
  if (!html) { alert('분석 결과가 없습니다.'); return; }
  const w = window.open('', '_blank');
  if (!w) { alert('팝업이 차단되었습니다. 팝업 허용 후 다시 시도해주세요.'); return; }
  w.document.write(html);
  w.document.close();
  // 폰트 로드 여유를 두고 인쇄 대화상자
  setTimeout(() => { try { w.focus(); w.print(); } catch (e) { /* 사용자가 닫음 */ } }, 600);
}
