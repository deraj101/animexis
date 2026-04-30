const scraperService = require('../src/services/scraperService');

async function test() {
    try {
        console.log('=== Testing Episode Link Resolution ===\n');
        
        // Test with a known episode URL
        const testUrl = '/that-time-i-got-reincarnated-as-a-slime-season-4-episode-1';
        console.log(`Testing URL: ${testUrl}\n`);
        
        const data = await scraperService.getEpisodeLinks(testUrl);
        
        console.log('\n--- Results ---');
        console.log('Title:', data.title);
        console.log('Iframe:', data.iframe);
        console.log('Video Sources:', JSON.stringify(data.videoSources, null, 2));
        console.log('Download Links:', JSON.stringify(data.downloadLinks, null, 2));
        
        // Check if any source is a direct MP4
        const mp4Sources = data.videoSources.filter(s => s.url && s.url.includes('.mp4'));
        const m3u8Sources = data.videoSources.filter(s => s.url && s.url.includes('.m3u8'));
        
        console.log(`\n--- Summary ---`);
        console.log(`MP4 sources: ${mp4Sources.length}`);
        console.log(`M3U8 sources: ${m3u8Sources.length}`);
        console.log(`Download links: ${data.downloadLinks.length}`);
        console.log(`Has iframe: ${!!data.iframe}`);
        
    } catch (err) {
        console.error('Test failed:', err.message);
    }
    process.exit(0);
}

test();
