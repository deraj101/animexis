const ffmpegStatic = require('ffmpeg-static');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');

ffmpeg.setFfmpegPath(ffmpegStatic);

const writeStream = fs.createWriteStream('output.ts');

ffmpeg('https://vibeplayer.site/public/stream/e7116428cb83df27/master.m3u8')
    .outputOptions([
        '-c copy'
    ])
    .outputFormat('mpegts')
    .on('start', (cmd) => console.log('Started: ', cmd))
    .on('error', (err) => console.log('Error: ', err.message))
    .on('end', () => console.log('Finished!'))
    .pipe(writeStream, { end: true });
