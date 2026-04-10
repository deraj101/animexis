const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/animexis';

const connectDB = async () => {
  try {
    await mongoose.connect(MONGO_URI, {
      autoIndex: process.env.NODE_ENV !== 'production', // Auto-create indexes (recommended for dev, off in prod 1M+)
    });
    console.log('✅ MongoDB connected successfully');
  } catch (err) {
    console.error('❌ MongoDB connection error:', err.message);
    // Exit if we can't connect - for 1M users we need a stable DB
    process.exit(1);
  }
};

module.exports = connectDB;
