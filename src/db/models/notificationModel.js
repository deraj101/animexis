const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  userEmail: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    index: true
  },
  type: {
    type: String,
    enum: ['REPLY', 'LIKE', 'RELEASE', 'SUPPORT_REPLY', 'SYSTEM'],
    required: true,
    index: true
  },
  refId: {
    type: String, // Can be AnimeId or CommentId
    required: true
  },
  episodeNum: {
    type: String, // Specifically for RELEASE notifications
    default: null
  },
  title: {
    type: String,
    required: true
  },
  message: {
    type: String,
    required: true
  },
  isRead: {
    type: Boolean,
    default: false,
    index: true
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: { expires: '30d' } // Auto-prune after 30 days
  }
}, {
  timestamps: false
});

// Index for fetching a user's notifications efficiently
notificationSchema.index({ userEmail: 1, isRead: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
