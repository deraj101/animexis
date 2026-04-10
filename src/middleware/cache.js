// src/middleware/cache.js
const NodeCache = require('node-cache');

// Create cache instance with default TTL of 10 minutes
const cache = new NodeCache({ 
    stdTTL: 600,
    checkperiod: 120,
    useClones: false
});

function cacheMiddleware(duration = 300) {
    return (req, res, next) => {
        // Skip cache in development if needed
        if (process.env.NODE_ENV === 'development' && req.query.noCache === 'true') {
            return next();
        }

        const key = `__express__${req.originalUrl || req.url}`;
        const cachedResponse = cache.get(key);

        if (cachedResponse) {
            console.log(`📦 Cache hit for: ${key}`);
            return res.json(cachedResponse);
        }

        console.log(`🔄 Cache miss for: ${key}`);
        
        // Store the original res.json function
        const originalJson = res.json;
        
        // Override res.json to cache the response
        res.json = function(data) {
            // Only cache successful responses
            if (data.success !== false) {
                cache.set(key, data, duration);
            }
            originalJson.call(this, data);
        };

        next();
    };
}

// Function to clear cache by key pattern
function clearCache(pattern) {
    const keys = cache.keys();
    const regex = new RegExp(pattern);
    
    keys.forEach(key => {
        if (regex.test(key)) {
            cache.del(key);
            console.log(`🗑️ Cleared cache for: ${key}`);
        }
    });
}

// Function to get cache stats
function getCacheStats() {
    return {
        keys: cache.keys().length,
        hits: cache.getStats().hits,
        misses: cache.getStats().misses,
        ksize: cache.getStats().ksize,
        vsize: cache.getStats().vsize
    };
}

module.exports = cacheMiddleware;
module.exports.clearCache = clearCache;
module.exports.getCacheStats = getCacheStats;