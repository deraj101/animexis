const axios = require('axios');
const cheerio = require('cheerio');

async function testDood() {
    try {
        const doodUrl = 'https://myvidplay.com/e/bav3bymdni5q';
        console.log('Fetching Doodstream:', doodUrl);
        
        const res = await axios.get(doodUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://anitaku.to/'
            }
        });
        
        // Doodstream usually has a path hidden in a script like '/pass_md5/...'
        const passMatch = res.data.match(/\/pass_md5\/[a-zA-Z0-9_-]+/);
        console.log('Pass match:', passMatch ? passMatch[0] : 'None');
        
        const tokenMatch = res.data.match(/token=([a-zA-Z0-9_-]+)/);
        console.log('Token match:', tokenMatch ? tokenMatch[1] : 'None');

    } catch (e) {
        console.error('Error:', e.message);
    }
}
testDood();
