const express = require('express');
const { pool } = require('../config/database');
const { authenticateToken, validateInput } = require('../middleware/auth');

const router = express.Router();

// Helper function to safely parse JSON
function safeJsonParse(jsonString, defaultValue = null) {
    if (!jsonString) return defaultValue;
    
    try {
        if (typeof jsonString === 'object') {
            return jsonString;
        }
        return JSON.parse(jsonString);
    } catch (error) {
        console.log('JSON parse error:', error.message);
        return defaultValue;
    }
}

// @route   POST /api/claims
// @desc    Submit a claim for an item
// @access  Private
router.post('/', authenticateToken, async (req, res) => {
    try {
        const { itemId, verificationAnswers } = req.body;
        
        if (!itemId || !verificationAnswers) {
            return res.status(400).json({
                success: false,
                error: 'Item ID and verification answers are required'
            });
        }

        // Get the item details
        const [items] = await pool.execute(`
            SELECT i.*, u.user_id as item_owner_id, u.first_name, u.last_name, u.email
            FROM items i
            JOIN users u ON i.reporter_id = u.user_id
            WHERE i.item_id = ? AND i.is_verified = TRUE AND i.status = 'active'
        `, [itemId]);

        if (items.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Item not found or not available for claiming'
            });
        }

        const item = items[0];

        // Check if user is trying to claim their own item
        if (item.item_owner_id === req.user.user_id) {
            return res.status(400).json({
                success: false,
                error: 'You cannot claim your own item'
            });
        }

        // Check if user has already claimed this item
        const [existingClaims] = await pool.execute(
            'SELECT claim_id FROM claims WHERE item_id = ? AND claimant_id = ?',
            [itemId, req.user.user_id]
        );

        if (existingClaims.length > 0) {
            return res.status(400).json({
                success: false,
                error: 'You have already submitted a claim for this item'
            });
        }

        // Get verification questions
        const verificationQuestions = safeJsonParse(item.verification_questions, []);
        
        if (verificationQuestions.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'This item does not have verification questions set up'
            });
        }

        // Validate answers
        if (!Array.isArray(verificationAnswers) || verificationAnswers.length !== verificationQuestions.length) {
            return res.status(400).json({
                success: false,
                error: 'Please provide answers to all verification questions'
            });
        }

        // Check answers (case-insensitive comparison)
        let correctAnswers = 0;
        const answerComparisons = [];

        verificationQuestions.forEach((q, index) => {
            const correctAnswer = q.answer.toLowerCase().trim();
            const userAnswer = (verificationAnswers[index] || '').toLowerCase().trim();
            const isCorrect = correctAnswer === userAnswer;
            
            if (isCorrect) {
                correctAnswers++;
            }
            
            answerComparisons.push({
                question: q.question,
                correct_answer: q.answer,
                user_answer: verificationAnswers[index],
                is_correct: isCorrect
            });
        });

        // Determine claim status based on answer accuracy
        const requiredCorrect = Math.max(2, Math.ceil(verificationQuestions.length * 0.8)); // 80% or minimum 2
        const claimStatus = correctAnswers >= requiredCorrect ? 'approved' : 'pending_verification';

        // Create the claim
        const [claimResult] = await pool.execute(`
            INSERT INTO claims (
                item_id, claimant_id, item_owner_id, claim_status, 
                verification_answers, created_at
            ) VALUES (?, ?, ?, ?, ?, NOW())
        `, [
            itemId,
            req.user.user_id,
            item.item_owner_id,
            claimStatus,
            JSON.stringify(answerComparisons)
        ]);

        // If approved, update item status
        if (claimStatus === 'approved') {
            await pool.execute(
                'UPDATE items SET status = ? WHERE item_id = ?',
                ['claimed', itemId]
            );
        }

        console.log(`✅ Claim submitted: User ${req.user.user_id} claimed item ${itemId} (${claimStatus})`);

        res.status(201).json({
            success: true,
            message: claimStatus === 'approved' 
                ? 'Claim approved! The item owner will be notified with your contact information.'
                : 'Claim submitted for review. You will be notified once it\'s processed.',
            claim: {
                claim_id: claimResult.insertId,
                status: claimStatus,
                correct_answers: correctAnswers,
                total_questions: verificationQuestions.length,
                item_title: item.title
            }
        });

    } catch (error) {
        console.error('Submit claim error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to submit claim. Please try again.'
        });
    }
});

// @route   GET /api/claims/my
// @desc    Get user's claims
// @access  Private
router.get('/my', authenticateToken, async (req, res) => {
    try {
        const [claims] = await pool.execute(`
            SELECT 
                c.*,
                i.title as item_title,
                i.description as item_description,
                i.type as item_type,
                CONCAT(u.first_name, ' ', u.last_name) as item_owner_name
            FROM claims c
            JOIN items i ON c.item_id = i.item_id
            JOIN users u ON c.item_owner_id = u.user_id
            WHERE c.claimant_id = ?
            ORDER BY c.created_at DESC
        `, [req.user.user_id]);

        // Parse JSON fields
        const claimsWithParsedData = claims.map(claim => ({
            ...claim,
            verification_answers: safeJsonParse(claim.verification_answers, [])
        }));

        res.json({
            success: true,
            claims: claimsWithParsedData
        });

    } catch (error) {
        console.error('Get user claims error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch your claims'
        });
    }
});

