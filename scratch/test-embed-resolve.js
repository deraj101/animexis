const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

async function resolveEmbed(embedUrl) {
    console.log(`\n=== Resolving embed: ${embedUrl} ===\n`);
    try {
        const resp = await axios.get(embedUrl, {
            httpsAgent,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://anitaku.to/'
            },
            timeout: 10000
        });

        const html = resp.data;
        const $ = cheerio.load(html);

        // Look for video URLs in scripts
        const scripts = $('script').map((i, el) => $(el).html()).get();
        for (const script of scripts) {
            if (!script) continue;
            
            // Look for file/src/source patterns
            const fileMatches = script.match(/(?:file|src|source|video_url|link)\s*[:=]\s*["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*?)["']/gi);
            if (fileMatches) {
                console.log('Found file matches:', fileMatches);
            }
            
            // Look for any m3u8 or mp4 URLs
            const urlMatches = script.match(/(https?:\/\/[^\s"'`]+\.(?:m3u8|mp4)(?:\?[^\s"'`]*)?)/g);
            if (urlMatches) {
                console.log('Found URL matches:', urlMatches);
            }
        }

        // Also check for <source> tags
        $('source, video source').each((i, el) => {
            console.log('Found <source> tag:', $(el).attr('src'), $(el).attr('type'));
        });

        // Check for iframes (nested embeds)
        $('iframe').each((i, el) => {
            console.log('Found nested iframe:', $(el).attr('src'));
        });

        // Print first 2000 chars of HTML for debugging
        console.log('\n--- First 2000 chars of HTML ---');
        console.log(html.substring(0, 2000));

    } catch (err) {
        console.error('Error:', err.message);
    }
}

async function main() {
    // Test with the first vibeplayer embed
    await resolveEmbed('https://vibeplayer.site/37086faf8067c880');
    process.exit(0);
}

main();
