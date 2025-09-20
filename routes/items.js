const express = require('express');
const multer = require('multer');
const path = require('path');
const { pool } = require('../config/database');
const { authenticateToken, validateInput } = require('../middleware/auth');

const router = express.Router();

// Configure multer for image uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/uploads/');
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'item-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB limit
        files: 5 // Maximum 5 files
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);

        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Only image files are allowed'));
        }
    }
});

// Helper function to safely parse JSON
function safeJsonParse(jsonString, defaultValue = null) {
    if (!jsonString) return defaultValue;
    
    try {
        // If it's already an object, return it
        if (typeof jsonString === 'object') {
            return jsonString;
        }
        
        // If it's a string that doesn't look like JSON, return default
        if (typeof jsonString === 'string') {
            const trimmed = jsonString.trim();
            if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) {
                console.log('Invalid JSON format:', trimmed);
                return defaultValue;
            }
        }
        
        return JSON.parse(jsonString);
    } catch (error) {
        console.log('JSON parse error for:', jsonString, 'Error:', error.message);
        return defaultValue;
    }
}

// Check if table has a specific column
async function hasColumn(tableName, columnName) {
    try {
        const [columns] = await pool.execute(`
            SELECT COLUMN_NAME 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?
        `, [process.env.DB_NAME || 'campus_lost_found', tableName, columnName]);
        
        return columns.length > 0;
    } catch (error) {
        console.error('Error checking column:', error);
        return false;
    }
}

// @route   POST /api/items
// @desc    Create new item (lost or found)
// @access  Private
router.post('/', authenticateToken, upload.array('images', 5), async (req, res) => {
    try {
        const {
            type,
            title,
            description,
            category,
            location,
            dateLostFound,
            timeLostFound,
            contactInfo,
            verificationQuestions,
            rewardAmount
        } = req.body;

        // Validate required fields
        if (!type || !title || !description || !dateLostFound) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields'
            });
        }

        // Validate type
        if (!['lost', 'found'].includes(type)) {
            return res.status(400).json({
                success: false,
                error: 'Type must be either "lost" or "found"'
            });
        }

        // Process uploaded images
        const images = req.files ? req.files.map(file => `/uploads/${file.filename}`) : [];

        // Parse contact info and verification questions
        let parsedContactInfo = {};
        let parsedVerificationQuestions = [];

        try {
            if (contactInfo) {
                parsedContactInfo = typeof contactInfo === 'string' ? JSON.parse(contactInfo) : contactInfo;
            }
            if (verificationQuestions) {
                parsedVerificationQuestions = typeof verificationQuestions === 'string' ? JSON.parse(verificationQuestions) : verificationQuestions;
            }
        } catch (parseError) {
            return res.status(400).json({
                success: false,
                error: 'Invalid JSON format in contact info or verification questions'
            });
        }

        // Check if category column exists
        const hasCategoryColumn = await hasColumn('items', 'category');
        
        let insertQuery, insertParams;
        
        if (hasCategoryColumn) {
            // Use category column
            insertQuery = `
                INSERT INTO items (
                    reporter_id, type, title, description, category, location,
                    date_lost_found, time_lost_found, contact_info, verification_questions,
                    reward_amount, images, is_verified, status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            insertParams = [
                req.user.user_id,
                type,
                title,
                description,
                category || null,
                location,
                dateLostFound,
                timeLostFound || null,
                JSON.stringify(parsedContactInfo),
                JSON.stringify(parsedVerificationQuestions),
                rewardAmount || 0,
                JSON.stringify(images),
                false, // Requires admin verification
                'active'
            ];
        } else {
            // Don't use category column (original schema)
            insertQuery = `
                INSERT INTO items (
                    reporter_id, type, title, description, location,
                    date_lost_found, contact_info, verification_questions,
                    images, is_verified, status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            insertParams = [
                req.user.user_id,
                type,
                title,
                description,
                location,
                dateLostFound,
                JSON.stringify(parsedContactInfo),
                JSON.stringify(parsedVerificationQuestions),
                JSON.stringify(images),
                false, // Requires admin verification
                'active'
            ];
        }

        // Insert item into database
        const [result] = await pool.execute(insertQuery, insertParams);

        // Get the created item
        const [newItem] = await pool.execute(`
            SELECT i.*, u.first_name, u.last_name
            FROM items i
            LEFT JOIN users u ON i.reporter_id = u.user_id
            WHERE i.item_id = ?
        `, [result.insertId]);

        console.log(`✅ New ${type} item created: ${title} by ${req.user.email}`);

        res.status(201).json({
            success: true,
            message: `${type.charAt(0).toUpperCase() + type.slice(1)} item reported successfully! It will be visible to others after admin verification.`,
            item: newItem[0]
        });

    } catch (error) {
        console.error('Create item error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create item. Please try again.'
        });
    }
});

