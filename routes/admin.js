import express from 'express';
import bcrypt from 'bcryptjs';
import { getOne, getAll, runQuery } from '../database/db.js';
import { authenticateToken, requireSuperuser } from '../middleware/auth.js';

const router = express.Router();

// Get all sellers with earnings
router.get('/sellers', authenticateToken, requireSuperuser, (req, res) => {
    try {
        const sellers = getAll(`
      SELECT id, email, earnings, created_at, is_active
      FROM users
      WHERE role = 'seller'
      ORDER BY created_at DESC
    `);

        // Get order count and total sales for each seller
        for (const seller of sellers) {
            const stats = getOne(`
        SELECT COUNT(*) as order_count, COALESCE(SUM(total_amount), 0) as total_sales
        FROM orders
        WHERE seller_id = ? AND status = 'completed'
      `, [seller.id]);

            seller.order_count = stats.order_count;
            seller.total_sales = stats.total_sales;
        }

        res.json({ sellers });
    } catch (error) {
        console.error('Error fetching sellers:', error);
        res.status(500).json({ error: 'Error al obtener vendedores.' });
    }
});

// Create new seller account (superuser only)
router.post('/sellers', authenticateToken, requireSuperuser, async (req, res) => {
    try {
        const { email, password, binance_wallet } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email y contraseña son requeridos.' });
        }

        // Check if user already exists
        const existingUser = getOne('SELECT id FROM users WHERE email = ?', [email]);
        if (existingUser) {
            return res.status(400).json({ error: 'Este email ya está registrado.' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create seller
        const sellerId = runQuery(`
      INSERT INTO users (email, password, role, binance_wallet)
      VALUES (?, ?, 'seller', ?)
    `, [email, hashedPassword, binance_wallet || null]);

        res.status(201).json({
            message: 'Vendedor creado exitosamente.',
            seller: {
                id: sellerId,
                email,
                role: 'seller'
            }
        });
    } catch (error) {
        console.error('Error creating seller:', error);
        res.status(500).json({ error: 'Error al crear vendedor.' });
    }
});

// Update seller details
router.put('/sellers/:id', authenticateToken, requireSuperuser, async (req, res) => {
    try {
        const { email, password, binance_wallet, is_active } = req.body;

        const seller = getOne('SELECT * FROM users WHERE id = ? AND role = ?', [req.params.id, 'seller']);

        if (!seller) {
            return res.status(404).json({ error: 'Vendedor no encontrado.' });
        }

        // Build update query
        if (password) {
            const hashedPassword = await bcrypt.hash(password, 10);
            runQuery(`
        UPDATE users SET email = ?, binance_wallet = ?, is_active = ?, password = ?, updated_at = CURRENT_TIMESTAMP 
        WHERE id = ?
      `, [
                email || seller.email,
                binance_wallet || seller.binance_wallet,
                is_active !== undefined ? (is_active ? 1 : 0) : seller.is_active,
                hashedPassword,
                req.params.id
            ]);
        } else {
            runQuery(`
        UPDATE users SET email = ?, binance_wallet = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP 
        WHERE id = ?
      `, [
                email || seller.email,
                binance_wallet || seller.binance_wallet,
                is_active !== undefined ? (is_active ? 1 : 0) : seller.is_active,
                req.params.id
            ]);
        }

        res.json({ message: 'Vendedor actualizado exitosamente.' });
    } catch (error) {
        console.error('Error updating seller:', error);
        res.status(500).json({ error: 'Error al actualizar vendedor.' });
    }
});

// Deactivate seller
router.delete('/sellers/:id', authenticateToken, requireSuperuser, (req, res) => {
    try {
        runQuery('UPDATE users SET is_active = 0 WHERE id = ? AND role = ?', [req.params.id, 'seller']);
        res.json({ message: 'Vendedor desactivado exitosamente.' });
    } catch (error) {
        console.error('Error deactivating seller:', error);
        res.status(500).json({ error: 'Error al desactivar vendedor.' });
    }
});

// Update seller earnings
router.put('/sellers/:id/earnings', authenticateToken, requireSuperuser, (req, res) => {
    try {
        const { amount, operation } = req.body; // operation: 'add' or 'set'

        if (!amount || !operation) {
            return res.status(400).json({ error: 'Monto y operación son requeridos.' });
        }

        const seller = getOne('SELECT * FROM users WHERE id = ? AND role = ?', [req.params.id, 'seller']);

        if (!seller) {
            return res.status(404).json({ error: 'Vendedor no encontrado.' });
        }

        let newEarnings;
        if (operation === 'add') {
            newEarnings = seller.earnings + amount;
        } else if (operation === 'set') {
            newEarnings = amount;
        } else {
            return res.status(400).json({ error: 'Operación inválida. Use "add" o "set".' });
        }

        runQuery('UPDATE users SET earnings = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [newEarnings, req.params.id]);

        res.json({ message: 'Ganancias actualizadas exitosamente.', new_earnings: newEarnings });
    } catch (error) {
        console.error('Error updating earnings:', error);
        res.status(500).json({ error: 'Error al actualizar ganancias.' });
    }
});

// Assign sale to seller (add earnings)
router.post('/sellers/:id/sales', authenticateToken, requireSuperuser, (req, res) => {
    try {
        const { order_id, amount } = req.body;

        if (!order_id || !amount) {
            return res.status(400).json({ error: 'ID de orden y monto son requeridos.' });
        }

        const seller = getOne('SELECT * FROM users WHERE id = ? AND role = ?', [req.params.id, 'seller']);

        if (!seller) {
            return res.status(404).json({ error: 'Vendedor no encontrado.' });
        }

        // Record earning
        runQuery(`
      INSERT INTO seller_earnings (seller_id, order_id, amount)
      VALUES (?, ?, ?)
    `, [req.params.id, order_id, amount]);

        // Update seller total earnings
        runQuery(`
      UPDATE users SET earnings = earnings + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `, [amount, req.params.id]);

        res.json({ message: 'Venta asignada exitosamente.' });
    } catch (error) {
        console.error('Error assigning sale:', error);
        res.status(500).json({ error: 'Error al asignar venta.' });
    }
});

// Get system analytics
router.get('/analytics', authenticateToken, requireSuperuser, (req, res) => {
    try {
        // Total users by role
        const userStats = getAll(`
      SELECT role, COUNT(*) as count
      FROM users
      WHERE is_active = 1
      GROUP BY role
    `);

        // Order stats
        const orderStats = getOne(`
      SELECT 
        COUNT(*) as total_orders,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_orders,
        SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing_orders,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_orders,
        COALESCE(SUM(CASE WHEN status = 'completed' THEN total_amount ELSE 0 END), 0) as total_revenue
      FROM orders
    `);

        // Product stats
        const productStats = getOne(`
      SELECT COUNT(*) as total_products, SUM(stock) as total_stock
      FROM products
      WHERE is_active = 1
    `);

        // Top sellers
        const topSellers = getAll(`
      SELECT u.email, u.earnings, COUNT(o.id) as completed_orders
      FROM users u
      LEFT JOIN orders o ON u.id = o.seller_id AND o.status = 'completed'
      WHERE u.role = 'seller' AND u.is_active = 1
      GROUP BY u.id
      ORDER BY u.earnings DESC
      LIMIT 5
    `);

        res.json({
            users: userStats,
            orders: orderStats,
            products: productStats,
            top_sellers: topSellers
        });
    } catch (error) {
        console.error('Error fetching analytics:', error);
        res.status(500).json({ error: 'Error al obtener analíticas.' });
    }
});

export default router;
