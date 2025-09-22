const express = require('express');
const { pool } = require('../config/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Helper function to safely parse JSON
function safeJsonParse(jsonString, defaultValue = null) {
    if (!jsonString) return defaultValue;
    try {
        if (typeof jsonString === 'object') return jsonString;
        return JSON.parse(jsonString);
    } catch (error) {
        return defaultValue;
    }
}

// @route   GET /api/admin/dashboard-stats
// @desc    Get dashboard statistics
// @access  Admin
router.get('/dashboard-stats', authenticateToken, requireAdmin, async (req, res) => {
    try {
        // Get user statistics
        const [userStats] = await pool.execute(`
            SELECT 
                COUNT(*) as total_users,
                SUM(CASE WHEN role = 'student' THEN 1 ELSE 0 END) as students,
                SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END) as admins,
                SUM(CASE WHEN is_verified = 1 THEN 1 ELSE 0 END) as verified_users
            FROM users
        `);

        // Get item statistics
        const [itemStats] = await pool.execute(`
            SELECT 
                COUNT(*) as total_items,
                SUM(CASE WHEN type = 'lost' THEN 1 ELSE 0 END) as lost_items,
                SUM(CASE WHEN type = 'found' THEN 1 ELSE 0 END) as found_items,
                SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_items,
                SUM(CASE WHEN status = 'claimed' THEN 1 ELSE 0 END) as claimed_items,
                SUM(CASE WHEN status = 'returned' THEN 1 ELSE 0 END) as returned_items,
                SUM(CASE WHEN is_verified = 1 THEN 1 ELSE 0 END) as verified_items
            FROM items
        `);

        // Get claim statistics (if claims table exists)
        let claimStats = [{ total_claims: 0, pending_claims: 0, approved_claims: 0, rejected_claims: 0 }];
        try {
            const [claims] = await pool.execute(`
                SELECT 
                    COUNT(*) as total_claims,
                    SUM(CASE WHEN claim_status = 'pending_verification' THEN 1 ELSE 0 END) as pending_claims,
                    SUM(CASE WHEN claim_status = 'approved' THEN 1 ELSE 0 END) as approved_claims,
                    SUM(CASE WHEN claim_status = 'rejected' THEN 1 ELSE 0 END) as rejected_claims
                FROM claims
            `);
            claimStats = claims;
        } catch (error) {
            console.log('Claims table not found, using default values');
        }

        res.json({
            success: true,
            stats: {
                users: userStats[0],
                items: itemStats[0],
                claims: claimStats[0]
            }
        });

    } catch (error) {
        console.error('Dashboard stats error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch dashboard statistics'
        });
    }
});

// @route   GET /api/admin/users
// @desc    Get all users with pagination
// @access  Admin
router.get('/users', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { page = '1', limit = '20', search = '', role = '' } = req.query;
        
        // Convert to integers and validate
        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 20)); // Cap at 100
        const offsetNum = (pageNum - 1) * limitNum;

        console.log('Admin users request:', { pageNum, limitNum, offsetNum, search, role });

        let whereConditions = [];
        let queryParams = [];

        if (search && search.trim()) {
            whereConditions.push('(first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR student_id LIKE ?)');
            const searchTerm = `%${search.trim()}%`;
            queryParams.push(searchTerm, searchTerm, searchTerm, searchTerm);
        }

        if (role && ['student', 'admin'].includes(role)) {
            whereConditions.push('role = ?');
            queryParams.push(role);
        }

        const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

        // Get total count first - use simple query without subquery for count
        const countQuery = `SELECT COUNT(*) as total FROM users ${whereClause}`;
        const [countResult] = await pool.execute(countQuery, queryParams);
        const totalUsers = countResult[0].total;

        // Build the main query - avoid subquery for better compatibility
        let usersQuery;
        let finalParams;

        if (whereClause) {
            usersQuery = `
    SELECT 
        user_id, student_id, email, password_hash, first_name, last_name, phone, 
        department, year_of_study, role, student_id_card, created_at
    FROM users 
    ${whereClause}
    ORDER BY created_at DESC 
    LIMIT ${limitNum} OFFSET ${offsetNum}
`;
            finalParams = queryParams;
        } else {
            usersQuery = `
    SELECT 
        user_id, student_id, email, password_hash, first_name, last_name, phone, 
        department, year_of_study, role, student_id_card, created_at
    FROM users 
    ORDER BY created_at DESC 
    LIMIT ${limitNum} OFFSET ${offsetNum}
`;
            finalParams = [];
        }
        
        console.log('Executing query:', usersQuery);
        console.log('With params:', finalParams);
        
        const [users] = await pool.execute(usersQuery, finalParams);

        // Get item counts separately for each user to avoid subquery issues
        const usersWithCounts = [];
        for (const user of users) {
            try {
                const [itemCount] = await pool.execute(
                    'SELECT COUNT(*) as total_items FROM items WHERE reporter_id = ?',
                    [user.user_id]
                );
                usersWithCounts.push({
                    ...user,
                    total_items: itemCount[0].total_items || 0
                });
            } catch (err) {
                console.log('Error getting item count for user:', user.user_id, err.message);
                usersWithCounts.push({
                    ...user,
                    total_items: 0
                });
            }
        }

        console.log(`✅ Retrieved ${usersWithCounts.length} users for admin dashboard`);

        res.json({
            success: true,
            users: usersWithCounts,
            pagination: {
                currentPage: pageNum,
                totalPages: Math.ceil(totalUsers / limitNum),
                totalUsers,
                limit: limitNum
            }
        });

    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch users: ' + error.message
        });
    }
});

