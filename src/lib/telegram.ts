import { TelegramClient } from '@mtcute/node';
import { MemoryStorage } from '@mtcute/core';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { getRedis } from './redis';

const API_ID = parseInt(process.env.TELEGRAM_API_ID || '0');
const API_HASH = process.env.TELEGRAM_API_HASH || '';
const CHANNEL_IDS = (process.env.TELEGRAM_CHANNEL_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

const SESSION_FILE = process.env.TELEGRAM_SESSION_FILE
    ? path.resolve(process.env.TELEGRAM_SESSION_FILE)
    : path.join(process.cwd(), 'telegram.session');
const SESSION_REDIS_KEY = process.env.TELEGRAM_SESSION_REDIS_KEY || '';
const MAX_RETRIES = 3;
const RETRY_DELAYS = [2000, 5000, 10000]; // exponential backoff

let client: TelegramClient | null = null;
let channelRoundRobin = 0;

// --- Media location cache: avoids repeated getMessages() calls during streaming ---
const MEDIA_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const mediaLocationCache = new Map<string, { media: any; mediaSize: number | null; ts: number }>();

function getCachedMedia(channelId: string, messageId: number) {
    const key = `${channelId}:${messageId}`;
    const entry = mediaLocationCache.get(key);
    if (entry && Date.now() - entry.ts < MEDIA_CACHE_TTL) return entry;
    mediaLocationCache.delete(key);
    return null;
}

function setCachedMedia(channelId: string, messageId: number, media: any, mediaSize: number | null) {
    const key = `${channelId}:${messageId}`;
    mediaLocationCache.set(key, { media, mediaSize, ts: Date.now() });
    // Evict old entries to prevent unbounded growth
    if (mediaLocationCache.size > 200) {
        const now = Date.now();
        for (const [k, v] of mediaLocationCache) {
            if (now - v.ts > MEDIA_CACHE_TTL) mediaLocationCache.delete(k);
        }
    }
}

// --- Chunk data cache: serves rewinds/rewatches instantly from memory ---
const CHUNK_CACHE_TTL = 10 * 60 * 1000; // 10 minutes
const CHUNK_CACHE_MAX_BYTES = 50 * 1024 * 1024; // 50MB memory budget
const chunkDataCache = new Map<string, { data: Buffer; ts: number }>();
let chunkCacheTotalBytes = 0;

function chunkCacheKey(channelId: string, messageId: number, offset: number) {
    return `${channelId}:${messageId}:${offset}`;
}

function getCachedChunk(channelId: string, messageId: number, offset: number): Buffer | null {
    const key = chunkCacheKey(channelId, messageId, offset);
    const entry = chunkDataCache.get(key);
    if (entry && Date.now() - entry.ts < CHUNK_CACHE_TTL) return entry.data;
    if (entry) {
        chunkCacheTotalBytes -= entry.data.length;
        chunkDataCache.delete(key);
    }
    return null;
}

function setCachedChunk(channelId: string, messageId: number, offset: number, data: Buffer) {
    const key = chunkCacheKey(channelId, messageId, offset);
    
    // Remove old size if we are overwriting an existing key to prevent double-counting
    if (chunkDataCache.has(key)) {
        const existing = chunkDataCache.get(key)!;
        chunkCacheTotalBytes -= existing.data.length;
    }

    // Evict oldest entries if over budget
    while (chunkCacheTotalBytes + data.length > CHUNK_CACHE_MAX_BYTES && chunkDataCache.size > 0) {
        const firstKey = chunkDataCache.keys().next().value!;
        const evicted = chunkDataCache.get(firstKey)!;
        chunkCacheTotalBytes -= evicted.data.length;
        chunkDataCache.delete(firstKey);
    }
    // Also evict expired entries
    const now = Date.now();
    for (const [k, v] of chunkDataCache) {
        if (now - v.ts > CHUNK_CACHE_TTL) {
            chunkCacheTotalBytes -= v.data.length;
            chunkDataCache.delete(k);
        }
    }
    chunkDataCache.set(key, { data, ts: now });
    chunkCacheTotalBytes += data.length;
}

/**
 * O(1) aligned limit: find the largest power-of-2 (up to maxLimit)
 * that evenly divides the given offset.
 * Telegram's upload.getFile with precise:true requires offset % limit === 0.
 */
function alignedLimitForOffset(offset: number, maxLimit: number): number {
    if (offset === 0) return maxLimit;
    // offset & -offset gives the largest power of 2 dividing offset
    const maxPow2 = offset & -offset;
    // Clamp to maxLimit (which is already a power of 2, 1MB)
    return Math.min(maxPow2, maxLimit);
}

export function getChannelIds(): string[] {
    return [...CHANNEL_IDS];
}

export function getChannelIndexForId(channelId: string): number {
    const trimmed = channelId.trim();
    if (!trimmed) return -1;
    return CHANNEL_IDS.findIndex((id) => id.trim() === trimmed);
}

export function advanceChannelIndex(steps: number) {
    if (!Number.isFinite(steps) || steps <= 0) return;
    channelRoundRobin += Math.floor(steps);
}

async function loadSession(): Promise<string> {
    if (SESSION_REDIS_KEY) {
        try {
            const redis = getRedis();
            const value = await redis.get(SESSION_REDIS_KEY);
            if (value) return value.trim();
        } catch { }
    }
    try {
        if (fs.existsSync(SESSION_FILE)) {
            return fs.readFileSync(SESSION_FILE, 'utf-8').trim();
        }
    } catch { }
    return '';
}

async function saveSession(session: string) {
    if (SESSION_REDIS_KEY) {
        try {
            const redis = getRedis();
            await redis.set(SESSION_REDIS_KEY, session);
        } catch { }
    }
    try {
        fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
        fs.writeFileSync(SESSION_FILE, session, 'utf-8');
    } catch { }
}

async function clearSessionFile() {
    if (SESSION_REDIS_KEY) {
        try {
            const redis = getRedis();
            await redis.del(SESSION_REDIS_KEY);
        } catch { }
    }
    try {
        if (fs.existsSync(SESSION_FILE)) {
            fs.unlinkSync(SESSION_FILE);
        }
    } catch { }
}

export async function initClient(): Promise<TelegramClient> {
    if (client) return client;

    const sessionStr = await loadSession();
    
    client = new TelegramClient({
        apiId: API_ID,
        apiHash: API_HASH,
        storage: new MemoryStorage(),
    });

    if (sessionStr) {
        try {
            await client.importSession(sessionStr);
        } catch (e) {
            console.error('Failed to import session:', e);
            await clearSessionFile();
        }
    }

    return client;
}

export async function isTelegramAuthorized(): Promise<boolean> {
    try {
        const tg = await initClient();
        const me = await tg.getMe();
        return !!me;
    } catch {
        return false;
    }
}

export async function saveClientSession(session?: string) {
    if (session) {
        await saveSession(session);
        return;
    }
    if (client) {
        const exported = await client.exportSession();
        await saveSession(exported);
    }
}

export async function resetClientSession() {
    try {
        if (client) {
            try {
                // Use close() if available, otherwise stop()
                if (typeof (client as any).close === 'function') {
                    await (client as any).close();
                } else if (typeof (client as any).stop === 'function') {
                    await (client as any).stop();
                }
            } catch { }
        }
    } finally {
        client = null;
        channelRoundRobin = 0;
        await clearSessionFile();
    }
}

function getNextChannelId(): string {
    if (CHANNEL_IDS.length === 0) throw new Error('No Telegram channels configured');
    const channelId = CHANNEL_IDS[channelRoundRobin % CHANNEL_IDS.length];
    channelRoundRobin++;
    return channelId;
}

function parseChannelPeer(channelId: string): string | number {
    const trimmed = channelId.trim();
    if (!trimmed) {
        throw new Error('Invalid Telegram channel id');
    }
    if (/^-?\d+$/.test(trimmed)) {
        const numeric = Number(trimmed);
        if (!Number.isSafeInteger(numeric)) {
            throw new Error(`Telegram channel id is too large: ${trimmed}`);
        }
        return numeric;
    }
    return trimmed;
}

export function getChannelIndex(): number {
    return channelRoundRobin % Math.max(CHANNEL_IDS.length, 1);
}

async function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export async function uploadVideoToTelegram(
    filePath: string,
    fileName: string,
    onProgress?: (progress: number) => void,
    options?: { abortSignal?: AbortSignal; channelId?: string }
): Promise<{ channelId: string; messageId: number; fileSize: number }> {
    const tg = await initClient();
    const channelId = options?.channelId ?? getNextChannelId();
    const channelPeer = parseChannelPeer(channelId);
    const fileSize = fs.statSync(filePath).size;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        let fileStream: fs.ReadStream | null = null;
        try {
            if (options?.abortSignal?.aborted) {
                throw new Error('Upload canceled by user');
            }

            fileStream = fs.createReadStream(filePath);
            const result = await tg.sendMedia(channelPeer, {
                type: 'video',
                file: fileStream,
                fileName,
                fileSize,
                caption: fileName,
            }, {
                abortSignal: options?.abortSignal,
                progressCallback: (on: number, total: number) => {
                    if (onProgress) {
                        onProgress(Math.round((on / total) * 100));
                    }
                }
            });

            await saveClientSession();

            return {
                channelId,
                messageId: result.id,
                fileSize,
            };
        } catch (error: any) {
            lastError = error;
            if (options?.abortSignal?.aborted) {
                throw new Error('Upload canceled by user');
            }
            console.error(`Upload attempt ${attempt + 1}/${MAX_RETRIES} failed:`, error.message);

            if (attempt < MAX_RETRIES - 1) {
                await sleep(RETRY_DELAYS[attempt]);
            }
        } finally {
            if (fileStream && !fileStream.destroyed) {
                fileStream.destroy();
            }
        }
    }

    throw new Error(`Upload failed after ${MAX_RETRIES} attempts: ${lastError?.message}`);
}

