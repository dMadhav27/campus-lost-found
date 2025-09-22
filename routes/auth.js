const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { pool } = require('../config/database');
const { authenticateToken, validateInput } = require('../middleware/auth');

const router = express.Router();

// Create documents directory if it doesn't exist
const documentsDir = path.join(__dirname, '..', 'public', 'documents');
if (!fs.existsSync(documentsDir)) {
    fs.mkdirSync(documentsDir, { recursive: true });
    console.log('📁 Created documents directory');
}

// Configure multer for document uploads
const documentStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, documentsDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        let prefix = '';
        
        switch (file.fieldname) {
            case 'feeReceipt':
                prefix = 'fee-receipt';
                break;
            case 'aadharCard':
                prefix = 'aadhar';
                break;
            case 'studentIdCard':
                prefix = 'student-id';
                break;
            default:
                prefix = 'document';
        }
        
        cb(null, `${prefix}-${uniqueSuffix}${ext}`);
    }
});

const documentUpload = multer({
    storage: documentStorage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
    },
    fileFilter: (req, file, cb) => {
    if (file.fieldname === 'studentIdCard') {
        // Only images for student ID card
        const allowedTypes = /jpeg|jpg|png/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (mimetype && extname) {
            cb(null, true);
        } else {
            cb(new Error('Student ID card must be JPG, JPEG, or PNG file'), false);
        }
    } else {
        cb(new Error('Invalid file field'), false);
    }
}
});

// Rate limiting for auth endpoints
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // limit each IP to 5 requests per windowMs
    message: {
        success: false,
        error: 'Too many authentication attempts, please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// Helper function to generate JWT token
function generateToken(user) {
    return jwt.sign(
        { 
            userId: user.user_id,
            email: user.email,
            role: user.role
        },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
    );
}

// Helper function to clean up uploaded files
function cleanupFiles(files) {
    Object.values(files).forEach(fileArray => {
        if (Array.isArray(fileArray)) {
            fileArray.forEach(file => {
                if (file && file.path && fs.existsSync(file.path)) {
                    fs.unlinkSync(file.path);
                }
            });
        }
    });
}

// @route   POST /api/auth/signup
// @desc    Register new student with document verification
// @access  Public
router.post('/signup', authLimiter, documentUpload.fields([
    
    { name: 'studentIdCard', maxCount: 1 }
]), async (req, res) => {
    try {
        const {
            studentId,
            email,
            password,
            firstName,
            lastName,
            phone,
            department,
            yearOfStudy
        } = req.body;

        // Validate required fields
        const requiredFields = ['studentId', 'email', 'password', 'firstName', 'lastName'];
        for (const field of requiredFields) {
            if (!req.body[field] || req.body[field].trim() === '') {
                cleanupFiles(req.files || {});
                return res.status(400).json({
                    success: false,
                    error: `${field.charAt(0).toUpperCase() + field.slice(1)} is required`
                });
            }
        }

        // Validate document uploads
        if (!req.files || !req.files.studentIdCard) {
            cleanupFiles(req.files || {});
            return res.status(400).json({
                success: false,
                error: 'Student ID Required'
            });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            cleanupFiles(req.files);
            return res.status(400).json({
                success: false,
                error: 'Invalid email format'
            });
        }

        // Validate password strength
        if (password.length < 6) {
            cleanupFiles(req.files);
            return res.status(400).json({
                success: false,
                error: 'Password must be at least 6 characters long'
            });
        }

        const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/;
        if (!passwordRegex.test(password)) {
            cleanupFiles(req.files);
            return res.status(400).json({
                success: false,
                error: 'Password must contain at least one uppercase letter, one lowercase letter, and one number'
            });
        }

        // Check if user already exists
        const [existingUsers] = await pool.execute(
            'SELECT user_id FROM users WHERE email = ? OR student_id = ?',
            [email, studentId]
        );

        if (existingUsers.length > 0) {
            cleanupFiles(req.files);
            return res.status(400).json({
                success: false,
                error: 'Student ID or email already registered'
            });
        }

        // Hash password
        const password_hash = password;

        // Get file paths
const studentIdCardPath = req.files && req.files.studentIdCard ? 
    `/documents/${req.files.studentIdCard[0].filename}` : null;
        // Insert new user with documents
        const [result] = await pool.execute(`
    INSERT INTO users (
        student_id, email, password_hash, first_name, last_name, phone, 
        department, year_of_study, student_id_card
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`, [
    studentId, email, password_hash, firstName, lastName, phone || null, 
    department || null, yearOfStudy || null, studentIdCardPath
]);

        // Get the created user
        const [newUser] = await pool.execute(
            'SELECT user_id, student_id, email, first_name, last_name, role, is_verified FROM users WHERE user_id = ?',
            [result.insertId]
        );

        // Generate JWT token
        const token = generateToken(newUser[0]);

        console.log(`✅ New user registered: ${email}`);

        res.status(201).json({
            success: true,
            message: 'Registration successful! Your account has been created with document verification.',
            token,
            user: {
                id: newUser[0].user_id,
                studentId: newUser[0].student_id,
                email: newUser[0].email,
                firstName: newUser[0].first_name,
                lastName: newUser[0].last_name,
                role: newUser[0].role
            }
        });

    } catch (error) {
        console.error('Registration error:', error);
        
        // Clean up uploaded files on error
        if (req.files) {
            cleanupFiles(req.files);
        }
        
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({
                success: false,
                error: 'Student ID or email already registered'
            });
        }

        if (error.message.includes('must be a PDF') || error.message.includes('must be JPG')) {
            return res.status(400).json({
                success: false,
                error: error.message
            });
        }

        res.status(500).json({
            success: false,
            error: 'Registration failed. Please try again.'
        });
    }
});

