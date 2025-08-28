const mysql = require('mysql2/promise');
require('dotenv').config();

// Database configuration
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'madhav2711',
    database: process.env.DB_NAME || 'campus_lost_found',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

// Create connection pool
const pool = mysql.createPool(dbConfig);

// Initialize database tables
async function initializeDatabase() {
    try {
        console.log('🔄 Initializing database...');
        
        // Create users table
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS users (
                user_id INT PRIMARY KEY AUTO_INCREMENT,
                student_id VARCHAR(20) UNIQUE NOT NULL,
                email VARCHAR(100) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                first_name VARCHAR(50) NOT NULL,
                last_name VARCHAR(50) NOT NULL,
                phone VARCHAR(15),
                department VARCHAR(100),
                year_of_study INT,
                is_verified BOOLEAN DEFAULT TRUE,
                role ENUM('student', 'admin') DEFAULT 'student',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_email (email),
                INDEX idx_student_id (student_id)
            )
        `);

        // Create items table (for future use)
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS items (
                item_id INT PRIMARY KEY AUTO_INCREMENT,
                reporter_id INT NOT NULL,
                type ENUM('lost', 'found') NOT NULL,
                status ENUM('active', 'claimed', 'returned', 'closed') DEFAULT 'active',
                title VARCHAR(100) NOT NULL,
                description TEXT NOT NULL,
                category VARCHAR(50) NOT NULL,
                location VARCHAR(100) NOT NULL,
                date_lost_found DATE NOT NULL,
                contact_info TEXT,
                verification_questions JSON,
                images JSON,
                is_verified BOOLEAN DEFAULT FALSE,
                admin_notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (reporter_id) REFERENCES users(user_id) ON DELETE CASCADE,
                INDEX idx_type_status (type, status),
                INDEX idx_created_at (created_at)
            )
        `);

        console.log('✅ Database tables initialized successfully');
        
        // Create demo admin user
        await createDemoUsers();
        
    } catch (error) {
        console.error('❌ Error initializing database:', error);
        throw error;
    }
}

// Create demo users for testing
async function createDemoUsers() {
    try {
        const bcrypt = require('bcryptjs');
        
        // Check if demo users already exist
        const [existingUsers] = await pool.execute('SELECT COUNT(*) as count FROM users');
        
        if (existingUsers[0].count === 0) {
            console.log('🔄 Creating demo users...');
            
            // Create demo student
            const studentPassword = await bcrypt.hash('student123', 12);
            await pool.execute(`
                INSERT INTO users (student_id, email, password_hash, first_name, last_name, phone, department, year_of_study, role)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, ['STU001', 'student@college.edu', studentPassword, 'John', 'Doe', '+1234567890', 'Computer Science', 3, 'student']);
            
            // Create demo admin
            const adminPassword = await bcrypt.hash('admin123', 12);
            await pool.execute(`
                INSERT INTO users (student_id, email, password_hash, first_name, last_name, phone, department, year_of_study, role)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, ['ADM001', 'admin@college.edu', adminPassword, 'Admin', 'User', '+1234567891', 'Administration', 0, 'admin']);
            
            console.log('✅ Demo users created successfully');
            console.log('📝 Demo Credentials:');
            console.log('   Student: student@college.edu / student123');
            console.log('   Admin: admin@college.edu / admin123');
        }
    } catch (error) {
        if (!error.message.includes('Duplicate entry')) {
            console.error('⚠️  Error creating demo users:', error.message);
        }
    }
}

// Test database connection
async function testConnection() {
    try {
        const connection = await pool.getConnection();
        console.log('✅ Database connected successfully');
        connection.release();
        return true;
    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
        return false;
    }
}

module.exports = {
    pool,
    initializeDatabase,
    testConnection
};