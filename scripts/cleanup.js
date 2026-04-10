const mongoose = require('mongoose');
mongoose.connect('mongodb://localhost:27017/animexis').then(async () => {
  const db = mongoose.connection.db;
  const r1 = await db.collection('users').updateMany(
    { profile_image: { $regex: '^(blob|file):' } },
    { $set: { profile_image: null } }
  );
  const r2 = await db.collection('comments').updateMany(
    { profileImage: { $regex: '^(blob|file):' } },
    { $set: { profileImage: null } }
  );
  console.log(`Wiped ${r1.modifiedCount} poisoned users and ${r2.modifiedCount} poisoned comments.`);
  process.exit(0);
});
