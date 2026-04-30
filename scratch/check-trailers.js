const mongoose = require('mongoose');
require('dotenv').config();

async function checkTrailers() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/animexis');
    const Mapping = require('../src/db/models/mappingModel');
    
    const count = await Mapping.countDocuments();
    const withTrailer = await Mapping.countDocuments({ 'trailer.id': { $exists: true, $ne: null } });
    
    console.log(`Total Mappings: ${count}`);
    console.log(`Mappings with Trailer: ${withTrailer}`);
    
    if (withTrailer > 0) {
      const sample = await Mapping.findOne({ 'trailer.id': { $exists: true, $ne: null } });
      console.log('Sample Trailer:', sample.title.english || sample.title.romaji, '->', sample.trailer);
    }
    
    await mongoose.disconnect();
  } catch (err) {
    console.error(err);
  }
}

checkTrailers();
