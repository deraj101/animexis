const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
  animeId: {
    type: String,
    required: true,
    index: true
  },
  episodeNum: {
    type: String, // String to handle '1', '2', or 'OVA'
    default: null, // null = anime-level discussion
    index: true
  },
  userEmail: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    index: true
  },
  userName: {
    type: String,
    required: true
  },
  profileImage: {
    type: String,
    default: null
  },
  profileBorder: {
    type: String,
    default: null
  },
  text: {
    type: String,
    required: true,
    trim: true,
    maxlength: 1000
  },
  parentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Comment',
    default: null, // null = top-level comment
    index: true
  },
  likes: {
    type: [String], // Array of user emails who liked
    default: []
  },
  isMod: {
    type: Boolean,
    default: false
  },
  ts: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: false
});

// Index for fetching a specific anime/episode's comments efficiently
commentSchema.index({ animeId: 1, episodeNum: 1, ts: -1 });

module.exports = mongoose.model('Comment', commentSchema);