// @route   GET /api/claims/for-my-items
// @desc    Get claims for user's items
// @access  Private
router.get('/for-my-items', authenticateToken, async (req, res) => {
    try {
        const [claims] = await pool.execute(`
            SELECT 
                c.*,
                i.title as item_title,
                i.description as item_description,
                i.type as item_type,
                CONCAT(u.first_name, ' ', u.last_name) as claimant_name,
                u.email as claimant_email,
                u.phone as claimant_phone
            FROM claims c
            JOIN items i ON c.item_id = i.item_id
            JOIN users u ON c.claimant_id = u.user_id
            WHERE c.item_owner_id = ?
            ORDER BY c.created_at DESC
        `, [req.user.user_id]);

        // Parse JSON fields
        const claimsWithParsedData = claims.map(claim => ({
            ...claim,
            verification_answers: safeJsonParse(claim.verification_answers, [])
        }));

        res.json({
            success: true,
            claims: claimsWithParsedData
        });

    } catch (error) {
        console.error('Get item claims error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch claims for your items'
        });
    }
});

// @route   GET /api/claims/:id/contact
// @desc    Get contact information for approved claim
// @access  Private
router.get('/:id/contact', authenticateToken, async (req, res) => {
    try {
        const claimId = req.params.id;

        const [claims] = await pool.execute(`
            SELECT 
                c.*,
                i.title as item_title,
                u.first_name,
                u.last_name,
                u.email,
                u.phone,
                i.contact_info
            FROM claims c
            JOIN items i ON c.item_id = i.item_id
            JOIN users u ON c.claimant_id = u.user_id
            WHERE c.claim_id = ? AND (c.item_owner_id = ? OR c.claimant_id = ?)
        `, [claimId, req.user.user_id, req.user.user_id]);

        if (claims.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Claim not found or access denied'
            });
        }

        const claim = claims[0];

        // Only show contact info for approved claims
        if (claim.claim_status !== 'approved') {
            return res.status(403).json({
                success: false,
                error: 'Contact information is only available for approved claims'
            });
        }

        const contactInfo = safeJsonParse(claim.contact_info, {});

        res.json({
            success: true,
            contact: {
                name: `${claim.first_name} ${claim.last_name}`,
                email: claim.email,
                phone: claim.phone,
                preferred_contact: contactInfo.preferred_contact || 'email',
                item_title: claim.item_title
            }
        });

    } catch (error) {
        console.error('Get contact info error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get contact information'
        });
    }
});

// @route   PUT /api/claims/:id/approve
// @desc    Approve a claim (for item owners)
// @access  Private
router.put('/:id/approve', authenticateToken, async (req, res) => {
    try {
        const claimId = req.params.id;

        // Check if user owns the item
        const [claims] = await pool.execute(`
            SELECT c.*, i.title as item_title
            FROM claims c
            JOIN items i ON c.item_id = i.item_id
            WHERE c.claim_id = ? AND c.item_owner_id = ?
        `, [claimId, req.user.user_id]);

        if (claims.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Claim not found or access denied'
            });
        }

        // Update claim status
        await pool.execute(`
            UPDATE claims 
            SET claim_status = 'approved', approved_at = NOW()
            WHERE claim_id = ?
        `, [claimId]);

        // Update item status
        await pool.execute(
            'UPDATE items SET status = ? WHERE item_id = ?',
            ['claimed', claims[0].item_id]
        );

        res.json({
            success: true,
            message: 'Claim approved successfully'
        });

    } catch (error) {
        console.error('Approve claim error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to approve claim'
        });
    }
});

// @route   PUT /api/claims/:id/reject
// @desc    Reject a claim (for item owners)
// @access  Private
router.put('/:id/reject', authenticateToken, async (req, res) => {
    try {
        const claimId = req.params.id;
        const { reason } = req.body;

        // Check if user owns the item
        const [claims] = await pool.execute(`
            SELECT c.*, i.title as item_title
            FROM claims c
            JOIN items i ON c.item_id = i.item_id
            WHERE c.claim_id = ? AND c.item_owner_id = ?
        `, [claimId, req.user.user_id]);

        if (claims.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Claim not found or access denied'
            });
        }

        // Update claim status
        await pool.execute(`
            UPDATE claims 
            SET claim_status = 'rejected', admin_notes = ?
            WHERE claim_id = ?
        `, [reason || 'Rejected by item owner', claimId]);

        res.json({
            success: true,
            message: 'Claim rejected successfully'
        });

    } catch (error) {
        console.error('Reject claim error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to reject claim'
        });
    }
});

// @route   PUT /api/claims/:id/complete
// @desc    Mark claim as completed (item returned)
// @access  Private
router.put('/:id/complete', authenticateToken, async (req, res) => {
    try {
        const claimId = req.params.id;

        // Check if user is involved in this claim
        const [claims] = await pool.execute(`
            SELECT c.*, i.title as item_title
            FROM claims c
            JOIN items i ON c.item_id = i.item_id
            WHERE c.claim_id = ? AND (c.item_owner_id = ? OR c.claimant_id = ?)
        `, [claimId, req.user.user_id, req.user.user_id]);

        if (claims.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Claim not found or access denied'
            });
        }

        // Update claim and item status
        await pool.execute(`
            UPDATE claims 
            SET claim_status = 'completed', completed_at = NOW()
            WHERE claim_id = ?
        `, [claimId]);

        await pool.execute(
            'UPDATE items SET status = ? WHERE item_id = ?',
            ['returned', claims[0].item_id]
        );

        res.json({
            success: true,
            message: 'Item marked as successfully returned!'
        });

    } catch (error) {
        console.error('Complete claim error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to complete claim'
        });
    }
});

module.exports = router;