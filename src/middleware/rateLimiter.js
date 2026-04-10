// Rate limiting middleware
const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
    windowMs: (process.env.RATE_LIMIT_WINDOW || 15) * 60 * 1000, // 15 minutes
    // 500 requests per window — a mobile app makes 5-8 API calls per screen load,
    // so 100 was too aggressive and caused normal usage to be rate-limited.
    max: process.env.RATE_LIMIT_MAX || 500,
    message: {
        success: false,
        error: 'Too many requests, please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
        // Never rate-limit health checks or ad video
        return req.path === '/health' || req.path.startsWith('/anime/ad');
    },
});

module.exports = limiter;