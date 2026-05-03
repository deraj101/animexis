const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/authMiddleware');
const SubscriptionRequest = require('../db/models/subscriptionRequestModel');

/**
 * POST /api/subscription/request
 * Allows a user to submit a manual payment reference for approval.
 */
router.post('/request', requireAuth, async (req, res) => {
  try {
    const { paymentMethod, referenceNumber, amount, plan } = req.body;
    const userEmail = req.userEmail;

    if (!paymentMethod || !referenceNumber || !amount) {
      return res.status(400).json({ success: false, error: 'Missing required fields (paymentMethod, referenceNumber, amount).' });
    }

    // Check if there's already a pending request for this user
    const existing = await SubscriptionRequest.findOne({ userEmail, status: 'pending' });
    if (existing) {
      return res.status(400).json({ success: false, error: 'You already have a pending request. Please wait for admin approval.' });
    }

    const request = await SubscriptionRequest.create({
      userEmail,
      paymentMethod,
      referenceNumber,
      amount,
      plan: plan || 'premium',
      status: 'pending'
    });

    res.json({ 
      success: true, 
      message: 'Subscription request submitted successfully. Admin will verify your payment soon.',
      request 
    });
  } catch (err) {
    console.error('[subscription] request error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to submit request.' });
  }
});

/**
 * GET /api/subscription/my-requests
 * Returns the user's manual subscription history/status.
 */
router.get('/my-requests', requireAuth, async (req, res) => {
  try {
    const requests = await SubscriptionRequest.find({ userEmail: req.userEmail }).sort({ createdAt: -1 });
    res.json({ success: true, requests });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch requests.' });
  }
});

module.exports = router;
