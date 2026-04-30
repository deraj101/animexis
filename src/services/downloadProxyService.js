const { spawn } = require('child_process');
const ffmpegStatic = require('ffmpeg-static');

class DownloadProxyService {
    /**
     * Proxies an M3U8 stream and converts it to an MP4 stream on the fly.
     * Uses child_process.spawn directly to avoid fluent-ffmpeg's argument escaping issues
     * (the -headers flag with \r\n was being split, causing "Error opening output file").
     *
     * @param {string} m3u8Url - The original M3U8 streaming URL
     * @param {object} res - Express response object
     */
    streamAsMp4(m3u8Url, res) {
        console.log(`🎬 [DownloadProxy] Starting MP4 conversion for: ${m3u8Url}`);

        // Derive referer from the M3U8 URL's origin
        let referer = 'https://anitaku.to/';
        let origin = 'https://anitaku.to';

        try {
            const parsed = new URL(m3u8Url);
            origin = parsed.origin;
            if (m3u8Url.includes('vibeplayer')) {
                // Extract video ID: /public/stream/ID/master.m3u8
                const match = m3u8Url.match(/\/stream\/([a-zA-Z0-9]+)\//);
                if (match && match[1]) {
                    referer = `${origin}/${match[1]}`;
                } else {
                    referer = origin + '/';
                }
            } else {
                referer = origin + '/';
            }
        } catch {}

        // Set headers for MP4 download
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Disposition', 'attachment; filename="episode.mp4"');

        // Disable timeout since conversions can take a while
        res.setTimeout(0);

        // Build args array — spawn passes each element as a separate argv entry,
        // so no shell escaping / splitting issues with the Referer header.
        const args = [
            '-user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            '-headers', `Referer: ${referer}\r\nOrigin: ${origin}\r\n`,
            '-i', m3u8Url,
            '-c', 'copy',
            '-bsf:a', 'aac_adtstoasc',
            '-movflags', 'frag_keyframe+empty_moov',
            '-f', 'mp4',
            'pipe:1'
        ];

        console.log(`▶️ [DownloadProxy] ffmpeg command: ${ffmpegStatic} ${args.join(' ')}`);

        const ffmpeg = spawn(ffmpegStatic, args, {
            stdio: ['ignore', 'pipe', 'pipe'] // stdin ignored, stdout piped, stderr piped
        });

        // Pipe ffmpeg stdout (the MP4 data) directly to the HTTP response
        ffmpeg.stdout.pipe(res);

        // Collect stderr for logging
        let stderrData = '';
        ffmpeg.stderr.on('data', (chunk) => {
            stderrData += chunk.toString();
        });

        ffmpeg.on('close', (code) => {
            if (code === 0) {
                console.log('✅ [DownloadProxy] MP4 conversion finished successfully');
            } else {
                console.error(`❌ [DownloadProxy] ffmpeg exited with code ${code}:\n${stderrData.slice(-500)}`);
                if (!res.headersSent) {
                    res.status(500).send('Error processing video stream');
                }
            }
        });

        ffmpeg.on('error', (err) => {
            console.error('❌ [DownloadProxy] ffmpeg spawn error:', err.message);
            if (!res.headersSent) {
                res.status(500).send('Error processing video stream');
            }
        });

        // If the client disconnects, kill ffmpeg to save server resources
        res.on('close', () => {
            if (!ffmpeg.killed) {
                console.log('⚠️ [DownloadProxy] Client disconnected, killing ffmpeg process');
                ffmpeg.kill('SIGKILL');
            }
        });
    }
}

module.exports = new DownloadProxyService();

