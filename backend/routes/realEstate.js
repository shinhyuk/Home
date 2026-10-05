const express = require('express');
const router = express.Router();
const realEstateService = require('../services/realEstateService');

// GET /api/real-estate/regions - 지원 지역 목록
router.get('/regions', (req, res) => {
  const regions = [
    '서울 강남구',
    '서울 서초구',
    '서울 마포구',
    '서울 송파구',
    '경기 성남시',
    '경기 판교',
    '경기 부천시',
    '부산 해운대',
    '부산 강서구',
    '대구 수성구',
    '인천 연수구',
  ];

  res.json(regions);
});

// GET /api/real-estate/price/:region - 지역 가격 정보
router.get('/price/:region', async (req, res) => {
  try {
    const region = decodeURIComponent(req.params.region);
    const data = await realEstateService.getRegionData(region);
    res.json(data);
  } catch (error) {
    console.error('가격 조회 오류:', error);
    res.status(500).json({ error: '가격 조회 실패' });
  }
});

// GET /api/real-estate/apartments/:region - 청약 정보
router.get('/apartments/:region', async (req, res) => {
  try {
    const region = decodeURIComponent(req.params.region);
    const data = await realEstateService.fetchApartmentInfo(region);
    res.json(data);
  } catch (error) {
    console.error('청약 정보 조회 오류:', error);
    res.status(500).json({ error: '청약 정보 조회 실패' });
  }
});

// GET /api/real-estate/trend/:region - 가격 추세
router.get('/trend/:region', async (req, res) => {
  try {
    const region = decodeURIComponent(req.params.region);
    const months = parseInt(req.query.months) || 12;
    const trend = await realEstateService.getPriceTrend(region, months);
    res.json(trend);
  } catch (error) {
    console.error('추세 조회 오류:', error);
    res.status(500).json({ error: '추세 조회 실패' });
  }
});

module.exports = router;
