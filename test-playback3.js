const scraperService = require('./src/services/scraperService');
const animePaheScraper = require('./src/services/animePaheScraper');

async function test() {
    try {
        console.log("Fetching episode links...");
        // Let's test a gogoanime link since the user can't play ANY anime
        // Format of url that frontend sends is usually the episode link
        const url = '/one-piece-episode-1'; // just an example
        
        const episodeData = await scraperService.getEpisodeLinks(url);
        
        console.log("--- RESULTS ---");
        console.log(JSON.stringify(episodeData, null, 2));
    } catch (e) {
        console.error(e.message);
    }
}
test();
