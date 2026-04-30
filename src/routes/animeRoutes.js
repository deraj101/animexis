// src/routes/animeRoutes.js
const express = require('express');
const router = express.Router();

// Import the controller
const animeController = require('../controllers/animeController');
const cacheMiddleware = require('../middleware/cache');
const usageLimiter = require('../middleware/usageLimiter');
const proxyService = require('../services/proxyService');

console.log('📝 Available controller functions:', Object.keys(animeController));

const fs = require('fs');
const path = require('path');

// ── Ad video — streams ads.mp4 with full CORS + range support ─────────────────
router.get('/ad', (req, res) => {
    const adPath = path.join(__dirname, '../../public/ads.mp4');

    if (!fs.existsSync(adPath)) {
        // Fallback to a placeholder MP4 since 173MB ads.mp4 is too large for GitHub/Render
        return res.redirect('https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4');
    }

    const stat = fs.statSync(adPath);
    const fileSize = stat.size;
    const range = req.headers.range;

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');

    if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunkSize = (end - start) + 1;
        res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Content-Length': chunkSize,
            'Content-Type': 'video/mp4',
        });
        fs.createReadStream(adPath, { start, end }).pipe(res);
    } else {
        res.writeHead(200, {
            'Content-Length': fileSize,
            'Content-Type': 'video/mp4',
        });
        fs.createReadStream(adPath).pipe(res);
    }
});

// Stream video endpoint (limit enforced)
router.get('/stream', usageLimiter, async (req, res) => {
    try {
        const { url } = req.query;

        if (!url) {
            return res.status(400).json({
                success: false,
                error: 'Missing video URL'
            });
        }

        if (!url.startsWith('http')) {
            return res.status(400).json({
                success: false,
                error: 'Invalid video URL'
            });
        }

        await proxyService.proxyVideo(url, req, res);
    } catch (error) {
        console.error('Stream error:', error);
        res.status(500).json({
            success: false,
            error: 'Streaming failed'
        });
    }
});

// 🚀 NEW: Download proxy for M3U8 -> MP4
router.get('/download-m3u8', usageLimiter, animeController.downloadM3u8);

// 🚀 AnimePahe direct MP4 sources (called by download button, not on every episode load)
router.get('/pahe-sources', usageLimiter, async (req, res) => {
    try {
        const { title, episode } = req.query;
        if (!title || !episode) {
            return res.status(400).json({ success: false, error: 'Missing title or episode parameter' });
        }

        console.log(`[AnimePahe] 📥 Download request: "${title}" Ep ${episode}`);
        const animePaheScraper = require('../services/animePaheScraper');
        const result = await animePaheScraper.getDownloadLinks(title, episode);
        res.json(result);
    } catch (error) {
        console.error('[AnimePahe] pahe-sources error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get video info endpoint (limit enforced)
router.get('/video-info', usageLimiter, async (req, res) => {
    try {
        const { url } = req.query;

        if (!url) {
            return res.status(400).json({
                success: false,
                error: 'Missing video URL'
            });
        }

        const info = await proxyService.getVideoInfo(url);

        res.json({
            success: true,
            ...info
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get episode info by URL (limited to 20/day for Free users)
router.get('/episode-info', usageLimiter, cacheMiddleware(300), async (req, res) => {
    try {
        const { url } = req.query;

        if (!url) {
            return res.status(400).json({
                success: false,
                error: 'Missing episode URL'
            });
        }

        console.log(`🎬 Fetching episode info for: ${url}`);

        // 🚀 HANDLE CUSTOM EPISODES
        const CustomEpisode = require('../db/models/customEpisodeModel');
        const mongoose = require('mongoose');
        
        // If it's a valid MongoDB ID, it's likely a custom episode
        if (mongoose.Types.ObjectId.isValid(url)) {
            const ep = await CustomEpisode.findById(url);
            if (ep) {
                return res.json({
                    success: true,
                    title: ep.title || `Episode ${ep.number}`,
                    iframe: null,
                    videoSources: [{
                        url: ep.videoUrl,
                        isM3U8: ep.videoUrl.includes('.m3u8'),
                        quality: 'auto'
                    }],
                    downloadLinks: [{ url: ep.videoUrl, label: 'Custom Stream' }]
                });
            }
        }

        const scraperService = require('../services/scraperService');

        if (url.match(/\/\d+$/)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid episode URL format. Expected format: /anime-name-episode-1',
                title: 'Invalid URL',
                iframe: null,
                videoSources: [],
                downloadLinks: []
            });
        }

        const episodeData = await scraperService.getEpisodeLinks(url);

        // NOTE: AnimePahe sources are now fetched separately via /api/anime/pahe-sources
        // This avoids blocking episode playback with slow Playwright calls

        res.json({
            success: true,
            ...episodeData
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Public routes with caching
router.get('/recent',           cacheMiddleware(300),   animeController.getRecentEpisodes);
router.get('/spotlight',        cacheMiddleware(1800),  animeController.getSpotlightAnime);
router.get('/ongoing',          cacheMiddleware(3600),  animeController.getOngoingAnime);
router.get('/alphabet/:letter', cacheMiddleware(86400), animeController.getAnimeByLetter);
router.get('/popular',          cacheMiddleware(3600),  animeController.getPopularAnime);
router.get('/genres',           cacheMiddleware(86400), animeController.getGenres);
router.get('/genre/:genre',     cacheMiddleware(3600),  animeController.getAnimeByGenre);

// Search route
router.get('/search', animeController.searchAnime);

// Anime details — 24h TTL (metadata rarely changes)
router.get('/details/:id',                          cacheMiddleware(86400), animeController.getAnimeDetails);
router.get('/details/:id/rating',                   animeController.getGlobalRating);
router.get('/:animeId/episode/:episodeNum',         cacheMiddleware(300),   animeController.getEpisodeLinks);

// Analytics
router.post('/visit',           animeController.logAppVisit);
router.post('/:animeId/view',   animeController.logAnimeView);

// Continue Watching
router.get('/continue-watching',    animeController.getContinueWatching);
router.post('/continue-watching',   animeController.saveContinueWatching);
router.delete('/continue-watching', animeController.deleteContinueWatching);

// Watch History (The Full List)
router.get('/watch-history',    animeController.getWatchHistory);
router.delete('/watch-history', animeController.clearWatchHistory);

// Episode Progress (for progress bars on episode cards)
router.get('/episode-progress', animeController.getEpisodeProgress);

// Search History
router.get('/search-history',    animeController.getSearchHistory);
router.delete('/search-history', animeController.clearSearchHistory);



// Download M3U8 (Proxy for downloading HLS as MP4)
router.get('/download-m3u8',   animeController.downloadM3u8);

// Test route — must be BEFORE /:id to avoid being swallowed by the catch-all
router.get('/test', (req, res) => {
    res.json({
        message: 'Anime routes working',
        availableFunctions: Object.keys(animeController)
    });
});

// Legacy routes — keep LAST, acts as catch-all
router.get('/:id', (req, res) => {
    res.redirect(`/api/anime/details/${req.params.id}`);
});

module.exports = router;