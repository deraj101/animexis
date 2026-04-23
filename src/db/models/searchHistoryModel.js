const mongoose = require('mongoose');

const searchHistorySchema = new mongoose.Schema({
  email: { 
    type: String, 
    required: true, 
    index: true, 
    lowercase: true 
  },
  query: { 
    type: String, 
    required: true 
  },
  searched_at: { 
    type: Date, 
    default: Date.now,
    index: true
  }
});

// Optimization for clearing and fetching
searchHistorySchema.index({ email: 1, searched_at: -1 });

module.exports = mongoose.model('SearchHistory', searchHistorySchema);
