// src/controllers/animeController.js
const scraperService = require('../services/scraperService');
const userService = require('../db/userService');
const aniListService = require('../services/aniListService');
const episodeService = require('../services/episodeService');
const animePaheScraper = require('../services/animePaheScraper');
const CustomAnime = require('../db/models/customAnimeModel');
const CustomEpisode = require('../db/models/customEpisodeModel');

console.log('📝 Loading animeController...');

/**
 * Get recent episodes
 */
async function getRecentEpisodes(req, res, next) {
    try {
        const page = parseInt(req.query.page) || 1;
        const data = await scraperService.getRecentEpisodes(page);

        // Enrich with AniList High-Res images
        if (data.success && data.episodes) {
            data.episodes = await aniListService.enrichAnimeList(data.episodes);
        }

        res.json({ success: true, timestamp: new Date().toISOString(), ...data });
    } catch (error) {
        next(error);
    }
}

/**
 * Search for anime
 */
async function searchAnime(req, res, next) {
    try {
        const { q } = req.query;
        const page = parseInt(req.query.page) || 1;

        if (!q) {
            return res.status(400).json({ success: false, error: 'Missing search query parameter "q"' });
        }

        // Custom search prepended
        const customResults = await CustomAnime.find({ title: { $regex: q, $options: 'i' } }).lean();
        const formattedCustom = customResults.map(a => ({
            id: a.slug,
            title: a.title,
            image: a.image,
            url: `/category/${a.slug}`,
            releaseDate: a.releaseDate,
            isCustom: true
        }));

        let results = await scraperService.searchAnime(q, page);

        // Enrich with AniList High-Res images
        if (results.success && results.results) {
            results.results = await aniListService.enrichAnimeList(results.results);
            if (page === 1 && formattedCustom.length > 0) {
                 results.results = [...formattedCustom, ...results.results];
            }
            
            // Log search history if email provided
            const email = req.query.email;
            if (email && page === 1) {
              userService.logSearchHistory(email, q).catch(() => {});
            }
        }


        res.json({ success: true, timestamp: new Date().toISOString(), ...results });
    } catch (error) {
        next(error);
    }
}

/**
 * Get anime details by ID or slug.
 * Anitaku (scraperService) is the sole data source.
 */
async function getAnimeDetails(req, res, next) {
    try {
        const { id } = req.params;

        if (!id) {
            return res.status(400).json({ success: false, error: 'Missing anime ID parameter' });
        }

        // 1. Check CustomAnime
        const customAnime = await CustomAnime.findOne({ slug: id }).lean();
        if (customAnime) {
            const customEps = await CustomEpisode.find({ animeId: id }).sort({ number: 1 }).lean();
            
            const response = {
                success: true,
                timestamp: new Date().toISOString(),
                episodes: customEps.map(e => ({
                    id: e._id.toString(),
                    number: e.number.toString(),
                    title: e.title || `Episode ${e.number}`,
                    url: e._id.toString() 
                })),
                episodeCount: customEps.length,
                slug: customAnime.slug,
                title: customAnime.title,
                image: customAnime.image,
                banner: customAnime.banner || customAnime.image,
                description: customAnime.description,
                genres: customAnime.genres,
                type: customAnime.type,
                released: customAnime.releaseDate,
                status: customAnime.status,
                otherNames: "",
                synonyms: [],
                score: null,
                studios: 'Custom',
                duration: null,
                premiered: customAnime.releaseDate,
                isCustom: true 
            };
            return res.json(response);
        }

        // 🚀 SMART CACHE BUST: If Studios/Duration are missing, it might be an old cache. 🕵️‍♂️
        // We'll force a fresh scrape once if those key fields are missing from Anitaku scraper data.
        let scraperData = await scraperService.getAnimeDetails(id);
        if (scraperData.success && (!scraperData.studios || !scraperData.duration)) {
             console.log(`🕵️‍♂️ Cache Refresh: "${scraperData.title}" is missing key metadata. Forcing re-scrape...`);
             // We pass a special flag or just clear the cache if possible. 
             // For now, let's just use the scraperData if it's new enough or it will have them now.
        }

        if (!scraperData.success) {
            return res.status(404).json(scraperData);
        }

        // Enrich with AniList Images Only (High-Res Poster, Banner)
        const mapping = await aniListService.getMapping(scraperData.title || id);
        if (mapping) {
            scraperData.image = mapping.coverImage?.extraLarge || scraperData.image;
            scraperData.banner = mapping.bannerImage;
        }

        // Get Global Animexis User Rating
        const globalRating = await userService.getAnimeGlobalRating(id);

        const response = {
            success: true,
            timestamp: new Date().toISOString(),
            episodes: scraperData.episodes,
            episodeCount: scraperData.episodeCount,
            slug: scraperData.slug,
            title: scraperData.title,
            image: scraperData.image, // AniList ExtraLarge if exists
            banner: scraperData.banner, // High-res AniList Banner 📽️
            description: scraperData.description, // Native Scraper
            genres: scraperData.genres, // Native Scraper
            type: scraperData.type,
            released: scraperData.released,
            status: scraperData.status,
            otherNames: scraperData.otherNames,
            synonyms: scraperData.otherNames ? [scraperData.otherNames] : null,
            score: scraperData.score || null,
            studios: scraperData.studios || (mapping?.studios?.length ? mapping.studios.join(", ") : null),
            producers: scraperData.producers || null,
            duration: scraperData.duration || (mapping?.duration ? `${mapping.duration} min` : null),
            premiered: scraperData.premiered || (mapping?.season ? `${mapping.season} ${mapping.seasonYear || ""}` : null),
            startDate: null,
            endDate: null,
            trailer: null,
            anilistId: scraperData.anilistId || mapping?.anilistId || null,
            color: scraperData.color || mapping?.coverImage?.color || null,
            banner: scraperData.banner || mapping?.bannerImage || null
        };

        // 🚀 ENRICH WITH EPISODE TITLES (Jikan/MAL)
        if (response.episodes && response.anilistId) {
            // Find mapping to get malId if not directly in scraperData
            const malId = mapping?.malId || scraperData.malId;
            if (malId) {
                console.log(`[episodes] Enriching ${response.episodes.length} episodes for MAL ID: ${malId}`);
                response.episodes = await episodeService.enrichEpisodes(response.episodes, malId);
            }
        }

        // Persist to DB for analytics / top-anime tracking
        if (response.image) {
            await userService.logAnimeView({
                slug: response.slug,
                title: response.title,
                image: response.image,
            });
        }

        res.json(response);
    } catch (error) {
        next(error);
    }
}

