const realEstateService = require('./realEstateService');

// 연봉 범위 → 대표값 (만원/년)
const SALARY_RANGES = {
  '0-2000': 1500,
  '2000-3500': 2800,
  '3500-5000': 4200,
  '5000-7000': 6000,
  '7000-10000': 8500,
  '10000': 12000,
};

// 보유자금 범위 → 대표값 (만원)
const SAVINGS_RANGES = {
  '0-5000': 2500,
  '5000-10000': 7500,
  '10000-20000': 15000,
  '20000-50000': 35000,
  '50000': 60000,
};

// ───────────────────────── 대출 계산 ─────────────────────────

// 원리금균등 월상환액
function monthlyPayment(principal, annualRate = 3.5, years = 30) {
  const r = annualRate / 100 / 12;
  const n = years * 12;
  if (r === 0) return principal / n;
  return principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}

// DSR 40% + LTV 70% 기준 최대 대출액 (만원)
function maxLoanCapacity(annualIncome, housePrice, { dsr = 0.4, ltv = 0.7, rate = 3.5, years = 30 } = {}) {
  const maxMonthly = (annualIncome / 12) * dsr;
  // 월상환액 → 원금 역산
  const r = rate / 100 / 12;
  const n = years * 12;
  const factor = (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
  const dsrLimit = maxMonthly / factor;
  const ltvLimit = housePrice ? housePrice * ltv : Infinity;
  return Math.round(Math.min(dsrLimit, ltvLimit));
}

function simulateLoan(principal, interestRate = 3.5, months = 360) {
  const payment = monthlyPayment(principal, interestRate, months / 12);
  const totalPayment = payment * months;
  return {
    principal,
    monthlyPayment: Math.round(payment),
    totalPayment: Math.round(totalPayment),
    totalInterest: Math.round(totalPayment - principal),
  };
}

// ───────────────────────── 점수 계산 ─────────────────────────

function calculateScores(userData, regionData) {
  const { salary, family, savings, currentHome, timeline, priority } = userData;

  const annualIncome = SALARY_RANGES[salary] || 4000;
  const capital = SAVINGS_RANGES[savings] || 5000;

  // 구매력: 실제 지역 시세 대비 (가용예산 / 중위 매매가)
  let affordability = 50;
  let budgetRatio = null;
  const medianPrice = regionData?.medianPrice || regionData?.avgPrice;
  if (medianPrice) {
    const loan = maxLoanCapacity(annualIncome, medianPrice);
    const maxBudget = capital + loan;
    budgetRatio = maxBudget / medianPrice;
    affordability = Math.min(100, Math.round(budgetRatio * 60)); // ratio 1.0 → 60점, 1.67 → 100점
  } else {
    // 시세 데이터 없으면 절대 금액 기준
    if (capital >= 20000) affordability = 80;
    else if (capital >= 10000) affordability = 60;
    else if (capital >= 5000) affordability = 40;
    else affordability = 20;
  }

  // 준비도
  let readiness = 0;
  if (currentHome === 'none' || currentHome === 'jeonse') readiness += 40; // 무주택 = 청약 유리
  else if (currentHome === 'first-time') readiness += 30;
  else readiness += 15;
  if (family === 'married-2plus') readiness += 30; // 다자녀 특공 가점
  else if (family === 'married-1child') readiness += 25;
  else if (family === 'married-no-child') readiness += 15;
  else readiness += 10;
  if (timeline === 'urgent') readiness += 30;
  else if (timeline === '1year') readiness += 25;
  else if (timeline === '2year') readiness += 15;
  else readiness += 10;

  // 기회도: 시장 추세 반영
  let opportunity = 40;
  if (regionData?.trend === 'down') opportunity += 30; // 하락장 = 매수자 우위
  else if (regionData?.trend === 'stable') opportunity += 20;
  else if (regionData?.trend === 'up') opportunity += 10; // 상승장 = 추격매수 위험
  if (priority === 'own-home') opportunity += 20;
  else if (priority === 'upgrade') opportunity += 15;
  else opportunity += 10;

  return {
    affordability: Math.min(affordability, 100),
    readiness: Math.min(readiness, 100),
    opportunity: Math.min(opportunity, 100),
    overall: Math.round((Math.min(affordability, 100) + Math.min(readiness, 100) + Math.min(opportunity, 100)) / 3),
    budgetRatio,
    annualIncome,
    capital,
  };
}

// ───────────────────────── 전략 결정 ─────────────────────────

function determineStrategy({ scores, priority, currentHome, regionData }) {
  const isHomeless = currentHome === 'none' || currentHome === 'jeonse';
  const canAffordNow = scores.budgetRatio !== null && scores.budgetRatio >= 1.0;
  const nearlyAfford = scores.budgetRatio !== null && scores.budgetRatio >= 0.7;

  if (priority === 'own-home' && isHomeless) {
    if (canAffordNow) {
      return {
        title: '즉시 매매 가능 전략',
        type: 'buy-now',
        description: `현재 예산으로 ${regionData.name} 중위가격대 매매가 가능합니다. 청약 가점이 낮다면 기축 매매가, 가점이 높다면 청약 병행이 유리합니다.`,
      };
    }
    if (nearlyAfford) {
      return {
        title: '청약 + 전세 조합 전략',
        type: 'apartment-lease-combo',
        description: `${regionData.name} 시세 대비 예산이 약간 부족합니다. 무주택 기간을 유지하며 청약 가점을 쌓고, 분양가 상한제 단지를 노리는 것이 유리합니다.`,
      };
    }
    return {
      title: '자금 축적 + 청약 대기 전략',
      type: 'save-and-wait',
      description: `현재 예산으로는 ${regionData.name} 진입이 어렵습니다. 청약통장을 유지하면서 자금을 모으거나, 인근 저평가 지역을 검토하세요.`,
    };
  }

  if (priority === 'investment') {
    if (scores.affordability >= 70) {
      return {
        title: '수익형 부동산 투자 전략',
        type: 'multi-property-investment',
        description: '충분한 자본력이 확인됩니다. 다만 다주택 규제(취득세 중과, 종부세)를 반드시 계산에 넣어야 합니다.',
      };
    }
    return {
      title: '소액 투자 검토 전략',
      type: 'small-investment',
      description: '현재 자본으로는 오피스텔·연립다세대 등 소액 물건부터 검토하는 것이 현실적입니다.',
    };
  }

  if (priority === 'upgrade' && (currentHome === 'owned' || currentHome === 'first-time')) {
    return {
      title: '갈아타기 전략',
      type: 'upgrade-strategy',
      description: '일시적 2주택 비과세 특례(신규 취득 후 3년 내 기존 주택 처분)를 활용한 갈아타기가 핵심입니다.',
    };
  }

  return {
    title: '단계적 준비 전략',
    type: 'conservative-strategy',
    description: '현재 상황에서는 무리한 진입보다 준비를 다지는 것이 유리합니다.',
  };
}

// ───────────────────────── 상세 분석 ─────────────────────────

function generateDetails(strategy, scores, userData, regionData) {
  const { currentHome } = userData;
  const isHomeless = currentHome === 'none' || currentHome === 'jeonse';

  const qualification = [];
  const actions = [];
  const warnings = [];
  const risks = [];

  // 자격
  if (isHomeless) {
    qualification.push('✓ 무주택자 — 청약 1순위 자격 및 생애최초 특별공급 검토 가능');
    qualification.push('✓ 생애최초 구입 시 LTV 최대 80%, 취득세 감면 혜택');
  } else if (currentHome === 'first-time') {
    qualification.push('✓ 1주택자 — 갈아타기 시 일시적 2주택 비과세 활용 가능');
  } else {
    qualification.push('⚠ 다주택 — 취득세 중과(8~12%) 및 종부세 대상 여부 확인 필요');
  }

  // 예산 분석
  if (scores.budgetRatio !== null) {
    const pct = Math.round(scores.budgetRatio * 100);
    if (pct >= 100) qualification.push(`✓ 가용예산이 지역 중위가의 ${pct}% — 즉시 매수 가능권`);
    else if (pct >= 70) qualification.push(`⚠ 가용예산이 지역 중위가의 ${pct}% — 소형 평수 또는 인근 지역 검토`);
    else qualification.push(`⚠ 가용예산이 지역 중위가의 ${pct}% — 현 시점 진입 어려움`);
  }

  // 전략별 액션
  const actionMap = {
    'buy-now': [
      '주택담보대출 사전 한도 조회 (DSR 40% 기준)',
      '실거래가 기준 급매물 위주 검색',
      '생애최초라면 디딤돌·보금자리론 금리 비교',
      '취득세·중개수수료 등 부대비용 약 2~3% 별도 준비',
    ],
    'apartment-lease-combo': [
      '청약통장 월 10만원 이상 납입 유지 (공공분양 대비)',
      '청약홈에서 관심 지역 분양 일정 알림 설정',
      '분양가 상한제 적용 단지 우선 검토',
      '전세 계약 시 보증보험(HUG/SGI) 가입 필수',
    ],
    'save-and-wait': [
      '월 저축액 목표 설정 및 파킹통장/적금 활용',
      '청약통장 납입 횟수·금액 꾸준히 쌓기',
      '목표 지역 실거래가 월 1회 모니터링',
      '인근 저평가 지역(교통 호재 예정지) 리스트업',
    ],
    'multi-property-investment': [
      '취득세 중과율 시뮬레이션 (2주택 8%, 3주택 12%)',
      '전세가율 높은 지역 위주 물건 검토',
      '보유세(재산세+종부세) 연간 부담액 계산',
      '임대사업자 등록 여부 세무사 상담',
    ],
    'small-investment': [
      '오피스텔 수익률 계산 (월세 수입 대비 실투자금)',
      '연립다세대는 환금성 낮음 — 입지 최우선 검토',
      '대출 레버리지 과다 사용 금지',
    ],
    'upgrade-strategy': [
      '기존 주택 시세 확인 및 양도세 비과세 요건 점검 (2년 보유/거주)',
      '신규 취득 후 3년 내 기존 주택 처분 계획 수립',
      '매도·매수 타이밍 갭 최소화 (이사 일정 조율)',
      '중도금 브릿지 대출 가능 여부 확인',
    ],
    'conservative-strategy': [
      '청약통장 개설 및 유지',
      '부동산 세금·대출 기초 학습',
      '6개월마다 재분석으로 진입 시점 재평가',
    ],
  };
  actions.push(...(actionMap[strategy.type] || actionMap['conservative-strategy']));

  // 시장 상황 기반 경고
  if (regionData?.trend === 'up' && regionData.changeRate > 3) {
    warnings.push(`• ${regionData.name} 최근 6개월 평당가 ${regionData.changeRate}% 상승 — 추격매수 주의`);
    risks.push('고점 매수 위험');
  } else if (regionData?.trend === 'down') {
    warnings.push(`• ${regionData.name} 최근 6개월 평당가 ${Math.abs(regionData.changeRate)}% 하락 — 협상 여지 있으나 추가 하락 가능성도 고려`);
    risks.push('추가 하락 위험');
  }

  if (regionData?.jeonseRatio) {
    if (regionData.jeonseRatio >= 80) {
      warnings.push(`• 전세가율 ${regionData.jeonseRatio}% — 전세 계약 시 깡통전세 위험, 보증보험 필수`);
      risks.push('깡통전세 위험');
    } else if (regionData.jeonseRatio <= 50) {
      warnings.push(`• 전세가율 ${regionData.jeonseRatio}% — 매매가에 미래 기대가 선반영된 상태일 수 있음`);
    }
  }

  warnings.push('• 금리 변동 시 상환 부담이 달라집니다 — 고정/변동 금리 비교 필수');
  warnings.push('• 본 분석은 공공데이터 기반 참고자료이며, 실제 거래 전 전문가 상담을 권장합니다');

  return { qualification, actions, warnings, risks };
}

// ───────────────────────── 메인 분석 ─────────────────────────

async function analyzeStrategy(userData) {
  const { region } = userData;

  // 실제 국토교통부 실거래 데이터 조회
  const regionData = await realEstateService.getRegionData(region);

  const scores = calculateScores(userData, regionData);
  const strategy = determineStrategy({ scores, priority: userData.priority, currentHome: userData.currentHome, regionData });
  strategy.score = scores.overall;

  const details = generateDetails(strategy, scores, userData, regionData);

  // 대출 시뮬레이션 (지역 중위가 기준)
  let loanSimulation = null;
  const medianPrice = regionData?.medianPrice || regionData?.avgPrice;
  if (medianPrice) {
    const loan = maxLoanCapacity(scores.annualIncome, medianPrice);
    const needed = Math.max(0, medianPrice - scores.capital);
    const actualLoan = Math.min(loan, needed);
    loanSimulation = {
      housePrice: medianPrice,
      ownCapital: scores.capital,
      maxLoanByDSR: loan,
      recommendedLoan: actualLoan,
      ...simulateLoan(actualLoan || loan),
      shortfall: Math.max(0, medianPrice - scores.capital - loan),
    };
  }

  return {
    strategy,
    details,
    scores: {
      affordability: scores.affordability,
      readiness: scores.readiness,
      opportunity: scores.opportunity,
      overall: scores.overall,
      budgetRatio: scores.budgetRatio,
    },
    loanSimulation,
    regionData,
    confidence: regionData?.tradeCount >= 30 ? 85 : regionData?.tradeCount >= 10 ? 70 : 50,
  };
}

module.exports = {
  analyzeStrategy,
  calculateScores,
  simulateLoan,
  maxLoanCapacity,
};
