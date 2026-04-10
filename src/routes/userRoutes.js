/**
 * userRoutes.js
 * 
 * Endpoints for public user profiles and activity aggregation.
 */

const express = require('express');
const router = express.Router();
const User = require('../db/models/userModel');
const Comment = require('../db/models/commentModel');
const { ContinueWatching } = require('../db/models/analyticsModels');

// ── GET /api/users/public-profile/:email ─────────────────────────────────────
router.get('/public-profile/:email', async (req, res) => {
  try {
    const email = req.params.email.toLowerCase();
    const user = await User.findOne({ email }).lean();

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    // Only return public data
    res.json({
      success: true,
      profile: {
        email: user.email,
        name: user.name || 'Anonymous Fan',
        profile_image: user.profile_image,
        profile_border: user.profile_border,
        subscription: user.subscription || 'free',
        joined_at: user.joined_at,
        isMod: user.isAdmin || false
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── GET /api/users/public-activity/:email ────────────────────────────────────
router.get('/public-activity/:email', async (req, res) => {
  try {
    const email = req.params.email.toLowerCase();

    // 1. Fetch recent comments
    const comments = await Comment.find({ userEmail: email })
      .sort({ ts: -1 })
      .limit(5)
      .lean();

    // 2. Fetch recent watch history
    const watches = await ContinueWatching.find({ email })
      .sort({ updated_at: -1 })
      .limit(5)
      .lean();

    // 3. Aggregate into a unified timeline
    // Format: { type: 'COMMENT'|'WATCH', ts: Date, data: {} }
    const timeline = [
      ...comments.map(c => ({
        type: 'COMMENT',
        ts: c.ts,
        animeId: c.animeId,
        episodeNum: c.episodeNum,
        text: c.text,
        _id: c._id
      })),
      ...watches.map(w => ({
        type: 'WATCH',
        ts: w.updated_at,
        animeId: w.anime_id,
        episodeNum: w.episode_number,
        title: w.title,
        image: w.image,
        _id: w._id
      }))
    ].sort((a, b) => b.ts - a.ts); // Most recent first

    res.json({ success: true, activity: timeline });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