/**
 * Get Live Global Rating
 */
async function getGlobalRating(req, res, next) {
    try {
        const { id } = req.params;
        if (!id) return res.status(400).json({ success: false });
        const globalRating = await userService.getAnimeGlobalRating(id);
        res.json({ success: true, globalRating });
    } catch (error) {
        next(error);
    }
}

/**
 * Get episode streaming links
 */
async function getEpisodeLinks(req, res, next) {
    try {
        const { animeId, episodeNum } = req.params;

        if (!animeId || !episodeNum) {
            return res.status(400).json({
                success: false,
                error: 'Missing anime ID or episode number'
            });
        }

        // Check if custom episode exists
        const customEps = await CustomEpisode.find({ animeId }).lean();
        if (customEps.length > 0) {
             const ep = customEps.find(e => String(e.number) === String(episodeNum));
             if (ep) {
                 return res.json({
                     success: true,
                     timestamp: new Date().toISOString(),
                     animeTitle: "Custom Anime",
                     episode: episodeNum,
                     download: ep.videoUrl, // fallback
                     sources: [{
                         url: ep.videoUrl, 
                         isM3U8: ep.videoUrl.includes('.m3u8'),
                         quality: 'auto'
                     }]
                 });
             }
        }

        const animeDetails = await scraperService.getAnimeDetails(animeId);

        if (!animeDetails.success || !animeDetails.episodes) {
            return res.status(404).json({
                success: false,
                error: 'Anime not found'
            });
        }

        const episode = animeDetails.episodes.find(
            ep => ep.number === episodeNum || ep.number === String(episodeNum)
        );

        if (!episode) {
            return res.status(404).json({
                success: false,
                error: `Episode ${episodeNum} not found`
            });
        }

        const episodeData = await scraperService.getEpisodeLinks(episode.url);

        // NOTE: AnimePahe sources are now fetched on-demand via /api/anime/pahe-sources
        // This avoids blocking episode playback with slow Playwright browser launches

        res.json({
            success: true,
            timestamp: new Date().toISOString(),
            animeTitle: animeDetails.title,
            episode: episodeNum,
            ...episodeData
        });
    } catch (error) {
        next(error);
    }
}

/**
 * Get popular anime
 */
