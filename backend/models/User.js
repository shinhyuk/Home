const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  // 기본 정보
  salary: String, // "0-2000", "2000-3500", etc
  family: String, // "single", "married-no-child", etc
  savings: String, // "0-5000", "5000-10000", etc

  // 현재 부동산 상태
  currentHome: String, // "none", "jeonse", "owned", "first-time"
  experiences: [String], // ["apt", "lprog", "buy"]

  // 목표
  priority: String, // "own-home", "investment", "upgrade", "flexible"
  timeline: String, // "urgent", "1year", "2year", "3plus"
  region: String,

  // 분석 결과 (최신)
  lastAnalysis: {
    strategy: String,
    score: Number,
    recommendation: mongoose.Schema.Types.Mixed,
    createdAt: Date,
  },

  // 메타데이터
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  ip: String, // 사용자 IP (익명성 유지)
  userAgent: String,
}, {
  timestamps: true,
  collection: 'users'
});

// TTL 인덱스 - 30일 후 자동 삭제 (개인정보 보호)
userSchema.index({ createdAt: 1 }, { expireAfterSeconds: 2592000 });

module.exports = mongoose.model('User', userSchema);
