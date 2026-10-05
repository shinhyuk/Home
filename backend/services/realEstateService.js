const axios = require('axios');

// 실거래가 공공데이터 (샘플 데이터 - 실제로는 API에서 가져옴)
const REGION_DATA = {
  '서울 강남구': {
    avgPrice: 8500, // 만원
    pricePerSquare: 1200, // 만원/제곱미터
    trend: 'stable',
    prediction: 2, // 연 2% 상승 예상
  },
  '서울 서초구': {
    avgPrice: 8200,
    pricePerSquare: 1150,
    trend: 'stable',
    prediction: 1.5,
  },
  '경기 성남시': {
    avgPrice: 5500,
    pricePerSquare: 750,
    trend: 'up',
    prediction: 3.5,
  },
  '경기 판교': {
    avgPrice: 6800,
    pricePerSquare: 900,
    trend: 'up',
    prediction: 4,
  },
  '부산 해운대': {
    avgPrice: 4200,
    pricePerSquare: 580,
    trend: 'up',
    prediction: 3,
  },
};

// 국토교통부 실거래가 API 조회 (실제 구현)
async function fetchFromMolitAPI(region, type = 'apt') {
  try {
    const apiKey = process.env.MOLIT_API_KEY;
    if (!apiKey) {
      console.warn('MOLIT_API_KEY not configured, using mock data');
      return getRegionData(region);
    }

    // 실제 API 호출 예시 (구현 필요)
    // const response = await axios.get(`${process.env.MOLIT_API_URL}/...`);
    // return parseResponse(response.data);

    return getRegionData(region);
  } catch (error) {
    console.error('부동산 API 조회 실패:', error.message);
    return getRegionData(region);
  }
}

// 지역 데이터 조회
function getRegionData(region) {
  if (REGION_DATA[region]) {
    return {
      name: region,
      ...REGION_DATA[region],
    };
  }

  // 기본값 반환
  return {
    name: region,
    avgPrice: 5000,
    pricePerSquare: 700,
    trend: 'stable',
    prediction: 2,
  };
}

// 청약 정보 조회 (예시)
async function fetchApartmentInfo(region) {
  try {
    // 실제로는 청약홈 API나 공공데이터포털에서 가져옴
    return {
      region,
      upcomingProjects: [
        {
          name: '신규 분양',
          enterDate: '2025-06-30',
          area: '84㎡',
          price: 5500, // 만원
        },
      ],
      recentCompetition: 2.5, // 평균 경쟁률
    };
  } catch (error) {
    console.error('청약 정보 조회 실패:', error.message);
    return null;
  }
}

// 매매가 추세 조회
async function getPriceTrend(region, months = 12) {
  try {
    // 실제로는 데이터베이스나 API에서 조회
    const data = getRegionData(region);

    // 추세 시뮬레이션
    const trend = [];
    const monthlyRate = (data.prediction / 100) / 12;
    let currentPrice = data.avgPrice;

    for (let i = 0; i < months; i++) {
      trend.push({
        month: i + 1,
        price: Math.round(currentPrice),
      });
      currentPrice *= (1 + monthlyRate);
    }

    return trend;
  } catch (error) {
    console.error('가격 추세 조회 실패:', error.message);
    return [];
  }
}

module.exports = {
  fetchFromMolitAPI,
  getRegionData,
  fetchApartmentInfo,
  getPriceTrend,
};
