import fs from 'fs';
import path from 'path';

const CACHE_DIR = path.resolve(process.env.STREAM_CACHE_DIR || './tmp/cache');
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const MAX_CACHE_SIZE = 10 * 1024 * 1024 * 1024; // 10GB

function ensureCacheDir() {
    if (!fs.existsSync(CACHE_DIR)) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
}

function getCacheKey(channelId: string, messageId: number): string {
    return `${channelId}_${messageId}`;
}

function getCachePath(key: string): string {
    return path.join(CACHE_DIR, key);
}

export function getCachedVideoPath(channelId: string, messageId: number): string {
    ensureCacheDir();
    return getCachePath(getCacheKey(channelId, messageId));
}

export function getCachedVideo(channelId: string, messageId: number): Buffer | null {
    ensureCacheDir();
    const cacheFile = getCachePath(getCacheKey(channelId, messageId));

    try {
        if (!fs.existsSync(cacheFile)) return null;

        const stats = fs.statSync(cacheFile);
        const age = Date.now() - stats.mtimeMs;

        // Check TTL
        if (age > CACHE_TTL) {
            fs.unlinkSync(cacheFile);
            return null;
        }

        return fs.readFileSync(cacheFile);
    } catch {
        return null;
    }
}

export async function ensureCachedVideoFile(
    channelId: string,
    messageId: number,
    downloader: () => Promise<Buffer>
): Promise<string> {
    const cacheFile = getCachedVideoPath(channelId, messageId);
    try {
        if (fs.existsSync(cacheFile)) {
            return cacheFile;
        }
    } catch { }

    const buffer = await downloader();
    cacheVideo(channelId, messageId, buffer);
    if (!fs.existsSync(cacheFile)) {
        throw new Error('Failed to create cached video file');
    }
    return cacheFile;
}

export function cacheVideo(channelId: string, messageId: number, data: Buffer): void {
    ensureCacheDir();
    const cacheFile = getCachePath(getCacheKey(channelId, messageId));

    try {
        fs.writeFileSync(cacheFile, data);
    } catch (error: any) {
        console.error('Failed to cache video:', error.message);
    }
}

export function seedCacheFromFile(channelId: string, messageId: number, filePath: string): void {
    ensureCacheDir();
    const cacheFile = getCachePath(getCacheKey(channelId, messageId));
    try {
        if (fs.existsSync(cacheFile)) return;
        if (!fs.existsSync(filePath)) return;
        fs.copyFileSync(filePath, cacheFile);
    } catch (error: any) {
        console.error('Failed to seed cache:', error.message);
    }
}

export function deleteCachedVideo(channelId: string, messageId: number): void {
    const cacheFile = getCachePath(getCacheKey(channelId, messageId));
    try {
        if (fs.existsSync(cacheFile)) {
            fs.unlinkSync(cacheFile);
        }
    } catch { }
}

export function cleanupCache(): void {
    ensureCacheDir();

    try {
        const files = fs.readdirSync(CACHE_DIR);
        let totalSize = 0;

        const fileInfos = files.map(f => {
            const filePath = path.join(CACHE_DIR, f);
            const stats = fs.statSync(filePath);
            totalSize += stats.size;
            return { path: filePath, size: stats.size, mtime: stats.mtimeMs };
        });

        // Remove expired files
        for (const info of fileInfos) {
            if (Date.now() - info.mtime > CACHE_TTL) {
                fs.unlinkSync(info.path);
                totalSize -= info.size;
            }
        }

        // If still over limit, remove oldest files
        if (totalSize > MAX_CACHE_SIZE) {
            const sorted = fileInfos
                .filter(f => fs.existsSync(f.path))
                .sort((a, b) => a.mtime - b.mtime);

            for (const info of sorted) {
                if (totalSize <= MAX_CACHE_SIZE) break;
                try {
                    fs.unlinkSync(info.path);
                    totalSize -= info.size;
                } catch { }
            }
        }
    } catch (error: any) {
        console.error('Cache cleanup failed:', error.message);
    }
}
