const jwt = require('jsonwebtoken');
const User = require('../db/models/userModel');

/**
 * requireAuth — Standard middleware for verifying JWT and attaching user to req.
 */
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  
  if (!token) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'changeme_use_env');
    req.userEmail = payload.email.toLowerCase();
    
    const user = await User.findOne({ email: req.userEmail });
    if (!user) {
       return res.status(401).json({ success: false, error: 'User no longer exists' });
    }

    // 🔥 Update last_seen if it's been more than 2 minutes since last update
    const now = new Date();
    const twoMinutesAgo = new Date(now.getTime() - 2 * 60 * 1000);
    
    if (!user.last_seen || user.last_seen < twoMinutesAgo) {
      user.last_seen = now;
      await user.save();
    }

    req.user = user; // Attach the full user object for convenience
    req.isAdmin = !!user.isAdmin;
    
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Invalid or expired session' });
  }
}

module.exports = { requireAuth };
