// migration-add-claims.js
// Run this script to add claims and notifications tables
// Usage: node migration-add-claims.js

const mysql = require('mysql2/promise');
require('dotenv').config();

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'madhav2711',
    database: process.env.DB_NAME || 'campus_lost_found',
};

async function addClaimsSystem() {
    let connection;
    
    try {
        connection = await mysql.createConnection(dbConfig);
        console.log('🔄 Connected to database for claims migration...');

        // Create claims table
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS claims (
                claim_id INT PRIMARY KEY AUTO_INCREMENT,
                item_id INT NOT NULL,
                claimant_id INT NOT NULL,
                claimant_answers JSON NOT NULL,
                status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
                admin_notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                
                FOREIGN KEY (item_id) REFERENCES items(item_id) ON DELETE CASCADE,
                FOREIGN KEY (claimant_id) REFERENCES users(user_id) ON DELETE CASCADE,
                
                INDEX idx_item_id (item_id),
                INDEX idx_claimant_id (claimant_id),
                INDEX idx_status (status),
                INDEX idx_created_at (created_at),
                
                UNIQUE KEY unique_claim (item_id, claimant_id)
            )
        `);
        console.log('✅ Created claims table');

        // Create notifications table
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS notifications (
                notification_id INT PRIMARY KEY AUTO_INCREMENT,
                user_id INT NOT NULL,
                type ENUM('claim_submitted', 'claim_approved', 'claim_rejected', 'item_claimed') NOT NULL,
                title VARCHAR(255) NOT NULL,
                message TEXT NOT NULL,
                item_id INT,
                claim_id INT,
                is_read BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                
                FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
                FOREIGN KEY (item_id) REFERENCES items(item_id) ON DELETE SET NULL,
                FOREIGN KEY (claim_id) REFERENCES claims(claim_id) ON DELETE SET NULL,
                
                INDEX idx_user_id (user_id),
                INDEX idx_type (type),
                INDEX idx_is_read (is_read),
                INDEX idx_created_at (created_at)
            )
        `);
        console.log('✅ Created notifications table');

        console.log('\n🎉 Claims system migration completed successfully!');
        console.log('✅ Users can now claim items and receive notifications');
        
    } catch (error) {
        console.error('❌ Claims migration failed:', error);
    } finally {
        if (connection) {
            await connection.end();
        }
    }
}

// Run the migration
addClaimsSystem();