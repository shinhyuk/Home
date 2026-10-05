const mongoose = require('mongoose');

const analysisSchema = new mongoose.Schema({
  userId: mongoose.Schema.Types.ObjectId,

  // 입력 데이터
  input: {
    salary: String,
    family: String,
    savings: String,
    currentHome: String,
    priority: String,
    timeline: String,
    region: String,
  },

  // 분석 결과
  strategy: {
    title: String, // "청약 + 전세 조합 전략" 등
    description: String,
    score: Number, // 0-100
    confidence: Number, // 신뢰도
  },

  // 상세 분석
  qualification: [String], // 자격 항목
  risks: [String], // 위험 요소
  actions: [String], // 액션 플랜
  warnings: [String], // 주의사항

  // 수치 분석
  metrics: {
    afforderability: Number, // 구매력 지수
    riskLevel: String, // "low", "medium", "high"
    timelineRating: String, // 타이밍 평가
    regionPotential: Number, // 지역 성장성 점수
  },

  // 지역 데이터
  regionData: {
    name: String,
    averagePrice: Number, // 평균 매매가
    pricePerSquare: Number, // 평당 가격
    recentTrend: String, // "up", "down", "stable"
    nextYearPrediction: Number, // 예상 상승률 %
  },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },

  // TTL - 30일 후 자동 삭제
}, {
  timestamps: true,
  collection: 'analyses'
});

analysisSchema.index({ createdAt: 1 }, { expireAfterSeconds: 2592000 });

module.exports = mongoose.model('Analysis', analysisSchema);
