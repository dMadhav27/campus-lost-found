const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'madhav2711',
    database: process.env.DB_NAME || 'campus_lost_found',
};

async function updateAdminUser() {
    let connection;
    
    try {
        connection = await mysql.createConnection(dbConfig);
        console.log('🔄 Connected to database...');

        // Update or create admin user with correct password and role
        const adminPassword = await bcrypt.hash('admin123', 12);
        
        // First, try to update existing admin
        const [updateResult] = await connection.execute(`
            UPDATE users 
            SET password_hash = ?, role = 'admin', is_verified = 1 
            WHERE email = 'admin@college.edu'
        `, [adminPassword]);

        if (updateResult.affectedRows > 0) {
            console.log('✅ Admin user updated successfully');
        } else {
            // If no existing admin, create new one
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

        // Verify the admin user exists with correct role
        const [adminCheck] = await connection.execute(
            'SELECT user_id, email, role, is_verified FROM users WHERE email = ?',
            ['admin@college.edu']
        );

        if (adminCheck.length > 0) {
            console.log('✅ Admin verification:');
            console.log('   Email:', adminCheck[0].email);
            console.log('   Role:', adminCheck[0].role);
            console.log('   Verified:', adminCheck[0].is_verified ? 'Yes' : 'No');
        }

        console.log('\n🎉 Admin user is ready!');
        console.log('📝 Login Credentials:');
        console.log('   Email: admin@college.edu');
        console.log('   Password: admin123');
        console.log('\n🚀 You can now login as admin!');

    } catch (error) {
        console.error('❌ Error updating admin user:', error);
    } finally {
        if (connection) {
            await connection.end();
        }
    }
}

updateAdminUser();