// @route   GET /api/admin/items
// @desc    Get all items with pagination
// @access  Admin
router.get('/items', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { page = '1', limit = '20', search = '', type = '', status = '' } = req.query;
        
        // Convert to integers and validate
        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 20)); // Cap at 100
        const offsetNum = (pageNum - 1) * limitNum;

        console.log('Admin items request:', { pageNum, limitNum, offsetNum, search, type, status });

        let whereConditions = [];
        let queryParams = [];

        if (search && search.trim()) {
            whereConditions.push('(i.title LIKE ? OR i.description LIKE ?)');
            const searchTerm = `%${search.trim()}%`;
            queryParams.push(searchTerm, searchTerm);
        }

        if (type && ['lost', 'found'].includes(type)) {
            whereConditions.push('i.type = ?');
            queryParams.push(type);
        }

        if (status && ['active', 'claimed', 'returned', 'closed'].includes(status)) {
            whereConditions.push('i.status = ?');
            queryParams.push(status);
        }

        const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

        // Get total count first
        const countQuery = `SELECT COUNT(*) as total FROM items i ${whereClause}`;
        const [countResult] = await pool.execute(countQuery, queryParams);
        const totalItems = countResult[0].total;

        // Build the main query without LIMIT/OFFSET parameters to avoid type issues
        let itemsQuery;
        let finalParams;

        if (whereClause) {
            itemsQuery = `
                SELECT 
                    i.*, 
                    CONCAT(u.first_name, ' ', u.last_name) as reporter_name,
                    u.email as reporter_email
                FROM items i 
                LEFT JOIN users u ON i.reporter_id = u.user_id 
                ${whereClause}
                ORDER BY i.created_at DESC 
                LIMIT ${limitNum} OFFSET ${offsetNum}
            `;
            finalParams = queryParams;
        } else {
            itemsQuery = `
                SELECT 
                    i.*, 
                    CONCAT(u.first_name, ' ', u.last_name) as reporter_name,
                    u.email as reporter_email
                FROM items i 
                LEFT JOIN users u ON i.reporter_id = u.user_id 
                ORDER BY i.created_at DESC 
                LIMIT ${limitNum} OFFSET ${offsetNum}
            `;
            finalParams = [];
        }
        
        console.log('Executing query:', itemsQuery);
        console.log('With params:', finalParams);
        
        const [items] = await pool.execute(itemsQuery, finalParams);

        // Parse JSON fields
        const itemsWithParsedData = items.map(item => ({
            ...item,
            images: safeJsonParse(item.images, []),
            contact_info: safeJsonParse(item.contact_info, {}),
            verification_questions: safeJsonParse(item.verification_questions, [])
        }));

        console.log(`✅ Retrieved ${items.length} items for admin dashboard`);

        res.json({
            success: true,
            items: itemsWithParsedData,
            pagination: {
                currentPage: pageNum,
                totalPages: Math.ceil(totalItems / limitNum),
                totalItems,
                limit: limitNum
            }
        });

    } catch (error) {
        console.error('Get items error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch items: ' + error.message
        });
    }
});

// @route   PUT /api/admin/users/:id/verify
// @desc    Verify/unverify a user
// @access  Admin
router.put('/users/:id/verify', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const { is_verified } = req.body;

        if (isNaN(userId)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid user ID'
            });
        }

        await pool.execute(
            'UPDATE users SET is_verified = ? WHERE user_id = ?',
            [is_verified ? 1 : 0, userId]
        );

        res.json({
            success: true,
            message: `User ${is_verified ? 'verified' : 'unverified'} successfully`
        });

    } catch (error) {
        console.error('Verify user error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update user verification status'
        });
    }
});

// @route   DELETE /api/admin/users/:id
// @desc    Delete a user
// @access  Admin
router.delete('/users/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const userId = parseInt(req.params.id);

        if (isNaN(userId)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid user ID'
            });
        }

        // Check if user exists
        const [user] = await pool.execute('SELECT user_id, role FROM users WHERE user_id = ?', [userId]);
        
        if (user.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        // Prevent deleting other admins
        if (user[0].role === 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Cannot delete admin users'
            });
        }

        // Delete user (items will be deleted due to foreign key cascade)
        await pool.execute('DELETE FROM users WHERE user_id = ?', [userId]);

        res.json({
            success: true,
            message: 'User deleted successfully'
        });

    } catch (error) {
        console.error('Delete user error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete user'
        });
    }
});

// @route   PUT /api/admin/items/:id/verify
// @desc    Verify/unverify an item
// @access  Admin
router.put('/items/:id/verify', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const itemId = parseInt(req.params.id);
        const { is_verified } = req.body;

        if (isNaN(itemId)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid item ID'
            });
        }

        await pool.execute(
            'UPDATE items SET is_verified = ? WHERE item_id = ?',
            [is_verified ? 1 : 0, itemId]
        );

        res.json({
            success: true,
            message: `Item ${is_verified ? 'verified' : 'unverified'} successfully`
        });

    } catch (error) {
        console.error('Verify item error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update item verification status'
        });
    }
});

// @route   DELETE /api/admin/items/:id
// @desc    Delete an item
// @access  Admin
router.delete('/items/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const itemId = parseInt(req.params.id);

        if (isNaN(itemId)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid item ID'
            });
        }

        await pool.execute('DELETE FROM items WHERE item_id = ?', [itemId]);

        res.json({
            success: true,
            message: 'Item deleted successfully'
        });

    } catch (error) {
        console.error('Delete item error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete item'
        });
    }
});

module.exports = router;