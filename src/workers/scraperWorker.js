const { Worker, Queue } = require('bullmq');
const scraperService = require('../services/scraperService');
const User           = require('../db/models/userModel');
const Notification   = require('../db/models/notificationModel');
const redisClient      = require('../db/redisClient');

// We share the connection parameters from Redis env
const connection = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT) || 6379,
};

const SCRAPER_QUEUE = 'scraper-tasks';
let scraperQueue = null;
let worker = null;

/**
 * Initialize Queues and Workers only if Redis is confirmed connected.
 * This prevents the app from crashing or spamming errors when Redis is missing.
 */
function startWorkers() {
    if (scraperQueue) return; // already started

    console.log('👷 Initializing Background Workers...');
    
    scraperQueue = new Queue(SCRAPER_QUEUE, { connection });
    
    worker = new Worker(SCRAPER_QUEUE, async (job) => {
        const { type, payload } = job.data;
        console.log(`🕵️ Worker processing job: ${job.id} (${type})`);

        try {
            if (type === 'PRE_SCRAPE_RECENT') {
                const page = payload?.page || 1;
                const data = await scraperService.getRecentEpisodes(page);
                console.log(`✅ Pre-scraped ${data.episodes?.length} recent episodes.`);

                // 🔔 Check for new releases to notify users
                if (data.episodes && data.episodes.length > 0) {
                    for (const ep of data.episodes) {
                        const animeId = ep.id;
                        const epNum   = ep.episodeNumber;
                        const redisKey = `notified_ep:${animeId}`;

                        // Check if we've already notified for this episode
                        const lastNotified = await redisClient.get(redisKey);
                        
                        // Simple comparison: if the current epNum is strictly greater than last notified
                        // (handles '122' > '121' correctly as strings for most cases, or convert to Int)
                        if (!lastNotified || parseInt(epNum) > parseInt(lastNotified)) {
                            console.log(`📡 New Release detected: ${ep.title} Ep ${epNum}`);
                            
                            // Find all users who have this anime in their favorites
                            const usersToNotify = await User.find({ "favorites.id": animeId });
                            
                            if (usersToNotify.length > 0) {
                                console.log(`🔔 Notifying ${usersToNotify.length} fans for ${ep.title}`);
                                const notifications = usersToNotify.map(u => ({
                                    userEmail: u.email,
                                    type: 'RELEASE',
                                    refId: animeId,
                                    episodeNum: epNum,
                                    title: 'New Release 🎥',
                                    message: `A new episode is out: ${ep.title} Episode ${epNum}!`
                                }));
                                
                                await Notification.insertMany(notifications);
                            }

                            // Update Redis to mark this episode as notified
                            await redisClient.set(redisKey, epNum);
                        }
                    }
                }
            }
            if (type === 'DEEP_SCAN_ANIME') {
                const { id } = payload;
                await scraperService.getAnimeDetails(id);
                console.log(`✅ Deep scanned anime: ${id}`);
            }
        } catch (err) {
            console.error(`❌ Worker Job Failed (${type}):`, err.message);
            throw err;
        }
    }, { connection });

    worker.on('completed', (job) => console.log(`🏁 Job ${job.id} completed!`));
    worker.on('failed', (job, err) => console.error(`🚨 Job ${job.id} failed: ${err.message}`));

    setupCronJobs();
}

// Periodic Task: Pre-scrape first page every 30 minutes
async function setupCronJobs() {
    if (!scraperQueue) return;
    
    await scraperQueue.add('periodic-recent', 
        { type: 'PRE_SCRAPE_RECENT', payload: { page: 1 } },
        { repeat: { cron: '*/30 * * * *' } }
    );
    console.log('⏰ Scraper Cron Jobs Scheduled');
}

module.exports = { startWorkers, scraperQueue };
