// src/services/scraperService.js
const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');
const { BASE_URL, SELECTORS, HEADERS } = require('../config/constants');
const redisClient = require('../db/redisClient');
const {
    extractText,
    extractAttr,
    delay,
    generateSlug,
    cleanText,
    decodeVideoUrl
} = require('./utils');

// List of working domains
const WORKING_DOMAINS = [
    'https://anitaku.to',
    'https://anitaku.pe',
    'https://anitaku.bz',
    'https://anitaku.so',
    'https://gogoanime.cl',
    'https://gogoanime3.net'
];

class ScraperService {
    constructor() {
        this.lastRequestTime = 0;
        this.minRequestDelay = 0;
        this.maxRetries = 3;
        this.baseUrl = BASE_URL;
        this.workingDomains = [...WORKING_DOMAINS];
        this.currentDomainIndex = this.workingDomains.indexOf(BASE_URL) || 0;
        
        this.httpsAgent = new https.Agent({
            rejectUnauthorized: false,
            keepAlive: true,
            maxSockets: 10,
            keepAliveMsecs: 3000,
            timeout: 10000
        });
    }

    // Try next domain if current one fails
    async tryNextDomain() {
        this.currentDomainIndex = (this.currentDomainIndex + 1) % this.workingDomains.length;
        this.baseUrl = this.workingDomains[this.currentDomainIndex];
        console.log(`🔄 Switching to next domain: ${this.baseUrl}`);
        return this.baseUrl;
    }

    // Test if domain is reachable
    async testDomain(domain) {
        try {
            await axios.get(domain, {
                httpsAgent: this.httpsAgent,
                timeout: 5000,
                maxRedirects: 2
            });
            return true;
        } catch {
            return false;
        }
    }

    // Find working domain automatically
    async findWorkingDomain() {
        console.log('🔍 Testing domains for availability...');
        for (const domain of this.workingDomains) {
            try {
                await axios.get(domain, {
                    httpsAgent: this.httpsAgent,
                    timeout: 5000
                });
                console.log(`✅ Domain working: ${domain}`);
                this.baseUrl = domain;
                return domain;
            } catch (error) {
                console.log(`❌ Domain failed: ${domain}`);
            }
        }
        return this.baseUrl;
    }

    async fetchPage(endpoint, retryCount = 0) {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        if (timeSinceLastRequest < this.minRequestDelay) {
            await delay(this.minRequestDelay - timeSinceLastRequest);
        }

        try {
            let url;
            if (endpoint.startsWith('http')) {
                url = endpoint;
            } else {
                url = this.baseUrl + endpoint;
            }

            console.log(`🌐 Fetching: ${url}`);

            const response = await axios.get(url, {
                headers: {
                    ...HEADERS,
                    'Host': new URL(url).hostname,
                    'Referer': this.baseUrl,
                    'Origin': this.baseUrl
                },
                timeout: 15000,
                maxRedirects: 5,
                validateStatus: status => status < 400,
                httpsAgent: this.httpsAgent
            });

            this.lastRequestTime = Date.now();

            if (response.status === 200) {
                if (response.request && response.request.res && response.request.res.responseUrl) {
                    console.log(`📍 Final URL: ${response.request.res.responseUrl}`);
                }
                
                const $ = cheerio.load(response.data);
                return $;
            }

            throw new Error(`HTTP ${response.status}`);
        } catch (error) {
            console.error(`❌ Error fetching page (attempt ${retryCount + 1}):`, error.message);

            if (error.code === 'ENETUNREACH' || error.message.includes('ENETUNREACH') || 
                error.code === 'ECONNREFUSED' || error.message.includes('ECONNREFUSED')) {
                
                await this.tryNextDomain();
                
                if (retryCount < this.maxRetries) {
                    const delayTime = Math.pow(2, retryCount) * 500;
                    await delay(delayTime);
                    return this.fetchPage(endpoint, retryCount + 1);
                }
                throw error;
            }

            if (retryCount < this.maxRetries) {
                const delayTime = Math.pow(2, retryCount) * 500;
                await delay(delayTime);
                return this.fetchPage(endpoint, retryCount + 1);
            }

            throw error;
        }
    }

    async getThumbnailOnly(idOrUrl) {
        try {
            const id = idOrUrl.includes('/') ? idOrUrl.split('/').pop() : idOrUrl;
            const $ = await this.fetchPage(`/category/${id}`);
            let image = $('.anime_info_body_bg img').attr('src');
            if (image && !image.startsWith('http')) {
                image = image.startsWith('//') ? 'https:' + image : this.baseUrl + image;
            }
            return image || null;
        } catch (e) {
            console.error(`[peek] fail: ${idOrUrl}`, e.message);
            return null;
        }
    }

