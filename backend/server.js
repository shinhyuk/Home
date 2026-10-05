require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// 프론트엔드 정적 서빙 (http://localhost:5000 접속 시 입력 페이지)
app.use(express.static(require('path').join(__dirname, '..', 'frontend')));

// MongoDB 연결 (실패해도 서버는 동작 — 캐시는 메모리로 대체)
const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/ormhome';
mongoose.connect(mongoURI, { serverSelectionTimeoutMS: 5000 })
  .then(() => console.log('✅ MongoDB 연결됨'))
  .catch(err => console.warn('⚠ MongoDB 미연결 (메모리 캐시로 동작):', err.message));

// Routes
app.use('/api/real-estate', require('./routes/realEstate'));
app.use('/api/analysis', require('./routes/analysis'));
app.use('/api/users', require('./routes/users'));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date() });
});

// 에러 핸들링
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: '서버 오류가 발생했습니다.' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 오름홈 백엔드 서버 실행 중: http://localhost:${PORT}`);
});