export async function uploadAudioToTelegram(
    filePath: string,
    fileName: string,
    title: string,
    onProgress?: (progress: number) => void,
    options?: { abortSignal?: AbortSignal; channelId?: string }
): Promise<{ channelId: string; messageId: number; fileSize: number }> {
    const tg = await initClient();
    const channelId = options?.channelId ?? getNextChannelId();
    const channelPeer = parseChannelPeer(channelId);
    const fileSize = fs.statSync(filePath).size;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        let fileStream: fs.ReadStream | null = null;
        try {
            if (options?.abortSignal?.aborted) {
                throw new Error('Upload canceled by user');
            }

            fileStream = fs.createReadStream(filePath);
            const result = await tg.sendMedia(channelPeer, {
                type: 'audio',
                file: fileStream,
                fileName,
                fileSize,
                title: title,
                caption: title,
            }, {
                abortSignal: options?.abortSignal,
                progressCallback: (on: number, total: number) => {
                    if (onProgress) {
                        onProgress(Math.round((on / total) * 100));
                    }
                }
            });

            await saveClientSession();

            return {
                channelId,
                messageId: result.id,
                fileSize,
            };
        } catch (error: any) {
            lastError = error;
            if (options?.abortSignal?.aborted) {
                throw new Error('Upload canceled by user');
            }
            console.error(`Audio upload attempt ${attempt + 1}/${MAX_RETRIES} failed:`, error.message);

            if (attempt < MAX_RETRIES - 1) {
                await sleep(RETRY_DELAYS[attempt]);
            }
        } finally {
            if (fileStream && !fileStream.destroyed) {
                fileStream.destroy();
            }
        }
    }

    throw new Error(`Audio upload failed after ${MAX_RETRIES} attempts: ${lastError?.message}`);
}

