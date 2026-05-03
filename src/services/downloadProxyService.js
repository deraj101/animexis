const { spawn } = require('child_process');
const axios = require('axios');
const ffmpegStatic = require('ffmpeg-static');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

class DownloadProxyService {
    async streamAsTs(m3u8Url, res) {
        console.log(`[DownloadProxy] Starting TS remux for: ${m3u8Url}`);

        const { referer, origin } = this._getRequestContext(m3u8Url);
        let streamUrl;

        try {
            streamUrl = await this._resolvePlayableM3u8Url(m3u8Url, referer, origin);
        } catch (error) {
            console.error(`[DownloadProxy] HLS preflight failed: ${error.message}`);
            return res.status(422).json({
                success: false,
                error: error.message || 'This HLS stream is not downloadable.',
            });
        }

        res.setHeader('Content-Type', 'video/mp2t');
        res.setHeader('Content-Disposition', 'attachment; filename="episode.ts"');
        res.setTimeout(0);

        const args = [
            '-loglevel', 'error', // 🔇 Reduce memory usage by suppressing logs
            '-threads', '1',      // 🏎️ Limit to 1 thread to save memory on Render Free
            '-user_agent', this._headers(referer, origin)['User-Agent'],
            '-headers', `Referer: ${referer}\r\nOrigin: ${origin}\r\n`,
            '-i', streamUrl,
            '-map', '0:v:0?',
            '-map', '0:a:0?',
            '-c', 'copy',
            '-f', 'mpegts',
            'pipe:1',
        ];

        console.log(`[DownloadProxy] ffmpeg command: ${ffmpegStatic} ${args.join(' ')}`);

        const ffmpeg = spawn(ffmpegStatic, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        ffmpeg.stdout.pipe(res);

        let stderrData = '';
        let ffmpegClosed = false;

        ffmpeg.stderr.on('data', (chunk) => {
            stderrData += chunk.toString();
        });

        ffmpeg.on('close', (code) => {
            ffmpegClosed = true;
            if (code === 0) {
                console.log('[DownloadProxy] TS remux finished successfully');
            } else {
                console.error(`[DownloadProxy] ffmpeg exited with code ${code}:\n${stderrData.slice(-500)}`);
                if (!res.headersSent) {
                    res.status(500).send('Error processing video stream');
                }
            }
        });

        ffmpeg.on('error', (err) => {
            console.error('[DownloadProxy] ffmpeg spawn error:', err.message);
            if (!res.headersSent) {
                res.status(500).send('Error processing video stream');
            }
        });

        res.on('close', () => {
            if (!ffmpegClosed && !res.writableEnded && !ffmpeg.killed) {
                console.log('[DownloadProxy] Client disconnected, killing ffmpeg process');
                ffmpeg.kill('SIGKILL');
            }
        });
    }

    async streamAsMp4(m3u8Url, res) {
        console.log(`[DownloadProxy] Starting MP4 conversion for: ${m3u8Url}`);

        const { referer, origin } = this._getRequestContext(m3u8Url);
        let streamUrl;

        try {
            streamUrl = await this._resolvePlayableM3u8Url(m3u8Url, referer, origin);
        } catch (error) {
            console.error(`[DownloadProxy] HLS preflight failed: ${error.message}`);
            return res.status(422).json({
                success: false,
                error: error.message || 'This HLS stream is not downloadable.',
            });
        }

        res.setTimeout(0);
        const tempFile = path.join(os.tmpdir(), `animexis-${crypto.randomUUID()}.mp4`);

        const args = [
            '-loglevel', 'error',
            '-threads', '1',      // 🏎️ Limit to 1 thread to save memory on Render Free
            '-user_agent', this._headers(referer, origin)['User-Agent'],
            '-headers', `Referer: ${referer}\r\nOrigin: ${origin}\r\n`,
            '-i', streamUrl,
            '-map', '0:v:0?',
            '-map', '0:a:0?',
            '-c', 'copy',
            '-bsf:a', 'aac_adtstoasc',
            '-movflags', '+faststart',
            '-f', 'mp4',
            '-y',
            tempFile,
        ];

        console.log(`[DownloadProxy] ffmpeg command: ${ffmpegStatic} ${args.join(' ')}`);

        const ffmpeg = spawn(ffmpegStatic, args, {
            stdio: ['ignore', 'ignore', 'pipe'],
        });

        let stderrData = '';
        let ffmpegClosed = false;
        let responseStarted = false;

        ffmpeg.stderr.on('data', (chunk) => {
            stderrData += chunk.toString();
        });

        ffmpeg.on('close', (code) => {
            ffmpegClosed = true;
            if (code === 0) {
                console.log('[DownloadProxy] MP4 conversion finished successfully');
                responseStarted = true;

                const stat = fs.statSync(tempFile);
                res.setHeader('Content-Type', 'video/mp4');
                res.setHeader('Content-Disposition', 'attachment; filename="episode.mp4"');
                res.setHeader('Content-Length', stat.size);

                const fileStream = fs.createReadStream(tempFile);
                fileStream.pipe(res);
                fileStream.on('close', () => {
                    fs.unlink(tempFile, () => {});
                });
                fileStream.on('error', (err) => {
                    console.error('[DownloadProxy] temp file stream error:', err.message);
                    fs.unlink(tempFile, () => {});
                    if (!res.headersSent) {
                        res.status(500).send('Error sending video file');
                    } else {
                        res.destroy(err);
                    }
                });
            } else {
                console.error(`[DownloadProxy] ffmpeg exited with code ${code}:\n${stderrData.slice(-500)}`);
                fs.unlink(tempFile, () => {});
                if (!res.headersSent) {
                    res.status(500).send('Error processing video stream');
                }
            }
        });

        ffmpeg.on('error', (err) => {
            console.error('[DownloadProxy] ffmpeg spawn error:', err.message);
            fs.unlink(tempFile, () => {});
            if (!res.headersSent) {
                res.status(500).send('Error processing video stream');
            }
        });

        res.on('close', () => {
            if (!ffmpegClosed && !responseStarted && !res.writableEnded && !ffmpeg.killed) {
                console.log('[DownloadProxy] Client disconnected, killing ffmpeg process');
                ffmpeg.kill('SIGKILL');
                fs.unlink(tempFile, () => {});
            }
        });
    }

    _getRequestContext(m3u8Url) {
        let referer = 'https://anitaku.to/';
        let origin = 'https://anitaku.to';

        try {
            const parsed = new URL(m3u8Url);
            origin = parsed.origin;

            if (m3u8Url.includes('vibeplayer')) {
                const match = m3u8Url.match(/\/stream\/([a-zA-Z0-9]+)\//);
                referer = match?.[1] ? `${origin}/${match[1]}` : `${origin}/`;
            } else {
                referer = `${origin}/`;
            }
        } catch {}

        return { referer, origin };
    }

    async _resolvePlayableM3u8Url(m3u8Url, referer, origin) {
        const playlist = await this._fetchText(m3u8Url, referer, origin);
        const variants = this._parseVariants(playlist, m3u8Url);
        const candidates = variants.length > 0 ? variants : [{ url: m3u8Url, bandwidth: 0 }];

        candidates.sort((a, b) => b.bandwidth - a.bandwidth);

        for (const candidate of candidates) {
            const mediaPlaylist = candidate.url === m3u8Url
                ? playlist
                : await this._fetchText(candidate.url, referer, origin);
            const firstSegment = this._findFirstSegmentUrl(mediaPlaylist, candidate.url);

            if (!firstSegment) continue;

            const type = await this._getSegmentContentType(firstSegment, referer, origin);
            if (!type || !type.toLowerCase().startsWith('image/')) {
                if (candidate.url !== m3u8Url) {
                    console.log(`[DownloadProxy] Selected HLS variant: ${candidate.url}`);
                }
                return candidate.url;
            }

            console.log(`[DownloadProxy] Skipping image-only HLS variant (${type}): ${candidate.url}`);
        }

        throw new Error('This stream exposes image segments instead of downloadable video.');
    }

    async _fetchText(url, referer, origin) {
        const response = await axios.get(url, {
            timeout: 15000,
            responseType: 'text',
            proxy: false,
            headers: this._headers(referer, origin),
        });
        return response.data;
    }

    _parseVariants(playlist, baseUrl) {
        const lines = String(playlist).split(/\r?\n/);
        const variants = [];

        for (let i = 0; i < lines.length; i += 1) {
            const line = lines[i].trim();
            if (!line.startsWith('#EXT-X-STREAM-INF')) continue;

            const bandwidth = Number(line.match(/BANDWIDTH=(\d+)/)?.[1] || 0);
            const nextLine = lines.slice(i + 1).find((candidate) => {
                const trimmed = candidate.trim();
                return trimmed && !trimmed.startsWith('#');
            });

            if (nextLine) {
                variants.push({
                    url: new URL(nextLine.trim(), baseUrl).toString(),
                    bandwidth,
                });
            }
        }

        return variants;
    }

    _findFirstSegmentUrl(playlist, baseUrl) {
        const lines = String(playlist).split(/\r?\n/);

        for (let i = 0; i < lines.length; i += 1) {
            if (!lines[i].trim().startsWith('#EXTINF')) continue;

            const nextLine = lines.slice(i + 1).find((candidate) => {
                const trimmed = candidate.trim();
                return trimmed && !trimmed.startsWith('#');
            });

            return nextLine ? new URL(nextLine.trim(), baseUrl).toString() : null;
        }

        return null;
    }

    async _getSegmentContentType(url, referer, origin) {
        const response = await axios.get(url, {
            timeout: 15000,
            responseType: 'stream',
            proxy: false,
            headers: {
                ...this._headers(referer, origin),
                Range: 'bytes=0-31',
            },
            validateStatus: status => status < 400,
        });

        response.data.destroy();
        return response.headers['content-type'] || '';
    }

    _headers(referer, origin) {
        return {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            Referer: referer,
            Origin: origin,
            Accept: '*/*',
        };
    }
}

module.exports = new DownloadProxyService();
