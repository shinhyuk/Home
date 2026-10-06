// 종합 전략 시나리오 플래너 — 거주·투자·청약을 조합한 "한 판" 전략 생성
const realEstateService = require('./realEstateService');

const fmt = (man) => {
  if (man == null || isNaN(man)) return '-';
  man = Math.round(man);
  if (Math.abs(man) >= 10000) {
    const eok = Math.floor(Math.abs(man) / 10000) * Math.sign(man);
    const rest = Math.abs(man) % 10000;
    return rest ? `${eok}억 ${rest.toLocaleString()}만` : `${eok}억`;
  }
  return man.toLocaleString() + '만원';
};

// 1주택 기준 취득세 약식 (1~3% 누진, 부대비용 미포함)
function acquisitionTax(price) {
  if (!price) return 0;
  if (price <= 60000) return Math.round(price * 0.011);
  if (price <= 90000) return Math.round(price * (0.011 + ((price - 60000) / 30000) * 0.022));
  return Math.round(price * 0.033);
}

const METRO = /^(서울|경기|인천)/;

async function buildScenarios(userData, norm, effRegion, tracks, maxLoanFn) {
  const scenarios = [];
  const isHomeless = ['none', 'jeonse'].includes(userData.currentHome);
  const score = tracks?.subscription?.score || {};
  const buy = tracks?.buy || {};
  const workLabel = [userData.workRegion1, userData.workRegion2].filter(Boolean).join(' · ');

  let summary = null;
  try { summary = await realEstateService.getAllRegionSummaries(); } catch (e) { /* 무시 */ }
  const regions = (summary?.regions || []).filter((r) => r.medianPrice && r.tradeCount >= 10);

  // ── A. 직주근접(목표지역) 실거주 매수 ──
  if (buy.medianPrice) {
    const ok = buy.budgetRatio >= 100;
    const near = buy.budgetRatio >= 85;
    scenarios.push({
      id: 'A',
      icon: '🏠',
      title: `${effRegion.name} 실거주 매수`,
      fit: ok ? 85 : near ? 62 : 30,
      oneLiner: ok
        ? '예산이 되는 지금, 직주근접 실거주를 확정하는 정공법.'
        : `현재 예산으로는 ${effRegion.name} 중위가의 ${buy.budgetRatio}%만 커버 — 평형·연식 눈높이 조정이 전제.`,
      steps: [
        `주담대 사전한도 확인 (DSR 기준 약 ${fmt(buy.maxLoan)})`,
        `${effRegion.name} 급매·구축 중심으로 ${fmt(buy.budget)} 이내 물건 탐색`,
        `매수 후 실거주 — 월 상환 약 ${fmt(buy.monthlyPayment)} 감당`,
      ],
      numbers: [
        { k: '중위 매매가', v: fmt(buy.medianPrice) },
        { k: '내 최대 예산', v: fmt(buy.budget) },
        { k: '예산 충족률', v: buy.budgetRatio + '%' },
        { k: '월 상환액', v: fmt(buy.monthlyPayment) },
        ...(buy.shortfall > 0 ? [{ k: '부족 자금', v: fmt(buy.shortfall) }] : []),
      ],
      candidates: null,
      pros: ['주거 안정 + 직장 접근성 확보', '실거주 1주택 — 양도세 비과세 베이스', '이사·전세 갱신 스트레스 종료'],
      cons: ok
        ? ['대출 상환 부담 장기화', '단기 시세 하락 시 심리적 부담']
        : ['현 예산으론 소형·구축 한정', '무리한 영끌 시 금리 리스크'],
    });
  }

  // ── B. 사두고 전세살기 (거주·투자 분리 / 갭 전략) ──
  // 가용자금(전세보증금 제외 — 거주 유지에 묶임)으로 갭+취득세 감당 가능한 성장지
  const gapCands = regions
    .filter((r) => r.jeonseRatio && METRO.test(r.name))
    .map((r) => {
      const gap = Math.round(r.medianPrice * (1 - r.jeonseRatio / 100));
      const cost = gap + acquisitionTax(r.medianPrice);
      return { ...r, gap, cost };
    })
    .filter((r) => r.gap > 0)
    .sort((a, b) => (b.changeRate ?? -99) - (a.changeRate ?? -99));

  const affordableGaps = gapCands.filter((r) => r.cost <= norm.capital);
  const bList = (affordableGaps.length ? affordableGaps : gapCands.slice()
    .sort((a, b) => a.cost - b.cost)).slice(0, 4);

  if (bList.length) {
    const top = bList[0];
    const affordable = affordableGaps.length > 0;
    let fitB = affordable ? 68 : 28;
    if (affordable && (score.total ?? 99) < 50) fitB += 8;   // 가점 낮으면 청약 포기 비용 작음
    if (affordable && top.changeRate > 2) fitB += 6;
    if (userData.currentHome === 'multi') fitB -= 25;

    scenarios.push({
      id: 'B',
      icon: '🔀',
      title: '사두고 전세살기 — 거주·투자 분리',
      fit: Math.max(5, Math.min(95, fitB)),
      oneLiner: affordable
        ? `직주근접(${workLabel || effRegion.name})은 전세로 유지하고, 성장지에 전세 끼고 선점. ${top.name} 갭 약 ${fmt(top.gap)}.`
        : `지금 가용자금(${fmt(norm.capital)})으론 갭이 부족 — 최소 갭 지역 기준 ${fmt(bList[0].cost - norm.capital)} 더 필요.`,
      steps: [
        `성장 후보지에서 전세 낀 매물 매수 — 투입: 갭 + 취득세 (예: ${top.name} 약 ${fmt(top.cost)})`,
        `부부는 현 거주지 전세 유지${workLabel ? ` (직장 ${workLabel} 접근 유지)` : ''}${norm.jeonseDeposit ? ` — 보증금 ${fmt(norm.jeonseDeposit)} 그대로` : ''}`,
        '2~4년 보유: 전세 만기 맞춰 실입주하거나, 상승분 챙겨 상급지 환승',
      ],
      numbers: [
        { k: '가용 투자금 (전세금 제외)', v: fmt(norm.capital) },
        { k: `1순위 후보 (${top.name}) 갭`, v: fmt(top.gap) },
        { k: '취득세 포함 필요액', v: fmt(top.cost) },
        { k: '후보지 6개월 추세', v: (top.changeRate > 0 ? '+' : '') + top.changeRate + '%' },
      ],
      candidates: bList.map((r) => ({
        name: r.name, medianPrice: r.medianPrice, jeonseRatio: r.jeonseRatio,
        gap: r.gap, cost: r.cost, changeRate: r.changeRate,
        affordable: r.cost <= norm.capital,
      })),
      pros: [
        '주담대 0원 — 전세보증금이 무이자 레버리지',
        '직장 접근성 포기 없이 자산 선점',
        '상승장이면 적은 자본으로 상승분 전체 향유',
      ],
      cons: [
        '⚠ 유주택 전환 — 청약 가점·생애최초 혜택 소멸' + (score.total ? ` (현재 가점 ${score.total}점 포기)` : ''),
        '⚠ 역전세·전세가 하락 시 보증금 반환 리스크',
        '⚠ 규제: 소유권이전 조건부 전세대출 금지 — 세입자 승계 구조 사전 확인 필수',
        '1주택자 전세대출 연장 제약 가능 — 본인 거주 전세대출 있다면 은행 확인',
        '보유세(재산세) + 2년 보유 전 매도 시 단기 양도세 중과',
      ],
    });
  }

  // ── C. 청약 올인 — 무주택 유지 ──
  if (isHomeless) {
    const total = score.total;
    const fitC = total == null ? 45 : total >= 60 ? 82 : total >= 45 ? 60 : 35;
    scenarios.push({
      id: 'C',
      icon: '🎫',
      title: '청약 올인 — 무주택 가치 지키기',
      fit: fitC,
      oneLiner: total != null
        ? `가점 ${total}점. ${total >= 60 ? '인기 단지 당첨권 — 무주택을 깨는 건 아깝다.' : total >= 45 ? '중위권 — 특공 병행하면 승산.' : '가점제는 불리 — 추첨제·특공 위주로만 유지.'}`
        : '무주택 기간·통장 기간 입력 시 정밀 판단 가능.',
      steps: [
        '현 전세 유지 + 청약통장 납입 지속 (무주택 기간 가점 매년 +2점)',
        `관심 지역 분양 알림 설정 — 분양가상한제 단지 집중${workLabel ? ` (${workLabel} 출퇴근권)` : ''}`,
        '당첨 시: 분양가-시세 차익 + 신축 — 실패 누적 시 2년 후 플랜 A/B 재검토',
      ],
      numbers: [
        { k: '청약 가점', v: total != null ? `${total}점 / 84` : '미입력' },
        { k: '무주택 가점 증가', v: '+2점/년' },
        { k: '거주 비용', v: norm.jeonseDeposit ? `전세 ${fmt(norm.jeonseDeposit)} 유지` : '현 거주 유지' },
      ],
      candidates: null,
      pros: ['분양가상한제 = 시세 대비 확정 할인', '신축 + 중도금 분할 납부', '무주택 혜택(생애최초 LTV 80%·취득세 감면) 보존'],
      cons: ['당첨까지 수년 불확실', '그 사이 시세 상승 리스크 (기회비용)', '전세 갱신·이사 스트레스 지속'],
    });
  }

  // ── D. 사다리 전략 — 성장지 실거주 → 상급지 환승 ──
  const ladderCands = regions
    .filter((r) => METRO.test(r.name) && r.name !== effRegion.name)
    .map((r) => {
      const loan = maxLoanFn(norm.annualIncome, r.medianPrice, { currentHome: userData.currentHome });
      const budget = norm.capital + norm.jeonseDeposit + loan;
      return { ...r, fit: Math.round((budget / r.medianPrice) * 100) };
    })
    .filter((r) => r.fit >= 100 && (r.changeRate ?? 0) >= 0)
    .sort((a, b) => (b.changeRate ?? 0) - (a.changeRate ?? 0))
    .slice(0, 4);

  if (ladderCands.length) {
    const top = ladderCands[0];
    scenarios.push({
      id: 'D',
      icon: '🪜',
      title: '사다리 전략 — 되는 곳부터 실거주',
      fit: userData.priority === 'own-home' ? 66 : 55,
      oneLiner: `${effRegion.name}은 아직 어렵다면, 지금 예산으로 살 수 있는 성장지(${top.name} 등)에 먼저 올라타고 몇 년 뒤 환승.`,
      steps: [
        `예산 100% 이내 성장지 매수 — 예: ${top.name} 중위 ${fmt(top.medianPrice)} (충족률 ${top.fit}%)`,
        '실거주 2년+ — 양도세 비과세 요건 확보하며 상승분 축적',
        `일시적 2주택 특례로 ${effRegion.name} 등 상급지 환승 (신규 취득 후 3년 내 처분)`,
      ],
      numbers: [
        { k: '1순위 후보', v: top.name },
        { k: '중위가 / 충족률', v: `${fmt(top.medianPrice)} / ${top.fit}%` },
        { k: '6개월 추세', v: (top.changeRate > 0 ? '+' : '') + top.changeRate + '%' },
      ],
      candidates: ladderCands.map((r) => ({
        name: r.name, medianPrice: r.medianPrice, jeonseRatio: r.jeonseRatio,
        gap: null, cost: null, changeRate: r.changeRate, affordable: true, fitPct: r.fit,
      })),
      pros: ['내 집에서 거주 안정 + 자산 증식 동시 진행', '비과세 양도차익이 상급지 입장권', '전세금 인상 걱정 종료'],
      cons: ['출퇴근 거리 증가 가능성 — 후보지 통근 체크 필수', '상급지가 더 빨리 오르면 격차 유지·확대', '환승 시 거래비용 2회(중개·취득세)'],
    });
  }

  // 추천도 정렬 + 1위 마킹
  scenarios.sort((a, b) => b.fit - a.fit);
  scenarios.forEach((s, i) => { s.recommended = i === 0; s.rank = i + 1; });

  return scenarios;
}

module.exports = { buildScenarios };
