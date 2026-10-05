const realEstateService = require('./realEstateService');

// 연봉 범위별 월소득 (만원)
const SALARY_RANGES = {
  '0-2000': 120,
  '2000-3500': 250,
  '3500-5000': 380,
  '5000-7000': 580,
  '7000-10000': 800,
  '10000': 1000,
};

// 자금 범위 (만원)
const SAVINGS_RANGES = {
  '0-5000': 2500,
  '5000-10000': 7500,
  '10000-20000': 15000,
  '20000-50000': 35000,
  '50000': 50000,
};

// 핵심 분석 함수
async function analyzeStrategy(userData) {
  const {
    salary,
    family,
    savings,
    currentHome,
    experiences,
    priority,
    timeline,
    region,
  } = userData;

  // 1. 점수 계산
  const scores = calculateScores(userData);

  // 2. 지역 데이터 조회
  const regionData = await realEstateService.getRegionData(region);

  // 3. 전략 결정
  let strategy = determineStrategy({
    scores,
    priority,
    currentHome,
    regionData,
  });

  // 4. 상세 분석
  const details = generateDetails(strategy, scores, userData, regionData);

  return {
    strategy,
    details,
    scores,
    regionData,
    confidence: calculateConfidence(scores),
  };
}

// 점수 계산
function calculateScores(userData) {
  const { salary, family, savings, currentHome, priority, timeline } = userData;

  let affordability = 0; // 구매력
  let readiness = 0; // 준비도
  let opportunity = 0; // 기회도

  // 구매력 평가 (0-100)
  const monthlyIncome = SALARY_RANGES[salary] || 400;
  const capital = SAVINGS_RANGES[savings] || 5000;

  if (capital >= 20000) affordability += 80;
  else if (capital >= 10000) affordability += 60;
  else if (capital >= 5000) affordability += 40;
  else affordability += 20;

  if (monthlyIncome >= 800) affordability += 20;
  else if (monthlyIncome >= 500) affordability += 15;
  else affordability += 10;

  // 준비도 평가 (0-100)
  if (currentHome === 'first-time' || currentHome === 'owned') readiness += 40;
  else if (currentHome === 'jeonse') readiness += 20;
  else readiness += 10;

  if (family === 'married-1child' || family === 'married-2plus') readiness += 30;
  else if (family === 'married-no-child') readiness += 20;
  else readiness += 10;

  if (timeline === 'urgent') readiness += 30;
  else if (timeline === '1year') readiness += 20;
  else if (timeline === '2year') readiness += 10;

  // 기회도 평가 (0-100)
  if (priority === 'own-home') opportunity += 50;
  else if (priority === 'upgrade') opportunity += 40;
  else if (priority === 'investment') opportunity += 30;
  else opportunity += 20;

  if (timeline === 'urgent' || timeline === '1year') opportunity += 30;
  else opportunity += 15;

  return {
    affordability: Math.min(affordability, 100),
    readiness: Math.min(readiness, 100),
    opportunity: Math.min(opportunity, 100),
    overall: Math.round((affordability + readiness + opportunity) / 3),
  };
}

// 전략 결정 로직
function determineStrategy({ scores, priority, currentHome, regionData }) {
  const isFirstTime = currentHome === 'first-time' || currentHome === 'none';
  const affordability = scores.affordability;

  // 기준 충족 확인
  if (priority === 'own-home' && isFirstTime && affordability >= 40) {
    return {
      title: '청약 + 전세 조합 전략',
      description: '신규 분양 청약을 집중하면서 당분간 전세로 거주하는 전략입니다. 확정 배정까지 시간이 걸리므로 현실적인 방법입니다.',
      type: 'apartment-lease-combo',
      score: scores.overall,
    };
  } else if (priority === 'investment' && affordability >= 70) {
    return {
      title: '다주택 투자 전략',
      description: '충분한 자본금을 바탕으로 수익성 있는 부동산에 투자하는 전략입니다. 세금과 규제를 고려한 신중한 접근이 필요합니다.',
      type: 'multi-property-investment',
      score: scores.overall,
    };
  } else if (priority === 'upgrade' && currentHome === 'owned') {
    return {
      title: '주택 매매/전세 전환 전략',
      description: '현재의 집을 업그레이드하는 전략입니다. 기존 주택의 처분과 새 집 구입의 타이밍이 중요합니다.',
      type: 'upgrade-strategy',
      score: scores.overall,
    };
  } else {
    return {
      title: '신중한 상황 분석 전략',
      description: '현재 상황을 고려하여 단계적으로 접근하는 전략입니다. 무리하지 않는 것이 중요합니다.',
      type: 'conservative-strategy',
      score: scores.overall,
    };
  }
}

