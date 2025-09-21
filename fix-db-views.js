// Run this script to fix database view issues
// Save this as fix-database-views.js and run: node fix-database-views.js

const mysql = require('mysql2/promise');
require('dotenv').config();

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'madhav2711',
    database: process.env.DB_NAME || 'campus_lost_found',
};

async function fixDatabaseViews() {
    let connection;
    
    try {
        connection = await mysql.createConnection(dbConfig);
        console.log('🔄 Connected to database for fixing views...');

        // First, let's see what views exist
        console.log('📋 Checking existing views...');
        const [views] = await connection.execute(`
            SELECT TABLE_NAME, TABLE_TYPE 
            FROM INFORMATION_SCHEMA.TABLES 
            WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'VIEW'
        `, [dbConfig.database]);

        if (views.length > 0) {
            console.log('🔍 Found views:');
            views.forEach(view => {
                console.log(`  - ${view.TABLE_NAME}`);
            });

            // Drop problematic views
            for (const view of views) {
                try {
                    console.log(`🗑️  Dropping view: ${view.TABLE_NAME}`);
                    await connection.execute(`DROP VIEW IF EXISTS \`${view.TABLE_NAME}\``);
                    console.log(`✅ Dropped view: ${view.TABLE_NAME}`);
                } catch (error) {
                    console.log(`⚠️  Could not drop view ${view.TABLE_NAME}:`, error.message);
                }
            }
        } else {
            console.log('✅ No views found');
        }

        // Check for any remaining problematic objects
        console.log('🔍 Checking for other problematic objects...');
        
        // Check triggers
        const [triggers] = await connection.execute(`
            SELECT TRIGGER_NAME 
            FROM INFORMATION_SCHEMA.TRIGGERS 
            WHERE TRIGGER_SCHEMA = ?
        `, [dbConfig.database]);

        console.log(`📋 Found ${triggers.length} triggers`);
        triggers.forEach(trigger => {
            console.log(`  - ${trigger.TRIGGER_NAME}`);
        });

        // Check functions
        const [functions] = await connection.execute(`
            SELECT ROUTINE_NAME, ROUTINE_TYPE
            FROM INFORMATION_SCHEMA.ROUTINES 
            WHERE ROUTINE_SCHEMA = ?
        `, [dbConfig.database]);

        console.log(`📋 Found ${functions.length} functions/procedures`);
        functions.forEach(func => {
            console.log(`  - ${func.ROUTINE_NAME} (${func.ROUTINE_TYPE})`);
        });

        // Verify core tables exist and are accessible
        console.log('🔍 Verifying core tables...');
        const coreTables = ['users', 'items', 'categories', 'locations'];
        
        for (const tableName of coreTables) {
            try {
                const [result] = await connection.execute(`
                    SELECT COUNT(*) as count 
                    FROM \`${tableName}\` 
                    LIMIT 1
                `);
                console.log(`✅ Table '${tableName}' is accessible (${result[0].count} rows)`);
            } catch (error) {
                console.log(`❌ Table '${tableName}' has issues:`, error.message);
            }
        }

        // Check if claims table exists (from Phase 2)
        try {
            const [result] = await connection.execute(`
                SELECT COUNT(*) as count 
                FROM claims 
                LIMIT 1
            `);
            console.log(`✅ Claims table is accessible (${result[0].count} rows)`);
        } catch (error) {
            console.log(`⚠️  Claims table not found or has issues:`, error.message);
            console.log('💡 Run init-claims-database.js to create claims functionality');
        }

        // Check table structures
        console.log('🔍 Checking table structures...');
        const [tables] = await connection.execute(`
            SELECT TABLE_NAME 
            FROM INFORMATION_SCHEMA.TABLES 
            WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
            ORDER BY TABLE_NAME
        `, [dbConfig.database]);

        for (const table of tables) {
            try {
                const [columns] = await connection.execute(`
                    SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
                    FROM INFORMATION_SCHEMA.COLUMNS 
                    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
                    ORDER BY ORDINAL_POSITION
                `, [dbConfig.database, table.TABLE_NAME]);
                
                console.log(`📋 Table '${table.TABLE_NAME}' has ${columns.length} columns`);
            } catch (error) {
                console.log(`❌ Error checking table '${table.TABLE_NAME}':`, error.message);
            }
        }

        // Create a simple view for active items (if you want one)
        console.log('🔄 Creating clean active_items view...');
        
        try {
            // Drop if exists
            await connection.execute('DROP VIEW IF EXISTS active_items_view');
            
            // Create a simple, safe view
            await connection.execute(`
                CREATE VIEW active_items_view AS
                SELECT 
                    i.item_id,
                    i.title,
                    i.description,
                    i.type,
                    i.status,
                    i.location,
                    i.date_lost_found,
                    i.is_verified,
                    i.created_at,
                    CONCAT(u.first_name, ' ', u.last_name) as reporter_name
                FROM items i
                LEFT JOIN users u ON i.reporter_id = u.user_id
                WHERE i.status = 'active' AND i.is_verified = TRUE
            `);
            console.log('✅ Created clean active_items_view');
            
        } catch (error) {
            console.log('⚠️  Could not create active_items_view:', error.message);
            console.log('💡 This is optional - the app will work without it');
        }

        // Test the view
        try {
            const [viewTest] = await connection.execute('SELECT COUNT(*) as count FROM active_items_view');
            console.log(`✅ Active items view working (${viewTest[0].count} active items)`);
        } catch (error) {
            console.log('⚠️  Active items view test failed:', error.message);
        }

        // Refresh MySQL metadata
        console.log('🔄 Refreshing database metadata...');
        await connection.execute('FLUSH TABLES');

        console.log('\n🎉 Database view cleanup completed!');
        console.log('\n📋 Summary:');
        console.log(`   📁 Database: ${dbConfig.database}`);
        console.log(`   📊 Tables: ${tables.length}`);
        console.log(`   👁️  Views: Created clean active_items_view`);
        console.log(`   🔧 Triggers: ${triggers.length} (for claims functionality)`);
        
        console.log('\n💡 Next steps:');
        console.log('   1. Refresh your MySQL Workbench schema (F5)');
        console.log('   2. If you still see errors, restart MySQL Workbench');
        console.log('   3. If issues persist, run: FLUSH PRIVILEGES; in MySQL');

    } catch (error) {
        console.error('❌ Database fix failed:', error);
        throw error;
    } finally {
        if (connection) {
            await connection.end();
        }
    }
}

