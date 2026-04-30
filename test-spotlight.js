const axios = require('axios');
const cheerio = require('cheerio');

async function testSpotlight() {
    try {
        const url = 'https://anitaku.to/';
        const res = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }});
        const $ = cheerio.load(res.data);
        const slides = $('.swiper-wrapper .swiper-slide, #top-spotlight .swiper-slide, .spotlight-section .swiper-slide');
        console.log(`Found ${slides.length} slides on ${url}`);
    } catch (e) {
        console.error(e.message);
    }
}
testSpotlight();
