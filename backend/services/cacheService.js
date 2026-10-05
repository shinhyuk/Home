const mongoose = require('mongoose');

// 트래픽 10,000/일 보호의 핵심: 같은 (유형×지역×월) 조회는 캐시로 해결
// 1차: 메모리 캐시 (빠름), 2차: MongoDB (서버 재시작에도 유지, 연결 시에만)

const memoryCache = new Map();

// MongoDB 캐시 컬렉션 (유연한 스키마)
const cacheSchema = new mongoose.Schema({
  key: { type: String, unique: true, index: true },
  data: mongoose.Schema.Types.Mixed,
  expiresAt: { type: Date, index: { expireAfterSeconds: 0 } },
}, { collection: 'api_cache' });

const CacheEntry = mongoose.model('CacheEntry', cacheSchema);

function mongoReady() {
  return mongoose.connection.readyState === 1;
}

async function get(key) {
  // 1차: 메모리
  const mem = memoryCache.get(key);
  if (mem && mem.expiresAt > Date.now()) {
    return mem.data;
  }
  memoryCache.delete(key);

  // 2차: MongoDB
  if (mongoReady()) {
    try {
      const doc = await CacheEntry.findOne({ key }).lean();
      if (doc && doc.expiresAt > new Date()) {
        memoryCache.set(key, { data: doc.data, expiresAt: doc.expiresAt.getTime() });
        return doc.data;
      }
    } catch (err) {
      console.warn('캐시 조회 실패 (무시):', err.message);
    }
  }
  return null;
}

async function set(key, data, ttlMs) {
  const expiresAt = Date.now() + ttlMs;
  memoryCache.set(key, { data, expiresAt });

  if (mongoReady()) {
    try {
      await CacheEntry.updateOne(
        { key },
        { $set: { data, expiresAt: new Date(expiresAt) } },
        { upsert: true }
      );
    } catch (err) {
      console.warn('캐시 저장 실패 (무시):', err.message);
    }
  }
}

// 메모리 캐시 크기 제한 (오래된 것부터 정리)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of memoryCache) {
    if (entry.expiresAt <= now) memoryCache.delete(key);
  }
  if (memoryCache.size > 2000) {
    const keys = [...memoryCache.keys()].slice(0, memoryCache.size - 2000);
    keys.forEach((k) => memoryCache.delete(k));
  }
}, 60 * 1000).unref();

module.exports = { get, set };
