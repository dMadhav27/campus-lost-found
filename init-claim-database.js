// run this script to add claims functionality to your database
// Save this as init-claims-database.js and run: node init-claims-database.js

const mysql = require('mysql2/promise');
require('dotenv').config();

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'madhav2711',
    database: process.env.DB_NAME || 'campus_lost_found',
};

async function initializeClaimsDatabase() {
    let connection;
    
    try {
        connection = await mysql.createConnection(dbConfig);
        console.log('🔄 Connected to database for claims initialization...');

        // Create claims table
        console.log('📋 Creating claims table...');
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS claims (
                claim_id INT PRIMARY KEY AUTO_INCREMENT,
                item_id INT NOT NULL,
                claimant_id INT NOT NULL,
                item_owner_id INT NOT NULL,
                claim_status ENUM('pending_verification', 'awaiting_proof', 'proof_submitted', 'approved', 'rejected', 'completed') DEFAULT 'pending_verification',
                verification_answers JSON,
                proof_documents JSON,
                admin_notes TEXT,
                contact_revealed BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                proof_submitted_at TIMESTAMP NULL,
                approved_at TIMESTAMP NULL,
                completed_at TIMESTAMP NULL,
                
                FOREIGN KEY (item_id) REFERENCES items(item_id) ON DELETE CASCADE,
                FOREIGN KEY (claimant_id) REFERENCES users(user_id) ON DELETE CASCADE,
                FOREIGN KEY (item_owner_id) REFERENCES users(user_id) ON DELETE CASCADE,
                
                INDEX idx_item_id (item_id),
                INDEX idx_claimant_id (claimant_id),
                INDEX idx_item_owner_id (item_owner_id),
                INDEX idx_claim_status (claim_status),
                INDEX idx_created_at (created_at),
                
                UNIQUE KEY unique_user_item_claim (item_id, claimant_id)
            )
        `);
        console.log('✅ Claims table created successfully');

        // Check if claim count columns exist in items table
        const [columns] = await connection.execute(`
            SELECT COLUMN_NAME 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'items'
        `, [dbConfig.database]);
        
        const existingColumns = columns.map(col => col.COLUMN_NAME);
        
        // Add claim count columns if they don't exist
        if (!existingColumns.includes('pending_claims_count')) {
            console.log('📊 Adding pending_claims_count column to items table...');
            await connection.execute('ALTER TABLE items ADD COLUMN pending_claims_count INT DEFAULT 0');
            console.log('✅ Added pending_claims_count column');
        }
        
        if (!existingColumns.includes('total_claims_count')) {
            console.log('📊 Adding total_claims_count column to items table...');
            await connection.execute('ALTER TABLE items ADD COLUMN total_claims_count INT DEFAULT 0');
            console.log('✅ Added total_claims_count column');
        }

        // Create triggers for claim count management
        console.log('🔧 Setting up database triggers...');
        
        // Drop existing triggers if they exist
        try {
            await connection.execute('DROP TRIGGER IF EXISTS update_claim_counts_after_insert');
            await connection.execute('DROP TRIGGER IF EXISTS update_claim_counts_after_update');
            await connection.execute('DROP TRIGGER IF EXISTS update_claim_counts_after_delete');
        } catch (error) {
            // Triggers might not exist, ignore errors
        }

        // Create new triggers
        await connection.execute(`
            CREATE TRIGGER update_claim_counts_after_insert
            AFTER INSERT ON claims
            FOR EACH ROW
            BEGIN
                UPDATE items 
                SET 
                    pending_claims_count = pending_claims_count + 1,
                    total_claims_count = total_claims_count + 1
                WHERE item_id = NEW.item_id;
            END
        `);

        await connection.execute(`
            CREATE TRIGGER update_claim_counts_after_update
            AFTER UPDATE ON claims
            FOR EACH ROW
            BEGIN
                -- If status changed from pending to something else, decrease pending count
                IF OLD.claim_status = 'pending_verification' AND NEW.claim_status != 'pending_verification' THEN
                    UPDATE items 
                    SET pending_claims_count = pending_claims_count - 1
                    WHERE item_id = NEW.item_id;
                END IF;
                
                -- If status changed to pending from something else, increase pending count
                IF OLD.claim_status != 'pending_verification' AND NEW.claim_status = 'pending_verification' THEN
                    UPDATE items 
                    SET pending_claims_count = pending_claims_count + 1
                    WHERE item_id = NEW.item_id;
                END IF;
            END
        `);

        await connection.execute(`
            CREATE TRIGGER update_claim_counts_after_delete
            AFTER DELETE ON claims
            FOR EACH ROW
            BEGIN
                UPDATE items 
                SET 
                    total_claims_count = total_claims_count - 1,
                    pending_claims_count = CASE 
                        WHEN OLD.claim_status = 'pending_verification' THEN pending_claims_count - 1 
                        ELSE pending_claims_count 
                    END
                WHERE item_id = OLD.item_id;
            END
        `);
        console.log('✅ Database triggers created successfully');

        // Update existing claim counts
        console.log('🔄 Updating existing claim counts...');
        await connection.execute(`
            UPDATE items i 
            SET 
                total_claims_count = (
                    SELECT COUNT(*) 
                    FROM claims c 
                    WHERE c.item_id = i.item_id
                ),
                pending_claims_count = (
                    SELECT COUNT(*) 
                    FROM claims c 
                    WHERE c.item_id = i.item_id 
                    AND c.claim_status = 'pending_verification'
                )
        `);
        console.log('✅ Updated existing claim counts');

        console.log('\n🎉 Claims database initialization completed successfully!');
        console.log('\n📋 What was added:');
        console.log('   ✅ Claims table with all necessary columns and indexes');
        console.log('   ✅ Claim count columns in items table');
        console.log('   ✅ Database triggers for automatic count management');
        console.log('   ✅ Foreign key relationships and constraints');
        console.log('\n🔧 New API endpoints available:');
        console.log('   📝 POST /api/claims - Submit a claim');
        console.log('   📎 POST /api/claims/:id/proof - Submit proof documents');
        console.log('   📋 GET /api/claims/my - Get user\'s claims');
        console.log('   👥 GET /api/claims/for-my-items - Get claims for user\'s items');
        console.log('   ✅ PUT /api/claims/:id/approve - Approve a claim');
        console.log('   ❌ PUT /api/claims/:id/reject - Reject a claim');
        console.log('   🏁 PUT /api/claims/:id/complete - Mark claim as completed');
        console.log('   📞 GET /api/claims/:id/contact - Get contact information');

    } catch (error) {
        console.error('❌ Claims database initialization failed:', error);
        throw error;
    } finally {
        if (connection) {
            await connection.end();
        }
    }
}

// Run the initialization
initializeClaimsDatabase()
    .then(() => {
        console.log('\n🚀 Ready to use the claims functionality!');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n💥 Initialization failed:', error);
        process.exit(1);
    });