const mongoose = require('mongoose');

const watchHistorySchema = new mongoose.Schema({
  email: { 
    type: String, 
    required: true, 
    index: true, 
    lowercase: true 
  },
  anime_id: { 
    type: String, 
    required: true 
  },
  title: { 
    type: String, 
    required: true 
  },
  image: { 
    type: String, 
    default: null 
  },
  episode_url: { 
    type: String, 
    required: true 
  },
  episode_number: { 
    type: String, 
    required: true 
  },
  watched_at: { 
    type: Date, 
    default: Date.now,
    index: true
  }
});

// Optimization for clearing and fetching
watchHistorySchema.index({ email: 1, watched_at: -1 });

module.exports = mongoose.model('WatchHistory', watchHistorySchema);
