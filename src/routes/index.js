// src/routes/index.js
// Aggregates all routes. Admin routes are now mounted here.

const express     = require('express');
const router      = express.Router();
const animeRoutes = require('./animeRoutes');
const authRoutes  = require('./Auth_routes');
const adminRoutes = require('./adminRoutes');
const statsRoutes = require('./statsRoutes');
const commentRoutes = require('./commentRoutes');
const notificationRoutes = require('./notificationRoutes');
const userRoutes = require('./userRoutes'); // 👤 NEW
const paymentRoutes = require('./paymentRoutes'); // 💳 NEW
const feedbackRoutes = require('./feedbackRoutes'); // 📝 NEW
const subscriptionRoutes = require('./subscriptionRoutes'); // 🛡️ NEW

// ── Health check ──────────────────────────────────────────────────────────────
router.get('/health', (req, res) => {
  res.json({
    status:    'OK',
    timestamp: new Date().toISOString(),
    uptime:    process.uptime(),
  });
});

// ── Mount routes ──────────────────────────────────────────────────────────────
router.use('/anime', animeRoutes);
router.use('/auth',  authRoutes);
router.use('/admin', adminRoutes);   // ← all endpoints require admin JWT
router.use('/stats', statsRoutes);  // ← user stats (replaces AsyncStorage)
router.use('/comments', commentRoutes); // ← comment system 💬
router.use('/notifications', notificationRoutes); // ← notification system 🔔
router.use('/users', userRoutes); // ← public profiles 👤
router.use('/payments', paymentRoutes); // ← subscription payments 💳
router.use('/feedback', feedbackRoutes); // ← user feedback 📝
router.use('/subscription', subscriptionRoutes); // 🛡️ NEW

// ── API info ──────────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  res.json({
    name:    'Animexis API',
    version: '1.0.0',
    endpoints: {
      health:       '/api/health',
      recent:       '/api/anime/recent',
      search:       '/api/anime/search?q={query}',
      details:      '/api/anime/{id}',
      adminStats:   '/api/admin/stats',          // requires admin JWT
      adminUsers:   '/api/admin/recent-users',   // requires admin JWT
    },
  });
});

module.exports = router;