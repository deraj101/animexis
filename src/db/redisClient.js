const { createClient } = require('redis');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Upstash uses rediss:// (TLS) — detect and configure accordingly
const isTLS = REDIS_URL.startsWith('rediss://');

const redisClient = createClient({
  url: REDIS_URL,
  disableOfflineQueue: true, // Fail immediately if not connected (prevents hangs)
  socket: {
    tls: isTLS,
    rejectUnauthorized: false, // required for Upstash free tier
    connectTimeout: 10000,    // 10s timeout for connection attempts
    reconnectStrategy: (retries) => {
      if (retries > 10) {
        console.warn('⚠️ Redis: gave up reconnecting after 10 attempts.');
        return false;
      }
      return Math.min(retries * 200, 3000);
    }
  }
});

redisClient.on('error', (err) => {
  // Only log non-connection-refused errors to avoid noise in local dev
  if (err.code !== 'ECONNREFUSED') {
    console.error('❌ Redis error:', err.message);
  }
});

redisClient.on('connect', () => console.log('✅ Redis connected'));
redisClient.on('reconnecting', () => console.log('🔄 Redis reconnecting...'));

module.exports = redisClient;
