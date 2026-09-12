import express from 'express';
import os from 'os';
import { pool } from '../db.js';
import { getCache, setCache, delCache } from '../redis.js';
import { authenticateToken } from './auth.js';

const router = express.Router();
const CACHE_KEY_ALL_PRODUCTS = 'products:all';
const CACHE_TTL_SECONDS = 60;

// GET /api/products — Read with Redis Cache-Aside
router.get('/', async (req, res) => {
  const startTime = Date.now();
  try {
    // 1. Check Redis Cache
    const cachedProducts = await getCache(CACHE_KEY_ALL_PRODUCTS);
    if (cachedProducts) {
      return res.json({
        data: cachedProducts,
        source: 'redis-cache',
        cached: true,
        ttl: CACHE_TTL_SECONDS,
        node: os.hostname(),
        durationMs: Date.now() - startTime
      });
    }

    // 2. Cache Miss: Query MariaDB
    const [rows] = await pool.query('SELECT * FROM products ORDER BY id ASC');

    // 3. Populate Redis Cache (non-blocking, errors swallowed gracefully)
    setCache(CACHE_KEY_ALL_PRODUCTS, rows, CACHE_TTL_SECONDS);

    return res.json({
      data: rows,
      source: 'mariadb-primary',
      cached: false,
      node: os.hostname(),
      durationMs: Date.now() - startTime
    });
  } catch (err) {
    console.error('[PRODUCTS GET ERROR]', err);
    res.status(500).json({ error: 'Failed to retrieve products', message: err.message });
  }
});

// GET /api/products/:id — Read individual product
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const cacheKey = `product:${id}`;

  try {
    const cached = await getCache(cacheKey);
    if (cached) {
      return res.json({ data: cached, source: 'redis-cache', cached: true, node: os.hostname() });
    }

    const [rows] = await pool.query('SELECT * FROM products WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    setCache(cacheKey, rows[0], CACHE_TTL_SECONDS);
    res.json({ data: rows[0], source: 'mariadb-primary', cached: false, node: os.hostname() });
  } catch (err) {
    console.error(`[PRODUCT ${id} GET ERROR]`, err);
    res.status(500).json({ error: 'Failed to retrieve product' });
  }
});

// POST /api/products — Create product (Admin only / authenticated)
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { name, description, price, stock, category, image_url } = req.body;
    if (!name || price == null) {
      return res.status(400).json({ error: 'Product name and price are required' });
    }

    const [result] = await pool.query(
      'INSERT INTO products (name, description, price, stock, category, image_url) VALUES (?, ?, ?, ?, ?, ?)',
      [name, description || '', price, stock || 0, category || 'General', image_url || '']
    );

    // Invalidate product caches on write
    await delCache(CACHE_KEY_ALL_PRODUCTS);

    res.status(201).json({
      message: 'Product created successfully',
      productId: result.insertId
    });
  } catch (err) {
    console.error('[PRODUCT CREATE ERROR]', err);
    res.status(500).json({ error: 'Failed to create product' });
  }
});

// PUT /api/products/:id — Update product stock or details
router.put('/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { name, description, price, stock, category, image_url } = req.body;

  try {
    const [result] = await pool.query(
      'UPDATE products SET name = COALESCE(?, name), description = COALESCE(?, description), price = COALESCE(?, price), stock = COALESCE(?, stock), category = COALESCE(?, category), image_url = COALESCE(?, image_url) WHERE id = ?',
      [name, description, price, stock, category, image_url, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    // Invalidate both catalog and specific item cache
    await delCache(CACHE_KEY_ALL_PRODUCTS);
    await delCache(`product:${id}`);

    res.json({ message: 'Product updated successfully' });
  } catch (err) {
    console.error(`[PRODUCT ${id} UPDATE ERROR]`, err);
    res.status(500).json({ error: 'Failed to update product' });
  }
});

export default router;
