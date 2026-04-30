const axios = require('axios');

const domains = [
    'https://anitaku.to',
    'https://anitaku.so',
    'https://anitaku.pe',
    'https://anitaku.bz',
    'https://anitaku.cv',
    'https://gogoanime3.co',
    'https://gogoanime.to',
    'https://gogoanime.hu'
];

async function testDomains() {
    for (const url of domains) {
        try {
            console.log(`Testing ${url}/home/...`);
            const start = Date.now();
            const res = await axios.get(url + '/home/', { timeout: 5000, maxRedirects: 0, validateStatus: () => true });
            const time = Date.now() - start;
            console.log(`✅ ${url}/home/ -> Status: ${res.status}, Time: ${time}ms`);
            if (res.headers.location) {
                console.log(`   Redirects to: ${res.headers.location}`);
            }
        } catch (e) {
            console.log(`❌ ${url}/home/ -> Error: ${e.message}`);
        }
    }
}

testDomains();
