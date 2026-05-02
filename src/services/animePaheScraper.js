/**
 * AnimePahe Scraper — Optimised for Speed
 * 
 * Uses a persistent Playwright browser pool so we only pay the DDoS-Guard
 * bypass cost once, then reuse cookies for subsequent requests.
 * 
 * Architecture:
 *  1. search()       — JSON API via Playwright (DDoS-Guard protected)
 *  2. getEpisodes()  — JSON API via same context (cookies carry)
 *  3. getSources()   — Scrapes play page for pahe.win / kwik.cx links
 *  4. resolveLink()  — Follows pahe.win → kwik.cx → extracts direct MP4
 */
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);
const NodeCache = require('node-cache');

// Cache search results (1h) and episode lists (30min) to avoid hammering API
const cache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });

class AnimePaheScraper {
    constructor() {
        this.baseUrl = 'https://animepahe.com';
        this._browser = null;
        this._context = null;
        this._launching = null;  // prevents duplicate launches
    }

    // ────────────────────────────────────────────────────────────────────────────
    // BROWSER POOL — reuse a single browser + context to keep DDoS-Guard cookies
    // ────────────────────────────────────────────────────────────────────────────
    async _getContext() {
        if (this._context) {
            try {
                // Quick sanity check — does the browser still exist?
                await this._browser.version();
                return this._context;
            } catch {
                this._browser = null;
                this._context = null;
            }
        }

        // Avoid launching two browsers in parallel
        if (this._launching) return this._launching;

        this._launching = (async () => {
            console.log('[AnimePahe] 🚀 Launching persistent browser (Headless: FALSE to bypass Cloudflare)...');
            this._browser = await chromium.launch({
                headless: false,
                args: ['--disable-blink-features=AutomationControlled']
            });
            this._context = await this._browser.newContext({
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                locale: 'en-US'
            });

            // Close the browser if it crashes or disconnects
            this._browser.on('disconnected', () => {
                console.log('[AnimePahe] ⚠️ Browser disconnected');
                this._browser = null;
                this._context = null;
            });

            // Auto-close idle browser after 10 minutes
            this._resetIdleTimer();

            return this._context;
        })();

        const ctx = await this._launching;
        this._launching = null;
        return ctx;
    }

    _resetIdleTimer() {
        if (this._idleTimer) clearTimeout(this._idleTimer);
        this._idleTimer = setTimeout(() => {
            console.log('[AnimePahe] 💤 Closing idle browser...');
            this._closeBrowser();
        }, 10 * 60 * 1000); // 10 minutes
    }

    async _closeBrowser() {
        if (this._browser) {
            await this._browser.close().catch(() => {});
            this._browser = null;
            this._context = null;
        }
    }

    // ────────────────────────────────────────────────────────────────────────────
    // HELPER — Navigate to a URL and wait for the DDoS-Guard challenge to pass,
    // then parse the JSON body.
    // ────────────────────────────────────────────────────────────────────────────
    async _fetchJson(url, label = 'API') {
        const context = await this._getContext();
        const page = await context.newPage();
        this._resetIdleTimer();

        try {
            console.log(`[AnimePahe] 🌐 ${label}: ${url}`);
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

            for (let i = 0; i < 20; i++) {
                const content = await page.innerText('body');
                try {
                    const data = JSON.parse(content);
                    console.log(`[AnimePahe] ✅ ${label} OK (${i + 1} attempts)`);
                    return data;
                } catch {
                    if (i > 0 && i % 5 === 0) {
                        console.log(`[AnimePahe] ⏳ ${label} waiting for DDoS-Guard (attempt ${i + 1})...`);
                    }
                    await page.waitForTimeout(1000);
                }
            }

            console.log(`[AnimePahe] ❌ ${label} failed after 20 attempts`);
            return null;
        } finally {
            await page.close();
        }
    }

    // ────────────────────────────────────────────────────────────────────────────
    // SEARCH — Find anime by title
    // ────────────────────────────────────────────────────────────────────────────
    async search(query) {
        const cacheKey = `pahe_search_${query.toLowerCase().trim()}`;
        const cached = cache.get(cacheKey);
        if (cached) {
            console.log(`[AnimePahe] 📦 Cache hit for search: "${query}"`);
            return cached;
        }

        try {
            const data = await this._fetchJson(
                `${this.baseUrl}/api?m=search&q=${encodeURIComponent(query)}`,
                `Search "${query}"`
            );

            if (!data || !data.data) {
                console.log(`[AnimePahe] ❌ No results for: ${query}`);
                return [];
            }

            const results = data.data.map(anime => ({
                id: anime.session,
                animeId: anime.id,
                title: anime.title,
                type: anime.type,
                episodes: anime.episodes,
                status: anime.status,
                season: anime.season,
                year: anime.year,
                score: anime.score,
                image: anime.poster
            }));

            cache.set(cacheKey, results);
            console.log(`[AnimePahe] ✅ Found ${results.length} results for "${query}"`);
            return results;
        } catch (error) {
            console.error('[AnimePahe] Search error:', error.message);
            return [];
        }
    }

