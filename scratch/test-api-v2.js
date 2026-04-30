const { chromium } = require('playwright-chromium');

async function getPaheLinks(query, episodeNumber) {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();

    try {
        console.log(`Searching for: ${query}`);
        await page.goto(`https://animepahe.com/api?m=search&q=${encodeURIComponent(query)}`);
        
        let searchData;
        for (let i = 0; i < 15; i++) {
            const content = await page.innerText('body');
            try {
                searchData = JSON.parse(content);
                break;
            } catch (e) {
                await page.waitForTimeout(2000);
            }
        }

        if (!searchData || !searchData.data) {
            console.log('No anime found.');
            return;
        }

        const anime = searchData.data.find(a => a.title.toLowerCase().includes(query.toLowerCase())) || searchData.data[0];
        console.log(`Found Anime: ${anime.title} (ID: ${anime.id}, Session: ${anime.session})`);

        // Get episodes
        await page.goto(`https://animepahe.com/api?m=release&id=${anime.session}&sort=episode_asc&page=1`);
        let epData;
        for (let i = 0; i < 15; i++) {
            const content = await page.innerText('body');
            try {
                epData = JSON.parse(content);
                break;
            } catch (e) {
                await page.waitForTimeout(2000);
            }
        }

        const episode = epData.data.find(e => e.episode === parseInt(episodeNumber)) || epData.data[0];
        console.log(`Using Episode: ${episode.episode} (Session: ${episode.session})`);

        // Try the links API
        const linksUrl = `https://animepahe.com/api?m=links&id=${anime.id}&session=${episode.session}&p=kwik`;
        console.log(`Fetching links API: ${linksUrl}`);
        await page.goto(linksUrl);
        
        await page.waitForTimeout(5000);
        const content = await page.innerText('body');
        console.log('Raw API Content:', content);

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await browser.close();
    }
}

getPaheLinks('Slime', 1);
