// src/routes/adminRoutes.js
const express = require('express');
const router  = express.Router();
const admin   = require('../controllers/adminController');
const cache   = require('../middleware/cache');

// All admin routes require a valid admin JWT
router.use(admin.requireAdmin);

// ── Dashboard data ────────────────────────────────────────────────────────────
router.get('/stats',        cache(60),   admin.getStats);         // 1 min TTL — stays fresh
router.get('/recent-users', cache(30),   admin.getRecentUsers);   // 30 s
router.get('/activity',     cache(30),   admin.getActivity);
router.get('/top-anime',    cache(3600), admin.getTopAnime);      // 1 h — scraper data
router.get('/reports',                   admin.getReports);
router.get('/all-users',    cache(30),   admin.getAllUsers);

// ── Mutations (no cache) ──────────────────────────────────────────────────────

router.post('/set-otp-bypass', admin.setOtpBypass);
router.post('/set-subscription', admin.setSubscription);
router.post('/reply-feedback', admin.replyToFeedback);

// ── System ──────────────────────────────────────────────────────────
router.get('/monthly-visits', admin.getMonthlyVisits);
router.get('/active-users',   admin.getActiveUsers);   // no cache — always live
// ── Custom Anime CMS ────────────────────────────────────────────────────────
router.post('/anime', admin.createCustomAnime);
router.get('/anime', admin.getCustomAnimes);
router.put('/anime/:id', admin.updateCustomAnime);
router.delete('/anime/:id', admin.deleteCustomAnime);

// ── Custom Episodes ─────────────────────────────────────────────────────────
router.post('/episodes', admin.addCustomEpisode);
router.get('/episodes/:animeId', admin.getCustomEpisodes);
router.put('/episodes/:id', admin.updateCustomEpisode);
router.delete('/episodes/:id', admin.deleteCustomEpisode);

// ── User Management (Extended) ──────────────────────────────────────────────
router.put('/users/:email', admin.updateUser);
router.delete('/users/:email', admin.deleteUser);

// ── Comment Moderation ──────────────────────────────────────────────────────
router.get('/comments/all', admin.getAllComments);
router.delete('/comments/:id', admin.deleteComment);
router.delete('/feedbacks/:id', admin.deleteReport);

// ── System Announcements ────────────────────────────────────────────────────
router.post('/send-notification', admin.sendGlobalNotification);

module.exports = router;