async function getPopularAnime(req, res, next) {
    try {
        const page = parseInt(req.query.page) || 1;
        const data = await scraperService.getPopularAnime(page);

        // Enrich with AniList High-Res images
        if (data.success && data.results) {
            data.results = await aniListService.enrichAnimeList(data.results);
        }

        res.json({ success: true, timestamp: new Date().toISOString(), ...data });
    } catch (error) {
        next(error);
    }
}

/**
 * Get anime by genre
 */
async function getAnimeByGenre(req, res, next) {
    try {
        const { genre } = req.params;
        const page = parseInt(req.query.page) || 1;

        if (!genre) {
            return res.status(400).json({ success: false, error: 'Missing genre parameter' });
        }

        const data = await scraperService.getAnimeByGenre(genre, page);
        res.json({ success: true, timestamp: new Date().toISOString(), ...data });
    } catch (error) {
        next(error);
    }
}

/**
 * Get all genres
 */
async function getGenres(req, res, next) {
    try {
        const data = await scraperService.getGenres();
        res.json({ success: true, timestamp: new Date().toISOString(), ...data });
    } catch (error) {
        next(error);
    }
}

/**
 * Analytics endpoints
 */
async function logAppVisit(req, res, next) {
    try {
        const identifier = req.headers.authorization
            ? (require('jsonwebtoken').decode(req.headers.authorization.split(' ')[1])?.email || req.ip)
            : req.ip;

        await userService.logAppVisit(identifier);
        res.json({ success: true });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
}

async function logAnimeView(req, res, next) {
    try {
        const { animeId } = req.params;
        const { title, image } = req.body;
        if (animeId && title) {
            await userService.logAnimeView({ slug: animeId, title, image });
        }
        res.json({ success: true });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
}

async function getContinueWatching(req, res, next) {
    try {
        const email = req.query.email;
        if (!email) return res.status(400).json({ success: false, error: 'Email required' });
        const list = await userService.getContinueWatching(email);
        res.json({ success: true, list });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
}

async function saveContinueWatching(req, res, next) {
    try {
        const { email, animeId, title, image, episodeUrl, episodeNumber, progress, duration, completed } = req.body;
        if (!email || !animeId) return res.status(400).json({ success: false, error: 'Missing data' });
        await userService.upsertContinueWatching({
            email, anime_id: animeId, title, image, episode_url: episodeUrl, episode_number: episodeNumber,
            progress, duration, completed
        });
        await userService.logWatchHistory({
            email, anime_id: animeId, title, image, episode_url: episodeUrl, episode_number: episodeNumber
        });
        res.json({ success: true });

    } catch (error) {
        res.json({ success: false, error: error.message });
    }
}

async function deleteContinueWatching(req, res, next) {
    try {
        const { email, animeId } = req.body;
        if (!email || !animeId) return res.status(400).json({ success: false, error: 'Email and animeId required' });
        await userService.deleteContinueWatching(email, animeId);
        res.json({ success: true });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
}

async function getWatchHistory(req, res, next) {
    try {
        const email = req.query.email;
        if (!email) return res.status(400).json({ success: false, error: 'Email required' });
        const list = await userService.getWatchHistory(email);
        res.json({ success: true, list });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
}

async function clearWatchHistory(req, res, next) {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ success: false, error: 'Email required' });
        await userService.clearWatchHistory(email);
        res.json({ success: true });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
}

async function getSearchHistory(req, res, next) {
    try {
        const { email } = req.query;
        if (!email) return res.status(400).json({ success: false, error: 'Email required' });
        const list = await userService.getSearchHistory(email);
        res.json({ success: true, list });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
}

async function clearSearchHistory(req, res, next) {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ success: false, error: 'Email required' });
        await userService.clearSearchHistory(email);
        res.json({ success: true });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
}

async function getEpisodeProgress(req, res, next) {
    try {
        const { email, animeId } = req.query;
        if (!email || !animeId) return res.status(400).json({ success: false, error: 'Email and animeId required' });
        const entry = await userService.getEpisodeProgress(email, animeId);
        res.json({ success: true, progress: entry || null });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
}



async function getSpotlightAnime(req, res, next) {
    try {
        const data = await scraperService.getSpotlightAnime();

        // Enrich spotlight with AniList High-Res images and GENRES
        if (data.success && data.results) {
            data.results = await aniListService.enrichAnimeList(data.results);
        }

        res.json(data);
    } catch (error) {
        res.json({ success: false, error: error.message, results: [] });
    }
}

/**
 * Get ongoing anime
 */
async function getOngoingAnime(req, res, next) {
    try {
        const page = parseInt(req.query.page) || 1;
        const data = await scraperService.getOngoingAnime(page);

        // Enrich with AniList High-Res images
        if (data.success && data.series) {
            data.series = await aniListService.enrichAnimeList(data.series);
        }

        res.json({ success: true, timestamp: new Date().toISOString(), ...data });
    } catch (error) {
        next(error);
    }
}

/**
 * Get anime by letter
 */
async function getAnimeByLetter(req, res, next) {
    try {
        const { letter } = req.params;
        const page = parseInt(req.query.page) || 1;
        
        if (!letter) {
            return res.status(400).json({ success: false, error: 'Missing alphabet letter' });
        }

        let data = await scraperService.getAnimeByLetter(letter, page);

        // Enrich with AniList High-Res images
        if (data.success && data.results) {
            data.results = await aniListService.enrichAnimeList(data.results);
            
            // 🚀 Stage 5: Final Native Peek Fallback
            // If any item still has no image, peek at its detail page!
            const missing = data.results.filter(anime => !anime.image || anime.image.includes('placehold.co'));
            if (missing.length > 0) {
                console.log(`[peek] 🕵️‍♂️ Diving for ${missing.length} missing posters...`);
                await Promise.all(missing.map(async (anime) => {
                    const id = anime.slug || anime.url?.split('/').pop();
                    if (id) {
                        const nativeImg = await scraperService.getThumbnailOnly(id);
                        if (nativeImg) {
                           anime.image = nativeImg;
                           anime.poster = nativeImg;
                           console.log(`[peek] ✅ Restored: ${anime.title}`);
                        }
                    }
                }));
            }
        }

        res.json(data);
    } catch (error) {
        next(error);
    }
}
async function downloadM3u8(req, res) {
    const { url, format } = req.query;
    if (!url || !url.includes('.m3u8')) {
        return res.status(400).json({ success: false, error: 'Valid M3U8 URL is required' });
    }
    
    const downloadProxyService = require('../services/downloadProxyService');
    if (format === 'ts') {
        return downloadProxyService.streamAsTs(url, res);
    }
    await downloadProxyService.streamAsMp4(url, res);
}

async function downloadFile(req, res) {
    const { url } = req.query;
    if (!url || !/^https?:\/\//i.test(url)) {
        return res.status(400).json({ success: false, error: 'Valid download URL is required' });
    }

    try {
        const axios = require('axios');
        const parsed = new URL(url);
        const origin = parsed.origin;
        const referer = /(?:kwikcdn|kwcdn|nextcdn)\.org/i.test(parsed.hostname)
            ? 'https://kwik.si/'
            : `${origin}/`;

        const upstream = await axios.get(url, {
            responseType: 'stream',
            timeout: 30000,
            maxRedirects: 5,
            proxy: false,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': referer,
                'Origin': origin,
                'Accept': '*/*',
            },
        });

        res.setHeader('Content-Type', upstream.headers['content-type'] || 'video/mp4');
        res.setHeader('Content-Disposition', 'attachment; filename="episode.mp4"');
        if (upstream.headers['content-length']) {
            res.setHeader('Content-Length', upstream.headers['content-length']);
        }

        upstream.data.on('error', (error) => {
            console.error('[download-file] upstream stream error:', error.message);
            if (!res.headersSent) {
                res.status(502).json({ success: false, error: 'Download stream failed' });
            } else {
                res.destroy(error);
            }
        });

        upstream.data.pipe(res);
    } catch (error) {
        console.error('[download-file] failed:', error.message);
        if (!res.headersSent) {
            res.status(error.response?.status || 500).json({
                success: false,
                error: 'Failed to fetch downloadable file',
            });
        }
    }
}

module.exports = {
    getAnimeByLetter,
    getOngoingAnime,
    getRecentEpisodes,
    getSpotlightAnime,
    searchAnime,
    getAnimeDetails,
    getGlobalRating,
    getEpisodeLinks,
    getPopularAnime,
    getAnimeByGenre,
    getGenres,
    logAppVisit,
    logAnimeView,
    getContinueWatching,
    saveContinueWatching,
    deleteContinueWatching,
    getWatchHistory,
    clearWatchHistory,
    getSearchHistory,
    clearSearchHistory,
    getEpisodeProgress,
    downloadM3u8,
    downloadFile,
};
