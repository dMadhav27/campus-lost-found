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

        // Create items table with proper structure
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS items (
                item_id INT PRIMARY KEY AUTO_INCREMENT,
                reporter_id INT NOT NULL,
                type ENUM('lost', 'found') NOT NULL,
                status ENUM('active', 'claimed', 'returned', 'closed') DEFAULT 'active',
                title VARCHAR(100) NOT NULL,
                description TEXT NOT NULL,
                category VARCHAR(50),
                location VARCHAR(100) NOT NULL,
                date_lost_found DATE NOT NULL,
                time_lost_found TIME,
                contact_info JSON,
                verification_questions JSON,
                reward_amount DECIMAL(10,2) DEFAULT 0.00,
                images JSON,
                is_verified BOOLEAN DEFAULT FALSE,
                admin_notes TEXT,
                view_count INT DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (reporter_id) REFERENCES users(user_id) ON DELETE CASCADE,
                INDEX idx_type_status (type, status),
                INDEX idx_reporter (reporter_id),
                INDEX idx_verified (is_verified),
                INDEX idx_created_at (created_at)
            )
        `);

        // Check if we need to add missing columns to existing items table
        try {
            const [columns] = await pool.execute(`
                SELECT COLUMN_NAME 
                FROM INFORMATION_SCHEMA.COLUMNS 
                WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'items'
            `, [process.env.DB_NAME || 'campus_lost_found']);
            
            const existingColumns = columns.map(col => col.COLUMN_NAME);
            
            // Add missing columns if they don't exist
            if (!existingColumns.includes('time_lost_found')) {
                await pool.execute('ALTER TABLE items ADD COLUMN time_lost_found TIME');
                console.log('✅ Added time_lost_found column');
            }
            
            if (!existingColumns.includes('reward_amount')) {
                await pool.execute('ALTER TABLE items ADD COLUMN reward_amount DECIMAL(10,2) DEFAULT 0.00');
                console.log('✅ Added reward_amount column');
            }
            
            if (!existingColumns.includes('view_count')) {
                await pool.execute('ALTER TABLE items ADD COLUMN view_count INT DEFAULT 0');
                console.log('✅ Added view_count column');
            }
            
        } catch (alterError) {
            console.log('⚠️  Could not alter table (might be first run):', alterError.message);
        }

        // Create optional tables for categories and locations (for future use)
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS categories (
                category_id INT PRIMARY KEY AUTO_INCREMENT,
                name VARCHAR(50) UNIQUE NOT NULL,
                description TEXT,
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await pool.execute(`
            CREATE TABLE IF NOT EXISTS locations (
                location_id INT PRIMARY KEY AUTO_INCREMENT,
                name VARCHAR(100) UNIQUE NOT NULL,
                description TEXT,
                building VARCHAR(50),
                floor VARCHAR(10),
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Insert default categories if table is empty
        const [categoryCount] = await pool.execute('SELECT COUNT(*) as count FROM categories');
        if (categoryCount[0].count === 0) {
            const defaultCategories = [
                'Electronics',
                'Books & Stationery', 
                'Clothing & Accessories',
                'Bags & Backpacks',
                'Keys & Cards',
                'Sports Equipment',
                'Jewelry & Watches',
                'Documents',
                'Other'
            ];
            
            for (const category of defaultCategories) {
                await pool.execute(
                    'INSERT INTO categories (name) VALUES (?)',
                    [category]
                );
            }
            console.log('✅ Default categories inserted');
        }

        // Insert default locations if table is empty
        const [locationCount] = await pool.execute('SELECT COUNT(*) as count FROM locations');
        if (locationCount[0].count === 0) {
            const defaultLocations = [
                { name: 'Main Library', building: 'Library Building' },
                { name: 'Computer Lab 1', building: 'CS Building' },
                { name: 'Computer Lab 2', building: 'CS Building' },
                { name: 'Cafeteria', building: 'Student Center' },
                { name: 'Gym/Sports Complex', building: 'Sports Building' },
                { name: 'Student Center', building: 'Student Center' },
                { name: 'Lecture Hall A', building: 'Academic Building' },
                { name: 'Lecture Hall B', building: 'Academic Building' },
                { name: 'Parking Lot', building: 'Outdoor' },
                { name: 'Dormitory', building: 'Residential' },
                { name: 'Admin Building', building: 'Administration' },
                { name: 'Other', building: 'Various' }
            ];
            
            for (const location of defaultLocations) {
                await pool.execute(
                    'INSERT INTO locations (name, building) VALUES (?, ?)',
                    [location.name, location.building]
                );
            }
            console.log('✅ Default locations inserted');
        }

        console.log('✅ Database tables initialized successfully');
        
        // Create demo admin user
        await createDemoUsers();
        
    } catch (error) {
        console.error('❌ Error initializing database:', error);
        throw error;
    }
}

// Create demo users for testing
// Create demo users for testing
async function createDemoUsers() {
    try {
        const bcrypt = require('bcryptjs');
        
        // Check if demo users already exist
        const [existingUsers] = await pool.execute('SELECT COUNT(*) as count FROM users');
        
        if (existingUsers[0].count === 0) {
            console.log('🔄 Creating demo users...');
            
            // Create demo student
const studentPassword = 'student123';
            await pool.execute(`
                INSERT INTO users (student_id, email, password_hash, first_name, last_name, phone, department, year_of_study, role, is_verified)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, ['STU001', 'student@college.edu', studentPassword, 'John', 'Doe', '+1234567890', 'Computer Science', 3, 'student', 1]);
            
            // Create demo admin - FIXED PASSWORD TO MATCH LOGIN FORM
            const adminPassword = 'admin123';
            await pool.execute(`
                INSERT INTO users (student_id, email, password_hash, first_name, last_name, phone, department, year_of_study, role, is_verified)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, ['ADM001', 'admin@college.edu', adminPassword, 'Admin', 'User', '+1234567891', 'Administration', 0, 'admin', 1]);
            
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