// migration-add-documents.js
// Run this script to add document fields to existing users table
// Usage: node migration-add-documents.js

const mysql = require('mysql2/promise');
require('dotenv').config();

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'madhav2711',
    database: process.env.DB_NAME || 'campus_lost_found',
};

async function addDocumentFields() {
    let connection;
    
    try {
        connection = await mysql.createConnection(dbConfig);
        console.log('🔄 Connected to database for migration...');

        // Check current table structure
        const [columns] = await connection.execute(`
            SELECT COLUMN_NAME 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users'
            ORDER BY ORDINAL_POSITION
        `, [dbConfig.database]);
        
        console.log('📋 Current users table columns:');
        const existingColumns = columns.map(col => col.COLUMN_NAME);
        existingColumns.forEach(col => console.log('  -', col));

        // Add missing document columns
        if (!existingColumns.includes('fee_receipt')) {
            await connection.execute('ALTER TABLE users ADD COLUMN fee_receipt VARCHAR(255) DEFAULT NULL AFTER profile_image');
            console.log('✅ Added fee_receipt column');
        } else {
            console.log('⚠️  fee_receipt column already exists');
        }
        
        if (!existingColumns.includes('aadhar_card')) {
            await connection.execute('ALTER TABLE users ADD COLUMN aadhar_card VARCHAR(255) DEFAULT NULL AFTER fee_receipt');
            console.log('✅ Added aadhar_card column');
        } else {
            console.log('⚠️  aadhar_card column already exists');
        }
        
        if (!existingColumns.includes('student_id_card')) {
            await connection.execute('ALTER TABLE users ADD COLUMN student_id_card VARCHAR(255) DEFAULT NULL AFTER aadhar_card');
            console.log('✅ Added student_id_card column');
        } else {
            console.log('⚠️  student_id_card column already exists');
        }

        console.log('\n🎉 Migration completed successfully!');
        console.log('✅ Users table now supports document uploads');
        
    } catch (error) {
        console.error('❌ Migration failed:', error);
    } finally {
        if (connection) {
            await connection.end();
        }
    }
}

// Run the migration
addDocumentFields();