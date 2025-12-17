import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getOne, runQuery } from '../database/db.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Register new buyer (only buyers can self-register)
router.post('/register', async (req, res) => {
    try {
        const { email, password, binance_wallet } = req.body;

        // Validation
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

        // Insert new buyer
        const userId = runQuery(`
      INSERT INTO users (email, password, role, binance_wallet)
      VALUES (?, ?, 'buyer', ?)
    `, [email, hashedPassword, binance_wallet || null]);

        // Generate token
        const token = jwt.sign(
            { userId, role: 'buyer' },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.status(201).json({
            message: 'Usuario registrado exitosamente.',
            token,
            user: {
                id: userId,
                email,
                role: 'buyer'
            }
        });
    } catch (error) {
        console.error('Error en registro:', error);
        res.status(500).json({ error: 'Error al registrar usuario.' });
    }
});

// Login (all user types)
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Validation
        if (!email || !password) {
            return res.status(400).json({ error: 'Email y contraseña son requeridos.' });
        }

        // Get user
        const user = getOne('SELECT * FROM users WHERE email = ? AND is_active = 1', [email]);

        if (!user) {
            return res.status(401).json({ error: 'Credenciales inválidas.' });
        }

        // Verify password
        const validPassword = await bcrypt.compare(password, user.password);

        if (!validPassword) {
            return res.status(401).json({ error: 'Credenciales inválidas.' });
        }

        // Generate token
        const token = jwt.sign(
            { userId: user.id, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            message: 'Login exitoso.',
            token,
            user: {
                id: user.id,
                email: user.email,
                role: user.role,
                earnings: user.earnings
            }
        });
    } catch (error) {
        console.error('Error en login:', error);
        res.status(500).json({ error: 'Error al iniciar sesión.' });
    }
});

// Get current user
router.get('/me', authenticateToken, (req, res) => {
    res.json({
        user: req.user
    });
});

export default router;
