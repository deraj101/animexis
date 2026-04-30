const ffmpegStatic = require('ffmpeg-static');
const ffmpeg = require('fluent-ffmpeg');

ffmpeg.setFfmpegPath(ffmpegStatic);

ffmpeg('https://vibeplayer.site/public/stream/e7116428cb83df27/master.m3u8')
    .outputOptions([
        '-c copy',
        '-bsf:a aac_adtstoasc'
    ])
    .outputFormat('mp4')
    .on('start', (cmd) => console.log('Started: ', cmd))
    .on('error', (err) => console.log('Error: ', err.message))
    .on('end', () => console.log('Finished!'))
    .save('output.mp4');
