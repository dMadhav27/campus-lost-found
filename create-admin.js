const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'madhav2711',
    database: process.env.DB_NAME || 'campus_lost_found',
};

async function createAdminUser() {
    let connection;
    
    try {
        connection = await mysql.createConnection(dbConfig);
        console.log('🔄 Connected to database...');

        // Check if admin user already exists
        const [existingAdmin] = await connection.execute(
            'SELECT user_id FROM users WHERE email = ?',
            ['admin@college.edu']
        );

        if (existingAdmin.length > 0) {
            console.log('✅ Admin user already exists');
            
            // Update password to make sure it's correct
            const adminPassword = await bcrypt.hash('admin123', 12);
            await connection.execute(
                'UPDATE users SET password_hash = ?, role = ?, is_verified = 1 WHERE email = ?',
                [adminPassword, 'admin', 'admin@college.edu']
            );
            console.log('✅ Admin password updated');
        } else {
            // Create new admin user
            console.log('🔄 Creating new admin user...');
            
            const adminPassword = await bcrypt.hash('admin123', 12);
            
            await connection.execute(`
                INSERT INTO users (
                    student_id, email, password_hash, first_name, last_name, 
                    phone, department, year_of_study, role, is_verified
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                'ADM001',
                'admin@college.edu', 
                adminPassword,
                'Admin',
                'User',
                '+1234567891',
                'Administration',
                0,
                'admin',
                1
            ]);
            
            console.log('✅ Admin user created successfully');
        }

        // Also check/create the demo student
        const [existingStudent] = await connection.execute(
            'SELECT user_id FROM users WHERE email = ?',
            ['student@college.edu']
        );

        if (existingStudent.length === 0) {
            console.log('🔄 Creating demo student user...');
            
            const studentPassword = await bcrypt.hash('student123', 12);
            
            await connection.execute(`
                INSERT INTO users (
                    student_id, email, password_hash, first_name, last_name, 
                    phone, department, year_of_study, role, is_verified
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                'STU001',
                'student@college.edu',
                studentPassword,
                'John',
                'Doe',
                '+1234567890',
                'Computer Science',
                3,
                'student',
                1
            ]);
            
            console.log('✅ Demo student user created successfully');
        }

        console.log('\n🎉 All demo users are ready!');
        console.log('📝 Login Credentials:');
        console.log('   👤 Admin: admin@college.edu / admin123');
        console.log('   👤 Student: student@college.edu / student123');
        console.log('\n🚀 You can now login with these credentials!');

    } catch (error) {
        console.error('❌ Error creating admin user:', error);
    } finally {
        if (connection) {
            await connection.end();
        }
    }
}

createAdminUser();