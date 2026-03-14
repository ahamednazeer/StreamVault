import ffmpeg from 'fluent-ffmpeg';

export interface VideoMetadata {
    duration: number;      // seconds
    width: number;
    height: number;
    codec: string;
    bitrate: number;
    resolution: string;    // e.g. "1920x1080"
}

const PROBE_OPTIONS = [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_type,codec_name,width,height',
    '-show_entries', 'format=duration,bit_rate',
    '-read_intervals', '0%+5',
    '-probesize', process.env.FFPROBE_PROBESIZE || '5000000',
    '-analyzeduration', process.env.FFPROBE_ANALYZEDURATION || '5000000',
];

const FALLBACK_OPTIONS = [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_type,codec_name,width,height',
    '-show_entries', 'format=duration,bit_rate',
];

function isKilledError(err: Error): boolean {
    return /SIGKILL|killed with signal/i.test(err.message);
}

export function extractVideoMetadata(filePath: string): Promise<VideoMetadata> {
    return new Promise((resolve, reject) => {
        const handleMetadata = (metadata: any) => {
            const streams = Array.isArray(metadata.streams) ? metadata.streams : [];
            let videoStream = streams.find((s: any) => s.codec_type === 'video');
            if (!videoStream) {
                const hasCodecType = streams.some((s: any) => typeof s.codec_type === 'string');
                if (!hasCodecType && streams.length > 0) {
                    videoStream = streams[0];
                }
            }
            if (!videoStream) {
                reject(new Error('No video stream found'));
                return;
            }

            const duration = metadata.format.duration || 0;
            const width = videoStream.width || 0;
            const height = videoStream.height || 0;
            const codec = videoStream.codec_name || 'unknown';
            const bitrate = parseInt(String(metadata.format.bit_rate || '0'));

            resolve({
                duration: Math.round(duration),
                width,
                height,
                codec,
                bitrate,
                resolution: `${width}x${height}`,
            });
        };

        const runProbe = (options: string[], allowFallback: boolean) => {
            ffmpeg.ffprobe(filePath, options, (err, metadata) => {
                if (err) {
                    if (allowFallback && isKilledError(err)) {
                        runProbe(FALLBACK_OPTIONS, false);
                        return;
                    }
                    reject(new Error(`FFmpeg probe failed: ${err.message}`));
                    return;
                }
                handleMetadata(metadata);
            });
        };

        runProbe(PROBE_OPTIONS, true);
    });
}

export function remuxToMp4(inputPath: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .outputOptions([
                '-map 0:v:0',
                '-map 0:a?',
                '-c copy',
                '-movflags +faststart',
                '-f mp4',
            ])
            .on('error', (err) => {
                reject(new Error(`FFmpeg remux failed: ${err.message}`));
            })
            .on('end', () => resolve())
            .save(outputPath);
    });
}

export function transcodeToMp4(inputPath: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .outputOptions([
                '-map 0:v:0',
                '-map 0:a?',
                '-c:v libx264',
                '-preset veryfast',
                '-crf 23',
                '-c:a aac',
                '-b:a 160k',
                '-ac 2',
                '-movflags +faststart',
                '-f mp4',
            ])
            .on('error', (err) => {
                reject(new Error(`FFmpeg transcode failed: ${err.message}`));
            })
            .on('end', () => resolve())
            .save(outputPath);
    });
}