    // ────────────────────────────────────────────────────────────────────────────
    // GET EPISODES — Fetch episode list for an anime session
    // ────────────────────────────────────────────────────────────────────────────
    async getEpisodes(animeSession, pageNum = 1) {
        const cacheKey = `pahe_eps_${animeSession}_p${pageNum}`;
        const cached = cache.get(cacheKey);
        if (cached) {
            console.log(`[AnimePahe] 📦 Cache hit for episodes: ${animeSession}`);
            return cached;
        }

        try {
            const data = await this._fetchJson(
                `${this.baseUrl}/api?m=release&id=${animeSession}&sort=episode_asc&page=${pageNum}`,
                `Episodes (${animeSession})`
            );

            if (!data || !data.data) {
                console.log(`[AnimePahe] ❌ No episodes for: ${animeSession}`);
                return [];
            }

            const episodes = data.data.map(ep => ({
                number: ep.episode,
                session: ep.session,
                image: ep.snapshot,
                duration: ep.duration,
                isAired: ep.filler === 0
            }));

            cache.set(cacheKey, episodes, 1800); // 30min TTL for episodes
            console.log(`[AnimePahe] ✅ Found ${episodes.length} episodes (total: ${data.total})`);
            return episodes;
        } catch (error) {
            console.error('[AnimePahe] Episodes error:', error.message);
            return [];
        }
    }

