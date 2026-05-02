/** 
 * notificationRoutes.js
 * 
 * Endpoints for managing user notifications (likes, replies, releases).
 */

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Notification = require('../db/models/notificationModel');

const { requireAuth } = require('../middleware/authMiddleware');

// ── GET /api/notifications — Fetch user notifications ────────────────────────
router.get('/', requireAuth, async (req, res) => {
  try {
    const notifications = await Notification.find({ userEmail: req.userEmail })
      .sort({ createdAt: -1 })
      .limit(50);
    
    const unreadCount = await Notification.countDocuments({ 
      userEmail: req.userEmail, 
      isRead: false 
    });

    res.json({ success: true, notifications, unreadCount });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── PATCH /api/notifications/:id/read — Mark notification as read ────────────
router.patch('/:id/read', requireAuth, async (req, res) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, userEmail: req.userEmail },
      { isRead: true },
      { returnDocument: 'after' }
    );

    if (!notification) {
      return res.status(404).json({ success: false, error: 'Notification not found' });
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── POST /api/notifications/read-all — Mark all as read ─────────────────────
router.post('/read-all', requireAuth, async (req, res) => {
  try {
    await Notification.updateMany(
      { userEmail: req.userEmail, isRead: false },
      { isRead: true }
    );

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