// 상세 분석 생성
function generateDetails(strategy, scores, userData, regionData) {
  const { currentHome } = userData;
  const isFirstTime = currentHome === 'first-time' || currentHome === 'none';

  const qualification = [];
  const actions = [];
  const warnings = [];
  const risks = [];

  // 자격 평가
  if (isFirstTime) {
    qualification.push('✓ 첫 주택 구매 자격 있음');
    qualification.push('✓ 청약 신청 가능');
  } else {
    qualification.push('⚠ 다주택 규제 확인 필요');
  }

  if (scores.affordability >= 70) {
    qualification.push('✓ 신청금 충분');
  } else if (scores.affordability >= 40) {
    qualification.push('⚠ 신청금 확보 필요');
  } else {
    qualification.push('⚠ 초기자본 부족 - 저축 필요');
  }

  // 액션 플랜
  if (strategy.type === 'apartment-lease-combo') {
    actions.push('청약 통장 개설 (미보유 시)');
    actions.push('원하는 지역의 신규 분양 정보 수집');
    actions.push('매달 청약 통장 적립');
    actions.push('당첨 후 전세 자금 준비');

    warnings.push('• 청약 당첨까지 1~3년 소요될 수 있습니다');
    warnings.push('• 전세 계약 시 전세사기 주의하세요');
    warnings.push('• 대출 금리 변동을 모니터링하세요');

    risks.push('당첨 불확실성');
    risks.push('금리 상승 위험');
  } else if (strategy.type === 'multi-property-investment') {
    actions.push('투자 목표 지역 시장 분석');
    actions.push('수익성 있는 물건 발굴');
    actions.push('대출 구조 설계');
    actions.push('세금 계획 (양도세, 보유세 등)');

    warnings.push('• 다주택자 규제가 강해지고 있습니다');
    warnings.push('• 보유세가 상당할 수 있습니다');
    warnings.push('• 금리 인상 시 대출금 부담 증가');

    risks.push('규제 리스크');
    risks.push('보유세 부담');
    risks.push('유동성 리스크');
  }

  return {
    qualification,
    actions,
    warnings,
    risks,
    regionAnalysis: {
      name: regionData.name,
      avgPrice: regionData.avgPrice,
      prediction: regionData.prediction,
      recommendation: getRegionRecommendation(regionData),
    },
  };
}

// 지역별 추천 의견
function getRegionRecommendation(regionData) {
  if (regionData.prediction >= 4) {
    return '높은 성장 기대 지역입니다. 투자 가치가 있을 수 있습니다.';
  } else if (regionData.prediction >= 2) {
    return '안정적인 성장이 예상됩니다. 무난한 선택입니다.';
  } else {
    return '보수적인 접근을 권장합니다. 추가 검토가 필요합니다.';
  }
}

// 신뢰도 계산
function calculateConfidence(scores) {
  // 점수들이 일관성 있으면 신뢰도 높음
  const diff = Math.max(...Object.values(scores)) - Math.min(...Object.values(scores));
  return Math.max(0, 100 - (diff * 2));
}

// 대출 시뮬레이션
function simulateLoan(principal, interestRate = 3.5, months = 360) {
  // principal: 대출액 (만원)
  // interestRate: 연이율 (%)
  // months: 상환 개월 수

  const monthlyRate = interestRate / 100 / 12;
  const monthlyPayment = principal *
    (monthlyRate * Math.pow(1 + monthlyRate, months)) /
    (Math.pow(1 + monthlyRate, months) - 1);

  const totalPayment = monthlyPayment * months;
  const totalInterest = totalPayment - principal;

  return {
    principal,
    monthlyPayment: Math.round(monthlyPayment),
    totalPayment: Math.round(totalPayment),
    totalInterest: Math.round(totalInterest),
  };
}

module.exports = {
  analyzeStrategy,
  calculateScores,
  simulateLoan,
};
