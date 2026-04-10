// src/services/proxyService.js
const axios = require('axios');
const { HEADERS } = require('../config/constants');

class ProxyService {
    constructor() {
        this.timeout = 30000;
    }

    /**
     * Proxy video stream
     */
    async proxyVideo(videoUrl, req, res) {  // Added req parameter here!
        try {
            console.log(`🔄 Proxying video: ${videoUrl}`);

            // Fetch the video with streaming
            const response = await axios({
                method: 'GET',
                url: videoUrl,
                headers: {
                    ...HEADERS,
                    'Range': req.headers.range || 'bytes=0-',
                    'Referer': new URL(videoUrl).origin
                },
                responseType: 'stream',
                timeout: this.timeout
            });

            // Set appropriate headers
            res.set({
                'Content-Type': response.headers['content-type'] || 'video/mp4',
                'Content-Length': response.headers['content-length'],
                'Accept-Ranges': 'bytes',
                'Cache-Control': 'public, max-age=3600'
            });

            // Handle range requests
            if (req.headers.range) {
                res.status(206);
                res.set('Content-Range', response.headers['content-range']);
            }

            // Pipe the video stream to response
            response.data.pipe(res);

            // Handle errors
            response.data.on('error', (error) => {
                console.error('Stream error:', error);
                if (!res.headersSent) {
                    res.status(500).json({ error: 'Stream error' });
                }
            });

        } catch (error) {
            console.error('Proxy error:', error);
            if (!res.headersSent) {
                res.status(500).json({ 
                    error: 'Failed to proxy video',
                    message: error.message 
                });
            }
        }
    }

    /**
     * Get video info without proxying
     */
    async getVideoInfo(videoUrl) {
        try {
            const response = await axios.head(videoUrl, {
                headers: HEADERS,
                timeout: 5000
            });

            return {
                url: videoUrl,
                contentType: response.headers['content-type'],
                contentLength: response.headers['content-length'],
                acceptRanges: response.headers['accept-ranges'] === 'bytes'
            };
        } catch (error) {
            console.error('Error getting video info:', error);
            return {
                url: videoUrl,
                error: error.message
            };
        }
    }
}

module.exports = new ProxyService();