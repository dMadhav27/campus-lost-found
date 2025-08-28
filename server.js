const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

// Import configurations and routes
const { initializeDatabase, testConnection } = require('./config/database');
const authRoutes = require('./routes/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "blob:"],
        },
    },
}));

// CORS configuration
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: {
        success: false,
        error: 'Too many requests, please try again later.'
    }
});
app.use(generalLimiter);

// Static files middleware
app.use(express.static('public'));
app.use('/views', express.static('views'));

// Routes
app.use('/api/auth', authRoutes);

// Serve HTML files
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

app.get('/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

app.get('/signup.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'signup.html'));
});

app.get('/dashboard.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

// API health check
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        message: 'Campus Lost & Found API is running!',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// 404 handler for API routes
app.use('/api/*', (req, res) => {
    res.status(404).json({
        success: false,
        error: 'API route not found'
    });
});

// 404 handler for other routes
app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, 'views', 'index.html'));
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Global error:', err);
    
    res.status(err.status || 500).json({
        success: false,
        error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
    });
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🔄 SIGTERM received, shutting down gracefully...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('🔄 SIGINT received, shutting down gracefully...');
    process.exit(0);
});

// Start server
async function startServer() {
    try {
        // Test database connection
        console.log('🔄 Testing database connection...');
        const dbConnected = await testConnection();
        
        if (!dbConnected) {
            console.error('❌ Failed to connect to database. Please check your configuration.');
            process.exit(1);
        }

        // Initialize database
        await initializeDatabase();

        // Start HTTP server
        app.listen(PORT, () => {
            console.log('\n🚀 Campus Lost & Found Server Started!');
            console.log('═══════════════════════════════════════');
            console.log(`📍 Server running on: http://localhost:${PORT}`);
            console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
            console.log(`💾 Database: ${process.env.DB_NAME || 'campus_lost_found'}`);
            console.log('\n📄 Available Pages:');
            console.log(`   🏠 Home: http://localhost:${PORT}/`);
            console.log(`   🔐 Login: http://localhost:${PORT}/login.html`);
            console.log(`   📝 Signup: http://localhost:${PORT}/signup.html`);
            console.log(`   📊 Dashboard: http://localhost:${PORT}/dashboard.html`);
            console.log('\n🔧 API Endpoints:');
            console.log(`   ❤️  Health Check: http://localhost:${PORT}/api/health`);
            console.log(`   🔑 Auth Test: http://localhost:${PORT}/api/auth/test`);
            console.log('═══════════════════════════════════════\n');
        });

    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

// Initialize server
startServer();