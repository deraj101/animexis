const axios = require('axios');
const redisClient = require('../db/redisClient');

const JIKAN_BASE_URL = 'https://api.jikan.moe/v4';

class EpisodeService {
    /**
     * Fetch episode titles from Jikan API using MAL ID.
     * Includes Redis caching to avoid rate limiting.
     */
    async getEpisodeTitles(malId) {
        if (!malId) return null;

        const cacheKey = `anime:episodes:${malId}`;
        
        // 1. Try Cache
        try {
            const cached = await redisClient.get(cacheKey);
            if (cached) {
                console.log(`[episodes] Cache HIT for MAL ID: ${malId}`);
                return JSON.parse(cached);
            }
        } catch (err) {
            console.warn('[episodes] Redis error:', err.message);
        }

        // 2. Fetch from Jikan
        try {
            console.log(`[episodes] Fetching titles from Jikan for MAL ID: ${malId}`);
            
            // Jikan /episodes endpoint
            // We fetch the first page (usually 100 episodes)
            const response = await axios.get(`${JIKAN_BASE_URL}/anime/${malId}/episodes`, {
                timeout: 10000
            });

            if (response.data && response.data.data) {
                const titlesMap = {};
                response.data.data.forEach(ep => {
                    if (ep.mal_id && ep.title) {
                        titlesMap[ep.mal_id] = ep.title;
                    }
                });

                // Cache for 24 hours
                try {
                    await redisClient.set(cacheKey, JSON.stringify(titlesMap), {
                        EX: 60 * 60 * 24 
                    });
                } catch (err) {
                    console.warn('[episodes] Redis set error:', err.message);
                }

                return titlesMap;
            }
            return null;
        } catch (err) {
            if (err.response?.status === 429) {
                console.warn('[episodes] Jikan Rate Limited (429)');
            } else {
                console.error(`[episodes] Error fetching from Jikan: ${err.message}`);
            }
            return null;
        }
    }

    /**
     * Merge titles into a list of episodes.
     */
    async enrichEpisodes(episodes, malId) {
        if (!episodes || !episodes.length || !malId) return episodes;

        const titles = await this.getEpisodeTitles(malId);
        if (!titles) return episodes;

        return episodes.map(ep => {
            const num = parseInt(ep.number);
            if (titles[num]) {
                return {
                    ...ep,
                    title: titles[num]
                };
            }
            return ep;
        });
    }
}

module.exports = new EpisodeService();
