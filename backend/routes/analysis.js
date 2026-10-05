const express = require('express');
const router = express.Router();
const analysisService = require('../services/analysisService');
const realEstateService = require('../services/realEstateService');
const Analysis = require('../models/Analysis');
const mongoose = require('mongoose');

// POST /api/analysis/analyze - 전략 분석 (핵심 API)
router.post('/analyze', async (req, res) => {
  try {
    const userData = req.body;

    const hasIncome = userData.salary || Number(userData.salaryAmount) > 0;
    if (!hasIncome || !userData.family || !userData.priority || !userData.region) {
      return res.status(400).json({ error: '필수 입력값이 누락되었습니다. (연소득, 가족, 우선순위, 지역)' });
    }

    const result = await analysisService.analyzeStrategy(userData);

    // 결과 저장 (MongoDB 연결 시에만, 실패해도 분석 결과는 반환)
    if (req.body.saveResult && mongoose.connection.readyState === 1) {
      try {
        const analysis = new Analysis({
          input: userData,
          strategy: result.strategy,
          metrics: {
            afforderability: result.scores.affordability,
            riskLevel: result.scores.overall >= 70 ? 'low' : result.scores.overall >= 50 ? 'medium' : 'high',
            timelineRating: userData.timeline,
            regionPotential: result.regionData?.changeRate ?? null,
          },
          regionData: {
            name: result.regionData?.name,
            averagePrice: result.regionData?.avgPrice,
            pricePerSquare: result.regionData?.avgPerPyeong,
            recentTrend: result.regionData?.trend,
            nextYearPrediction: result.regionData?.changeRate,
          },
        });
        await analysis.save();
      } catch (saveErr) {
        console.warn('분석 결과 저장 실패 (무시):', saveErr.message);
      }
    }

    res.json(result);
  } catch (error) {
    console.error('분석 오류:', error);
    res.status(500).json({ error: '분석 중 오류가 발생했습니다.', detail: error.message });
  }
});

// GET /api/analysis/loan-simulation?principal=30000&rate=3.5&months=360
router.get('/loan-simulation', (req, res) => {
  try {
    const { principal, rate, months } = req.query;
    if (!principal) {
      return res.status(400).json({ error: 'principal 파라미터가 필요합니다. (만원 단위)' });
    }
    const result = analysisService.simulateLoan(
      parseInt(principal),
      parseFloat(rate) || 3.5,
      parseInt(months) || 360
    );
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: '시뮬레이션 실패', detail: error.message });
  }
});

// GET /api/analysis/loan-capacity?income=6000&housePrice=90000
router.get('/loan-capacity', (req, res) => {
  try {
    const { income, housePrice, rate } = req.query;
    if (!income) {
      return res.status(400).json({ error: 'income 파라미터가 필요합니다. (연소득, 만원 단위)' });
    }
    const maxLoan = analysisService.maxLoanCapacity(
      parseInt(income),
      housePrice ? parseInt(housePrice) : null,
      { rate: parseFloat(rate) || 3.5 }
    );
    res.json({ income: parseInt(income), maxLoan, basis: 'DSR 40% + LTV 70%, 30년 원리금균등' });
  } catch (error) {
    res.status(500).json({ error: '계산 실패', detail: error.message });
  }
});

// GET /api/analysis/stats - 분석 통계 (대시보드용)
router.get('/stats', async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.json({ totalAnalyses: 0, byStrategy: [], note: 'DB 미연결' });
    }
    const total = await Analysis.countDocuments();
    const byStrategy = await Analysis.aggregate([
      { $group: { _id: '$strategy.type', count: { $sum: 1 } } }
    ]);
    res.json({ totalAnalyses: total, byStrategy });
  } catch (error) {
    res.status(500).json({ error: '통계 조회 실패' });
  }
});

module.exports = router;
