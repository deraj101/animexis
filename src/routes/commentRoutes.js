/** 
 * commentRoutes.js
 * 
 * Endpoints for managing comments and replies for anime and episodes.
 */

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Comment = require('../db/models/commentModel');
const User    = require('../db/models/userModel'); // 💬 Needed to check admin status
const Notification = require('../db/models/notificationModel'); // 🔔 For in-app alerts

const { requireAuth } = require('../middleware/authMiddleware');
const { isAdmin } = require('../controllers/adminController');


// ── GET /api/comments/:animeId — Fetch all comments for an anime/episode ──────
router.get('/:animeId', async (req, res) => {
  const { animeId } = req.params;
  const { episodeNum } = req.query; // optional: if null, returns anime-level discussion

  try {
    // Normalizing episodeNum (null or string)
    const normalizedEp = (episodeNum === 'null' || !episodeNum) ? null : String(episodeNum);
    
    // Fetch all comments and replies for the given anime + episode
    const comments = await Comment.find({ 
      animeId, 
      episodeNum: normalizedEp 
    }).sort({ ts: -1 }).lean();

    // Dynamically inject the most up-to-date user profile info into the comments
    const userEmails = [...new Set(comments.map(c => c.userEmail))];
    const users = await User.find({ email: { $in: userEmails } }, 'email name profile_image profile_border subscription').lean();
    
    const userMap = users.reduce((acc, user) => {
      acc[user.email.toLowerCase()] = user;
      return acc;
    }, {});

    const populatedComments = comments.map(comment => {
      const liveUser = Object.values(userMap).find(u => u.email === comment.userEmail.toLowerCase()) || userMap[comment.userEmail.toLowerCase()];
      if (liveUser) {
        const userIsAdmin = isAdmin(liveUser.email);
        const isPremium = liveUser.subscription === 'premium';
        return {
          ...comment,
          userName: userIsAdmin ? 'Animexis' : (liveUser.name || comment.userName),
          profileImage: liveUser.profile_image || comment.profileImage,
          profileBorder: isPremium ? (liveUser.profile_border || comment.profileBorder) : null,
          isMod: userIsAdmin || comment.isMod,
          isPremium: isPremium
        };
      }
      
      // If user is deleted, strip premium borders to be safe
      return { ...comment, profileBorder: null, isPremium: false };
    });

    // The frontend handles nesting based on parentId
    res.json({ success: true, comments: populatedComments });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── GET /api/comments/count/:animeId — Fetch total comment + reply count ──────
router.get('/count/:animeId', async (req, res) => {
  const { animeId } = req.params;
  const { episodeNum } = req.query;

  try {
    const normalizedEp = (episodeNum === 'null' || !episodeNum) ? null : String(episodeNum);
    const count = await Comment.countDocuments({ animeId, episodeNum: normalizedEp });
    res.json({ success: true, count });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── POST /api/comments/create — Post a new comment or reply ───────────────────
router.post('/create', requireAuth, async (req, res) => {
  const { animeId, episodeNum, text, parentId, userName, profileImage, profileBorder } = req.body;
  const userEmail = req.userEmail;

  if (!animeId || !text || !userName) {
    return res.status(400).json({ success: false, error: 'AnimeId, text, and userName are required.' });
  }

  try {
    const normalizedEp = (episodeNum === 'null' || !episodeNum) ? null : String(episodeNum);

    const newComment = await Comment.create({
      animeId,
      episodeNum: normalizedEp,
      userEmail,
      userName,
      profileImage,
      profileBorder,
      text,
      parentId: parentId || null,
      isMod: req.isAdmin || false
    });

    res.json({ success: true, comment: newComment });

    // 🔔 Create Notification for Reply
    if (parentId) {
      try {
        const parentComment = await Comment.findById(parentId);
        if (parentComment && parentComment.userEmail !== userEmail) {
          await Notification.create({
            userEmail: parentComment.userEmail,
            type: 'REPLY',
            refId: animeId,
            episodeNum: normalizedEp,
            title: 'New Reply 💬',
            message: `${userName} replied to your comment: "${text.substring(0, 30)}${text.length > 30 ? '...' : ''}"`
          });
        }
      } catch (err) { console.error('Reply notification failed:', err.message); }
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── POST /api/comments/:commentId/like — Toggle a like ────────────────────────
router.post('/:commentId/like', requireAuth, async (req, res) => {
  const { commentId } = req.params;
  const userEmail = req.userEmail;

  try {
    const comment = await Comment.findById(commentId);
    if (!comment) return res.status(404).json({ success: false, error: 'Comment not found' });

    const alreadyLiked = comment.likes.includes(userEmail);
    if (alreadyLiked) {
      // Unlike
      comment.likes = comment.likes.filter(email => email !== userEmail);
    } else {
      // Like
      comment.likes.push(userEmail);
    }

    await comment.save();
    res.json({ success: true, liked: !alreadyLiked, count: comment.likes.length });

    // 🔔 Create Notification for Like (only if being liked, not unliked)
    if (!alreadyLiked && comment.userEmail !== userEmail) {
      try {
        await Notification.create({
          userEmail: comment.userEmail,
          type: 'LIKE',
          refId: comment.animeId,
          episodeNum: comment.episodeNum,
          title: 'New Like ❤️',
          message: `Someone liked your comment: "${comment.text.substring(0, 30)}..."`
        });
      } catch (err) { console.error('Like notification failed:', err.message); }
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── DELETE /api/comments/:commentId ───────────────────────────────────────────
router.delete('/:commentId', requireAuth, async (req, res) => {
  const { commentId } = req.params;
  const userEmail = req.userEmail;

  try {
    const comment = await Comment.findById(commentId);
    if (!comment) return res.status(404).json({ success: false, error: 'Comment not found' });

    // Only the author can delete their comment
    if (comment.userEmail !== userEmail) {
      return res.status(403).json({ success: false, error: 'Unauthorized to delete this comment' });
    }

    // Optional: Recursively delete replies? For now, we just delete the comment.
    // In a more robust system, you might mark it as [deleted] instead.
    await Comment.deleteOne({ _id: commentId });
    
    // Also delete any direct replies
    await Comment.deleteMany({ parentId: commentId });

    res.json({ success: true, message: 'Comment deleted' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
