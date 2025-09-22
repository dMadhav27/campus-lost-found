// migration-add-proof-fields.js
// Run: node migration-add-proof-fields.js

const mysql = require('mysql2/promise');
require('dotenv').config();

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'madhav2711',
    database: process.env.DB_NAME || 'campus_lost_found',
};

async function addProofFields() {
    let connection;
    
    try {
        connection = await mysql.createConnection(dbConfig);
        console.log('🔄 Adding proof fields to claims table...');

        // Check current table structure
        const [columns] = await connection.execute(`
            SELECT COLUMN_NAME 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'claims'
        `, [dbConfig.database]);
        
        const existingColumns = columns.map(col => col.COLUMN_NAME);
        
        // Add proof fields if they don't exist
        if (!existingColumns.includes('aadhar_proof')) {
            await connection.execute(`
                ALTER TABLE claims 
                ADD COLUMN aadhar_proof VARCHAR(255) DEFAULT NULL AFTER verification_answers
            `);
            console.log('✅ Added aadhar_proof column');
        }
        
        if (!existingColumns.includes('proof_verified')) {
            await connection.execute(`
                ALTER TABLE claims 
                ADD COLUMN proof_verified BOOLEAN DEFAULT FALSE AFTER aadhar_proof
            `);
            console.log('✅ Added proof_verified column');
        }

        // Update claim_status enum to include new statuses
        await connection.execute(`
            ALTER TABLE claims 
            MODIFY COLUMN claim_status ENUM(
                'pending_verification', 
                'awaiting_proof', 
                'proof_submitted', 
                'proof_verified',
                'approved', 
                'rejected', 
                'completed'
            ) DEFAULT 'pending_verification'
        `);
        console.log('✅ Updated claim_status enum');

        console.log('\n🎉 Proof fields migration completed!');
        
    } catch (error) {
        console.error('❌ Migration failed:', error);
    } finally {
        if (connection) {
            await connection.end();
        }
    }
}

addProofFields();