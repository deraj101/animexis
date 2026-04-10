// scripts/reset-db.js
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const User = require('../src/db/models/userModel');
const Activity = require('../src/db/models/activityModel');
const { AnimeView, AppVisit, ContinueWatching } = require('../src/db/models/analyticsModels');

const ADMIN_EMAIL = 'admin@animexis.com';
const ADMIN_PASS  = 'admin123456'; 

async function reset() {
  const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/animexis';
  
  console.log('🔄 Connecting to MongoDB for reset...');
  await mongoose.connect(MONGO_URI);

  console.log('🗑️ Dropping all collections...');
  try {
    await User.deleteMany({});
    await Activity.deleteMany({});
    await AnimeView.deleteMany({});
    await AppVisit.deleteMany({});
    await ContinueWatching.deleteMany({});
  } catch (err) {
    console.warn('⚠️ Warning during drop (it might be empty):', err.message);
  }

  console.log('👤 Creating unique Admin account...');
  const hashedPassword = await bcrypt.hash(ADMIN_PASS, 10);
  
  await User.create({
    email: ADMIN_EMAIL,
    password_hash: hashedPassword,
    joined_at: new Date(),
    last_seen: new Date(),
    is_banned: false,
    otp_bypass: true 
  });

  console.log('✅ Success!');
  console.log('---------------------------------');
  console.log(`Email:    ${ADMIN_EMAIL}`);
  console.log(`Password: ${ADMIN_PASS}`);
  console.log('---------------------------------');
  console.log('⚠️ REMINDER: Your .env has been updated to include this email in ADMIN_EMAILS.');
  
  await mongoose.disconnect();
}

reset().catch(err => {
  console.error('❌ Reset failed:', err);
  process.exit(1);
});
