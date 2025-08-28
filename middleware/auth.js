const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');

// Middleware to authenticate JWT token
const authenticateToken = async (req, res, next) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
        
        if (!token) {
            return res.status(401).json({ 
                success: false, 
                error: 'Access token required' 
            });
        }
        
        // Verify JWT token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Get user from database
        const [rows] = await pool.execute(
            'SELECT user_id, email, first_name, last_name, role, is_verified FROM users WHERE user_id = ?',
            [decoded.userId]
        );
        
        if (rows.length === 0) {
            return res.status(401).json({ 
                success: false, 
                error: 'Invalid token - user not found' 
            });
        }
        
        const user = rows[0];
        
        // Check if user is verified
        if (!user.is_verified) {
            return res.status(401).json({ 
                success: false, 
                error: 'Account not verified' 
            });
        }
        
        // Add user to request object
        req.user = user;
        next();
        
    } catch (error) {
        console.error('Token verification error:', error);
        
        if (error.name === 'TokenExpiredError') {
            return res.status(403).json({ 
                success: false, 
                error: 'Token has expired' 
            });
        }
        
        if (error.name === 'JsonWebTokenError') {
            return res.status(403).json({ 
                success: false, 
                error: 'Invalid token' 
            });
        }
        
        return res.status(500).json({ 
            success: false, 
            error: 'Token verification failed' 
        });
    }
};

// Middleware to check admin role
const requireAdmin = (req, res, next) => {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ 
            success: false, 
            error: 'Admin access required' 
        });
    }
    next();
};

// Middleware to validate input
const validateInput = (requiredFields) => {
    return (req, res, next) => {
        const missingFields = [];
        
        for (const field of requiredFields) {
            if (!req.body[field]) {
                missingFields.push(field);
            }
        }
        
        if (missingFields.length > 0) {
            return res.status(400).json({
                success: false,
                error: `Missing required fields: ${missingFields.join(', ')}`
            });
        }
        
        next();
    };
};

module.exports = {
    authenticateToken,
    requireAdmin,
    validateInput
};