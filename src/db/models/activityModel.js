const mongoose = require('mongoose');

const activitySchema = new mongoose.Schema({
  icon: {
    type: String,
    default: 'information-circle'
  },
  color: {
    type: String,
    default: '#9090a8'
  },
  title: {
    type: String,
    required: true
  },
  sub: {
    type: String,
    default: ''
  },
  ts: {
    type: Date,
    default: Date.now,
    index: { expires: '30d' } // Auto-prune logs after 30 days — much better for 1M users
  }
});

module.exports = mongoose.model('Activity', activitySchema);
