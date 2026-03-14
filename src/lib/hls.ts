import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import { downloadVideoStreamFromTelegram, isTelegramAuthorized } from './telegram';
import { Readable } from 'stream';
import { VideoPart } from './videoParts';

const CACHE_DIR = path.resolve(process.env.STREAM_CACHE_DIR || './tmp/cache');
const HLS_ROOT = path.join(CACHE_DIR, 'hls');
const HLS_TIME = parseInt(process.env.HLS_SEGMENT_TIME || '6');
const HLS_CACHE_TTL = parseInt(process.env.HLS_CACHE_TTL_MS || `${7 * 24 * 60 * 60 * 1000}`);
const HLS_CACHE_MAX_SIZE = parseInt(process.env.HLS_CACHE_MAX_SIZE || `${100 * 1024 * 1024 * 1024}`);
const HLS_PLAYLIST_TIMEOUT = parseInt(process.env.HLS_PLAYLIST_TIMEOUT_MS || '15000');

const buildLocks = new Map<string, Promise<string>>();

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function ensureDir(dir: string) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function getAccessMarkerPath(videoId: string): string {
    return path.join(getHlsDir(videoId), '.access');
}

type AudioStreamInfo = {
    index: number;
    language?: string;
    title?: string;
    channels?: number;
};

async function getAudioStreams(parts: VideoPart[]): Promise<AudioStreamInfo[]> {
    return new Promise((resolve) => {
        if (parts.length === 0) {
            resolve([]);
            return;
        }
        const first = parts[0];
        downloadVideoStreamFromTelegram(first.telegramChannelId, first.telegramMessageId)
            .then((stream) => {
                ffmpeg.ffprobe(stream as any, (err, metadata) => {
                    try {
                        if (stream && !stream.destroyed) {
                            stream.destroy();
                        }
                    } catch { }
                    if (err || !metadata?.streams) {
                        resolve([]);
                        return;
                    }
                    const audio = metadata.streams
                        .filter((s) => s.codec_type === 'audio')
                        .map((s) => ({
                            index: typeof s.index === 'number' ? s.index : 0,
                            language: s.tags?.language,
                            title: s.tags?.title,
                            channels: s.channels,
                        }));
                    resolve(audio);
                });
            })
            .catch(() => resolve([]));
    });
}

export function getHlsDir(videoId: string): string {
    ensureDir(HLS_ROOT);
    return path.join(HLS_ROOT, videoId);
}

export function getHlsPlaylistPath(videoId: string): string {
    return path.join(getHlsDir(videoId), 'index.m3u8');
}

export function touchHlsAccess(videoId: string) {
    try {
        const marker = getAccessMarkerPath(videoId);
        ensureDir(path.dirname(marker));
        const now = new Date();
        fs.writeFileSync(marker, '');
        fs.utimesSync(marker, now, now);
    } catch { }
}

function getDirSize(dir: string): number {
    let total = 0;
    const entries = fs.readdirSync(dir);
    for (const entry of entries) {
        const full = path.join(dir, entry);
        const stats = fs.statSync(full);
        if (stats.isDirectory()) {
            total += getDirSize(full);
        } else {
            total += stats.size;
        }
    }
    return total;
}

export function cleanupHlsCache() {
    ensureDir(HLS_ROOT);
    try {
        const dirs = fs.readdirSync(HLS_ROOT)
            .filter(name => !buildLocks.has(name))
            .map(name => path.join(HLS_ROOT, name))
            .filter(p => {
                try { return fs.statSync(p).isDirectory(); } catch { return false; }
            });

        const now = Date.now();
        let totalSize = 0;
        const info = dirs.map(dir => {
            const accessFile = path.join(dir, '.access');
            let lastAccess = 0;
            try {
                if (fs.existsSync(accessFile)) {
                    lastAccess = fs.statSync(accessFile).mtimeMs;
                } else {
                    lastAccess = fs.statSync(dir).mtimeMs;
                }
            } catch {
                lastAccess = 0;
            }
            let size = 0;
            try { size = getDirSize(dir); } catch { size = 0; }
            totalSize += size;
            return { dir, lastAccess, size };
        });

        for (const item of info) {
            if (HLS_CACHE_TTL > 0 && now - item.lastAccess > HLS_CACHE_TTL) {
                deleteHlsCacheByPath(item.dir);
                totalSize -= item.size;
            }
        }

        if (totalSize > HLS_CACHE_MAX_SIZE) {
            const sorted = info
                .filter(item => fs.existsSync(item.dir))
                .sort((a, b) => a.lastAccess - b.lastAccess);
            for (const item of sorted) {
                if (totalSize <= HLS_CACHE_MAX_SIZE) break;
                deleteHlsCacheByPath(item.dir);
                totalSize -= item.size;
            }
        }
    } catch { }
}

function deleteHlsCacheByPath(dir: string) {
    try {
        if (!fs.existsSync(dir)) return;
        const files = fs.readdirSync(dir);
        for (const file of files) {
            try { fs.unlinkSync(path.join(dir, file)); } catch { }
        }
        try { fs.rmdirSync(dir); } catch { }
    } catch { }
}

