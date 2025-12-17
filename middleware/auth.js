import jwt from 'jsonwebtoken';
import { getOne } from '../database/db.js';

// Verify JWT token
export const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
        return res.status(401).json({ error: 'Acceso denegado. Token no proporcionado.' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Get user from database
        const user = getOne('SELECT id, email, role, earnings FROM users WHERE id = ? AND is_active = 1', [decoded.userId]);

        if (!user) {
            return res.status(401).json({ error: 'Usuario no encontrado o inactivo.' });
        }

        req.user = user;
        next();
    } catch (error) {
        return res.status(403).json({ error: 'Token inválido o expirado.' });
    }
};

// Check if user has required role
export const requireRole = (...allowedRoles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Usuario no autenticado.' });
        }

        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ error: 'No tienes permisos para realizar esta acción.' });
        }

        next();
    };
};

// Specific role middleware
export const requireBuyer = requireRole('buyer');
export const requireSeller = requireRole('seller', 'superuser');
export const requireSuperuser = requireRole('superuser');
