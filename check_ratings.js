const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const User = require('./src/db/models/userModel');

async function debug() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/animexis');
  const animeId = 'dead-account';
  
  const result = await User.aggregate([
    { $match: { [`ratings.${animeId}`]: { $exists: true } } },
    { $group: {
      _id: null,
      average: { $avg: `$ratings.${animeId}` },
      count: { $sum: 1 }
    }}
  ]);
  
  console.log("Aggregation Result:", result);
  
  const manualCount = await User.countDocuments({ [`ratings.${animeId}`]: { $exists: true } });
  console.log("Manual CountDocuments:", manualCount);

  process.exit(0);
}
debug();