// Additional manual fixes you can run in MySQL Workbench if needed
function printManualFixes() {
    console.log('\n🔧 Manual fixes you can run in MySQL Workbench if issues persist:');
    console.log('\n-- 1. Drop all views forcefully:');
    console.log(`DROP VIEW IF EXISTS active_items_view;`);
    console.log(`DROP VIEW IF EXISTS pending_items_view;`);
    console.log(`DROP VIEW IF EXISTS claims_view;`);
    
    console.log('\n-- 2. Check for foreign key constraints:');
    console.log(`SELECT * FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE WHERE REFERENCED_TABLE_SCHEMA = '${dbConfig.database}';`);
    
    console.log('\n-- 3. Reset database privileges:');
    console.log(`FLUSH PRIVILEGES;`);
    console.log(`FLUSH TABLES;`);
    
    console.log('\n-- 4. Check MySQL error log:');
    console.log(`SHOW VARIABLES LIKE 'log_error';`);
    
    console.log('\n-- 5. Repair tables if needed:');
    console.log(`REPAIR TABLE items;`);
    console.log(`REPAIR TABLE users;`);
}

// Run the fix
fixDatabaseViews()
    .then(() => {
        printManualFixes();
        console.log('\n🚀 Database should now work properly with MySQL Workbench!');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n💥 Fix failed:', error);
        printManualFixes();
        process.exit(1);
    });