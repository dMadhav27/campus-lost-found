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

        // Get category ID if category is provided
        let categoryId = null;
        if (category) {
            const [categoryResult] = await pool.execute(
                'SELECT category_id FROM categories WHERE name = ?',
                [category]
            );
            categoryId = categoryResult.length > 0 ? categoryResult[0].category_id : null;
        }

        // For location, we'll store it as text now instead of looking up ID
        // Insert item into database
        const [result] = await pool.execute(`
            INSERT INTO items (
                reporter_id, type, title, description, category_id, location,
                date_lost_found, time_lost_found, contact_info, verification_questions,
                reward_amount, images, is_verified, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            req.user.user_id,
            type,
            title,
            description,
            categoryId,
            location, // Store location as text
            dateLostFound,
            timeLostFound || null,
            JSON.stringify(parsedContactInfo),
            JSON.stringify(parsedVerificationQuestions),
            rewardAmount || 0,
            JSON.stringify(images),
            false, // Requires admin verification
            'active'
        ]);

        // Get the created item
        const [newItem] = await pool.execute(`
            SELECT i.*, c.name as category_name,
                   u.first_name, u.last_name
            FROM items i
            LEFT JOIN categories c ON i.category_id = c.category_id
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

        if (category) {
            whereConditions.push('c.name = ?');
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
            LEFT JOIN categories c ON i.category_id = c.category_id
            ${whereClause}
        `, queryParams);

        const totalItems = countResult[0].total;
        const totalPages = Math.ceil(totalItems / limit);

        // Get items
        const itemsQuery = `
            SELECT 
                i.*,
                c.name as category_name,
                CONCAT(u.first_name, ' ', u.last_name) as reporter_name,
                u.email as reporter_email
            FROM items i
            LEFT JOIN categories c ON i.category_id = c.category_id
            LEFT JOIN users u ON i.reporter_id = u.user_id
            ${whereClause}
            ORDER BY i.${sortBy} ${sortOrder}
            LIMIT ? OFFSET ?
        `;

        const [items] = await pool.execute(itemsQuery, [...queryParams, parseInt(limit), parseInt(offset)]);

        // Parse JSON fields
        const itemsWithParsedData = items.map(item => ({
            ...item,
            images: item.images ? JSON.parse(item.images) : [],
            contact_info: item.contact_info ? JSON.parse(item.contact_info) : {},
            verification_questions: item.verification_questions ? JSON.parse(item.verification_questions) : []
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

        // Increment view count
        await pool.execute('UPDATE items SET view_count = view_count + 1 WHERE item_id = ?', [itemId]);

        // Get item details
        const [items] = await pool.execute(`
            SELECT 
                i.*,
                c.name as category_name,
                CONCAT(u.first_name, ' ', u.last_name) as reporter_name,
                u.email as reporter_email,
                u.phone as reporter_phone
            FROM items i
            LEFT JOIN categories c ON i.category_id = c.category_id
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

        // Parse JSON fields
        item.images = item.images ? JSON.parse(item.images) : [];
        item.contact_info = item.contact_info ? JSON.parse(item.contact_info) : {};
        item.verification_questions = item.verification_questions ? JSON.parse(item.verification_questions) : [];

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
            SELECT 
                i.*,
                c.name as category_name
            FROM items i
            LEFT JOIN categories c ON i.category_id = c.category_id
            ${whereClause}
            ORDER BY i.created_at DESC
        `, queryParams);

        // Parse JSON fields and add dummy claim counts for now
        const itemsWithParsedData = items.map(item => ({
            ...item,
            images: item.images ? JSON.parse(item.images) : [],
            contact_info: item.contact_info ? JSON.parse(item.contact_info) : {},
            verification_questions: item.verification_questions ? JSON.parse(item.verification_questions) : [],
            pending_claims: 0, // Will be real data in Phase 2
            approved_claims: 0,
            location_name: item.location // Since location is now text
        }));

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
// @desc    Get all categories
// @access  Public
router.get('/meta/categories', async (req, res) => {
    try {
        const [categories] = await pool.execute(
            'SELECT * FROM categories WHERE is_active = TRUE ORDER BY name'
        );

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
// @desc    Get all locations
// @access  Public
router.get('/meta/locations', async (req, res) => {
    try {
        const [locations] = await pool.execute(
            'SELECT * FROM locations WHERE is_active = TRUE ORDER BY name'
        );

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