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
// @desc    Submit a claim for an item with immediate approval logic
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

        // Check answers with improved matching logic
        let correctAnswers = 0;
        const answerComparisons = [];

        verificationQuestions.forEach((q, index) => {
            const correctAnswer = q.answer.toLowerCase().trim();
            const userAnswer = (verificationAnswers[index] || '').toLowerCase().trim();
            
            // Improved matching: exact match or high similarity
            let isCorrect = false;
            
            if (correctAnswer === userAnswer) {
                isCorrect = true;
            } else {
                // Check for partial matches for certain types of answers
                if (correctAnswer.length > 3 && userAnswer.length > 3) {
                    // If answers are similar enough (simple similarity check)
                    const similarity = calculateSimilarity(correctAnswer, userAnswer);
                    if (similarity > 0.8) { // 80% similarity threshold
                        isCorrect = true;
                    }
                }
            }
            
            if (isCorrect) {
                correctAnswers++;
            }
            
            answerComparisons.push({
                question: q.question,
                correct_answer: q.answer,
                user_answer: verificationAnswers[index],
                is_correct: isCorrect,
                similarity: calculateSimilarity(correctAnswer, userAnswer)
            });
        });

        // Determine claim status based on answer accuracy
        const requiredCorrect = Math.max(2, Math.ceil(verificationQuestions.length * 0.8)); // 80% or minimum 2
        let claimStatus = 'pending_verification';
        
        // If most answers are correct, approve immediately
        if (correctAnswers >= requiredCorrect) {
            claimStatus = 'approved';
        } else if (correctAnswers >= Math.ceil(verificationQuestions.length * 0.6)) {
            // If 60%+ correct, mark for manual review
            claimStatus = 'awaiting_proof';
        }

        // Create the claim
        const [claimResult] = await pool.execute(`
            INSERT INTO claims (
                item_id, claimant_id, item_owner_id, claim_status, 
                verification_answers, created_at,
                ${claimStatus === 'approved' ? 'approved_at,' : ''}
                contact_revealed
            ) VALUES (?, ?, ?, ?, ?, NOW(), ${claimStatus === 'approved' ? 'NOW(),' : ''} ?)
        `, [
            itemId,
            req.user.user_id,
            item.item_owner_id,
            claimStatus,
            JSON.stringify(answerComparisons),
            claimStatus === 'approved' ? true : false
        ]);

        // If approved immediately, update item status
        if (claimStatus === 'approved') {
            await pool.execute(
                'UPDATE items SET status = ? WHERE item_id = ?',
                ['claimed', itemId]
            );
            
            // Create notification for item owner (optional - if you have notifications)
            try {
                await pool.execute(`
                    INSERT INTO notifications (user_id, type, title, message, item_id, claim_id, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, NOW())
                `, [
                    item.item_owner_id,
                    'claim_approved',
                    'Item Claim Approved',
                    `Someone has successfully claimed your ${item.type} item "${item.title}". You can now arrange the pickup.`,
                    itemId,
                    claimResult.insertId
                ]);
            } catch (notifError) {
                console.log('Notification creation failed (table may not exist):', notifError.message);
            }
        }

        console.log(`✅ Claim submitted: User ${req.user.user_id} claimed item ${itemId} (${claimStatus}) - ${correctAnswers}/${verificationQuestions.length} correct`);

        // Prepare response message
        let message = '';
        if (claimStatus === 'approved') {
            message = 'Perfect match! Your claim has been automatically approved. The item owner will be notified with your contact information.';
        } else if (claimStatus === 'awaiting_proof') {
            message = 'Good match! Your claim requires additional verification. Please provide proof of ownership.';
        } else {
            message = 'Claim submitted for review. Some answers need verification by the item owner.';
        }

        res.status(201).json({
            success: true,
            message: message,
            claim: {
                claim_id: claimResult.insertId,
                status: claimStatus,
                correct_answers: correctAnswers,
                total_questions: verificationQuestions.length,
                item_title: item.title,
                accuracy_percentage: Math.round((correctAnswers / verificationQuestions.length) * 100)
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

// Helper function to calculate string similarity
function calculateSimilarity(str1, str2) {
    if (str1 === str2) return 1;
    
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.length === 0) return 1;
    
    const editDistance = getEditDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
}

// Helper function to calculate edit distance (Levenshtein distance)
function getEditDistance(str1, str2) {
    const matrix = [];
    
    for (let i = 0; i <= str2.length; i++) {
        matrix[i] = [i];
    }
    
    for (let j = 0; j <= str1.length; j++) {
        matrix[0][j] = j;
    }
    
    for (let i = 1; i <= str2.length; i++) {
        for (let j = 1; j <= str1.length; j++) {
            if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1, // substitution
                    matrix[i][j - 1] + 1,     // insertion
                    matrix[i - 1][j] + 1      // deletion
                );
            }
        }
    }
    
    return matrix[str2.length][str1.length];
}

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
                i.status as item_status,
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
// @desc    Manually approve a claim (for item owners)
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
            SET claim_status = 'approved', approved_at = NOW(), contact_revealed = TRUE
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