    // ────────────────────────────────────────────────────────────────────────────
    // GET SOURCES — Visit play page and extract download links
    // Returns array of { url, quality, type: 'pahe_redirect' | 'kwik_embed' }
    // ────────────────────────────────────────────────────────────────────────────
    async getSources(animeSession, epSession) {
        const context = await this._getContext();
        const page = await context.newPage();
        this._resetIdleTimer();

        // Block ads/tracking to speed things up
        await page.route('**/*', route => {
            const url = route.request().url();
            if (/google-analytics|doubleclick|ads\.|tracking|pop\.|traveloka/i.test(url)) {
                return route.abort();
            }
            route.continue();
        });

        try {
            const playUrl = `${this.baseUrl}/play/${animeSession}/${epSession}`;
            console.log(`[AnimePahe] 🎬 Visiting play page: ${playUrl}`);
            await page.goto(playUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

            // Wait for DDoS-Guard
            for (let i = 0; i < 30; i++) {
                const title = await page.title();
                const content = await page.innerText('body').catch(() => '');
                if (!title.includes('Just a moment') && 
                    !content.includes('Checking') && 
                    !content.includes('DDoS') && 
                    !content.includes('security verification') &&
                    content.length > 100) {
                    console.log(`[AnimePahe] ✅ Play page loaded`);
                    break;
                }
                await page.waitForTimeout(1000);
            }

            // Wait for download dropdown
            try {
                await page.waitForSelector('#pickDownload, a[href*="pahe.win"], a[href*="kwik"]', { timeout: 10000 });
            } catch {
                console.log(`[AnimePahe] ⚠️ No download links found after waiting`);
            }

            // Extract all links
            const links = await page.evaluate(() => {
                const results = [];
                const seen = new Set();

                const add = (text, url, type) => {
                    if (!url || seen.has(url)) return;
                    seen.add(url);
                    results.push({ text: text.trim(), url, type });
                };

                // 1. Check #pickDownload dropdown items (pahe.win links with size info)
                document.querySelectorAll('#pickDownload .dropdown-item').forEach(a => {
                    add(a.innerText, a.href, 'pahe_redirect');
                });

                // 2. Check all links for pahe.win or kwik.cx
                document.querySelectorAll('a').forEach(a => {
                    if (a.href.includes('pahe.win')) {
                        add(a.innerText, a.href, 'pahe_redirect');
                    } else if (a.href.includes('kwik.cx') || a.href.includes('kwik.si') || a.href.includes('kwik.cx/e/')) {
                        add(a.innerText, a.href, 'kwik_embed');
                    }
                });

                // 3. Also check scripts for hidden kwik links
                const scripts = Array.from(document.querySelectorAll('script'));
                scripts.forEach(s => {
                    const matches = s.innerText.match(/https?:\/\/kwik\.(cx|si)\/(e|f)\/[a-zA-Z0-9]+/g);
                    if (matches) {
                        matches.forEach(m => {
                            add('Direct Kwik Link', m, 'kwik_embed');
                        });
                    }
                });

                return results;
            });

            if (links.length === 0) {
                console.log(`[AnimePahe] ❌ No download links found on play page`);
                return [];
            }

            // Parse quality + filesize from link text
            // Format: "df68 · 360p (46MB) BD" or "df68 · 800p BD"
            const sources = links.map(link => {
                const qualityMatch = link.text.match(/(\d+)p/);
                const sizeMatch = link.text.match(/\((\d+)MB\)/);
                return {
                    url: link.url,
                    quality: qualityMatch ? `${qualityMatch[1]}p` : 'unknown',
                    filesize: sizeMatch ? `${sizeMatch[1]}MB` : null,
                    type: link.type,
                    label: link.text
                };
            });

            // Sort: prefer pahe_redirect (has filesize info), then higher quality
            sources.sort((a, b) => {
                if (a.type === 'pahe_redirect' && b.type !== 'pahe_redirect') return -1;
                if (b.type === 'pahe_redirect' && a.type !== 'pahe_redirect') return 1;
                const qa = parseInt(a.quality) || 0;
                const qb = parseInt(b.quality) || 0;
                return qb - qa; // Higher quality first
            });

            console.log(`[AnimePahe] ✅ Found ${sources.length} sources:`, sources.map(s => `${s.quality} (${s.type})`));
            return sources;
        } catch (error) {
            console.error('[AnimePahe] getSources error:', error.message);
            return [];
        } finally {
            await page.close();
        }
    }

    // ────────────────────────────────────────────────────────────────────────────
    // RESOLVE LINK — Follow pahe.win → kwik → extract direct MP4
    // This is the final step to get a downloadable URL.
    // ────────────────────────────────────────────────────────────────────────────
    async resolveLink(source) {
        const context = await this._getContext();
        const page = await context.newPage();
        this._resetIdleTimer();

        try {
            if (source.type === 'pahe_redirect') {
                // pahe.win redirector — click the redirect button to land on kwik
                console.log(`[AnimePahe] 🔀 Following pahe.win redirect: ${source.url}`);

                // Set up network interception to catch kwik URLs from redirects
                let interceptedKwikUrl = null;
                page.on('request', req => {
                    const u = req.url();
                    
                    // If it's a wrapper (like thum.io), extract the nested URL
                    if (u.includes('thum.io') || u.includes('thumbnail') || u.includes('screenshot')) {
                        const nestedMatch = u.match(/https?:\/\/(?:www\.)?kwik\.(?:cx|si)\/(?:f|e)\/[a-zA-Z0-9]+/);
                        if (nestedMatch) interceptedKwikUrl = nestedMatch[0];
                        return;
                    }

                    if (u.includes('kwik.cx/f/') || u.includes('kwik.cx/e/') || u.includes('kwik.si/')) {
                        interceptedKwikUrl = u;
                    }
                });

                // Also watch for new pages opening (popups) that go to kwik
                const popupPromise = context.waitForEvent('page', { 
                    predicate: p => p.url().includes('kwik.cx') || p.url().includes('kwik.si'),
                    timeout: 25000 
                }).catch(() => null);

                await page.goto(source.url, { waitUntil: 'domcontentloaded', timeout: 30000 });

                // Wait for DDoS-Guard on pahe.win
                for (let i = 0; i < 15; i++) {
                    const title = await page.title();
                    const content = await page.innerText('body').catch(() => '');
                    if (!title.includes('Just a moment') && 
                        !content.includes('Checking') && 
                        !content.includes('DDoS') && 
                        !content.includes('security verification')) {
                        break;
                    }
                    await page.waitForTimeout(1000);
                }

                // Broadened button detection — pahe.win changes button text frequently
                let newPage = null;
                try {
                    const btnHandle = await page.waitForFunction(() => {
                        const els = Array.from(document.querySelectorAll('a, button, input[type="submit"]'));
                        return els.find(el => {
                            const text = (el.innerText || el.value || '').toLowerCase();
                            return text.includes('redirect') || text.includes('continue') || 
                                   text.includes('get link') || text.includes('download') ||
                                   text.includes('click here') || text.includes('generate') ||
                                   text.includes('link') || text.includes('go to') || text.includes('please wait');
                        }) || document.querySelector('.redirect-btn, .link-btn, #btn-main, .btn, #downloadMenu');
                    }, { timeout: 10000 }).catch(() => null);

                    if (btnHandle) {
                        console.log(`[AnimePahe] 🖱️ Clicking redirect button...`);
                        [newPage] = await Promise.all([
                            context.waitForEvent('page', { timeout: 20000 }).catch(() => null),
                            page.evaluate(() => {
                                const els = Array.from(document.querySelectorAll('a, button, input[type="submit"]'));
                                const btn = els.find(el => {
                                    const text = (el.innerText || el.value || '').toLowerCase();
                                    return text.includes('redirect') || text.includes('continue') || 
                                           text.includes('get link') || text.includes('download') ||
                                           text.includes('click here') || text.includes('generate') ||
                                           text.includes('link') || text.includes('go to');
                                }) || document.querySelector('.redirect-btn, .link-btn, #btn-main, .btn, #downloadMenu');
                                if (btn) { btn.click(); return true; }
                                return false;
                            })
                        ]);
                    }
                } catch (err) {
                    console.log(`[AnimePahe] ⚠️ Error during redirect click: ${err.message}`);
                }

                // Prioritize: 1. A new page that opened, 2. A page caught by popupPromise, 3. Intercepted URL
                let kwikPage = newPage || (await popupPromise);
                
                // 🚀 ZENROWS INTEGRATION
                if (interceptedKwikUrl && process.env.ZENROWS_API_KEY) {
                    console.log(`[AnimePahe] 🛡️ ZenRows API Key found! Bypassing Cloudflare...`);
                    try {
                        const axios = require('axios');
                        const zenUrlBase = `https://api.zenrows.com/v1/?apikey=${process.env.ZENROWS_API_KEY}&antibot=true&js_render=true&premium_proxy=true&wait=5000`;
                        
                        console.log(`[AnimePahe] 🛡️ ZenRows Request (Step 1: Get Form)...`);
                        let response = await axios.get(`${zenUrlBase}&url=${encodeURIComponent(interceptedKwikUrl)}`, { timeout: 60000 });
                        let html = response.data;
                        
                        // Check for Download Form
                        const tokenMatch = html.match(/name="_token"\s+value="([^"]+)"/);
                        const actionMatch = html.match(/action="([^"]+)"/);
                        
                        if (tokenMatch && actionMatch) {
                            const token = tokenMatch[1];
                            const actionUrl = actionMatch[1];
                            console.log(`[AnimePahe] 🔑 Found Kwik Download Token. Step 2: POSTing...`);
                            
                            // Make a POST request via ZenRows
                            const postData = new URLSearchParams();
                            postData.append('_token', token);
                            
                            response = await axios.post(`${zenUrlBase}&url=${encodeURIComponent(actionUrl)}`, postData.toString(), { 
                                timeout: 60000,
                                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
                            });
                            html = response.data;
                        }
                        
                        // Try custom decoder first (most reliable for Kwik)
                        const decodedUrl = this._decodeKwikCustom(html);
                        if (decodedUrl) {
                            console.log(`[AnimePahe] ✅ ZenRows + Custom Decoder extracted MP4: ${decodedUrl.substring(0, 50)}...`);
                            return { url: decodedUrl, quality: source.quality, isPahe: true };
                        }

                        // Fallback to standard sniff
                        const sourceMatch = html.match(/<source[^>]+src=["'](https?:\/\/[a-zA-Z0-9.-]+\.(?:nextcdn|kwcdn|kwikcdn)\.org\/[^"']+)["']/i);
                        const rawMatch = html.match(/https?:\/\/[a-zA-Z0-9.-]+\.(?:nextcdn|kwcdn|kwikcdn)\.org\/(?:download|stream)\/[^"'\s\\]+/i);
                        
                        const finalUrl = (sourceMatch && sourceMatch[1]) || (rawMatch && rawMatch[0]);

                        if (finalUrl) {
                            console.log(`[AnimePahe] ✅ ZenRows successfully extracted MP4: ${finalUrl.substring(0, 50)}...`);
                            return { url: finalUrl, quality: source.quality, isPahe: true };
                        } else {
                            console.log(`[AnimePahe] ⚠️ ZenRows bypass succeeded, but MP4 not found in HTML. Dumping HTML...`);
                            require('fs').writeFileSync('scratch/zenrows_debug.html', html);
                        }
                    } catch (zenErr) {
                        console.log(`[AnimePahe] ❌ ZenRows API failed: ${zenErr.message}`);
                        if (zenErr.response) {
                            console.log(`[AnimePahe] ❌ ZenRows Response Status: ${zenErr.response.status}`);
                        }
                    }
                }

                if (!kwikPage) {
                    if (interceptedKwikUrl) {
                        console.log(`[AnimePahe] 🎯 Using intercepted Kwik URL in original page: ${interceptedKwikUrl}`);
                        kwikPage = page;
                        await kwikPage.goto(interceptedKwikUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                    } else {
                        await page.waitForTimeout(3000);
                        if (page.url().includes('kwik')) {
                            kwikPage = page;
                        }
                    }
                }

                if (kwikPage) {
                    console.log(`[AnimePahe] 📄 Found Kwik page: ${kwikPage.url()}`);
                    const mp4 = await this._extractKwikMp4(kwikPage);
                    
                    // Close extra pages
                    const allPages = context.pages();
                    for (const p of allPages) {
                        if (p !== page && p !== kwikPage) await p.close().catch(() => {});
                    }
                    
                    if (mp4) return { url: mp4, quality: source.quality, isPahe: true };
                } else {
                    console.log(`[AnimePahe] ⚠️ No Kwik page opened after redirect`);
                }
            } else if (source.type === 'kwik_embed') {
                // Direct kwik.cx link
                console.log(`[AnimePahe] 🎬 Visiting Kwik: ${source.url}`);
                await page.goto(source.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
                
                const mp4 = await this._extractKwikMp4(page);
                if (mp4) return { url: mp4, quality: source.quality, isPahe: true };
            }

            console.log(`[AnimePahe] ❌ Could not resolve: ${source.url}`);
            return null;
        } catch (error) {
            console.error('[AnimePahe] resolveLink error:', error.message);
            return null;
        } finally {
            await page.close();
        }
    }

    // ────────────────────────────────────────────────────────────────────────────
    // EXTRACT KWIK MP4 — Decode the packed JavaScript on kwik.cx
    // ────────────────────────────────────────────────────────────────────────────
    async _extractKwikMp4(page) {
        const url = page.url();
        console.log(`[AnimePahe] 🧪 Extracting from: ${url}`);

        // Wait for Cloudflare/DDoS-Guard/Turnstile
        for (let i = 0; i < 30; i++) {
            const title = await page.title();
            const content = await page.innerText('body').catch(() => '');
            if (!title.includes('Just a moment') && 
                !content.includes('Checking') && 
                !content.includes('DDoS') && 
                !content.includes('security verification') &&
                !content.includes('Cloudflare') &&
                content.length > 50) {
                break;
            }
            // Try to click Turnstile if it appears
            try {
                const turnstile = page.locator('iframe[src*="challenges.cloudflare.com"]').first();
                if (await turnstile.count() > 0) {
                    const box = await turnstile.boundingBox();
                    if (box) {
                        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
                    }
                }
            } catch (e) {}
            
            await page.waitForTimeout(1000);
        }

        // 1. Check for a download button/form on /f/ pages (Common for pahe.win redirects)
        if (url.includes('/f/')) {
            console.log(`[AnimePahe] 🕵️ Searching for download trigger on /f/ page...`);
            
            // Wait for Cloudflare/Turnstile to potentially clear
            await page.waitForTimeout(4000);

            // Intercept the redirect from form submission
            let capturedMp4 = null;
            page.on('response', response => {
                const resUrl = response.url();
                if (resUrl.includes('.mp4') || resUrl.includes('nextcdn') || resUrl.includes('kwcdn')) {
                    capturedMp4 = resUrl;
                }
                const status = response.status();
                if (status >= 300 && status < 400) {
                    const location = response.headers()['location'];
                    if (location && (location.includes('.mp4') || location.includes('nextcdn') || location.includes('kwcdn'))) {
                        capturedMp4 = location;
                    }
                }
            });

            // AGGRESSIVE: Try to find ANY download trigger
            const hasTrigger = await page.evaluate(() => {
                // 1. Look for forms
                const form = document.querySelector('form');
                if (form) return 'FORM';
                
                // 2. Look for buttons with specific text
                const buttons = Array.from(document.querySelectorAll('button, a, input[type="submit"], div[role="button"]'));
                const btn = buttons.find(el => {
                    const text = (el.innerText || el.value || '').toLowerCase();
                    return text.includes('download') || text.includes('redirect') || text.includes('continue') || text.includes('click here');
                });
                if (btn) return 'BUTTON';

                // 3. Look for anything that looks like a big blue button (common on Kwik)
                const bigBtn = document.querySelector('.btn-primary, .btn-success, #downloadMenu, .download-icon');
                if (bigBtn) return 'CLASS_BTN';

                return null;
            });

            if (hasTrigger) {
                console.log(`[AnimePahe] 📋 Found trigger (${hasTrigger}), attempting click/submit...`);
                try {
                    await Promise.all([
                        page.waitForNavigation({ timeout: 15000 }).catch(() => null),
                        page.evaluate(() => {
                            const form = document.querySelector('form');
                            if (form) { form.submit(); return; }
                            
                            const buttons = Array.from(document.querySelectorAll('button, a, input[type="submit"], div[role="button"]'));
                            const btn = buttons.find(el => {
                                const text = (el.innerText || el.value || '').toLowerCase();
                                return text.includes('download') || text.includes('redirect') || text.includes('continue') || text.includes('click here');
                            }) || document.querySelector('.btn-primary, .btn-success, #downloadMenu, .btn');
                            
                            if (btn) {
                                if (btn.click) btn.click();
                                else if (btn.submit) btn.submit();
                            }
                        })
                    ]);
                    
                    if (capturedMp4) {
                        console.log(`[AnimePahe] 🎯 Captured MP4: ${capturedMp4.substring(0, 80)}...`);
                        return capturedMp4;
                    }
                } catch (e) {
                    console.log(`[AnimePahe] ⚠️ Trigger error: ${e.message}`);
                }
            } else {
                console.log(`[AnimePahe] ⚠️ No trigger found on /f/ page. Dumping HTML for debugging...`);
                try {
                    const html = await page.content();
                    const fs = require('fs');
                    fs.writeFileSync('d:\\Desktop\\animexis-api\\animexis\\scratch\\kwik_debug.html', html);
                    await page.screenshot({ path: 'd:\\Desktop\\animexis-api\\animexis\\scratch\\kwik_debug.png' });
                    console.log(`[AnimePahe] 📸 Dumped debug info to scratch/kwik_debug.*`);
                } catch (err) {
                    console.log(`[AnimePahe] ⚠️ Failed to dump debug info: ${err.message}`);
                }
            }

            // LAST RESORT: Sniff raw HTML for download links or tokens
            const html = await page.content();
            const decoded = this._decodeKwikCustom(html);
            if (decoded) {
                console.log(`[AnimePahe] 🔍 Decoded Kwik URL from custom packer: ${decoded}`);
                return decoded;
            }

            const sniffed = await page.evaluate(() => {
                const innerHtml = document.documentElement.innerHTML;
                const match = innerHtml.match(/https?:\/\/[a-zA-Z0-9.-]+\.(?:nextcdn|kwcdn|kwikcdn)\.org\/download\/[^"'\s]+/i);
                return match ? match[0] : null;
            });
            if (sniffed) {
                console.log(`[AnimePahe] 🔍 Sniffed URL from source: ${sniffed}`);
                return sniffed;
            }
        }

        // 2. Wait for the packed script (Common for /e/ embed pages)
        let packedScriptFound = false;
        let finalHtml = '';
        for (let i = 0; i < 15; i++) {
            finalHtml = await page.content();
            if (finalHtml.includes('p,a,c,k,e,d') || finalHtml.includes('_0xe76c')) {
                packedScriptFound = true;
                break;
            }
            await page.waitForTimeout(1000);
        }

        // Check for custom decoder first on final HTML
        const customDecoded = this._decodeKwikCustom(finalHtml);
        if (customDecoded) return customDecoded;

        // 3. Robust decoding of ALL packed scripts
        const result = await page.evaluate(() => {
            const scripts = Array.from(document.querySelectorAll('script'));
            const unpackedResults = [];

            for (const s of scripts) {
                const code = s.innerText;
                if (code.includes('p,a,c,k,e,d')) {
                    try {
                        const match = code.match(/eval\s*\(\s*(function\s*\(p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*d\s*\).+)\s*\)\s*;?/s);
                        if (!match) continue;

                        const functionBody = match[1].trim();
                        let unpacked = null;
                        try {
                            // eslint-disable-next-line no-new-func
                            unpacked = new Function('return (' + functionBody + ')')();
                        } catch (e) {
                             // eslint-disable-next-line no-eval
                             unpacked = eval('(' + functionBody + ')');
                        }

                        if (unpacked && typeof unpacked === 'string') {
                            const urlMatch = unpacked.match(/source\s*=\s*['"]([^'"]+)['"]/i) || 
                                            unpacked.match(/var\s+source\s*=\s*['"]([^'"]+)['"]/i) ||
                                            unpacked.match(/stream_url\s*=\s*['"]([^'"]+)['"]/i) ||
                                            unpacked.match(/https?:\/\/[a-zA-Z0-9.-]+\.(?:nextcdn|kwikcdn|kwcdn)\.org\/[^\s'"]+/i);
                            if (urlMatch) {
                                const url = urlMatch[1] || urlMatch[0];
                                return { type: 'direct', url };
                            }
                            unpackedResults.push(unpacked.substring(0, 200));
                        }
                    } catch (e) {
                        unpackedResults.push('eval_error: ' + e.message);
                    }
                }
            }
            
            const video = document.querySelector('video');
            if (video && video.src && video.src.startsWith('http')) return { type: 'video_tag', url: video.src };

            for (const s of scripts) {
                const cdnMatch = s.innerText.match(/https?:\/\/[a-zA-Z0-9.-]+\.(?:nextcdn|kwikcdn|kwcdn)\.org\/[^\s'"]+/);
                if (cdnMatch) return { type: 'script_match', url: cdnMatch[0] };
            }

            return { type: 'not_found', debugInfo: unpackedResults };
        });

        if (result.url && result.url.startsWith('http')) {
            console.log(`[AnimePahe] 🎯 Resolved via ${result.type}: ${result.url.substring(0, 60)}...`);
            return result.url;
        }

        console.log(`[AnimePahe] ❌ Kwik extraction failed: ${JSON.stringify(result)}`);
        return null;
    }

    // ────────────────────────────────────────────────────────────────────────────
    // HIGH-LEVEL API — All-in-one: search → episodes → sources → resolve
    // Used by the /api/anime/pahe-sources endpoint
    // ────────────────────────────────────────────────────────────────────────────
    async getDownloadLinks(animeTitle, episodeNumber) {
        try {
            console.log(`[AnimePahe] 🔍 Full pipeline: "${animeTitle}" Ep ${episodeNumber}`);

            // Step 1: Search
            const searchResults = await this.search(animeTitle);
            if (searchResults.length === 0) {
                return { success: false, error: 'Anime not found on AnimePahe' };
            }

            // Try to find best match (exact title match first, then first result)
            const titleLower = animeTitle.toLowerCase().replace(/[^a-z0-9]/g, '');
            const bestMatch = searchResults.find(r => 
                r.title.toLowerCase().replace(/[^a-z0-9]/g, '') === titleLower
            ) || searchResults[0];

            console.log(`[AnimePahe] 📺 Best match: "${bestMatch.title}" (${bestMatch.episodes} eps)`);

            // Step 2: Get episodes
            const episodes = await this.getEpisodes(bestMatch.id);
            if (episodes.length === 0) {
                return { success: false, error: 'No episodes found on AnimePahe' };
            }

            // Find the matching episode
            const ep = episodes.find(e => String(e.number) === String(episodeNumber));
            if (!ep) {
                // Try fetching other pages if episode count > 30
                if (bestMatch.episodes > 30) {
                    const pageNum = Math.ceil(parseInt(episodeNumber) / 30);
                    const moreEps = await this.getEpisodes(bestMatch.id, pageNum);
                    const found = moreEps.find(e => String(e.number) === String(episodeNumber));
                    if (!found) {
                        return { success: false, error: `Episode ${episodeNumber} not found` };
                    }
                    return await this._processEpisodeSources(bestMatch, found);
                }
                return { success: false, error: `Episode ${episodeNumber} not found` };
            }

            return await this._processEpisodeSources(bestMatch, ep);
        } catch (error) {
            console.error('[AnimePahe] getDownloadLinks error:', error.message);
            return { success: false, error: error.message };
        }
    }

    async _processEpisodeSources(anime, episode) {
        // Step 3: Get sources from play page
        const sources = await this.getSources(anime.id, episode.session);
        if (sources.length === 0) {
            return { success: false, error: 'No download links found on play page' };
        }

        // Step 4: Try to resolve links until we get at least one direct MP4
        const results = [];
        
        // Filter and sort: try to resolve up to 3 links
        const toResolve = sources.slice(0, 3);

        for (const source of toResolve) {
            try {
                console.log(`[AnimePahe] 🔗 Resolving ${source.quality} (${source.type})...`);
                const resolved = await this.resolveLink(source);
                if (resolved && resolved.url) {
                    results.push({
                        url: resolved.url,
                        quality: source.quality,
                        filesize: source.filesize,
                        isPahe: true,
                        isM3U8: false
                    });
                    // If we found a direct MP4, we can stop if we have enough
                    if (results.length >= 2) break;
                }
            } catch (err) {
                console.error(`[AnimePahe] Failed to resolve ${source.quality}:`, err.message);
            }
        }

        // Also include unresolved kwik embed URLs as fallback
        const kwikEmbeds = sources
            .filter(s => s.type === 'kwik_embed' && !results.some(r => r.url === s.url))
            .map(s => ({
                url: s.url,
                quality: s.quality,
                filesize: s.filesize,
                isEmbed: true,
                isKwik: true
            }));

        return {
            success: true,
            anime: { title: anime.title, id: anime.id },
            sources: [...results, ...kwikEmbeds]
        };
    }
    /**
     * Specialized decoder for Kwik's custom obfuscation (Dynamic Version)
     */
    _decodeKwikCustom(html) {
        if (!html) return null;
        try {
            // 1. Extract the dictionary array (variable name is dynamic, e.g., _0xc17e or _0xc44e)
            const dictMatch = html.match(/var\s+(_0x[a-f0-9]+)\s*=\s*(\[.+?\]);/s);
            if (!dictMatch) return null;
            
            let dictStr = dictMatch[2].trim();
            if (dictStr.includes("'")) dictStr = dictStr.replace(/'/g, '"').replace(/,\]/, ']');
            const dictionary = JSON.parse(dictStr);

            // 2. Extract the eval call arguments
            // Kwik's arguments always follow the pattern: ("encoded", number, "dict", number, number, number)
            const evalMatch = html.match(/\}\s*\(\s*("[^"]+",\s*\d+,\s*"[^"]+",\s*\d+,\s*\d+,\s*\d+)\s*\)\s*\)/s);
            if (!evalMatch) return null;

            const argsStr = evalMatch[1];
            const args = [];
            let currentArg = '';
            let inQuotes = false;
            for (let i = 0; i < argsStr.length; i++) {
                const char = argsStr[i];
                if (char === '"' || char === "'") inQuotes = !inQuotes;
                if (char === ',' && !inQuotes) {
                    args.push(currentArg.trim().replace(/^["']|["']$/g, ''));
                    currentArg = '';
                } else {
                    currentArg += char;
                }
            }
            args.push(currentArg.trim().replace(/^["']|["']$/g, ''));

            if (args.length < 6) return null;

            const Cu = args[0];
            const Gz = parseInt(args[1]);
            const BP = args[2];
            const KI = parseInt(args[3]);
            const Qv = parseInt(args[4]);

            // 3. Re-implement the transformation function (e.g., _0xe76c or _0xe59c)
            const transform = (tn, zV, rL) => {
                const g = dictionary[2].split(dictionary[0]);
                const h = g.slice(0, zV);
                const i = g.slice(0, rL);
                const j = tn.split(dictionary[0]).reverse().reduce((xq, Uy, jj) => {
                    if (h.indexOf(Uy) !== -1) return xq + h.indexOf(Uy) * (Math.pow(zV, jj));
                    return xq;
                }, 0);
                let k = dictionary[0];
                let j_mut = j;
                while (j_mut > 0) {
                    k = i[j_mut % rL] + k;
                    j_mut = (j_mut - (j_mut % rL)) / rL;
                }
                return k || dictionary[11];
            };

            // 4. Run the main decoding loop
            let decoded = "";
            for (let i = 0; i < Cu.length; i++) {
                let s = "";
                while (i < Cu.length && Cu[i] !== BP[Qv]) {
                    s += Cu[i];
                    i++;
                }
                for (let j = 0; j < BP.length; j++) {
                    s = s.replace(new RegExp(BP[j], "g"), j);
                }
                decoded += String.fromCharCode(transform(s, Qv, 10) - KI);
            }

            const finalSource = decodeURIComponent(escape(decoded));
            const urlMatch = finalSource.match(/https?:\/\/[a-zA-Z0-9.-]+\.(?:nextcdn|kwcdn|kwikcdn)\.org\/[^"'\s\\]+/i);
            return urlMatch ? urlMatch[0] : null;
        } catch (e) {
            console.log(`[AnimePahe] ⚠️ Custom Kwik decode error: ${e.message}`);
            return null;
        }
    }
}

module.exports = new AnimePaheScraper();
