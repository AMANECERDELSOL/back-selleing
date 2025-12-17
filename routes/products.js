import express from 'express';
import { getAll, getOne, runQuery } from '../database/db.js';
import { authenticateToken, requireSuperuser } from '../middleware/auth.js';

const router = express.Router();

// Get all products (with optional category filter)
router.get('/', (req, res) => {
    try {
        const { category } = req.query;

        let query = `
      SELECT p.*, c.name as category_name
      FROM products p
      JOIN categories c ON p.category_id = c.id
      WHERE p.is_active = 1
    `;

        const params = [];

        if (category) {
            query += ' AND c.id = ?';
            params.push(category);
        }

        query += ' ORDER BY p.created_at DESC';

        const products = getAll(query, params);

        res.json({ products });
    } catch (error) {
        console.error('Error fetching products:', error);
        res.status(500).json({ error: 'Error al obtener productos.' });
    }
});

// Get single product
router.get('/:id', (req, res) => {
    try {
        const product = getOne(`
      SELECT p.*, c.name as category_name
      FROM products p
      JOIN categories c ON p.category_id = c.id
      WHERE p.id = ? AND p.is_active = 1
    `, [req.params.id]);

        if (!product) {
            return res.status(404).json({ error: 'Producto no encontrado.' });
        }

        res.json({ product });
    } catch (error) {
        console.error('Error fetching product:', error);
        res.status(500).json({ error: 'Error al obtener producto.' });
    }
});

// Get all categories
router.get('/categories/all', (req, res) => {
    try {
        const categories = getAll('SELECT * FROM categories ORDER BY name');
        res.json({ categories });
    } catch (error) {
        console.error('Error fetching categories:', error);
        res.status(500).json({ error: 'Error al obtener categorías.' });
    }
});

// Create product (superuser only)
router.post('/', authenticateToken, requireSuperuser, (req, res) => {
    try {
        const { name, description, price, stock, category_id, image_url } = req.body;

        if (!name || !price || !category_id) {
            return res.status(400).json({ error: 'Nombre, precio y categoría son requeridos.' });
        }

        const productId = runQuery(`
      INSERT INTO products (name, description, price, stock, category_id, image_url)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [name, description, price, stock || 0, category_id, image_url]);

        res.status(201).json({
            message: 'Producto creado exitosamente.',
            product: { id: productId, ...req.body }
        });
    } catch (error) {
        console.error('Error creating product:', error);
        res.status(500).json({ error: 'Error al crear producto.' });
    }
});

// Update product (superuser only)
router.put('/:id', authenticateToken, requireSuperuser, (req, res) => {
    try {
        const { name, description, price, stock, category_id, image_url, is_active } = req.body;

        runQuery(`
      UPDATE products
      SET name = ?, description = ?, price = ?, stock = ?, category_id = ?, 
          image_url = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [name, description, price, stock, category_id, image_url, is_active ? 1 : 0, req.params.id]);

        res.json({ message: 'Producto actualizado exitosamente.' });
    } catch (error) {
        console.error('Error updating product:', error);
        res.status(500).json({ error: 'Error al actualizar producto.' });
    }
});

// Delete product (superuser only) - soft delete
router.delete('/:id', authenticateToken, requireSuperuser, (req, res) => {
    try {
        runQuery('UPDATE products SET is_active = 0 WHERE id = ?', [req.params.id]);

        res.json({ message: 'Producto eliminado exitosamente.' });
    } catch (error) {
        console.error('Error deleting product:', error);
        res.status(500).json({ error: 'Error al eliminar producto.' });
    }
});

export default router;
