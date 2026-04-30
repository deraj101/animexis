require('dotenv').config();
const scraper = require('../src/services/animePaheScraper');

(async () => {
    console.log('Testing AnimePahe getDownloadLinks for One Piece Ep 10...');
    const result = await scraper.getDownloadLinks('One Piece', 10);
    console.log('\n\n--- FINAL RESULT ---');
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
})();