async function buildHls(videoId: string, parts: VideoPart[]): Promise<string> {
    const normalizedParts = [...parts].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    const key = videoId;
    if (buildLocks.has(key)) {
        return buildLocks.get(key)!;
    }

    const promise = (async () => {
        const authorized = await isTelegramAuthorized();
        if (!authorized) {
            throw new Error('Telegram not authorized');
        }
        const outDir = getHlsDir(videoId);
        const playlistPath = getHlsPlaylistPath(videoId);

        if (fs.existsSync(playlistPath)) {
            try {
                const segments = fs.readdirSync(outDir).filter(f => f.endsWith('.ts'));
                if (segments.length > 0) {
                    return playlistPath;
                }
            } catch { }
        }

        ensureDir(outDir);

        const videoPlaylist = path.join(outDir, 'video.m3u8');
        const videoSegmentPattern = path.join(outDir, 'video_%03d.ts');

        const audioInfos = await getAudioStreams(normalizedParts);
        const hasAudio = audioInfos.length > 0;

        const audioPlaylists = audioInfos.map((_, i) => path.join(outDir, `audio_${i}.m3u8`));
        const audioSegmentPatterns = audioInfos.map((_, i) => path.join(outDir, `audio_${i}_%03d.ts`));

        const lines: string[] = [
            '#EXTM3U',
            '#EXT-X-VERSION:3',
            '#EXT-X-INDEPENDENT-SEGMENTS',
        ];

        if (hasAudio) {
            audioInfos.forEach((audio, i) => {
                const name = audio.title || audio.language || `Track ${i + 1}`;
                const lang = audio.language ? `LANGUAGE="${audio.language}"` : '';
                const def = i === 0 ? 'DEFAULT=YES,AUTOSELECT=YES' : 'DEFAULT=NO,AUTOSELECT=YES';
                const attrs = [
                    'TYPE=AUDIO',
                    'GROUP-ID="audio"',
                    `NAME="${name}"`,
                    def,
                    lang,
                    `URI="audio_${i}.m3u8"`,
                ].filter(Boolean).join(',');
                lines.push(`#EXT-X-MEDIA:${attrs}`);
            });

            lines.push('#EXT-X-STREAM-INF:BANDWIDTH=3000000,CODECS="avc1.64001f,mp4a.40.2",AUDIO="audio"');
        } else {
            lines.push('#EXT-X-STREAM-INF:BANDWIDTH=3000000,CODECS="avc1.64001f"');
        }

        lines.push('video.m3u8');
        fs.writeFileSync(playlistPath, lines.join('\n'));

        const inputStream = Readable.from(async function* () {
            for (const part of normalizedParts) {
                const stream = await downloadVideoStreamFromTelegram(part.telegramChannelId, part.telegramMessageId);
                for await (const chunk of stream as any) {
                    yield chunk;
                }
            }
        }());

        const command = ffmpeg()
            .input(inputStream as any)
            .output(videoPlaylist)
            .outputOptions([
                '-map 0:v:0',
                '-an',
                '-c:v libx264',
                '-preset veryfast',
                '-f hls',
                `-hls_time ${HLS_TIME}`,
                '-hls_list_size 0',
                '-hls_playlist_type event',
                '-hls_flags independent_segments+append_list',
                `-hls_segment_filename ${videoSegmentPattern}`,
            ]);

        audioInfos.forEach((_, i) => {
            command
                .output(audioPlaylists[i])
                .outputOptions([
                    `-map 0:a:${i}`,
                    '-vn',
                    '-c:a aac',
                    '-b:a 160k',
                    '-ac 2',
                    '-f hls',
                    `-hls_time ${HLS_TIME}`,
                    '-hls_list_size 0',
                    '-hls_playlist_type event',
                    '-hls_flags independent_segments+append_list',
                    `-hls_segment_filename ${audioSegmentPatterns[i]}`,
                ]);
        });

        const ffmpegPromise = new Promise<void>((resolve, reject) => {
            command
                .on('end', () => resolve())
                .on('error', (err) => reject(err))
                .run();
        });

        const waitForPlaylists = async (): Promise<boolean> => {
            const targets = [videoPlaylist, ...audioPlaylists];
            const timeoutMs = HLS_PLAYLIST_TIMEOUT;
            const start = Date.now();
            while (Date.now() - start < timeoutMs) {
                const ready = targets.every(p => fs.existsSync(p));
                if (ready) return true;
                await sleep(500);
            }
            return false;
        };

        let readyResolve: ((value: string) => void) | null = null;
        let readyReject: ((reason?: any) => void) | null = null;
        const readyPromise = new Promise<string>((resolve, reject) => {
            readyResolve = resolve;
            readyReject = reject;
        });

        waitForPlaylists()
            .then((ready) => {
                if (!ready) {
                    console.warn('HLS playlists not ready yet, returning master playlist early');
                }
                readyResolve?.(playlistPath);
            })
            .catch((err) => readyReject?.(err));

        ffmpegPromise
            .catch((err) => readyReject?.(err))
            .finally(() => {
                try {
                    if (inputStream && typeof (inputStream as any).destroy === 'function') {
                        (inputStream as any).destroy();
                    }
                } catch { }
            });

        ffmpegPromise
            .catch((err) => {
                try {
                    const files = fs.readdirSync(outDir);
                    for (const file of files) {
                        try { fs.unlinkSync(path.join(outDir, file)); } catch { }
                    }
                    try { fs.rmdirSync(outDir); } catch { }
                } catch { }
                console.error('HLS build failed:', err.message);
            })
            .finally(() => {
                cleanupHlsCache();
                buildLocks.delete(key);
            });

        return readyPromise;
    })();

    buildLocks.set(key, promise);
    return promise;
}

export async function ensureHlsPlaylist(videoId: string, parts: VideoPart[]): Promise<string> {
    return buildHls(videoId, parts);
}

export function deleteHlsCache(videoId: string) {
    const dir = getHlsDir(videoId);
    try {
        if (!fs.existsSync(dir)) return;
        const files = fs.readdirSync(dir);
        for (const file of files) {
            try { fs.unlinkSync(path.join(dir, file)); } catch { }
        }
        try { fs.rmdirSync(dir); } catch { }
    } catch { }
}

export function getHlsSegmentPath(videoId: string, segment: string): string {
    return path.join(getHlsDir(videoId), segment);
}
