import express from 'express';
import os from 'os';
import { pool } from '../db.js';
import { delCache } from '../redis.js';
import { authenticateToken } from './auth.js';

const router = express.Router();

// POST /api/orders — Checkout and create order transactionally
router.post('/', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { items } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Order must contain at least one item' });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    let totalAmount = 0;
    const validatedItems = [];

    // 1. Verify stock and calculate total with database-level price consistency
    for (const item of items) {
      const [productRows] = await connection.query(
        'SELECT id, name, price, stock FROM products WHERE id = ? FOR UPDATE',
        [item.id]
      );

      if (productRows.length === 0) {
        throw new Error(`Product ID ${item.id} no longer exists`);
      }

      const product = productRows[0];
      if (product.stock < item.quantity) {
        throw new Error(`Insufficient stock for "${product.name}". Available: ${product.stock}`);
      }

      const lineTotal = parseFloat(product.price) * item.quantity;
      totalAmount += lineTotal;

      validatedItems.push({
        id: product.id,
        quantity: item.quantity,
        price: parseFloat(product.price)
      });

      // Decrement stock
      await connection.query(
        'UPDATE products SET stock = stock - ? WHERE id = ?',
        [item.quantity, product.id]
      );
    }

    // 2. Insert into orders table
    const [orderResult] = await connection.query(
      'INSERT INTO orders (user_id, total_amount, status) VALUES (?, ?, ?)',
      [userId, totalAmount.toFixed(2), 'paid']
    );

    const orderId = orderResult.insertId;

    // 3. Insert line items
    for (const vItem of validatedItems) {
      await connection.query(
        'INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)',
        [orderId, vItem.id, vItem.quantity, vItem.price]
      );
    }

    // Commit Transaction
    await connection.commit();

    // 4. Clear User Cart in Redis
    await delCache(`cart:user:${userId}`);

    res.status(201).json({
      message: 'Order created successfully',
      orderId,
      totalAmount: parseFloat(totalAmount.toFixed(2)),
      itemsCount: validatedItems.length,
      node: os.hostname()
    });
  } catch (err) {
    await connection.rollback();
    console.error('[ORDER TRANSACTION ERROR]', err);
    res.status(400).json({ error: err.message || 'Transaction failed' });
  } finally {
    connection.release();
  }
});

// GET /api/orders — Retrieve order history
router.get('/', authenticateToken, async (req, res) => {
  const userId = req.user.id;

  try {
    const [orders] = await pool.query(
      `SELECT o.id, o.total_amount, o.status, o.created_at,
              JSON_ARRAYAGG(
                JSON_OBJECT('productId', oi.product_id, 'name', p.name, 'quantity', oi.quantity, 'unitPrice', oi.unit_price)
              ) as items
       FROM orders o
       LEFT JOIN order_items oi ON o.id = oi.order_id
       LEFT JOIN products p ON oi.product_id = p.id
       WHERE o.user_id = ?
       GROUP BY o.id
       ORDER BY o.created_at DESC`,
      [userId]
    );

    res.json({ orders, node: os.hostname() });
  } catch (err) {
    console.error('[ORDERS GET ERROR]', err);
    res.status(500).json({ error: 'Failed to retrieve order history' });
  }
});

export default router;
