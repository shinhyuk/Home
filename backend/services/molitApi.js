const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');

// 국토교통부 실거래가 API 6종
const ENDPOINTS = {
  'apt-trade': {
    url: 'https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev',
    label: '아파트 매매',
    kind: 'trade',
  },
  'apt-rent': {
    url: 'https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent',
    label: '아파트 전월세',
    kind: 'rent',
  },
  'offi-trade': {
    url: 'https://apis.data.go.kr/1613000/RTMSDataSvcOffiTrade/getRTMSDataSvcOffiTrade',
    label: '오피스텔 매매',
    kind: 'trade',
  },
  'offi-rent': {
    url: 'https://apis.data.go.kr/1613000/RTMSDataSvcOffiRent/getRTMSDataSvcOffiRent',
    label: '오피스텔 전월세',
    kind: 'rent',
  },
  'rh-trade': {
    url: 'https://apis.data.go.kr/1613000/RTMSDataSvcRHTrade/getRTMSDataSvcRHTrade',
    label: '연립다세대 매매',
    kind: 'trade',
  },
  'rh-rent': {
    url: 'https://apis.data.go.kr/1613000/RTMSDataSvcRHRent/getRTMSDataSvcRHRent',
    label: '연립다세대 전월세',
    kind: 'rent',
  },
};

// parseTagValue: false — "000", "0464" 같은 값이 숫자로 변환되는 것 방지
const xmlParser = new XMLParser({ ignoreAttributes: true, trimValues: true, parseTagValue: false });

// 일일 트래픽(10,000/일) 사용량 추적
let dailyCallCount = 0;
let callCountDate = new Date().toDateString();

function trackCall() {
  const today = new Date().toDateString();
  if (today !== callCountDate) {
    dailyCallCount = 0;
    callCountDate = today;
  }
  dailyCallCount++;
}

function getDailyUsage() {
  return { date: callCountDate, calls: dailyCallCount, limit: 10000 };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 숫자 정제: "284,000" → 284000
function toNumber(value) {
  if (value === undefined || value === null) return null;
  const n = parseFloat(String(value).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

// 해외망→공공서버 연결이 간헐적으로 끊기므로 재시도 필수
async function requestWithRetry(url, params, maxRetries = 4) {
  let lastError;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      trackCall();
      const response = await axios.get(url, {
        params,
        timeout: 20000,
        responseType: 'text',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          'Accept': 'application/xml,text/xml,*/*',
          'Accept-Language': 'ko-KR,ko;q=0.9',
        },
      });
      return response.data;
    } catch (error) {
      lastError = error;
      const delay = 1000 * Math.pow(2, attempt); // 1s, 2s, 4s, 8s
      console.warn(`MOLIT API 재시도 ${attempt + 1}/${maxRetries} (${delay}ms 대기): ${error.message}`);
      await sleep(delay);
    }
  }
  throw lastError;
}

// 단일 페이지 조회
async function fetchPage(endpointKey, lawdCd, dealYmd, pageNo = 1, numOfRows = 1000) {
  const endpoint = ENDPOINTS[endpointKey];
  if (!endpoint) throw new Error(`알 수 없는 endpoint: ${endpointKey}`);

  const serviceKey = process.env.MOLIT_API_KEY;
  if (!serviceKey) throw new Error('MOLIT_API_KEY가 설정되지 않았습니다 (.env 확인)');

  const xml = await requestWithRetry(endpoint.url, {
    serviceKey,
    LAWD_CD: lawdCd,
    DEAL_YMD: dealYmd,
    pageNo,
    numOfRows,
  });

  const parsed = xmlParser.parse(xml);
  const response = parsed?.response;
  const header = response?.header;

  if (!header) {
    // OpenAPI 공통 에러 (인증키 오류 등)는 다른 루트 태그로 옴
    const errMsg = parsed?.OpenAPI_ServiceResponse?.cmmMsgHeader?.returnAuthMsg
      || parsed?.OpenAPI_ServiceResponse?.cmmMsgHeader?.errMsg
      || 'API 응답 형식 오류';
    throw new Error(`MOLIT API 오류: ${errMsg}`);
  }

  // 성공 코드: "000" (일부 응답은 "00")
  const code = String(header.resultCode).replace(/^0+$/, '0');
  if (code !== '0' && String(header.resultCode) !== '000' && String(header.resultCode) !== '00') {
    throw new Error(`MOLIT API 오류 [${header.resultCode}]: ${header.resultMsg}`);
  }

  const body = response.body || {};
  let items = body.items?.item || [];
  if (!Array.isArray(items)) items = [items]; // 1건이면 객체로 옴

  return {
    items,
    totalCount: toNumber(body.totalCount) || 0,
    pageNo: toNumber(body.pageNo) || pageNo,
    numOfRows: toNumber(body.numOfRows) || numOfRows,
  };
}

// 전체 페이지 조회 (한 달치 전부)
async function fetchMonth(endpointKey, lawdCd, dealYmd) {
  const first = await fetchPage(endpointKey, lawdCd, dealYmd, 1, 1000);
  let allItems = [...first.items];

  const totalPages = Math.ceil(first.totalCount / 1000);
  for (let page = 2; page <= totalPages; page++) {
    const next = await fetchPage(endpointKey, lawdCd, dealYmd, page, 1000);
    allItems = allItems.concat(next.items);
  }

  const kind = ENDPOINTS[endpointKey].kind;
  return allItems.map((item) => normalizeItem(item, kind, endpointKey));
}

// 유형별로 다른 필드명을 공통 스키마로 정규화
function normalizeItem(item, kind, endpointKey) {
  const name = item.aptNm || item.offiNm || item.mhouseNm || item.buildingNm || '';
  const area = toNumber(item.excluUseAr) || toNumber(item.buildingAr) || null;

  const base = {
    type: endpointKey,
    name,
    dong: item.umdNm || item.dong || '',
    jibun: String(item.jibun || ''),
    buildYear: toNumber(item.buildYear),
    area, // 전용면적 (㎡)
    floor: toNumber(item.floor),
    dealYear: toNumber(item.dealYear),
    dealMonth: toNumber(item.dealMonth),
    dealDay: toNumber(item.dealDay),
  };

  if (kind === 'trade') {
    return {
      ...base,
      dealAmount: toNumber(item.dealAmount), // 만원
      dealingType: item.dealingGbn || '',
      cancelled: Boolean(String(item.cdealType || '').trim()),
    };
  }

  // rent: monthlyRent 0이면 전세, >0이면 월세
  const monthlyRent = toNumber(item.monthlyRent) || 0;
  return {
    ...base,
    deposit: toNumber(item.deposit), // 보증금 (만원)
    monthlyRent, // 월세 (만원)
    rentType: monthlyRent > 0 ? '월세' : '전세',
    contractTerm: item.contractTerm || '',
    contractType: item.contractType || '',
  };
}

module.exports = { ENDPOINTS, fetchPage, fetchMonth, getDailyUsage };
