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
        return res.status(404).json({ error: 'Ad file not found' });
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

        if (!episodeData.iframe && episodeData.videoSources.length === 0) {
            console.log('⚠️ No video sources found for URL:', url);
        }

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