/** 
 * notificationRoutes.js
 * 
 * Endpoints for managing user notifications (likes, replies, releases).
 */

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Notification = require('../db/models/notificationModel');

// ── Auth middleware ──────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  
  if (!token) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'changeme_use_env');
    req.userEmail = payload.email.toLowerCase();
    next();
  } catch {
    return res.status(401).json({ success: false, error: 'Invalid or expired session' });
  }
}

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
      { new: true }
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
