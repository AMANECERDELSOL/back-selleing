import express from 'express';
import { getOne, getAll, runQuery } from '../database/db.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

const router = express.Router();

// Create new order (buyers only)
router.post('/', authenticateToken, requireRole('buyer'), (req, res) => {
    try {
        const { items, contact_name, contact_email, contact_phone, contact_info } = req.body;

        if (!items || items.length === 0) {
            return res.status(400).json({ error: 'Debes agregar al menos un producto.' });
        }

        if (!contact_name || !contact_email) {
            return res.status(400).json({ error: 'Nombre y email de contacto son requeridos.' });
        }

        // Calculate total and verify stock
        let total = 0;
        for (const item of items) {
            const product = getOne('SELECT price, stock FROM products WHERE id = ? AND is_active = 1', [item.product_id]);

            if (!product) {
                return res.status(400).json({ error: `Producto ${item.product_id} no encontrado.` });
            }

            if (product.stock < item.quantity) {
                return res.status(400).json({ error: `Stock insuficiente para producto ${item.product_id}.` });
            }

            total += product.price * item.quantity;
        }

        // Create order
        const orderId = runQuery(`
      INSERT INTO orders (buyer_id, status, total_amount, contact_name, contact_email, contact_phone, contact_info)
      VALUES (?, 'pending', ?, ?, ?, ?, ?)
    `, [req.user.id, total, contact_name, contact_email, contact_phone || null, contact_info || null]);

        // Add order items and update stock
        for (const item of items) {
            const product = getOne('SELECT price FROM products WHERE id = ?', [item.product_id]);
            runQuery(`
        INSERT INTO order_items (order_id, product_id, quantity, price)
        VALUES (?, ?, ?, ?)
      `, [orderId, item.product_id, item.quantity, product.price]);

            runQuery('UPDATE products SET stock = stock - ? WHERE id = ?', [item.quantity, item.product_id]);
        }

        res.status(201).json({
            message: 'Orden creada exitosamente. Por favor realiza el pago.',
            order_id: orderId,
            total_amount: total
        });
    } catch (error) {
        console.error('Error creating order:', error);
        res.status(500).json({ error: 'Error al crear orden.' });
    }
});

// Get orders (filtered by role)
router.get('/', authenticateToken, (req, res) => {
    try {
        let query = `
      SELECT o.*, u.email as buyer_email
      FROM orders o
      JOIN users u ON o.buyer_id = u.id
    `;

        const params = [];

        if (req.user.role === 'buyer') {
            query += ' WHERE o.buyer_id = ?';
            params.push(req.user.id);
        } else if (req.user.role === 'seller') {
            query += ' WHERE (o.seller_id = ? OR o.status = \'pending\')';
            params.push(req.user.id);
        }
        // superuser sees all

        query += ' ORDER BY o.created_at DESC';

        const orders = getAll(query, params);

        // Get items for each order
        for (const order of orders) {
            const items = getAll(`
        SELECT oi.*, p.name as product_name
        FROM order_items oi
        JOIN products p ON oi.product_id = p.id
        WHERE oi.order_id = ?
      `, [order.id]);

            order.items = items;
        }

        res.json({ orders });
    } catch (error) {
        console.error('Error fetching orders:', error);
        res.status(500).json({ error: 'Error al obtener órdenes.' });
    }
});

// Get single order
router.get('/:id', authenticateToken, (req, res) => {
    try {
        const order = getOne(`
      SELECT o.*, u.email as buyer_email, s.email as seller_email
      FROM orders o
      JOIN users u ON o.buyer_id = u.id
      LEFT JOIN users s ON o.seller_id = s.id
      WHERE o.id = ?
    `, [req.params.id]);

        if (!order) {
            return res.status(404).json({ error: 'Orden no encontrada.' });
        }

        // Check permissions
        if (req.user.role === 'buyer' && order.buyer_id !== req.user.id) {
            return res.status(403).json({ error: 'No tienes permiso para ver esta orden.' });
        }

        if (req.user.role === 'seller' && order.seller_id !== req.user.id && order.status === 'pending') {
            // Seller can see pending orders
        } else if (req.user.role === 'seller' && order.seller_id !== req.user.id) {
            return res.status(403).json({ error: 'No tienes permiso para ver esta orden.' });
        }

        // Get items
        const items = getAll(`
      SELECT oi.*, p.name as product_name
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = ?
    `, [order.id]);

        order.items = items;

        res.json({ order });
    } catch (error) {
        console.error('Error fetching order:', error);
        res.status(500).json({ error: 'Error al obtener orden.' });
    }
});

// Update order status (sellers and superuser)
router.put('/:id/status', authenticateToken, requireRole('seller', 'superuser'), (req, res) => {
    try {
        const { status, seller_id } = req.body;

        const validStatuses = ['pending', 'processing', 'completed', 'cancelled'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: 'Estado inválido.' });
        }

        const order = getOne('SELECT * FROM orders WHERE id = ?', [req.params.id]);

        if (!order) {
            return res.status(404).json({ error: 'Orden no encontrada.' });
        }

        // Assign seller if taking the order
        if (status === 'processing' && !order.seller_id) {
            runQuery(`
        UPDATE orders SET status = ?, seller_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [status, seller_id || req.user.id, req.params.id]);
        } else {
            runQuery(`
        UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [status, req.params.id]);
        }

        res.json({ message: 'Estado de orden actualizado exitosamente.' });
    } catch (error) {
        console.error('Error updating order status:', error);
        res.status(500).json({ error: 'Error al actualizar estado de orden.' });
    }
});

// Upload payment proof
router.post('/:id/payment-proof', authenticateToken, requireRole('buyer'), (req, res) => {
    try {
        const { payment_proof, binance_txid } = req.body;

        const order = getOne('SELECT * FROM orders WHERE id = ? AND buyer_id = ?', [req.params.id, req.user.id]);

        if (!order) {
            return res.status(404).json({ error: 'Orden no encontrada.' });
        }

        runQuery(`
      UPDATE orders 
      SET payment_proof = ?, binance_txid = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [payment_proof, binance_txid, req.params.id]);

        // Create transaction record
        runQuery(`
      INSERT INTO transactions (order_id, user_id, amount, binance_txid, payment_proof_url, status)
      VALUES (?, ?, ?, ?, ?, 'pending')
    `, [req.params.id, req.user.id, order.total_amount, binance_txid, payment_proof]);

        res.json({ message: 'Comprobante de pago enviado exitosamente.' });
    } catch (error) {
        console.error('Error uploading payment proof:', error);
        res.status(500).json({ error: 'Error al enviar comprobante de pago.' });
    }
});

export default router;
