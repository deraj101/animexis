const axios = require('axios');
const cheerio = require('cheerio');

async function testHG() {
    try {
        const url = 'https://otakuhg.site/e/fo2vdmjo01ri';
        const res = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://anitaku.to/'
            }
        });
        
        console.log('Status:', res.status);
        const m3u8Match = res.data.match(/file:\s*"(https:\/\/[^"]+\.m3u8[^"]*)"/);
        console.log('m3u8:', m3u8Match ? m3u8Match[1] : 'Not found');
    } catch (e) {
        console.error('Error:', e.message);
    }
}
testHG();
