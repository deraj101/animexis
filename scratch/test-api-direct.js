const { chromium } = require('playwright-chromium');

async function testApi() {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
        console.log('Fetching links API directly...');
        // We need to visit the site first to get cookies
        await page.goto('https://animepahe.com/');
        await page.waitForTimeout(2000);
        
        const epSession = '1ed62a47c969f3cd8aae4a6fc9eee052f80e7695bbdbd14a25371e107b4080a0';
        await page.goto(`https://animepahe.com/api?m=links&id=${epSession}&p=kwik`);
        
        const content = await page.innerText('body');
        console.log('API Response:', content);
    } catch (e) {
        console.error(e);
    } finally {
        await browser.close();
    }
}
testApi();
