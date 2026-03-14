import { TelegramClient } from '@mtcute/node';
import { MemoryStorage } from '@mtcute/core';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';

const API_ID = parseInt(process.env.TELEGRAM_API_ID || '0');
const API_HASH = process.env.TELEGRAM_API_HASH || '';
const CHANNEL_IDS = (process.env.TELEGRAM_CHANNEL_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

const SESSION_FILE = process.env.TELEGRAM_SESSION_FILE
    ? path.resolve(process.env.TELEGRAM_SESSION_FILE)
    : path.join(process.cwd(), 'telegram.session');
const MAX_RETRIES = 3;
const RETRY_DELAYS = [2000, 5000, 10000]; // exponential backoff

let client: TelegramClient | null = null;
let channelRoundRobin = 0;

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

function loadSession(): string {
    try {
        if (fs.existsSync(SESSION_FILE)) {
            return fs.readFileSync(SESSION_FILE, 'utf-8').trim();
        }
    } catch { }
    return '';
}

async function saveSession(session: string) {
    try {
        fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
    } catch { }
    fs.writeFileSync(SESSION_FILE, session, 'utf-8');
}

function clearSessionFile() {
    try {
        if (fs.existsSync(SESSION_FILE)) {
            fs.unlinkSync(SESSION_FILE);
        }
    } catch { }
}

export async function initClient(): Promise<TelegramClient> {
    if (client) return client;

    const sessionStr = loadSession();
    
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
            clearSessionFile();
        }
    }

    return client;
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
        clearSessionFile();
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
    const tg = await initClient();
    const channelPeer = parseChannelPeer(channelId);
    const [message] = await tg.getMessages(channelPeer, [messageId]);
    if (!message || !message.media) {
        throw new Error('Message not found or has no media in Telegram');
    }

    const chunk = await (tg as any).downloadChunk({
        location: message.media as any,
        offset,
        limit,
        abortSignal: options?.abortSignal,
    });

    return Buffer.from(chunk as any);
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
