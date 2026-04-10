const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema({
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    default: null 
  },
  email: { 
    type: String, 
    required: true,
    lowercase: true,
    trim: true
  },
  type: { 
    type: String, 
    enum: ['bug', 'support'], 
    required: true,
    index: true 
  },
  title: { 
    type: String, 
    required: true,
    trim: true
  },
  description: { 
    type: String, 
    required: true 
  },
  status: { 
    type: String, 
    enum: ['open', 'resolved'], 
    default: 'open',
    index: true 
  },
  createdAt: { 
    type: Date, 
    default: Date.now,
    index: true
  },
});

module.exports = mongoose.model('Report', reportSchema);