// @route   POST /api/auth/login
// @desc    Login user
// @access  Public
router.post('/login', authLimiter, validateInput(['email', 'password']), async (req, res) => {
    try {
        const { email, password } = req.body;

        // Find user by email
        const [users] = await pool.execute(
            'SELECT user_id, email, password_hash, first_name, last_name, role, is_verified FROM users WHERE email = ?',
            [email]
        );

        if (users.length === 0) {
            return res.status(401).json({
                success: false,
                error: 'Invalid email or password'
            });
        }

        const user = users[0];

        // Verify password
if (password !== user.password_hash) {
    return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
    });
}

        // Check if account is verified
        if (!user.is_verified) {
            return res.status(401).json({
                success: false,
                error: 'Account not verified. Please contact administrator.'
            });
        }

        // Update last login
        await pool.execute(
            'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE user_id = ?',
            [user.user_id]
        );

        // Generate JWT token
        const token = generateToken(user);

        console.log(`✅ User logged in: ${email}`);

        res.json({
            success: true,
            message: 'Login successful!',
            token,
            user: {
                id: user.user_id,
                email: user.email,
                firstName: user.first_name,
                lastName: user.last_name,
                role: user.role
            }
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            success: false,
            error: 'Login failed. Please try again.'
        });
    }
});

// @route   GET /api/auth/me
// @desc    Get current user info
// @access  Private
router.get('/me', authenticateToken, (req, res) => {
    res.json({
        success: true,
        user: {
            id: req.user.user_id,
            email: req.user.email,
            firstName: req.user.first_name,
            lastName: req.user.last_name,
            role: req.user.role
        }
    });
});

// @route   POST /api/auth/logout
// @desc    Logout user (client-side token removal)
// @access  Private
router.post('/logout', authenticateToken, (req, res) => {
    console.log(`✅ User logged out: ${req.user.email}`);
    
    res.json({
        success: true,
        message: 'Logout successful'
    });
});

// @route   GET /api/auth/test
// @desc    Test route
// @access  Public
router.get('/test', (req, res) => {
    res.json({
        success: true,
        message: 'Auth routes working!',
        timestamp: new Date().toISOString()
    });
});

module.exports = router;