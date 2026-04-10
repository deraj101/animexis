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
router.get('/all-users',    cache(30),   admin.getAllUsers);

// ── Mutations (no cache) ──────────────────────────────────────────────────────
router.post('/ban-user',      admin.banUser);
router.post('/unban-user',    admin.unbanUser);
router.post('/set-otp-bypass', admin.setOtpBypass);
router.post('/set-subscription', admin.setSubscription);

// ── System & Scraper ──────────────────────────────────────────────────────────
router.get('/scraper-status', admin.getScraperStatus);
router.post('/scraper-find-domain', admin.findWorkingDomain);
router.post('/clear-cache', admin.clearAllCache);
router.get('/monthly-visits', admin.getMonthlyVisits);
router.get('/active-users',   admin.getActiveUsers);   // no cache — always live

module.exports = router;