// @route   GET /api/items
// @desc    Get all items with filters (only verified items for public)
// @access  Public
router.get('/', async (req, res) => {
    try {
        const {
            type,
            category,
            location,
            search,
            status = 'active',
            page = 1,
            limit = 12,
            sortBy = 'created_at',
            sortOrder = 'DESC'
        } = req.query;

        const offset = (page - 1) * limit;
        
        let whereConditions = ['i.is_verified = TRUE']; // Only show verified items to public
        let queryParams = [];

        // Add filters
        if (type && ['lost', 'found'].includes(type)) {
            whereConditions.push('i.type = ?');
            queryParams.push(type);
        }

        if (status) {
            whereConditions.push('i.status = ?');
            queryParams.push(status);
        }

        // Check if category column exists before filtering
        const hasCategoryColumn = await hasColumn('items', 'category');
        if (category && hasCategoryColumn) {
            whereConditions.push('i.category = ?');
            queryParams.push(category);
        }

        if (location) {
            whereConditions.push('i.location LIKE ?');
            queryParams.push(`%${location}%`);
        }

        if (search) {
            whereConditions.push('(i.title LIKE ? OR i.description LIKE ?)');
            queryParams.push(`%${search}%`, `%${search}%`);
        }

        const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

        // Get total count
        const [countResult] = await pool.execute(`
            SELECT COUNT(*) as total
            FROM items i
            ${whereClause}
        `, queryParams);

        const totalItems = countResult[0].total;
        const totalPages = Math.ceil(totalItems / limit);

        // Get items
        const itemsQuery = `
            SELECT 
                i.*,
                CONCAT(u.first_name, ' ', u.last_name) as reporter_name,
                u.email as reporter_email
            FROM items i
            LEFT JOIN users u ON i.reporter_id = u.user_id
            ${whereClause}
            ORDER BY i.${sortBy} ${sortOrder}
            LIMIT ? OFFSET ?
        `;

        const [items] = await pool.execute(itemsQuery, [...queryParams, parseInt(limit), parseInt(offset)]);

        // Parse JSON fields safely
        const itemsWithParsedData = items.map(item => ({
            ...item,
            images: safeJsonParse(item.images, []),
            contact_info: safeJsonParse(item.contact_info, {}),
            verification_questions: safeJsonParse(item.verification_questions, [])
        }));

        res.json({
            success: true,
            items: itemsWithParsedData,
            pagination: {
                currentPage: parseInt(page),
                totalPages,
                totalItems,
                hasNextPage: page < totalPages,
                hasPrevPage: page > 1
            }
        });

    } catch (error) {
        console.error('Get items error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch items'
        });
    }
});

// @route   GET /api/items/:id
// @desc    Get single item by ID
// @access  Public
router.get('/:id', async (req, res) => {
    try {
        const itemId = req.params.id;

        // Check if view_count column exists before updating
        const hasViewCount = await hasColumn('items', 'view_count');
        if (hasViewCount) {
            await pool.execute('UPDATE items SET view_count = COALESCE(view_count, 0) + 1 WHERE item_id = ?', [itemId]);
        }

        // Get item details
        const [items] = await pool.execute(`
            SELECT 
                i.*,
                CONCAT(u.first_name, ' ', u.last_name) as reporter_name,
                u.email as reporter_email,
                u.phone as reporter_phone
            FROM items i
            LEFT JOIN users u ON i.reporter_id = u.user_id
            WHERE i.item_id = ? AND i.is_verified = TRUE
        `, [itemId]);

        if (items.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Item not found'
            });
        }

        const item = items[0];

        // Parse JSON fields safely
        item.images = safeJsonParse(item.images, []);
        item.contact_info = safeJsonParse(item.contact_info, {});
        item.verification_questions = safeJsonParse(item.verification_questions, []);

        res.json({
            success: true,
            item
        });

    } catch (error) {
        console.error('Get item error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch item'
        });
    }
});

// @route   GET /api/items/user/my-items
// @desc    Get current user's items (including unverified)
// @access  Private
router.get('/user/my-items', authenticateToken, async (req, res) => {
    try {
        console.log(`📋 Fetching items for user ID: ${req.user.user_id}`);
        
        const { type, status } = req.query;
        
        let whereConditions = ['i.reporter_id = ?'];
        let queryParams = [req.user.user_id];

        if (type && ['lost', 'found'].includes(type)) {
            whereConditions.push('i.type = ?');
            queryParams.push(type);
        }

        if (status) {
            whereConditions.push('i.status = ?');
            queryParams.push(status);
        }

        const whereClause = `WHERE ${whereConditions.join(' AND ')}`;

        const [items] = await pool.execute(`
            SELECT i.*
            FROM items i
            ${whereClause}
            ORDER BY i.created_at DESC
        `, queryParams);

        console.log(`📋 Found ${items.length} items for user`);

        // Parse JSON fields safely and add dummy claim counts for now
        const itemsWithParsedData = items.map(item => {
            try {
                return {
                    ...item,
                    images: safeJsonParse(item.images, []),
                    contact_info: safeJsonParse(item.contact_info, {}),
                    verification_questions: safeJsonParse(item.verification_questions, []),
                    pending_claims: 0, // Will be real data in Phase 2
                    approved_claims: 0,
                    category_name: item.category || 'Uncategorized', // Handle missing category column
                    location_name: item.location // Since location is text
                };
            } catch (error) {
                console.error('Error processing item:', item.item_id, error);
                // Return item with safe defaults
                return {
                    ...item,
                    images: [],
                    contact_info: {},
                    verification_questions: [],
                    pending_claims: 0,
                    approved_claims: 0,
                    category_name: 'Uncategorized',
                    location_name: item.location || 'Unknown'
                };
            }
        });

        res.json({
            success: true,
            items: itemsWithParsedData
        });

    } catch (error) {
        console.error('Get user items error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch your items'
        });
    }
});

