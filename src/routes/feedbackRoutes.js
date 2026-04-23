const express = require('express');
const router = express.Router();
const Feedback = require('../db/models/feedbackModel');
const User = require('../db/models/userModel');
const Notification = require('../db/models/notificationModel');
const jwt = require('jsonwebtoken');

// Middleware to optionally attach user if token is provided
const optionalAuth = async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  
  if (!token) {
    return next();
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'changeme_use_env');
    const user = await User.findOne({ email: payload.email.toLowerCase() });
    if (user) {
      req.user = user;
    }
  } catch (err) {
    // Ignore invalid tokens for optional auth
  }
  next();
};

/**
 * POST /api/feedback
 * Submit a new feedback or bug report
 */
router.post('/', optionalAuth, async (req, res) => {
  try {
    const { type, message } = req.body;

    if (!type || !['bug', 'feature', 'other'].includes(type)) {
      return res.status(400).json({ success: false, error: 'Invalid or missing feedback type' });
    }

    if (!message || message.trim() === '') {
      return res.status(400).json({ success: false, error: 'Message is required' });
    }

    const payload = {
      type,
      message: message.trim(),
    };

    if (req.user) {
      payload.user = req.user._id;
    }

    const newFeedback = await Feedback.create(payload);

    // Auto-reply notification bot
    if (req.user && req.user.email) {
      await Notification.create({
        userEmail: req.user.email,
        type: 'SUPPORT_REPLY',
        refId: newFeedback._id,
        title: 'Animexis Support',
        message: 'Thank you for your feedback! Our team has received your report and will look into it shortly.'
      });
    }

    res.status(201).json({
      success: true,
      message: 'Feedback submitted successfully',
      feedback: newFeedback
    });
  } catch (err) {
    console.error('Feedback submission error:', err);
    res.status(500).json({ success: false, error: 'Failed to submit feedback' });
  }
});

module.exports = router;
