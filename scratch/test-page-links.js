const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

async function checkEpisodePage() {
    const url = 'https://anitaku.to/that-time-i-got-reincarnated-as-a-slime-season-4-episode-1';
    console.log(`Fetching: ${url}\n`);
    
    const resp = await axios.get(url, {
        httpsAgent,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        timeout: 15000
    });

    const $ = cheerio.load(resp.data);

    // Check for download link
    console.log('=== Download Links ===');
    $('a').each((i, el) => {
        const href = $(el).attr('href') || '';
        const text = $(el).text().trim();
        if (href.includes('download') || text.toLowerCase().includes('download')) {
            console.log(`  [${text}] -> ${href}`);
        }
    });

    // Check for iframe
    console.log('\n=== Iframes ===');
    $('iframe').each((i, el) => {
        console.log(`  src: ${$(el).attr('src')}`);
    });

    // Check data-video attributes (server links)
    console.log('\n=== data-video attributes ===');
    $('[data-video]').each((i, el) => {
        console.log(`  ${$(el).text().trim()}: ${$(el).attr('data-video')}`);
    });

    // Check for .dowload or .download class sections
    console.log('\n=== Download sections ===');
    $('.dowload a, .download a, .download-links a, .anime_video_download a').each((i, el) => {
        console.log(`  [${$(el).text().trim()}] -> ${$(el).attr('href')}`);
    });

    // Check for link with "download" in class
    console.log('\n=== Links with download-related classes ===');
    $('a[class*="download"], a[class*="dowload"], li.dowloads a, li.download a').each((i, el) => {
        console.log(`  [${$(el).text().trim()}] -> ${$(el).attr('href')}`);
    });

    // Check the .anime_muti_link section (server list)
    console.log('\n=== Server list (.anime_muti_link) ===');
    $('.anime_muti_link li a, .anime_muti_link a').each((i, el) => {
        const dv = $(el).attr('data-video') || '';
        console.log(`  [${$(el).text().trim()}] data-video: ${dv}`);
    });
    
    process.exit(0);
}

checkEpisodePage().catch(e => { console.error(e.message); process.exit(1); });