// @route   PUT /api/items/:id
// @desc    Update item (only by owner)
// @access  Private
router.put('/:id', authenticateToken, async (req, res) => {
    try {
        const itemId = req.params.id;
        const { title, description, status } = req.body;

        // Check if user owns this item
        const [items] = await pool.execute(
            'SELECT reporter_id FROM items WHERE item_id = ?',
            [itemId]
        );

        if (items.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Item not found'
            });
        }

        if (items[0].reporter_id !== req.user.user_id) {
            return res.status(403).json({
                success: false,
                error: 'You can only update your own items'
            });
        }

        // Update item
        await pool.execute(`
            UPDATE items 
            SET title = ?, description = ?, status = ?, updated_at = CURRENT_TIMESTAMP
            WHERE item_id = ?
        `, [title, description, status, itemId]);

        res.json({
            success: true,
            message: 'Item updated successfully'
        });

    } catch (error) {
        console.error('Update item error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update item'
        });
    }
});

// @route   DELETE /api/items/:id
// @desc    Delete item (only by owner)
// @access  Private
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const itemId = req.params.id;

        // Check if user owns this item
        const [items] = await pool.execute(
            'SELECT reporter_id FROM items WHERE item_id = ?',
            [itemId]
        );

        if (items.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Item not found'
            });
        }

        if (items[0].reporter_id !== req.user.user_id) {
            return res.status(403).json({
                success: false,
                error: 'You can only delete your own items'
            });
        }

        // Delete item
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

// @route   GET /api/items/meta/categories
// @desc    Get all categories (or return default ones if table doesn't exist)
// @access  Public
router.get('/meta/categories', async (req, res) => {
    try {
        // Try to get categories from database, but provide defaults if table doesn't exist
        let categories = [];
        
        try {
            const [result] = await pool.execute(
                'SELECT * FROM categories WHERE is_active = TRUE ORDER BY name'
            );
            categories = result;
        } catch (dbError) {
            // If categories table doesn't exist, provide default categories
            console.log('Categories table not found, using defaults');
            categories = [
                { category_id: 1, name: 'Electronics', is_active: true },
                { category_id: 2, name: 'Books & Stationery', is_active: true },
                { category_id: 3, name: 'Clothing & Accessories', is_active: true },
                { category_id: 4, name: 'Bags & Backpacks', is_active: true },
                { category_id: 5, name: 'Keys & Cards', is_active: true },
                { category_id: 6, name: 'Sports Equipment', is_active: true },
                { category_id: 7, name: 'Jewelry & Watches', is_active: true },
                { category_id: 8, name: 'Documents', is_active: true },
                { category_id: 9, name: 'Other', is_active: true }
            ];
        }

        res.json({
            success: true,
            categories
        });
    } catch (error) {
        console.error('Get categories error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch categories'
        });
    }
});

// @route   GET /api/items/meta/locations
// @desc    Get all locations (or return default ones if table doesn't exist)
// @access  Public
router.get('/meta/locations', async (req, res) => {
    try {
        // Try to get locations from database, but provide defaults if table doesn't exist
        let locations = [];
        
        try {
            const [result] = await pool.execute(
                'SELECT * FROM locations WHERE is_active = TRUE ORDER BY name'
            );
            locations = result;
        } catch (dbError) {
            // If locations table doesn't exist, provide default locations
            console.log('Locations table not found, using defaults');
            locations = [
                { location_id: 1, name: 'Main Library', is_active: true },
                { location_id: 2, name: 'Computer Lab 1', is_active: true },
                { location_id: 3, name: 'Computer Lab 2', is_active: true },
                { location_id: 4, name: 'Cafeteria', is_active: true },
                { location_id: 5, name: 'Gym/Sports Complex', is_active: true },
                { location_id: 6, name: 'Student Center', is_active: true },
                { location_id: 7, name: 'Lecture Hall A', is_active: true },
                { location_id: 8, name: 'Lecture Hall B', is_active: true },
                { location_id: 9, name: 'Parking Lot', is_active: true },
                { location_id: 10, name: 'Dormitory', is_active: true },
                { location_id: 11, name: 'Admin Building', is_active: true },
                { location_id: 12, name: 'Other', is_active: true }
            ];
        }

        res.json({
            success: true,
            locations
        });
    } catch (error) {
        console.error('Get locations error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch locations'
        });
    }
});


module.exports = router;