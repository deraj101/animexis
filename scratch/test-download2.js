const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

async function checkDownload() {
    const url = 'https://anitaku.to/that-time-i-got-reincarnated-as-a-slime-season-4-episode-1';
    const resp = await axios.get(url, {
        httpsAgent,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
    });

    const $ = cheerio.load(resp.data);
    const dlLink = $('.dowloads a').attr('href');
    console.log('Class .dowloads a href:', dlLink);

    // Look for any download links in text
    const textMatches = resp.data.match(/https?:\/\/[^\s"'<]+download[^\s"'<]+/gi);
    console.log('Any text matching "download" URL:', textMatches);
}

checkDownload();
