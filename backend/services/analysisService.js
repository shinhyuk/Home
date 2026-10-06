const realEstateService = require('./realEstateService');
const scenarioService = require('./scenarioService');

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

// 입력 정규화: 직접 입력(만원) 우선, 없으면 범위 선택값 사용
function normalizeInput(userData) {
  const annualIncome = Number(userData.salaryAmount) > 0
    ? Number(userData.salaryAmount)
    : (SALARY_RANGES[userData.salary] || 4000);
  const capital = Number(userData.savingsAmount) >= 0 && userData.savingsAmount !== undefined && userData.savingsAmount !== ''
    ? Number(userData.savingsAmount)
    : (SAVINGS_RANGES[userData.savings] || 5000);

  // 부양가족 수: 배우자 + 자녀 (청약 가점용)
  let dependents = 0;
  const children = Number(userData.childrenCount);
  if (userData.family && userData.family.startsWith('married')) {
    dependents += 1; // 배우자
    if (Number.isFinite(children)) dependents += children;
    else if (userData.family === 'married-1child') dependents += 1;
    else if (userData.family === 'married-2plus') dependents += 2;
  } else if (Number.isFinite(children)) {
    dependents += children;
  }

  return {
    annualIncome,
    capital,
    dependents,
    homelessYears: Number(userData.homelessYears) >= 0 ? Number(userData.homelessYears) : null,
    subscriptionYears: Number(userData.subscriptionYears) >= 0 ? Number(userData.subscriptionYears) : null,
    jeonseDeposit: Number(userData.jeonseDeposit) > 0 ? Number(userData.jeonseDeposit) : 0,
  };
}

// ───────────────────────── 2026.10 기준 대출 규제 ─────────────────────────
// 출처: 금융위 6.27 대책 + 10.15 주택시장 안정화 대책
const REGULATION = {
  asOf: '2026년 10월',
  mortgageRate: 4.0,   // 주담대 대표금리 (시중은행 3.3~5.9% 중간값대)
  jeonseRate: 3.9,     // 전세대출 대표금리
  stressAdd: 1.5,      // 스트레스 DSR 가산금리 (%p)
  dsr: 0.4,
  maxTermYears: 30,    // 10.15 대책: 주담대 만기 30년 상한
  // 10.15 대책: 주택가격 구간별 주담대 상한 (만원)
  mortgageCapByPrice: [
    { maxPrice: 150000, cap: 60000 },  // 15억 이하 → 6억
    { maxPrice: 250000, cap: 40000 },  // 15~25억 → 4억
    { maxPrice: Infinity, cap: 20000 },// 25억 초과 → 2억
  ],
  ltv: { firstHome: 0.7, oneHome: 0.6 }, // 다주택 추가구입은 주담대 금지(0)
  jeonse: { guaranteeRatio: 0.8, capMetro: 60000 }, // 보증 80%, 수도권 한도 6억
};

function mortgagePriceCap(housePrice) {
  if (!housePrice) return Infinity;
  for (const tier of REGULATION.mortgageCapByPrice) {
    if (housePrice <= tier.maxPrice) return tier.cap;
  }
  return 20000;
}

// ───────────────────────── 대출 계산 ─────────────────────────

// 원리금균등 월상환액
function monthlyPayment(principal, annualRate = REGULATION.mortgageRate, years = 30) {
  const r = annualRate / 100 / 12;
  const n = years * 12;
  if (r === 0) return principal / n;
  return principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}

