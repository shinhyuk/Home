const express = require('express');
const router = express.Router();
const realEstateService = require('../services/realEstateService');
const molitApi = require('../services/molitApi');

// GET /api/real-estate/regions - 지원 지역 목록
router.get('/regions', (req, res) => {
  res.json(realEstateService.listRegions());
});

// GET /api/real-estate/usage - API 일일 사용량 (트래픽 10,000 모니터링)
router.get('/usage', (req, res) => {
  res.json(molitApi.getDailyUsage());
});

// GET /api/real-estate/diag - 데이터 소스 진단 (정적 수집 데이터 + 국토부 직접)
router.get('/diag', async (req, res) => {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
  const result = { dealYmd: ym, keySet: Boolean(process.env.MOLIT_API_KEY) };

  try {
    const items = await realEstateService.fetchMonthCached('apt-trade', '11680', ym);
    result.ok = true;
    result.itemCount = items.length;
  } catch (error) {
    result.ok = false;
    result.error = error.message;
    result.httpStatus = error.response?.status || null;
  }
  res.status(result.ok ? 200 : 502).json(result);
});

// GET /api/real-estate/summary/:region - 지역 종합 시세 (매매+전월세, 3개 유형)
router.get('/summary/:region', async (req, res) => {
  try {
    const region = decodeURIComponent(req.params.region);
    const data = await realEstateService.getRegionSummary(region);
    if (data.error) return res.status(404).json(data);
    res.json(data);
  } catch (error) {
    console.error('지역 종합 조회 오류:', error);
    res.status(500).json({ error: '시세 조회 실패', detail: error.message });
  }
});

// GET /api/real-estate/price/:region - 분석용 요약 시세
router.get('/price/:region', async (req, res) => {
  try {
    const region = decodeURIComponent(req.params.region);
    const data = await realEstateService.getRegionData(region);
    if (data.error) return res.status(404).json(data);
    res.json(data);
  } catch (error) {
    console.error('가격 조회 오류:', error);
    res.status(500).json({ error: '가격 조회 실패', detail: error.message });
  }
});

// GET /api/real-estate/trend/:region?months=6&type=apt-trade - 월별 추세
router.get('/trend/:region', async (req, res) => {
  try {
    const region = decodeURIComponent(req.params.region);
    const months = parseInt(req.query.months) || 6;
    const type = req.query.type || 'apt-trade';
    const trend = await realEstateService.getPriceTrend(region, months, type);
    if (trend.error) return res.status(404).json(trend);
    res.json(trend);
  } catch (error) {
    console.error('추세 조회 오류:', error);
    res.status(500).json({ error: '추세 조회 실패', detail: error.message });
  }
});

module.exports = router;
