// src/controllers/animeController.js
const scraperService = require('../services/scraperService');
const userService = require('../db/userService');
const aniListService = require('../services/aniListService');

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

        let results = await scraperService.searchAnime(q, page);

        // Enrich with AniList High-Res images
        if (results.success && results.results) {
            results.results = await aniListService.enrichAnimeList(results.results);
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
        const { email, animeId, title, image, episodeUrl, episodeNumber } = req.body;
        if (!email || !animeId) return res.status(400).json({ success: false, error: 'Missing data' });
        await userService.upsertContinueWatching({
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

};