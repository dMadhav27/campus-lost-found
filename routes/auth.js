const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { pool } = require('../config/database');
const { authenticateToken, validateInput } = require('../middleware/auth');

const router = express.Router();

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

// Approved email domains for student verification
const APPROVED_DOMAINS = ['college.edu', 'university.edu', 'school.ac.in', 'student.edu'];

// Helper function to validate email domain
function isValidStudentEmail(email) {
    const domain = email.split('@')[1];
    return APPROVED_DOMAINS.includes(domain);
}

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

// @route   POST /api/auth/signup
// @desc    Register new student
// @access  Public
router.post('/signup', authLimiter, validateInput(['studentId', 'email', 'password', 'firstName', 'lastName']), async (req, res) => {
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

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid email format'
            });
        }

        // Validate email domain (commented out for development)
        // if (!isValidStudentEmail(email)) {
        //     return res.status(400).json({
        //         success: false,
        //         error: 'Please use your official college email address'
        //     });
        // }

        // Validate password strength
        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                error: 'Password must be at least 6 characters long'
            });
        }

        // Check if user already exists
        const [existingUsers] = await pool.execute(
            'SELECT user_id FROM users WHERE email = ? OR student_id = ?',
            [email, studentId]
        );

        if (existingUsers.length > 0) {
            return res.status(400).json({
                success: false,
                error: 'Student ID or email already registered'
            });
        }

        // Hash password
        const saltRounds = 12;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        // Insert new user
        const [result] = await pool.execute(`
            INSERT INTO users (student_id, email, password_hash, first_name, last_name, phone, department, year_of_study)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [studentId, email, passwordHash, firstName, lastName, phone || null, department || null, yearOfStudy || null]);

        // Get the created user
        const [newUser] = await pool.execute(
            'SELECT user_id, student_id, email, first_name, last_name, role FROM users WHERE user_id = ?',
            [result.insertId]
        );

        // Generate JWT token
        const token = generateToken(newUser[0]);

        console.log(`✅ New user registered: ${email}`);

        res.status(201).json({
            success: true,
            message: 'Registration successful!',
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
        
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({
                success: false,
                error: 'Student ID or email already registered'
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

        // Check if account is verified
        if (!user.is_verified) {
            return res.status(401).json({
                success: false,
                error: 'Account not verified. Please contact administrator.'
            });
        }

        // Verify password
        const isPasswordValid = await bcrypt.compare(password, user.password_hash);

        if (!isPasswordValid) {
            return res.status(401).json({
                success: false,
                error: 'Invalid email or password'
            });
        }

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
    // In a stateless JWT setup, logout is handled client-side
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