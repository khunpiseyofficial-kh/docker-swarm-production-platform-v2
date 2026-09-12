import express from 'express';
import cors from 'cors';
import os from 'os';
import { pool, checkDbHealth } from './db.js';
import { redisClient, checkRedisHealth } from './redis.js';

import authRoutes from './routes/auth.js';
import productRoutes from './routes/products.js';
import cartRoutes from './routes/cart.js';
import orderRoutes from './routes/orders.js';

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// Middleware
app.use(cors({ origin: '*' }));
app.use(express.json());

// Request logging middleware with Swarm node identification
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] [Node: ${os.hostname()}] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${duration}ms)`);
  });
  next();
});

// Deep Health Check Endpoint
app.get('/health', async (req, res) => {
  const dbOk = await checkDbHealth();
  const redisOk = await checkRedisHealth();

  const healthPayload = {
    status: dbOk ? (redisOk ? 'healthy' : 'degraded') : 'unhealthy',
    timestamp: new Date().toISOString(),
    node: os.hostname(),
    uptimeSeconds: Math.floor(process.uptime()),
    components: {
      database: dbOk ? 'up' : 'down',
      redisCache: redisOk ? 'up' : 'down (graceful fallback)'
    }
  };

  // MariaDB is a hard dependency: if down, return 503
  // Redis is a soft dependency: if down, service degrades gracefully (return 200)
  if (!dbOk) {
    return res.status(503).json(healthPayload);
  }

  res.status(200).json(healthPayload);
});

// Mount Application Routes under /api
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/orders', orderRoutes);

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found', path: req.path });
});

// Central Error Handler
app.use((err, req, res, next) => {
  console.error('[UNHANDLED ERROR]', err);
  res.status(500).json({ error: 'Internal Server Error', message: err.message });
});

// Start Server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`========================================================`);
  console.log(`[✓] Swarm E-Commerce Backend running on port ${PORT}`);
  console.log(`[✓] Container Hostname (Node): ${os.hostname()}`);
  console.log(`[✓] Node.js Version: ${process.version}`);
  console.log(`========================================================`);
});

// Graceful Shutdown Handling
const shutdown = async (signal) => {
  console.log(`[SHUTDOWN] Received ${signal}. Initiating graceful shutdown...`);
  server.close(async () => {
    try {
      await pool.end();
      console.log('[SHUTDOWN] Closed MariaDB connection pool.');
      if (redisClient.isOpen) {
        await redisClient.quit();
        console.log('[SHUTDOWN] Closed Redis client.');
      }
      console.log('[SHUTDOWN] Clean exit completed.');
      process.exit(0);
    } catch (err) {
      console.error('[SHUTDOWN ERROR]', err);
      process.exit(1);
    }
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