export async function uploadVideoStreamToTelegram(
    createStream: () => Readable,
    fileName: string,
    fileSize: number,
    onProgress?: (progress: number) => void,
    options?: { abortSignal?: AbortSignal; channelId?: string }
): Promise<{ channelId: string; messageId: number; fileSize: number }> {
    const tg = await initClient();
    const channelId = options?.channelId ?? getNextChannelId();
    const channelPeer = parseChannelPeer(channelId);

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        let rawStream: Readable | null = null;
        let uploadStream: Readable | null = null;
        try {
            if (options?.abortSignal?.aborted) {
                throw new Error('Upload canceled by user');
            }

            rawStream = createStream();
            // Avoid ReadStream path stat (uses full file size). Wrap into generic Readable.
            uploadStream = rawStream instanceof fs.ReadStream ? Readable.from(rawStream) : rawStream;
            const result = await tg.sendMedia(channelPeer, {
                type: 'video',
                file: uploadStream,
                fileName,
                fileSize,
                caption: fileName,
            }, {
                abortSignal: options?.abortSignal,
                progressCallback: (on: number, total: number) => {
                    if (onProgress) {
                        onProgress(Math.round((on / total) * 100));
                    }
                }
            });

            await saveClientSession();

            return {
                channelId,
                messageId: result.id,
                fileSize,
            };
        } catch (error: any) {
            lastError = error;
            if (options?.abortSignal?.aborted) {
                throw new Error('Upload canceled by user');
            }
            console.error(`Upload attempt ${attempt + 1}/${MAX_RETRIES} failed:`, error.message);

            if (attempt < MAX_RETRIES - 1) {
                await sleep(RETRY_DELAYS[attempt]);
            }
        } finally {
            if (rawStream && 'destroy' in rawStream && !rawStream.destroyed) {
                rawStream.destroy();
            }
            if (uploadStream && uploadStream !== rawStream && 'destroy' in uploadStream && !uploadStream.destroyed) {
                uploadStream.destroy();
            }
        }
    }

    throw new Error(`Upload failed after ${MAX_RETRIES} attempts: ${lastError?.message}`);
}

