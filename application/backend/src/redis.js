import { createClient } from 'redis';

const REDIS_HOST = process.env.REDIS_HOST || 'redis';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
const REDIS_URL = `redis://${REDIS_HOST}:${REDIS_PORT}`;

let redisConnected = false;

// Create Redis Client with explicit connectTimeout and disabled offline queue
// disableOfflineQueue: true prevents commands from buffering indefinitely during an outage
export const redisClient = createClient({
  url: REDIS_URL,
  socket: {
    connectTimeout: 2000,
    reconnectStrategy: (retries) => {
      if (retries > 5) {
        console.warn('[REDIS] Max reconnect retries exceeded. Operating in degraded mode (DB fallback).');
        return false; // Stop reconnecting automatically until triggered
      }
      return Math.min(retries * 500, 3000);
    }
  },
  disableOfflineQueue: true
});

redisClient.on('connect', () => {
  redisConnected = true;
  console.log(`[REDIS] Successfully connected to ${REDIS_URL}`);
});

redisClient.on('ready', () => {
  redisConnected = true;
});

redisClient.on('error', (err) => {
  redisConnected = false;
  // Non-fatal: log warning and allow graceful fallback to MariaDB
  console.warn(`[REDIS SOFT-FAILURE] Redis error (${err.code || err.message}). Fallback to DB active.`);
});

redisClient.on('end', () => {
  redisConnected = false;
  console.warn('[REDIS] Connection closed.');
});

// Non-blocking initialization
(async () => {
  try {
    await redisClient.connect();
  } catch (err) {
    console.warn('[REDIS] Initial connection failed. Service will degrade gracefully to MariaDB.');
  }
})();

/**
 * Cache-aside GET wrapper.
 * Returns parsed object or null if missed or Redis is unavailable. Never throws.
 */
export async function getCache(key) {
  if (!redisConnected) return null;
  try {
    const data = await redisClient.get(key);
    return data ? JSON.parse(data) : null;
  } catch (err) {
    console.warn(`[REDIS GET WARN] Failed reading key "${key}": ${err.message}. Continuing with DB fallback.`);
    return null;
  }
}

/**
 * Cache-aside SET wrapper with TTL.
 * Never throws on failure.
 */
export async function setCache(key, value, ttlSeconds = 60) {
  if (!redisConnected) return false;
  try {
    const payload = JSON.stringify(value);
    await redisClient.set(key, payload, { EX: ttlSeconds });
    return true;
  } catch (err) {
    console.warn(`[REDIS SET WARN] Failed setting key "${key}": ${err.message}. Non-fatal.`);
    return false;
  }
}

/**
 * Cache invalidation wrapper.
 * Never throws on failure.
 */
export async function delCache(key) {
  if (!redisConnected) return false;
  try {
    await redisClient.del(key);
    return true;
  } catch (err) {
    console.warn(`[REDIS DEL WARN] Failed deleting key "${key}": ${err.message}. Non-fatal.`);
    return false;
  }
}

/**
 * Health check utility
 */
export async function checkRedisHealth() {
  if (!redisConnected) return false;
  try {
    const reply = await redisClient.ping();
    return reply === 'PONG';
  } catch {
    return false;
  }
}
