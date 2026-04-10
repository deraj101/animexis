const jwt = require('jsonwebtoken');
const userService = require('../db/userService');
const redisClient = require('../db/redisClient');

/**
 * usageLimiter — Enforces the 20-episode daily limit for Free users.
 * Requires a valid JWT to identify the user.
 */
async function usageLimiter(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required to watch episodes.',
      limitReached: false
    });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'changeme_use_env');
    const email = payload.email.toLowerCase();

    // 1. Check user subscription status
    const user = await userService.findUser(email);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    // Premium users have no limit
    if (user.subscription === 'premium') {
      return next();
    }

    // 2. Enforce 20-unique-episode limit for Free users via Redis Set
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const setKey = `usage:episodes:set:${email}:${today}`;
    
    // Identify the unique content being watched (favor the episode URL)
    const contentId = req.query.url || req.originalUrl;

    // Add this URL to the set for today. 
    // .sAdd returns 1 if it's a NEW member, 0 if it was already there.
    await redisClient.sAdd(setKey, contentId);
    
    // Set expiry to 24h (86400s) on the set
    await redisClient.expire(setKey, 86400); 

    // Get the current count of unique episodes (cardinality of the set)
    const count = await redisClient.sCard(setKey);

    if (count > 20) {
      return res.status(403).json({
        success: false,
        message: 'Daily limit reached (20/20 episodes). Upgrade to Premium for unlimited access!',
        limitReached: true,
        count: 20, 
        limit: 20
      });
    }

    // Attach usage info to response if needed
    req.usage = { count, limit: 20, subscription: 'free' };
    next();
  } catch (err) {
    console.error('Usage limiter error:', err.message);
    return res.status(401).json({ success: false, message: 'Invalid or expired session.' });
  }
}

module.exports = usageLimiter;
