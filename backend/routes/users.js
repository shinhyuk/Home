const express = require('express');
const router = express.Router();
const User = require('../models/User');

// POST /api/users - 사용자 저장 (분석 후)
router.post('/', async (req, res) => {
  try {
    const userData = req.body;

    // 필드 유효성 검증
    if (!userData.salary || !userData.family) {
      return res.status(400).json({ error: '필수 필드가 누락되었습니다.' });
    }

    // 사용자 생성
    const user = new User({
      salary: userData.salary,
      family: userData.family,
      savings: userData.savings,
      currentHome: userData.currentHome,
      experiences: userData.experiences || [],
      priority: userData.priority,
      timeline: userData.timeline,
      region: userData.region,
      lastAnalysis: userData.lastAnalysis,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });

    await user.save();

    res.status(201).json({
      id: user._id,
      message: '사용자 정보가 저장되었습니다.',
    });
  } catch (error) {
    console.error('사용자 저장 오류:', error);
    res.status(500).json({ error: '저장 실패' });
  }
});

// GET /api/users/stats - 익명 통계
router.get('/stats', async (req, res) => {
  try {
    const total = await User.countDocuments();

    const byFamily = await User.aggregate([
      { $group: { _id: '$family', count: { $sum: 1 } } }
    ]);

    const byPriority = await User.aggregate([
      { $group: { _id: '$priority', count: { $sum: 1 } } }
    ]);

    const byTimeline = await User.aggregate([
      { $group: { _id: '$timeline', count: { $sum: 1 } } }
    ]);

    res.json({
      totalUsers: total,
      byFamily,
      byPriority,
      byTimeline,
    });
  } catch (error) {
    console.error('통계 조회 오류:', error);
    res.status(500).json({ error: '통계 조회 실패' });
  }
});

module.exports = router;