    /**
     * Determine category from title keywords (Primary Fallback) 🏷️
     */
    determineCategory(title, fallback = 'TV') {
        const titleLower = title.toLowerCase();
        if (titleLower.includes('movie') || titleLower.includes('film')) return 'MOVIE';
        if (titleLower.includes('special')) return 'SPECIAL';
        if (titleLower.includes('ova')) return 'OVA';
        if (titleLower.includes('ona')) return 'ONA';
        if (titleLower.includes('music')) return 'MUSIC';
        
        // Clean fallback (e.g. "TV (Sub)" -> "TV")
        const cleanFallback = (fallback || 'TV').replace(/\(.*\)/g, '').trim().toUpperCase();
        return cleanFallback || 'TV';
    }

    async getRecentEpisodes(page = 1) {
        try {
            console.log(`📺 Fetching recent episodes - Page ${page}`);
            const $ = await this.fetchPage(`/?page=${page}`);
            const episodes = [];

            $('.items li').each((i, element) => {
                const $el = $(element);
                
                const title = $el.find('.name a').text().trim();
                let image = $el.find('.img img').attr('src');
                if (image && !image.startsWith('http')) {
                    image = image.startsWith('//') ? 'https:' + image : this.baseUrl + image;
                }
                
                const episodeText = $el.find('.episode').text().trim();
                const episodeNumber = episodeText.replace('Episode ', '').replace('Ep ', '').replace('ep ', '').trim();
                const released = $el.find('.released').text().trim();
                const type = $el.find('.type').text().trim(); // 'Sub' or 'Dub'
                
                // Usually the category (TV, ONA) is the first text node or a specific label
                // In some versions it's inside a different element.
                const category = $el.find('span').first().text().trim() || 'TV';

                let url = $el.find('.img a').attr('href');
                if (url && !url.startsWith('http')) {
                    url = url.startsWith('/') ? this.baseUrl + url : this.baseUrl + '/' + url;
                }

                if (title) {
                    episodes.push({
                        id: i + 1,
                        title: title,
                        image: image || null,
                        episode: episodeText,
                        episodeNumber: episodeNumber || episodeText,
                        released: released || null,
                        type: type || 'Sub',
                        category: this.determineCategory(title, category),
                        url: url,
                        slug: this.generateSlug(title)
                    });
                }
            });

            const currentPage = parseInt($('.pagination .current, .pagination .active').first().text()) || page;
            const hasNextPage = $('.pagination .next:not(.disabled)').length > 0 || 
                               $(`.pagination a[data-page="${currentPage + 1}"]`).length > 0 ||
                               $('.pagination .active + li:not(.disabled)').length > 0;

            console.log(`✅ Found ${episodes.length} episodes`);

            return {
                success: true,
                currentPage,
                hasNextPage,
                total: episodes.length,
                episodes
            };
        } catch (error) {
            console.error('Error scraping recent episodes:', error);
            return {
                success: false,
                error: error.message,
                episodes: []
            };
        }
    }

    async getOngoingAnime(page = 1) {
        try {
            console.log(`📅 Fetching ongoing anime - Page ${page}`);
            // Use different URLs as fallbacks if needed, but ongoing-updated.html is standard
            const $ = await this.fetchPage(`/ongoing-updated.html?page=${page}`);
            const series = [];

            // Targeted selectors for Anitaku/GogoAnime ongoing lists
            const listItems = $('.menu-recent li, .items li, .listing li');
            console.log(`🔎 Found ${listItems.length} potential ongoing items`);

            listItems.each((i, element) => {
                const $el = $(element);
                
                // Try multiple title locations
                const title = $el.find('a').attr('title') || 
                              $el.find('.name a').text().trim() || 
                              $el.find('a').first().text().trim();

                // Try multiple episode locations
                const latestEpisode = $el.find('.episode').text().trim() || 
                                     $el.find('p:contains("Episode")').text().trim() ||
                                     $el.find('span').last().text().trim();

                const genres = [];
                $el.find('.genres a, .genre a').each((j, g) => genres.push($(g).text().trim()));

                let url = $el.find('a').attr('href');
                if (url && !url.startsWith('http')) {
                    url = url.startsWith('/') ? this.baseUrl + url : this.baseUrl + '/' + url;
                }

                // Extract native image as fallback 🖼️
                let image = $el.find('.img img, img').first().attr('src');
                if (image && !image.startsWith('http')) {
                    image = image.startsWith('//') ? 'https:' + image : this.baseUrl + image;
                }

                if (title && title.length > 1) {
                    series.push({
                        id: `ongoing-${i}`,
                        title: title,
                        image: image || null, // Native fallback 📸
                        episode: latestEpisode.replace(/Episode\s+/i, "Ep ").trim(),
                        episodeNumber: latestEpisode.replace(/\D/g, ''),
                        genres: genres,
                        url: url,
                        slug: this.generateSlug(title)
                    });
                }
            });

            console.log(`✅ Successfully parsed ${series.length} ongoing series`);
            return {
                success: true,
                currentPage: page,
                hasNextPage: $('.pagination .next').length > 0 || $('.pagination .active + li').length > 0,
                series
            };
        } catch (error) {
            console.error('Error scraping ongoing anime:', error);
            return { success: false, error: error.message, series: [] };
        }
    }

