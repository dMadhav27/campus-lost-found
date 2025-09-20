// run this script once to clean up your database
// Save this as cleanup-database.js and run: node cleanup-database.js

const mysql = require('mysql2/promise');
require('dotenv').config();

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'madhav2711',
    database: process.env.DB_NAME || 'campus_lost_found',
};

async function cleanupDatabase() {
    let connection;
    
    try {
        connection = await mysql.createConnection(dbConfig);
        console.log('🔄 Connected to database for cleanup...');

        // First, let's see what columns exist in the items table
        const [columns] = await connection.execute(`
            SELECT COLUMN_NAME 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'items'
            ORDER BY ORDINAL_POSITION
        `, [dbConfig.database]);
        
        console.log('📋 Current items table columns:');
        columns.forEach(col => console.log('  -', col.COLUMN_NAME));

        // Get all items to check their JSON fields
        const [items] = await connection.execute('SELECT item_id, images, contact_info, verification_questions FROM items');
        
        console.log(`🔍 Found ${items.length} items to check...`);

        let fixedCount = 0;
        
        for (const item of items) {
            let needsUpdate = false;
            let newImages = '[]';
            let newContactInfo = '{}';
            let newVerificationQuestions = '[]';

            // Fix images field
            if (item.images) {
                try {
                    JSON.parse(item.images);
                    newImages = item.images; // Already valid JSON
                } catch (error) {
                    console.log(`❌ Invalid images JSON for item ${item.item_id}:`, item.images);
                    // If it's just a file path, wrap it in an array
                    if (typeof item.images === 'string' && item.images.startsWith('/uploads/')) {
                        newImages = JSON.stringify([item.images]);
                    } else {
                        newImages = '[]';
                    }
                    needsUpdate = true;
                }
            }

            // Fix contact_info field
            if (item.contact_info) {
                try {
                    JSON.parse(item.contact_info);
                    newContactInfo = item.contact_info; // Already valid JSON
                } catch (error) {
                    console.log(`❌ Invalid contact_info JSON for item ${item.item_id}:`, item.contact_info);
                    newContactInfo = '{}';
                    needsUpdate = true;
                }
            }

            // Fix verification_questions field
            if (item.verification_questions) {
                try {
                    JSON.parse(item.verification_questions);
                    newVerificationQuestions = item.verification_questions; // Already valid JSON
                } catch (error) {
                    console.log(`❌ Invalid verification_questions JSON for item ${item.item_id}:`, item.verification_questions);
                    newVerificationQuestions = '[]';
                    needsUpdate = true;
                }
            }

            // Update the item if needed
            if (needsUpdate) {
                await connection.execute(`
                    UPDATE items 
                    SET images = ?, contact_info = ?, verification_questions = ?
                    WHERE item_id = ?
                `, [newImages, newContactInfo, newVerificationQuestions, item.item_id]);
                
                console.log(`✅ Fixed JSON for item ${item.item_id}`);
                fixedCount++;
            }
        }

        // Add missing columns if they don't exist
        const columnNames = columns.map(col => col.COLUMN_NAME);
        
        if (!columnNames.includes('category')) {
            console.log('🔄 Adding category column...');
            await connection.execute('ALTER TABLE items ADD COLUMN category VARCHAR(50) AFTER description');
            console.log('✅ Added category column');
        }

        if (!columnNames.includes('time_lost_found')) {
            console.log('🔄 Adding time_lost_found column...');
            await connection.execute('ALTER TABLE items ADD COLUMN time_lost_found TIME AFTER date_lost_found');
            console.log('✅ Added time_lost_found column');
        }

        if (!columnNames.includes('reward_amount')) {
            console.log('🔄 Adding reward_amount column...');
            await connection.execute('ALTER TABLE items ADD COLUMN reward_amount DECIMAL(10,2) DEFAULT 0.00 AFTER verification_questions');
            console.log('✅ Added reward_amount column');
        }

        if (!columnNames.includes('view_count')) {
            console.log('🔄 Adding view_count column...');
            await connection.execute('ALTER TABLE items ADD COLUMN view_count INT DEFAULT 0 AFTER admin_notes');
            console.log('✅ Added view_count column');
        }

        console.log(`\n🎉 Cleanup completed!`);
        console.log(`   - Fixed ${fixedCount} items with invalid JSON`);
        console.log(`   - Added missing columns to items table`);
        console.log(`\n✅ Your database should now work properly with the application!`);

    } catch (error) {
        console.error('❌ Cleanup failed:', error);
    } finally {
        if (connection) {
            await connection.end();
        }
    }
}

// Run the cleanup
cleanupDatabase();