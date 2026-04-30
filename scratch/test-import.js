async function test() {
    try {
        const { AnimeScraper } = await import('better-ani-scraped');
        const animepahe = new AnimeScraper('animepahe');
        
        console.log('Searching for Slime...');
        const results = await animepahe.searchAnime('Slime');
        console.log('Results:', results);
    } catch (e) {
        console.error(e);
    }
}
test();
