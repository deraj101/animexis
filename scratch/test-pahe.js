const animePaheScraper = require('../src/services/animePaheScraper');

async function run() {
    console.log('Testing AnimePahe scraper...');
    // "Witch Hat Atelier" is what the user was downloading
    const result = await animePaheScraper.getDownloadLinks('Witch Hat Atelier', 1);
    console.log(JSON.stringify(result, null, 2));
    
    // clean up Playwright
    await animePaheScraper._closeBrowser();
}

run().catch(console.error);
