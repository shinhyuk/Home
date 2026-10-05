const express = require('express');
const router = express.Router();
const analysisService = require('../services/analysisService');
const realEstateService = require('../services/realEstateService');
const User = require('../models/User');
const Analysis = require('../models/Analysis');

// POST /api/analysis/analyze - 분석 실행
router.post('/analyze', async (req, res) => {
  try {
    const userData = req.body;

    // 입력값 검증
    if (!userData.salary || !userData.family || !userData.priority) {
      return res.status(400).json({ error: '필수 입력값이 누락되었습니다.' });
    }

    // 분석 실행
    const result = await analysisService.analyzeStrategy(userData);

    // 결과 저장 (사용자 동의 시)
    if (req.body.saveResult) {
      const analysis = new Analysis({
        input: userData,
        strategy: result.strategy,
        metrics: {
          afforderability: result.scores.affordability,
          riskLevel: getRiskLevel(result.scores.overall),
          timelineRating: userData.timeline,
          regionPotential: result.regionData.prediction,
        },
        regionData: result.regionData,
      });
      await analysis.save();
    }

    res.json(result);
  } catch (error) {
    console.error('분석 오류:', error);
    res.status(500).json({ error: '분석 중 오류가 발생했습니다.' });
  }
});

// GET /api/analysis/loan-simulation - 대출 시뮬레이션
router.get('/loan-simulation', (req, res) => {
  try {
    const { principal, rate, months } = req.query;

    if (!principal) {
      return res.status(400).json({ error: 'principal 파라미터가 필요합니다.' });
    }

    const result = analysisService.simulateLoan(
      parseInt(principal),
      parseFloat(rate) || 3.5,
      parseInt(months) || 360
    );

    res.json(result);
  } catch (error) {
    console.error('대출 시뮬레이션 오류:', error);
    res.status(500).json({ error: '시뮬레이션 실패' });
  }
});

// GET /api/analysis/price-trend - 가격 추세
router.get('/price-trend', async (req, res) => {
  try {
    const { region, months } = req.query;

    if (!region) {
      return res.status(400).json({ error: 'region 파라미터가 필요합니다.' });
    }

    const trend = await realEstateService.getPriceTrend(
      region,
      parseInt(months) || 12
    );

    res.json(trend);
  } catch (error) {
    console.error('가격 추세 조회 오류:', error);
    res.status(500).json({ error: '추세 조회 실패' });
  }
});

// GET /api/analysis/region-info - 지역 정보
router.get('/region-info', async (req, res) => {
  try {
    const { region } = req.query;

    if (!region) {
      return res.status(400).json({ error: 'region 파라미터가 필요합니다.' });
    }

    const data = await realEstateService.getRegionData(region);
    const apartments = await realEstateService.fetchApartmentInfo(region);

    res.json({
      regionData: data,
      apartmentInfo: apartments,
    });
  } catch (error) {
    console.error('지역 정보 조회 오류:', error);
    res.status(500).json({ error: '지역 정보 조회 실패' });
  }
});

// GET /api/analysis/stats - 통계 (대시보드용)
router.get('/stats', async (req, res) => {
  try {
    const total = await Analysis.countDocuments();
    const byStrategy = await Analysis.aggregate([
      { $group: { _id: '$strategy.type', count: { $sum: 1 } } }
    ]);

    res.json({
      totalAnalyses: total,
      byStrategy: byStrategy,
    });
  } catch (error) {
    console.error('통계 조회 오류:', error);
    res.status(500).json({ error: '통계 조회 실패' });
  }
});

function getRiskLevel(score) {
  if (score >= 70) return 'low';
  if (score >= 50) return 'medium';
  return 'high';
}

module.exports = router;
