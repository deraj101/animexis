// src/config/constants.js
module.exports = {
    // Set to the most reliable domain from your test
    BASE_URL: 'https://anitaku.to',
    
    // Priority order based on test results
    BASE_URLS: [
        'https://anitaku.to',    // ✓ Working (200)
        'https://anitaku.so',     // ✓ Working (302)
        'https://anitaku.pe',     // ⚠️ Sometimes times out
        'https://anitaku.bz'      // ⚠️ Sometimes times out
    ],
    
    // API Configuration
    API: {
        version: '1.0.0',
        name: 'Anitaku Scraper API',
        cacheTTL: 300,
        rateLimit: {
            window: 15 * 60 * 1000,
            max: 100
        }
    },
    
    
    // CSS Selectors for Anitaku
    SELECTORS: {
        recentEpisodes: {
            container: '.items li',
            title: '.name a',
            image: '.img img',
            episode: '.episode',
            episodeNumber: '.episode',
            released: '.released',
            url: '.img a'
        },
        
        searchResults: {
            container: '.items li',
            title: '.name a',
            image: '.img img',
            year: '.released',
            url: '.img a'
        },
        
        animeDetails: {
            container: '.anime_info_body_bg',
            title: 'h1',
            image: 'img',
            description: 'p.type',
            type: 'p.type',
            genres: 'p.type a',
            released: 'p.type',
            status: 'p.type',
            otherNames: 'p.type'
        },
        
        episodes: {
            container: '#episode_page li',
            episodeNumber: 'a',
            episodeUrl: 'a'
        },
        
        episodePage: {
            container: '.play-video',
            videoIframe: 'iframe',
            title: '.anime_video_body_cate h1',
            downloadLinks: '.anime_video_download a'
        },
        
        pagination: {
            container: '.pagination',
            currentPage: '.current',
            nextPage: '.next'
        }
    },
    
    // Request headers
    HEADERS: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
    },
    
    // Video quality preferences
    VIDEO_QUALITIES: [
        { label: '1080p', value: '1080' },
        { label: '720p', value: '720' },
        { label: '480p', value: '480' },
        { label: '360p', value: '360' }
    ]
};