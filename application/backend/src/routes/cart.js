import express from 'express';
import os from 'os';
import { getCache, setCache, delCache } from '../redis.js';
import { pool } from '../db.js';

const router = express.Router();
const CART_TTL_SECONDS = 3600; // 1 hour TTL for active shopping sessions

// In-memory fallback if Redis is unavailable
const memoryCartStore = new Map();

function getCartIdentifier(req) {
  const authHeader = req.headers['authorization'];
  const sessionId = req.headers['x-session-id'] || 'guest-session';
  return req.user?.id ? `user:${req.user.id}` : `session:${sessionId}`;
}

// GET /api/cart — Retrieve current session cart
router.get('/', async (req, res) => {
  const cartId = getCartIdentifier(req);
  const cacheKey = `cart:${cartId}`;

  try {
    let cart = await getCache(cacheKey);
    let storageType = 'redis';

    if (!cart) {
      cart = memoryCartStore.get(cartId) || { items: [] };
      storageType = 'memory-fallback';
    }

    // Calculate subtotal
    const subtotal = cart.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    res.json({
      cartId,
      items: cart.items,
      itemCount: cart.items.reduce((sum, item) => sum + item.quantity, 0),
      subtotal: parseFloat(subtotal.toFixed(2)),
      storage: storageType,
      node: os.hostname()
    });
  } catch (err) {
    console.error('[CART GET ERROR]', err);
    res.status(500).json({ error: 'Failed to retrieve cart' });
  }
});

// POST /api/cart/items — Add or increment an item in the cart
router.post('/items', async (req, res) => {
  const cartId = getCartIdentifier(req);
  const cacheKey = `cart:${cartId}`;
  const { productId, quantity = 1 } = req.body;

  if (!productId) {
    return res.status(400).json({ error: 'productId is required' });
  }

  try {
    // 1. Verify product exists in MariaDB
    const [products] = await pool.query('SELECT id, name, price, image_url, stock FROM products WHERE id = ?', [productId]);
    if (products.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    const product = products[0];

    // 2. Fetch existing cart
    let cart = await getCache(cacheKey);
    if (!cart) {
      cart = memoryCartStore.get(cartId) || { items: [] };
    }

    // 3. Update items list
    const existingIndex = cart.items.findIndex(i => i.id === product.id);
    if (existingIndex > -1) {
      cart.items[existingIndex].quantity += parseInt(quantity, 10);
    } else {
      cart.items.push({
        id: product.id,
        name: product.name,
        price: parseFloat(product.price),
        image_url: product.image_url,
        quantity: parseInt(quantity, 10)
      });
    }

    // 4. Save to Redis (and update memory fallback)
    await setCache(cacheKey, cart, CART_TTL_SECONDS);
    memoryCartStore.set(cartId, cart);

    res.json({ message: 'Item added to cart', cart });
  } catch (err) {
    console.error('[CART ADD ERROR]', err);
    res.status(500).json({ error: 'Failed to add item to cart' });
  }
});

// DELETE /api/cart/items/:productId — Remove item from cart
router.delete('/items/:productId', async (req, res) => {
  const cartId = getCartIdentifier(req);
  const cacheKey = `cart:${cartId}`;
  const productId = parseInt(req.params.productId, 10);

  try {
    let cart = await getCache(cacheKey) || memoryCartStore.get(cartId) || { items: [] };
    cart.items = cart.items.filter(item => item.id !== productId);

    await setCache(cacheKey, cart, CART_TTL_SECONDS);
    memoryCartStore.set(cartId, cart);

    res.json({ message: 'Item removed from cart', cart });
  } catch (err) {
    console.error('[CART REMOVE ERROR]', err);
    res.status(500).json({ error: 'Failed to remove item from cart' });
  }
});

// DELETE /api/cart — Clear entire cart
router.delete('/', async (req, res) => {
  const cartId = getCartIdentifier(req);
  const cacheKey = `cart:${cartId}`;

  try {
    await delCache(cacheKey);
    memoryCartStore.delete(cartId);
    res.json({ message: 'Cart cleared successfully' });
  } catch (err) {
    console.error('[CART CLEAR ERROR]', err);
    res.status(500).json({ error: 'Failed to clear cart' });
  }
});

export default router;