    async getAnimeByLetter(letter, page = 1) {
        try {
            const char = letter === '0-9' ? '0' : letter.toUpperCase();
            console.log(`🔠 Fetching anime by letter: "${char}" - Page ${page}`);
            const $ = await this.fetchPage(`/anime-list.html?letter=${encodeURIComponent(char)}&page=${page}`);
            const results = [];

            $('.items li').each((i, element) => {
                const $el = $(element);
                const title = $el.find('.name a').text().trim();
                
                // Robust image extraction 📸
                let image = $el.find('.img img, img').first().attr('src') || $el.find('.img a img').attr('src');
                if (image && !image.startsWith('http')) {
                    image = image.startsWith('//') ? 'https:' + image : this.baseUrl + image;
                }

                const released = $el.find('.released').text().trim();
                const url = $el.find('.name a').attr('href');
                
                if (title) {
                    const category = $el.find('.type, .fd-infor span').first().text().trim() || 'TV';
                    results.push({
                        id: `alpha-${i}`,
                        title: title,
                        image: image || null,
                        category: this.determineCategory(title, category),
                        released: released || null,
                        url: url ? (url.startsWith('http') ? url : this.baseUrl + url) : null,
                        slug: this.generateSlug(title)
                    });
                }
            });

            console.log(`✅ Found ${results.length} series for letter: ${char}`);
            
            const currentPage = parseInt($('.pagination .current, .pagination .active').first().text()) || page;
            const hasNextPage = $('.pagination .next').length > 0 || $('.pagination .active + li').length > 0;

            return {
                success: true,
                letter: char,
                currentPage,
                hasNextPage,
                results
            };
        } catch (error) {
            console.error('Error scraping anime by letter:', error);
            return { success: false, error: error.message, results: [] };
        }
    }

    async searchAnime(query, page = 1) {
        try {
            console.log(`🔍 Searching for: "${query}" - Page ${page}`);
            const $ = await this.fetchPage(`/search.html?keyword=${encodeURIComponent(query)}&page=${page}`);
            const results = [];

            const containers = [
                ...$('.items li'),
                ...$('.search-list li'),
                ...$('.film_list-wrap .flw-item'),
                ...$('.popular .li')
            ];

            containers.forEach((element) => {
                const $el = $(element);
                const title = $el.find('.name a, .film-name a, p.name a, .anime-name a').first().text().trim();
                let image = $el.find('.img img, .film-poster img').first().attr('src') || '';
                if (image && !image.startsWith('http')) {
                    image = image.startsWith('//') ? 'https:' + image : this.baseUrl + image;
                }
                const year = $el.find('.released, .fd-infor span, .year').first().text().trim() || '';
                const category = $el.find('.type, .fd-infor span').first().text().trim() || 'TV';
                const type = title.toLowerCase().includes('dub') ? 'Dub' : 'Sub';

                let url = $el.find('.img a, .film-poster a, .name a').first().attr('href') || '';
                
                if (url && !url.startsWith('http')) {
                    url = url.startsWith('/') ? this.baseUrl + url : this.baseUrl + '/' + url;
                }

                if (title) {
                    results.push({
                        id: this.generateSlug(title),
                        title: cleanText(title),
                        image: image || null,
                        year: cleanText(year) || null,
                        category: this.determineCategory(title, category),
                        type: type,
                        url: url || null,
                        slug: this.generateSlug(title)
                    });
                }
            });

            const currentPage = parseInt($('.pagination .current, .pagination .active').first().text()) || page;
            const hasNextPage = $('.pagination .next:not(.disabled)').length > 0 || 
                               $(`.pagination a[data-page="${currentPage + 1}"]`).length > 0 ||
                               $('.pagination .active + li:not(.disabled)').length > 0;

            return {
                success: true,
                query,
                currentPage,
                hasNextPage,
                count: results.length,
                results
            };
        } catch (error) {
            console.error('Error searching anime:', error);
            return {
                success: false,
                error: error.message,
                results: []
            };
        }
    }