// 최대 주담대 한도 (만원) — DSR(스트레스 금리) + LTV + 가격구간별 상한 + 다주택 금지
function maxLoanCapacity(annualIncome, housePrice, opts = {}) {
  const {
    currentHome = 'none',
    rate = REGULATION.mortgageRate,
    years = REGULATION.maxTermYears,
    dsr = REGULATION.dsr,
  } = opts;

  // 다주택자 추가 구입: 주담대 금지 (10.15 대책)
  if (currentHome === 'multi') return 0;

  // DSR: 스트레스 금리(실금리 + 가산)로 산정
  const stressRate = rate + REGULATION.stressAdd;
  const maxMonthly = (annualIncome / 12) * dsr;
  const r = stressRate / 100 / 12;
  const n = years * 12;
  const factor = (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
  const dsrLimit = maxMonthly / factor;

  // LTV
  const isFirst = currentHome === 'none' || currentHome === 'jeonse' || currentHome === 'first-time';
  const ltv = isFirst ? REGULATION.ltv.firstHome : REGULATION.ltv.oneHome;
  const ltvLimit = housePrice ? housePrice * ltv : Infinity;

  // 가격구간별 절대 상한
  const priceCap = mortgagePriceCap(housePrice);

  return Math.round(Math.min(dsrLimit, ltvLimit, priceCap));
}

function simulateLoan(principal, interestRate = REGULATION.mortgageRate, months = 360) {
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
  const { family, currentHome, timeline, priority } = userData;

  const { annualIncome, capital } = normalizeInput(userData);

  // 구매력: 실제 지역 시세 대비 (가용예산 / 중위 매매가)
  let affordability = 50;
  let budgetRatio = null;
  const medianPrice = regionData?.medianPrice || regionData?.avgPrice;
  if (medianPrice) {
    const loan = maxLoanCapacity(annualIncome, medianPrice, { currentHome });
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
    qualification.push('⚠ 다주택 — 추가 구입 시 주담대 금지(10.15 대책), 취득세 중과(8~12%)·종부세 확인 필요');
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

  warnings.push(`• ${REGULATION.asOf} 규제 반영: 주담대 상한(15억↓ 6억·15~25억 4억·25억↑ 2억), 스트레스 DSR(+${REGULATION.stressAdd}%p), 다주택 추가 주담대 금지, 전세대출 보증 80%·수도권 6억 한도`);
  warnings.push('• 금리 변동 시 상환 부담이 달라집니다 — 고정/변동 금리 비교 필수 (주담대 ' + REGULATION.mortgageRate + '%, 전세 ' + REGULATION.jeonseRate + '% 가정)');
  warnings.push('• 본 분석은 공공데이터 기반 참고자료이며, 실제 거래 전 전문가 상담을 권장합니다');

  return { qualification, actions, warnings, risks };
}

// ───────────────────────── 청약 가점 (민영 일반공급 84점 만점) ─────────────────────────

function subscriptionScore({ homelessYears, dependents, subscriptionYears }) {
  // 무주택 기간: 1년 미만 2점, 1년당 +2점, 15년 이상 32점
  let homeless = null;
  if (homelessYears !== null) {
    homeless = homelessYears < 1 ? 2 : Math.min(32, 2 + Math.floor(homelessYears) * 2);
  }
  // 부양가족: 0명 5점, 1명당 +5점, 6명 이상 35점
  const family = Math.min(35, 5 + (dependents || 0) * 5);
  // 청약통장 가입기간: 6개월 미만 1점, 1년 미만 2점, 1년당 +1점, 15년 이상 17점
  let account = null;
  if (subscriptionYears !== null) {
    if (subscriptionYears < 0.5) account = 1;
    else if (subscriptionYears < 1) account = 2;
    else account = Math.min(17, 2 + Math.floor(subscriptionYears));
  }

  const known = (homeless ?? 0) + family + (account ?? 0);
  const complete = homeless !== null && account !== null;
  return {
    homelessPoints: homeless,
    familyPoints: family,
    accountPoints: account,
    total: complete ? known : null,
    partialTotal: known,
    maxTotal: 84,
    complete,
  };
}

// ───────────────────────── 트랙별 전략 (청약/전세/매매) ─────────────────────────

function buildTracks(userData, norm, regionData, scores) {
  const isHomeless = ['none', 'jeonse'].includes(userData.currentHome);
  const medianPrice = regionData?.medianPrice || regionData?.avgPrice || null;
  const jeonseAvg = regionData?.jeonseAvgDeposit || null;

  // ── 매매 트랙 ──
  let buy = { name: '매매', feasible: null };
  if (medianPrice) {
    const maxLoan = maxLoanCapacity(norm.annualIncome, medianPrice, { currentHome: userData.currentHome });
    const budget = norm.capital + norm.jeonseDeposit + maxLoan; // 전세금 회수 가정
    const ratio = budget / medianPrice;
    const loan = Math.min(maxLoan, Math.max(0, medianPrice - norm.capital - norm.jeonseDeposit));
    const sim = simulateLoan(loan);
    buy = {
      name: '매매',
      feasible: ratio >= 1 ? 'possible' : ratio >= 0.7 ? 'tight' : 'hard',
      budget: Math.round(budget),
      medianPrice,
      budgetRatio: Math.round(ratio * 100),
      maxLoan,
      monthlyPayment: sim.monthlyPayment,
      shortfall: Math.max(0, medianPrice - budget),
      note: ratio >= 1
        ? '현재 예산으로 중위가격대 매수 가능. 급매·경매 활용 시 여유 확보.'
        : ratio >= 0.7
          ? '소형 평수·구축 또는 인근 지역으로 눈높이 조정 시 가능.'
          : '현 시세 기준 진입 어려움. 자금 축적 또는 지역 변경 필요.',
    };
  }

  // ── 전세 트랙 ──
  let jeonse = { name: '전세', feasible: null };
  if (jeonseAvg) {
    // 전세대출: 보증비율 80%, 수도권 한도 6억 (2026.10 규제)
    const jeonseLoan = Math.min(Math.round(jeonseAvg * REGULATION.jeonse.guaranteeRatio), REGULATION.jeonse.capMetro);
    const jeonseBudget = norm.capital + norm.jeonseDeposit + jeonseLoan;
    const ratio = jeonseBudget / jeonseAvg;
    // 전세대출 이자 (연 3.8% 가정, 이자만 납부)
    const actualLoan = Math.min(jeonseLoan, Math.max(0, jeonseAvg - norm.capital - norm.jeonseDeposit));
    const monthlyInterest = Math.round((actualLoan * (REGULATION.jeonseRate / 100)) / 12);
    jeonse = {
      name: '전세',
      feasible: ratio >= 1 ? 'possible' : ratio >= 0.8 ? 'tight' : 'hard',
      avgDeposit: jeonseAvg,
      budget: Math.round(jeonseBudget),
      budgetRatio: Math.round(ratio * 100),
      loanNeeded: actualLoan,
      monthlyInterest,
      jeonseRatio: regionData.jeonseRatio,
      note: ratio >= 1
        ? `평균 전세가 ${Math.round(jeonseAvg / 10000)}억 진입 가능. 월 이자 약 ${monthlyInterest}만원.`
        : '평균 전세가 대비 자금 부족. 보증금 낮은 매물 또는 월세 혼합 검토.',
      warning: regionData.jeonseRatio >= 80 ? '전세가율 80% 이상 — 깡통전세 위험, 보증보험 필수' : null,
    };
  }

  // ── 청약 트랙 ──
  const score = subscriptionScore(norm);
  const competitive = score.total !== null ? score.total >= 50 : null; // 수도권 인기지역 당첨선 대략 50~70점
  const subscription = {
    name: '청약',
    feasible: !isHomeless ? 'ineligible' : (competitive === null ? 'unknown' : competitive ? 'possible' : 'tight'),
    eligible: isHomeless,
    score,
    specialSupply: [],
    note: '',
  };
  if (isHomeless) {
    // 특별공급 자격 추정
    if (norm.dependents >= 3) subscription.specialSupply.push('다자녀 특별공급');
    if (userData.family === 'married-no-child' || userData.family === 'married-1child') subscription.specialSupply.push('신혼부부 특별공급 (혼인 7년 이내 시)');
    subscription.specialSupply.push('생애최초 특별공급 (최초 구입 시)');
    if (score.total !== null) {
      subscription.note = score.total >= 60
        ? `가점 ${score.total}점 — 인기 단지도 노려볼 만한 수준. 일반공급 적극 지원.`
        : score.total >= 45
          ? `가점 ${score.total}점 — 중위권. 특별공급 병행 + 비인기 타입 공략.`
          : `가점 ${score.total}점 — 가점제 불리. 추첨제 물량·특별공급 집중.`;
    } else {
      subscription.note = '무주택 기간·청약통장 납입기간을 입력하면 정확한 가점을 계산합니다.';
    }
  } else {
    subscription.note = '유주택자는 1순위 청약 제한. 처분 조건부 또는 추첨제만 가능.';
  }

  return { buy, jeonse, subscription };
}

// ───────────────────────── 추천: 단지 + 지역 ─────────────────────────

async function buildRecommendations(userData, norm, regionData, buyTrack) {
  const budget = buyTrack?.budget || (norm.capital + norm.jeonseDeposit);
  const result = { budget, complexes: null, regions: null };

  // 1) 목표 지역 내 단지 추천 — 사용자가 고른 주택 유형만
  const typeMap = {
    'apt': ['apt-trade'],
    'apt-offi': ['apt-trade', 'offi-trade'],
    'all': ['apt-trade', 'offi-trade', 'rh-trade'],
  };
  const types = typeMap[userData.housingTypes] || typeMap['apt']; // 기본: 아파트만
  try {
    const stats = await realEstateService.getComplexStats(userData.region, types, userData.areaBand || 'mid84');
    if (stats && stats.complexes.length) {
      const within = stats.complexes
        .filter((c) => c.medianPrice && c.medianPrice <= budget)
        .slice(0, 20);
      const stretch = stats.complexes
        .filter((c) => c.medianPrice > budget && c.medianPrice <= budget * 1.3)
        .map((c) => ({ ...c, shortfall: c.medianPrice - budget }))
        .sort((a, b) => a.shortfall - b.shortfall)
        .slice(0, 10);
      result.complexes = { regionName: stats.region, within, stretch, basis: '최근 6개월 실거래, 3건 이상 단지' };
    }
  } catch (e) {
    console.warn('단지 추천 실패:', e.message);
  }

  // 2) 전국 지역 추천 (예산으로 진입 가능한 지역)
  try {
    const summary = await realEstateService.getAllRegionSummaries();
    if (summary) {
      const scored = summary.regions
        .filter((r) => r.medianPrice && r.tradeCount >= 10)
        .map((r) => {
          // 지역별 예산: 자금 + min(DSR한도, 해당 지역 중위가의 LTV 70%)
          const loan = maxLoanCapacity(norm.annualIncome, r.medianPrice, { currentHome: userData.currentHome });
          const regionBudget = norm.capital + norm.jeonseDeposit + loan;
          return { ...r, fit: Math.round((regionBudget / r.medianPrice) * 100) };
        })
        .filter((r) => r.fit >= 90)
        .sort((a, b) => (b.changeRate ?? -99) - (a.changeRate ?? -99));

      result.regions = {
        affordable: scored.slice(0, 30),
        totalScanned: summary.regions.length,
        generatedAt: summary.generatedAt,
      };
    }
  } catch (e) {
    console.warn('지역 추천 실패:', e.message);
  }

  return result;
}

// ───────────────────────── 메인 분석 ─────────────────────────

async function analyzeStrategy(userData) {
  const { region } = userData;

  // 실제 국토교통부 실거래 데이터 조회
  const regionData = await realEstateService.getRegionData(region);
  const norm = normalizeInput(userData);

  // 희망 평형대 기준으로 중위가·전세가 재계산 (표본 8건 이상일 때)
  const bandKey = userData.areaBand || 'mid84';
  let effRegion = regionData;
  let areaBasis = null;
  if (!regionData.error) {
    try {
      const banded = await realEstateService.getBandedStats(region, bandKey);
      if (banded) {
        if (bandKey !== 'any' && banded.count >= 8) {
          effRegion = {
            ...regionData,
            medianPrice: banded.medianPrice,
            avgPerPyeong: banded.avgPerPyeong || regionData.avgPerPyeong,
            jeonseAvgDeposit: banded.jeonseAvgDeposit || regionData.jeonseAvgDeposit,
          };
          areaBasis = { label: banded.label, count: banded.count, applied: true };
        } else {
          areaBasis = { label: banded.label, count: banded.count, applied: false,
            note: bandKey === 'any' ? null : '해당 평형 표본 부족 — 전체 평형 기준 계산' };
        }
      }
    } catch (e) { console.warn('평형 통계 실패:', e.message); }
  }

  const scores = calculateScores(userData, effRegion);
  const tracks = buildTracks(userData, norm, effRegion, scores);
  const recommendations = await buildRecommendations(userData, norm, effRegion, tracks.buy);

  // 종합 전략 시나리오 (거주·투자·청약 조합)
  let scenarios = [];
  try {
    scenarios = await scenarioService.buildScenarios(userData, norm, effRegion, tracks, maxLoanCapacity);
  } catch (e) { console.warn('시나리오 생성 실패:', e.message); }
  const strategy = determineStrategy({ scores, priority: userData.priority, currentHome: userData.currentHome, regionData: effRegion });
  strategy.score = scores.overall;

  const details = generateDetails(strategy, scores, userData, effRegion);

  // 대출 시뮬레이션 (지역 중위가 기준)
  let loanSimulation = null;
  const medianPrice = effRegion?.medianPrice || effRegion?.avgPrice;
  if (medianPrice) {
    const loan = maxLoanCapacity(scores.annualIncome, medianPrice, { currentHome: userData.currentHome });
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
    scenarios,
    areaBasis,
    tracks,
    recommendations,
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
  REGULATION,
  analyzeStrategy,
  calculateScores,
  simulateLoan,
  maxLoanCapacity,
  monthlyPayment,
  normalizeInput,
};