export async function downloadVideoFromTelegram(
    channelId: string,
    messageId: number,
    offset?: number,
    limit?: number
): Promise<Buffer> {
    const tg = await initClient();

    const channelPeer = parseChannelPeer(channelId);
    const [message] = await tg.getMessages(channelPeer, [messageId]);
    if (!message || !message.media) {
        throw new Error('Message not found or has no media in Telegram');
    }

    const buffer = await tg.downloadAsBuffer(message.media as any);

    if (!buffer) {
        throw new Error('Failed to download media');
    }

    if (offset !== undefined && limit !== undefined) {
        return Buffer.from(buffer.subarray(offset, offset + limit));
    }

    return Buffer.from(buffer);
}

export async function downloadVideoChunkFromTelegram(
    channelId: string,
    messageId: number,
    offset: number,
    limit: number,
    options?: { abortSignal?: AbortSignal }
): Promise<Buffer> {
    if (limit <= 0) {
        return Buffer.alloc(0);
    }

    const tg = await initClient();
    const channelPeer = parseChannelPeer(channelId);
    const MAX_CHUNK = 1024 * 1024; // 1MB — Telegram's maximum per-request limit

    // --- Resolve media (cached) ---
    let media: any;
    let mediaSize: number | null;
    const cached = getCachedMedia(channelId, messageId);
    if (cached) {
        media = cached.media;
        mediaSize = cached.mediaSize;
    } else {
        const [message] = await tg.getMessages(channelPeer, [messageId]);
        if (!message || !message.media) {
            throw new Error('Message not found or has no media in Telegram');
        }
        media = message.media;
        const m: any = media;
        mediaSize =
            typeof m?.document?.size === 'number' ? m.document.size
            : typeof m?.video?.size === 'number' ? m.video.size
            : typeof m?.size === 'number' ? m.size
            : null;
        setCachedMedia(channelId, messageId, media, mediaSize);
    }

    // --- Bounds check ---
    if (mediaSize && offset >= mediaSize) {
        return Buffer.alloc(0);
    }
    if (mediaSize) {
        limit = Math.min(limit, mediaSize - offset);
        if (limit <= 0) return Buffer.alloc(0);
    }

    // --- Chunk data cache: instant rewind/rewatch ---
    const cachedChunk = getCachedChunk(channelId, messageId, offset);
    if (cachedChunk) return cachedChunk;

    // --- O(1) aligned limit: largest power-of-2 dividing offset, capped at 1MB ---
    const chunkLimit = alignedLimitForOffset(offset, MAX_CHUNK);

    // --- Primary path: downloadChunk with guaranteed alignment ---
    try {
        const chunk = await (tg as any).downloadChunk({
            location: media,
            offset,
            limit: chunkLimit,
            abortSignal: options?.abortSignal,
        });
        const buf = Buffer.from(chunk as any);
        // If we fetched more than the caller requested, trim
        const result = buf.length > limit ? buf.subarray(0, limit) : buf;
        setCachedChunk(channelId, messageId, offset, result);
        return result;
    } catch (err: any) {
        const msg = String(err?.message || err?.text || '');
        if (!(err?.code === 400 && msg.includes('LIMIT_INVALID')) && !msg.includes('LIMIT_INVALID')) {
            throw err;
        }
        // LIMIT_INVALID: fall through to stream fallback
    }

    // --- Fallback: downloadAsStream with 1MB-aligned window ---
    const safeOffset = Math.floor(offset / MAX_CHUNK) * MAX_CHUNK;
    const stripStart = offset - safeOffset;
    const safeLimit = Math.min(MAX_CHUNK, mediaSize ? mediaSize - safeOffset : MAX_CHUNK);
    if (safeLimit <= 0) {
        throw new Error('Telegram chunk download failed');
    }
    const webStream = await (tg as any).downloadAsStream(media, {
        offset: safeOffset,
        limit: MAX_CHUNK,
        abortSignal: options?.abortSignal,
    });
    const fromWeb = (Readable as any).fromWeb;
    const nodeStream: Readable = typeof fromWeb === 'function'
        ? fromWeb(webStream as any)
        : Readable.from(webStream as any);
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const buf of nodeStream as any) {
        const b = Buffer.from(buf as any);
        chunks.push(b);
        total += b.length;
        if (total >= safeLimit) break;
    }
    const merged = Buffer.concat(chunks, total);
    const result = merged.subarray(stripStart, stripStart + limit);
    setCachedChunk(channelId, messageId, offset, Buffer.from(result));
    return result;
}

export async function downloadVideoStreamFromTelegram(
    channelId: string,
    messageId: number,
    options?: { abortSignal?: AbortSignal }
): Promise<Readable> {
    const tg = await initClient();
    const channelPeer = parseChannelPeer(channelId);
    const [message] = await tg.getMessages(channelPeer, [messageId]);
    if (!message || !message.media) {
        throw new Error('Message not found or has no media in Telegram');
    }

    const webStream = await (tg as any).downloadAsStream(message.media as any, {
        abortSignal: options?.abortSignal,
    });

    if (!webStream) {
        throw new Error('Failed to create Telegram download stream');
    }

    const fromWeb = (Readable as any).fromWeb;
    if (typeof fromWeb === 'function') {
        return fromWeb(webStream as any);
    }

    return Readable.from(webStream as any);
}

export async function deleteVideoFromTelegram(
    channelId: string,
    messageId: number
): Promise<boolean> {
    try {
        const tg = await initClient();
        const channelPeer = parseChannelPeer(channelId);
        await (tg as any).deleteMessagesById(channelPeer, [messageId]);
        return true;
    } catch (error: any) {
        console.error('Failed to delete from Telegram:', error.message);
        return false;
    }
}