   async getAnimeDetails(identifier) {
    try {
        const cacheKey = `anime:details:${identifier}`;
        
        // 1. Try to get from Redis Cache first
        try {
            const cachedData = await redisClient.get(cacheKey);
            if (cachedData) {
                const parsed = JSON.parse(cachedData); 
                // 🕵️‍♂️ Check if it's an OLD cache (missing new metadata fields)
                if (parsed.success && parsed.studios) {
                    console.log(`🚀 Cache HIT for: ${identifier}`);
                    return parsed;
                }
                console.log(`🕵️‍♂️ Cache STALE: "${parsed.title}" is missing metadata. Refreshing...`);
            }
        } catch (err) {
            console.warn('⚠️ Redis Cache Get Error:', err.message);
        }

        const url = identifier.startsWith('http') ? identifier : `/category/${identifier}`;
        console.log(`📖 Fetching anime details from source: ${url}`);
        
        const $ = await this.fetchPage(url);

        const details = {
            title: '',
            image: null,
            description: '',
            type: '',
            genres: [],
            released: '',
            status: '',
            otherNames: '',
            studios: '',
            producers: '',
            duration: '',
            episodes: []
        };

        details.title = cleanText($('.anime_info_body_bg h1, .anime-details h1, .entry-title').first().text().trim());
        let image = $('.anime_info_body_bg img, .anime-details img, .poster img').first().attr('src') || null;
        if (image && !image.startsWith('http')) {
            image = image.startsWith('//') ? 'https:' + image : this.baseUrl + image;
        }
        details.image = image;
        
        const titleLower = details.title.toLowerCase();
        const isMovie = titleLower.includes('movie') || 
                       titleLower.includes('film') || 
                       titleLower.includes('the movie') ||
                       url.includes('/movie/') ||
                       identifier.includes('movie');
        
        const animeSlug = this.generateSlug(details.title);
        
        console.log(`📺 Anime: ${details.title}, Slug: ${animeSlug}, isMovie: ${isMovie}`);
        
        $('p.type, .info-item, .details-item').each((i, element) => {
            const $el = $(element);
            const text = $el.text().trim();
            const textLower = text.toLowerCase();

            if (textLower.includes('plot summary') || textLower.includes('summary') || textLower.includes('description')) {
                details.description = cleanText(text.replace(/^.*?:/i, ''));
            } else if (textLower.includes('type')) {
                const typeText = cleanText(text.replace(/^.*?:/i, '')).toUpperCase();
                details.type = this.determineCategory(details.title, typeText);
            } else if (textLower.includes('genre')) {
                $el.find('a').each((j, genre) => {
                    const genreText = $(genre).text().trim();
                    const genreName = cleanText(genreText.replace(/^[,\s]+/, ''));
                    if (genreName && !details.genres.includes(genreName)) {
                        details.genres.push(genreName);
                    }
                });
            } else if (textLower.includes('released')) {
                details.released = cleanText(text.replace(/^.*?:/i, ''));
            } else if (textLower.includes('status')) {
                details.status = cleanText(text.replace(/^.*?:/i, ''));
            } else if (textLower.includes('other names')) {
                details.otherNames = cleanText(text.replace(/^.*?:/i, ''));
            } else if (textLower.includes('studios') || textLower.includes('studio')) {
                details.studios = cleanText(text.replace(/^.*?:/i, '').replace(/Studio\(s\):|Studios:|Studio:/gi, '').trim());
            } else if (textLower.includes('producers') || textLower.includes('producer')) {
                details.producers = cleanText(text.replace(/^.*?:/i, '').replace(/Producer\(s\):|Producers:|Producer:/gi, '').trim());
            } else if (textLower.includes('duration')) {
                details.duration = cleanText(text.replace(/^.*?:/i, '').replace(/Duration:|Runtime:/gi, '').trim());
            }
        });
        
        if (!details.description) {
            const plotPara = $('.description, .plot, .summary').first();
            if (plotPara.length) {
                details.description = cleanText(plotPara.text());
            }
        }

        $('#episode_page li a, .episodes-list a, .episode-list a').each((i, element) => {
            const $el = $(element);
            const episodeText = $el.text().trim();
            
            if (episodeText) {
                if (episodeText.includes('-')) {
                    const parts = episodeText.split('-');
                    if (parts.length === 2) {
                        const start = parseInt(parts[0].trim());
                        const end = parseInt(parts[1].trim());
                        
                        if (!isNaN(start) && !isNaN(end)) {
                            for (let epNum = start; epNum <= end; epNum++) {
                                const properUrl = `${this.baseUrl}/${animeSlug}-episode-${epNum}`;
                                details.episodes.push({
                                    number: epNum.toString(),
                                    displayNumber: epNum.toString().padStart(3, '0'),
                                    url: properUrl,
                                    id: `ep-${epNum}`
                                });
                            }
                        }
                    }
                } else {
                    const epNum = episodeText.replace(/\D/g, '');
                    if (epNum) {
                        const properUrl = `${this.baseUrl}/${animeSlug}-episode-${epNum}`;
                        details.episodes.push({
                            number: epNum,
                            displayNumber: epNum.padStart(3, '0'),
                            url: properUrl,
                            id: `ep-${epNum}`
                        });
                    } else {
                        let episodeUrl = $el.attr('href');
                        if (episodeUrl && !episodeUrl.startsWith('http')) {
                            episodeUrl = episodeUrl.startsWith('/') ? this.baseUrl + episodeUrl : this.baseUrl + '/' + episodeUrl;
                        }
                        details.episodes.push({
                            number: episodeText,
                            displayNumber: episodeText.padStart(3, '0'),
                            url: episodeUrl,
                            id: `ep-${episodeText}`
                        });
                    }
                }
            }
        });

        if (details.episodes.length === 0 && isMovie) {
            details.episodes.push({
                number: '1',
                displayNumber: '1',
                url: `${this.baseUrl}/${animeSlug}-episode-1`,
                id: 'ep-1'
            });
        }

        details.episodes.sort((a, b) => (parseInt(a.number) || 0) - (parseInt(b.number) || 0));

        const result = {
            success: true,
            ...details,
            slug: animeSlug,
            episodeCount: details.episodes.length
        };

        // 2. Save to Redis Cache (TTL: 6 hours)
        try {
            await redisClient.set(cacheKey, JSON.stringify(result), {
                EX: 60 * 60 * 6 // 6 hours
            });
            console.log(`✅ Cached result for: ${identifier}`);
        } catch (err) {
            console.warn('⚠️ Redis Cache Set Error:', err.message);
        }

        return result;
    } catch (error) {
        console.error('Error getting anime details:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

    async getEpisodeLinks(episodeUrl) {
        try {
            let url = episodeUrl;
            if (!url.startsWith('http')) {
                url = this.baseUrl + url;
            }
            
            if (url.match(/\/\d+$/)) {
                console.log('⚠️ Invalid episode URL format - needs anime name');
                return {
                    success: false,
                    error: 'Invalid episode URL format',
                    title: 'Error: Invalid URL',
                    iframe: null,
                    videoSources: [],
                    downloadLinks: []
                };
            }
            
            console.log(`🎬 Fetching episode: ${url}`);
            
            const $ = await this.fetchPage(url);
            
            const episodeData = {
                title: '',
                iframe: null,
                videoSources: [],
                downloadLinks: [],
                released: ''
            };

            episodeData.title = $('.anime_video_body_cate h1, h1.title, .entry-title').first().text().trim() || 'Episode';

            const isMoviePage = url.includes('-movie-') || 
                               episodeData.title.toLowerCase().includes('movie') ||
                               $('.anime_video_body_cate').text().toLowerCase().includes('movie');
            
            const iframeSelectors = [
                '#load_anime', 
                'iframe#load_anime', 
                '.play-video iframe', 
                'iframe[src*="gogo"]', 
                'iframe[src*="anime"]',
                '.anime_video_body iframe',
                '#player iframe',
                'iframe[src*="stream"]',
                'iframe[src*="embed"]',
                'iframe[src*="watch"]',
                '.video-embed iframe',
                '#video-player iframe',
                'iframe[src*="vidoza"]',
                'iframe[src*="mcloud"]',
                'iframe[src*="fembed"]',
                'iframe[src*="mp4upload"]',
                'iframe[src*="dood"]',
                'iframe[src*="gogoanime"]',
                'iframe[src*="gogocdn"]'
            ];
            
            for (const selector of iframeSelectors) {
                const iframe = $(selector).first();
                if (iframe.length) {
                    let src = iframe.attr('src') || iframe.attr('data-src') || null;
                    if (src) {
                        if (src.startsWith('//')) {
                            src = 'https:' + src;
                        } else if (!src.startsWith('http')) {
                            src = this.baseUrl + src;
                        }
                        episodeData.iframe = src;
                        console.log(`✅ Found iframe: ${src.substring(0, 100)}...`);
                        break;
                    }
                }
            }

            if (!episodeData.iframe) {
                console.log('🔍 No iframe found, looking for video links...');
                
                $('a[href*=".mp4"], a[href*=".m3u8"], a[href*=".mkv"]').each((i, el) => {
                    const href = $(el).attr('href');
                    if (href) {
                        const fullUrl = href.startsWith('http') ? href : this.baseUrl + href;
                        episodeData.videoSources.push({
                            url: fullUrl,
                            quality: 'Auto',
                            type: href.includes('.m3u8') ? 'application/x-mpegURL' : 'video/mp4'
                        });
                    }
                });

                $('[data-video], [data-src], [data-url]').each((i, el) => {
                    const dataVideo = $(el).attr('data-video') || $(el).attr('data-src') || $(el).attr('data-url');
                    if (dataVideo) {
                        const videoUrl = dataVideo.startsWith('//') ? 'https:' + dataVideo : 
                                        (dataVideo.startsWith('http') ? dataVideo : this.baseUrl + dataVideo);
                        episodeData.videoSources.push({
                            url: videoUrl,
                            quality: 'Auto',
                            type: 'video/mp4'
                        });
                    }
                });
            }

            $('video, .video-js, .jw-video, .player-video, #video-player').each((i, el) => {
                const src = $(el).attr('src') || $(el).attr('data-src');
                if (src) {
                    episodeData.videoSources.push({
                        url: src.startsWith('http') ? src : this.baseUrl + src,
                        quality: 'Auto',
                        type: 'video/mp4'
                    });
                }
            });

            $('source, video source, .video-js source').each((i, el) => {
                const src = $(el).attr('src');
                const type = $(el).attr('type') || 'video/mp4';
                const label = $(el).attr('label') || $(el).attr('title') || 'Auto';
                
                if (src) {
                    const fullSrc = src.startsWith('http') ? src : this.baseUrl + src;
                    if (!episodeData.videoSources.some(s => s.url === fullSrc)) {
                        episodeData.videoSources.push({
                            url: fullSrc,
                            quality: label.match(/\d+p/i)?.[0] || 'Auto',
                            type: type
                        });
                    }
                }
            });

            $('.anime_video_download a, .download-links a, .download-list a, .dowloads a, .mirror_link a, .download a').each((i, el) => {
                const href = $(el).attr('href');
                const text = $(el).text().trim();
                
                if (href && !href.includes('javascript:')) {
                    const quality = text.match(/\d+p/i)?.[0] || 
                                   href.match(/\d+p/i)?.[0] || 
                                   (isMoviePage ? 'Movie' : 'Unknown');
                    
                    const fullUrl = href.startsWith('http') ? href : this.baseUrl + href;
                    
                    if (!episodeData.downloadLinks.some(l => l.url === fullUrl)) {
                        episodeData.downloadLinks.push({
                            quality: quality,
                            url: fullUrl,
                            label: text || quality
                        });
                    }
                }
            });

            if (episodeData.videoSources.length === 0 && !episodeData.iframe) {
                console.log('🔍 No sources found, checking JavaScript...');
                
                const scripts = $('script').map((i, el) => $(el).html()).get();
                
                for (const script of scripts) {
                    if (script) {
                        const videoMatches = script.match(/(?:https?:\/\/)[^\s"']+\.(?:mp4|m3u8|mkv)[^\s"']*/g);
                        if (videoMatches) {
                            videoMatches.forEach(match => {
                                episodeData.videoSources.push({
                                    url: match,
                                    quality: 'Auto',
                                    type: match.includes('.m3u8') ? 'application/x-mpegURL' : 'video/mp4'
                                });
                            });
                        }
                        
                        const iframeMatches = script.match(/(?:https?:\/\/)[^\s"']+(?:embed|player|watch)[^\s"']*/g);
                        if (iframeMatches && !episodeData.iframe) {
                            episodeData.iframe = iframeMatches[0];
                        }
                    }
                }
            }

            episodeData.released = $('.released, .update-time, .date, .duration, .info-item').first().text().trim() || 'Recently added';

            console.log(`✅ Found: ${episodeData.videoSources.length} video sources, ${episodeData.downloadLinks.length} download links, ${episodeData.iframe ? '1 iframe' : '0 iframes'}`);

            return episodeData;
        } catch (error) {
            console.error('Error getting episode links:', error);
            return {
                success: false,
                error: error.message,
                title: 'Error loading episode',
                iframe: null,
                videoSources: [],
                downloadLinks: []
            };
        }
    }

    async getPopularAnime(page = 1) {
        try {
            console.log(`🔥 Fetching popular anime - Page ${page}`);
            const $ = await this.fetchPage(`/popular.html?page=${page}`);
            const results = [];

            const containers = [
                ...$('.items li'),
                ...$('.film_list-wrap .flw-item'),
                ...$('.popular .li')
            ];

            containers.forEach((element) => {
                const $el = $(element);
                const title = $el.find('.name a, .film-name a, p.name a').first().text().trim();
                let image = $el.find('.img img, .film-poster img').first().attr('src') || '';
                if (image && !image.startsWith('http')) {
                    image = image.startsWith('//') ? 'https:' + image : this.baseUrl + image;
                }
                
                let url = $el.find('.img a, .film-poster a, .name a').first().attr('href') || '';
                
                if (url && !url.startsWith('http')) {
                    url = url.startsWith('/') ? this.baseUrl + url : this.baseUrl + '/' + url;
                }

                if (title) {
                    const category = $el.find('.type, .fd-infor span').first().text().trim() || 'TV';
                    results.push({
                        id: this.generateSlug(title),
                        title: cleanText(title),
                        image: image || null,
                        category: this.determineCategory(title, category),
                        type: title.toLowerCase().includes('dub') ? 'Dub' : 'Sub',
                        url: url || null,
                        slug: this.generateSlug(title)
                    });
                }
            });

            const currentPage = parseInt($('.pagination .current, .pagination .active').first().text()) || page;
            const hasNextPage = $('.pagination .next:not(.disabled)').length > 0 || 
                               $(`.pagination a[data-page="${currentPage + 1}"]`).length > 0 ||
                               $('.pagination .active + li:not(.disabled)').length > 0;

            return {
                success: true,
                currentPage,
                hasNextPage,
                count: results.length,
                results
            };
        } catch (error) {
            console.error('Error getting popular anime:', error);
            return {
                success: false,
                error: error.message,
                results: []
            };
        }
    }

    async getAnimeByGenre(genre, page = 1) {
        try {
            console.log(`🏷️ Fetching ${genre} anime - Page ${page}`);
            const $ = await this.fetchPage(`/genre/${encodeURIComponent(genre)}?page=${page}`);
            const results = [];

            const containers = [
                ...$('.items li'),
                ...$('.film_list-wrap .flw-item'),
                ...$('.popular .li')
            ];

            containers.forEach((element) => {
                const $el = $(element);
                const title = $el.find('.name a, .film-name a, p.name a').first().text().trim();
                let image = $el.find('.img img, .film-poster img').first().attr('src') || '';
                if (image && !image.startsWith('http')) {
                    image = image.startsWith('//') ? 'https:' + image : this.baseUrl + image;
                }
                
                let url = $el.find('.img a, .film-poster a, .name a').first().attr('href') || '';
                
                if (url && !url.startsWith('http')) {
                    url = url.startsWith('/') ? this.baseUrl + url : this.baseUrl + '/' + url;
                }

                if (title) {
                    const category = $el.find('.type, .fd-infor span').first().text().trim() || 'TV';
                    results.push({
                        id: this.generateSlug(title),
                        title: cleanText(title),
                        image: image || null,
                        category: this.determineCategory(title, category),
                        url: url || null,
                        slug: this.generateSlug(title)
                    });
                }
            });

            const currentPage = parseInt($('.pagination .current, .pagination .active').first().text()) || page;
            const hasNextPage = $('.pagination .next:not(.disabled)').length > 0 || 
                               $(`.pagination a[data-page="${currentPage + 1}"]`).length > 0 ||
                               $('.pagination .active + li:not(.disabled)').length > 0;

            return {
                success: true,
                genre,
                currentPage,
                hasNextPage,
                count: results.length,
                results
            };
        } catch (error) {
            console.error('Error getting anime by genre:', error);
            return {
                success: false,
                error: error.message,
                results: []
            };
        }
    }

    // ─── A-Z LETTER LIST ──────────────────────────────────────────────────────
    async getAnimeByLetter(letter, page = 1) {
        try {
            console.log(`🔤 Fetching anime list for letter "${letter}" - Page ${page}`);
            
            // Use specific letter endpoint: /anime-list-A?page=1
            const endpoint = `/anime-list-${letter.toUpperCase()}?page=${page}`;
            const $ = await this.fetchPage(endpoint);
            
            const results = [];
            $('ul.listing li').each((i, el) => {
                const $el = $(el);
                const $a = $el.find('a').first();
                const title = ($a.attr('title') || $a.text()).trim();
                let url = $a.attr('href') || '';

                if (!title || title.length < 2) return;
                if (!url.startsWith('http')) {
                    url = url.startsWith('/') ? this.baseUrl + url : `${this.baseUrl}/${url}`;
                }
                const slug = url.replace(/\/+$/, '').split('/').pop() || this.generateSlug(title);

                results.push({
                    id: slug,
                    slug: slug,
                    title: cleanText(title),
                    image: null,
                    category: this.determineCategory(title, 'TV'),
                    url: url
                });
            });

            const currentPage = parseInt($('.pagination .current, .pagination .active').first().text()) || page;
            const hasNextPage = $('.pagination .next:not(.disabled)').length > 0;

            console.log(`✅ Letter "${letter}": ${results.length} results found for page ${page}`);
            
            return {
                success: true,
                letter,
                currentPage,
                hasNextPage,
                count: results.length,
                results
            };
        } catch (error) {
            console.error('Error getting anime by letter:', error);
            return { success: false, error: error.message, results: [] };
        }
    }

    async getSpotlightAnime() {
        try {
            console.log('✨ Fetching spotlight anime from modern mirror');
            // Explicitly use the modern mirror for the spotlight carousel
            const spotlightUrl = 'https://anitaku.cv/home/';
            const $ = await this.fetchPage(spotlightUrl);
            const spotlight = [];

            const slides = $('.swiper-wrapper .swiper-slide, #top-spotlight .swiper-slide, .spotlight-section .swiper-slide');
            console.log(`🔍 Found ${slides.length} slides for spotlight`);

            slides.each((i, element) => {
                const $el = $(element);
                const title = $el.find('.hero-info h2, .hero-info h2 a, .description h2').first().text().trim();
                const description = $el.find('.hero-description, .description p, .hero-info p').first().text().trim();
                const rankText = $el.find('.stlight-item, .hero-info .spotlight').first().text().trim() || `#${i + 1} Spotlight`;
                
                // Background extraction
                let background = $el.attr('data-background') || $el.attr('data-src');
                
                // Check for a specific hero-bg image child
                if (!background) {
                    background = $el.find('.hero-bg img, img.hero-bg').attr('src') || $el.find('.hero-bg img, img.hero-bg').attr('data-src');
                }

                // Fallback to style attribute
                if (!background) {
                    const styleAttr = $el.attr('style') || '';
                    const bgMatch = styleAttr.match(/url\(['"]?([^'"]+)['"]?\)/);
                    background = bgMatch ? bgMatch[1] : null;
                }

                let poster = $el.find('.hero-poster img, .film-poster img').attr('src') || $el.find('.hero-poster img, .film-poster img').attr('data-src');
                
                // Cleanup URLs
                const resolve = (url) => {
                    if (!url) return null;
                    if (url.startsWith('http')) return url;
                    return url.startsWith('//') ? 'https:' + url : 'https://anitaku.cv' + (url.startsWith('/') ? '' : '/') + url;
                };

                background = resolve(background);
                poster = resolve(poster);

                let watchUrl = $el.find('.btn-watch').attr('href') || '#';
                let detailsUrl = $el.find('.btn-details, .hero-info h2 a').attr('href') || '#';

                const resolveLink = (l) => l && !l.startsWith('http') ? 'https://anitaku.cv' + (l.startsWith('/') ? '' : '/') + l : l;
                watchUrl = resolveLink(watchUrl);
                detailsUrl = resolveLink(detailsUrl);

                if (title) {
                    spotlight.push({
                        rank: rankText,
                        title: cleanText(title),
                        description: cleanText(description),
                        poster: poster,
                        background: background,
                        watchUrl: watchUrl,
                        detailsUrl: detailsUrl,
                        image: poster, // mapping for compatibility
                        id: this.generateSlug(title)
                    });
                }
            });

            if (spotlight.length === 0) {
                console.log('⚠️ No spotlight found on modern mirror, falling back to popular items');
                const popular = await this.getPopularAnime(1);
                if (popular.success && popular.results) {
                    return {
                        success: true,
                        count: Math.min(5, popular.results.length),
                        results: popular.results.slice(0, 5).map((it, i) => ({
                            ...it,
                            rank: `#${i + 1} Featured`,
                            description: `Watch the popular ${it.title} now on Animexis.`,
                            background: it.image,
                            poster: it.image
                        }))
                    };
                }
            }

            return {
                success: true,
                count: spotlight.length,
                results: spotlight
            };
        } catch (error) {
            console.error('Error getting spotlight anime:', error);
            return { success: false, error: error.message, results: [] };
        }
    }

    async getGenres() {
        try {
            console.log('📋 Fetching genres');
            const $ = await this.fetchPage('/');
            const genres = [];
            const seen = new Set();

            $('.genre-list a, .nav-genre a, .category a, .genres a, .anime-genre a').each((i, element) => {
                const $el = $(element);
                const name = $el.text().trim();
                const url = $el.attr('href');
                
                if (name && url && url.includes('/genre/') && !seen.has(name)) {
                    seen.add(name);
                    const fullUrl = url.startsWith('http') ? url : (url.startsWith('/') ? this.baseUrl + url : this.baseUrl + '/' + url);
                    genres.push({
                        name: cleanText(name),
                        url: fullUrl,
                        slug: name.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '')
                    });
                }
            });

            return {
                success: true,
                count: genres.length,
                genres
            };
        } catch (error) {
            console.error('Error getting genres:', error);
            return {
                success: false,
                error: error.message,
                genres: []
            };
        }
    }

    generateSlug(title) {
        if (!title) return '';
        return title
            .toLowerCase()
            .replace(/[^\w\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/--+/g, '-')
            .replace(/^-+|-+$/g, '');
    }
}

module.exports = new ScraperService();