import { Queue, Worker, Job } from 'bullmq';
import { setMaxListeners } from 'events';
import { getRedis } from './redis';
import { uploadVideoToTelegram, uploadVideoStreamToTelegram, getChannelIds, getChannelIndexForId, advanceChannelIndex, deleteVideoFromTelegram } from './telegram';
import { extractVideoMetadata } from './ffmpeg';
import { ensureHlsPlaylist } from './hls';
import { shouldUseHls } from './media';
import { getTelegramMaxUploadSizeBytes } from './limits';
import { VideoPart } from './videoParts';
import { connectDB } from './db';
import Video from '@/models/Video';
import fs from 'fs';

const QUEUE_NAME = 'video-upload';

let uploadQueue: Queue | null = null;
let uploadWorker: Worker | null = null;

export function getUploadQueue(): Queue {
    if (uploadQueue) return uploadQueue;

    uploadQueue = new Queue(QUEUE_NAME, {
        connection: getRedis() as any,
        defaultJobOptions: {
            attempts: 3,
            backoff: {
                type: 'exponential',
                delay: 2000,
            },
            removeOnComplete: { count: 100 },
            removeOnFail: { count: 50 },
        },
    });

    return uploadQueue;
}

export interface UploadJobData {
    videoId: string;
    filePath: string;
    fileName: string;
}

export async function enqueueUpload(data: UploadJobData): Promise<string> {
    const queue = getUploadQueue();
    const job = await queue.add('upload', data, {
        jobId: data.videoId,
    });
    return job.id || data.videoId;
}

function isCancelError(error: any): boolean {
    return error?.message === 'Upload canceled by user';
}

export function startUploadWorker(): Worker {
    if (uploadWorker) return uploadWorker;

    uploadWorker = new Worker(
        QUEUE_NAME,
        async (job: Job<UploadJobData>) => {
            const { videoId, filePath, fileName } = job.data;

            await connectDB();

            const current = await Video.findById(videoId).select('status tempFilePath');
            if (!current || current.status === 'canceled') {
                if (current?.tempFilePath && fs.existsSync(current.tempFilePath)) {
                    try { fs.unlinkSync(current.tempFilePath); } catch { }
                }
                return;
            }

            // Update status to uploading
            const updated = await Video.findOneAndUpdate({
                _id: videoId,
                status: { $ne: 'canceled' },
            }, {
                status: 'uploading',
                uploadStartedAt: new Date(),
                uploadAttempts: (job.attemptsMade || 0) + 1,
            });

            if (!updated) {
                if (current.tempFilePath && fs.existsSync(current.tempFilePath)) {
                    try { fs.unlinkSync(current.tempFilePath); } catch { }
                }
                return;
            }

            const abortController = new AbortController();
            setMaxListeners(0, abortController.signal);
            let cancelTimer: NodeJS.Timeout | null = null;

            const startCancelWatcher = () => {
                cancelTimer = setInterval(async () => {
                    try {
                        const latest = await Video.findById(videoId).select('status').lean();
                        if (!latest || latest.status === 'canceled') {
                            abortController.abort();
                        }
                    } catch { }
                }, 1000);
            };

            const stopCancelWatcher = () => {
                if (cancelTimer) clearInterval(cancelTimer);
                cancelTimer = null;
            };

            startCancelWatcher();

            let uploadedParts: VideoPart[] = [];

            try {
                const fileStats = fs.statSync(filePath);
                const totalSize = fileStats.size;
                const maxPartSize = getTelegramMaxUploadSizeBytes();
                const safePartSize = Math.max(maxPartSize - 4 * 1024 * 1024, 64 * 1024);

                let result: { channelId: string; messageId: number; fileSize: number } | null = null;
                const parts: VideoPart[] = [];

                if (totalSize <= safePartSize) {
                    // Single part upload
                    try {
                        result = await uploadVideoToTelegram(
                            filePath,
                            fileName,
                            async (progress: number) => {
                                await Video.findByIdAndUpdate(videoId, {
                                    uploadProgress: progress,
                                });
                            },
                            { abortSignal: abortController.signal }
                        );

                        parts.push({
                            index: 0,
                            telegramChannelId: result.channelId,
                            telegramMessageId: result.messageId,
                            size: totalSize,
                            startByte: 0,
                            endByte: totalSize - 1,
                        });
                        uploadedParts = [...parts];
                    } catch (err: any) {
                        const msg = String(err?.message || '');
                        if (!msg.includes('max 4000 parts') && !msg.includes('File is too large')) {
                            throw err;
                        }
                        // Fall back to multipart if Telegram rejects near-limit single upload.
                    }
                }

                if (!result) {
                    // Multipart upload
                    const totalParts = Math.ceil(totalSize / safePartSize);
                    let uploadedBytes = 0;
                    const channelIds = getChannelIds();
                    if (channelIds.length === 0) {
                        throw new Error('No Telegram channels configured');
                    }

                    for (let i = 0; i < totalParts; i++) {
                        if (abortController.signal.aborted) {
                            throw new Error('Upload canceled by user');
                        }

                        const startByte = i * safePartSize;
                        const endByte = Math.min(startByte + safePartSize - 1, totalSize - 1);
                        const partSize = endByte - startByte + 1;
                        const partName = `${fileName}.part${String(i + 1).padStart(2, '0')}`;

                        const channelId = channelIds[i % channelIds.length];
                        const partResult = await uploadVideoStreamToTelegram(
                            () => fs.createReadStream(filePath, { start: startByte, end: endByte }),
                            partName,
                            partSize,
                            async (progress: number) => {
                                const partUploaded = Math.round((progress / 100) * partSize);
                                const overall = Math.round(((uploadedBytes + partUploaded) / totalSize) * 100);
                                await Video.findByIdAndUpdate(videoId, {
                                    uploadProgress: Math.min(overall, 99),
                                });
                            },
                            { abortSignal: abortController.signal, channelId }
                        );

                        if (!result) {
                            result = partResult;
                        }

                        parts.push({
                            index: i,
                            telegramChannelId: partResult.channelId,
                            telegramMessageId: partResult.messageId,
                            size: partSize,
                            startByte,
                            endByte,
                        });
                        uploadedParts = [...parts];

                        uploadedBytes += partSize;
                    }

                    // Advance global channel index as if we consumed these channels in order.
                    advanceChannelIndex(totalParts);
                }

                if (abortController.signal.aborted) {
                    throw new Error('Upload canceled by user');
                }

                // Update with Telegram references
                await Video.findByIdAndUpdate(videoId, {
                    status: 'processing',
                    telegramChannelId: result?.channelId || '',
                    telegramMessageId: result?.messageId || 0,
                    fileSize: totalSize,
                    storageChannelIndex: parts.length > 0 ? getChannelIndexForId(parts[0].telegramChannelId) : -1,
                    uploadProgress: 100,
                    parts,
                });

                // Extract video metadata with FFmpeg
                try {
                    const metadata = await extractVideoMetadata(filePath);
                    await Video.findByIdAndUpdate(videoId, {
                        duration: metadata.duration,
                        resolution: metadata.resolution,
                        codec: metadata.codec,
                        status: 'ready',
                        uploadCompletedAt: new Date(),
                    });
                } catch (ffmpegError: any) {
                    console.error('FFmpeg metadata extraction failed:', ffmpegError.message);
                    // Still mark as ready even if metadata extraction fails
                    await Video.findByIdAndUpdate(videoId, {
                        status: 'ready',
                        uploadCompletedAt: new Date(),
                    });
                }

                // Delete temp file
                try {
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                    }
                } catch { }

                await Video.findByIdAndUpdate(videoId, { tempFilePath: '' });

                // Prebuild HLS playlist in the background for faster first play (only if needed).
                const latest = await Video.findById(videoId).select('mimeType codec parts').lean();
                if (latest && shouldUseHls(latest.mimeType, latest.codec)) {
                        const parts = Array.isArray(latest.parts) && latest.parts.length > 0
                        ? (latest.parts as VideoPart[])
                        : uploadedParts;
                    if (parts.length > 0) {
                        ensureHlsPlaylist(videoId, parts)
                            .catch((err) => console.error('HLS prebuild failed:', err.message));
                    }
                }

            } catch (error: any) {
                if (isCancelError(error)) {
                    if (uploadedParts.length > 0) {
                        for (const part of uploadedParts) {
                            try {
                                await deleteVideoFromTelegram(part.telegramChannelId, part.telegramMessageId);
                            } catch { }
                        }
                    }
                    await Video.findByIdAndUpdate(videoId, {
                        status: 'canceled',
                        lastError: 'Canceled by user',
                        uploadCompletedAt: new Date(),
                        tempFilePath: '',
                    });

                    try {
                        if (fs.existsSync(filePath)) {
                            fs.unlinkSync(filePath);
                        }
                    } catch { }

                    return;
                }

                // Update failure
                if (uploadedParts.length > 0) {
                    for (const part of uploadedParts) {
                        try {
                            await deleteVideoFromTelegram(part.telegramChannelId, part.telegramMessageId);
                        } catch { }
                    }
                }
                await Video.findByIdAndUpdate(videoId, {
                    status: 'failed',
                    lastError: error.message,
                    uploadAttempts: (job.attemptsMade || 0) + 1,
                });

                throw error; // Re-throw for BullMQ retry
            } finally {
                stopCancelWatcher();
            }
        },
        {
            connection: getRedis() as any,
            concurrency: 2,
        }
    );

    uploadWorker.on('failed', async (job, err) => {
        console.error(`Upload job ${job?.id} failed:`, err.message);

        if (isCancelError(err)) {
            return;
        }

        if (job && job.attemptsMade >= (job.opts?.attempts || 3)) {
            try {
                await connectDB();
                await Video.findByIdAndUpdate(job.data.videoId, {
                    status: 'failed',
                    lastError: `Final failure: ${err.message}`,
                    tempFilePath: '',
                });

                // Clean up temp file
                if (fs.existsSync(job.data.filePath)) {
                    fs.unlinkSync(job.data.filePath);
                }
            } catch { }
        }
    });

    uploadWorker.on('completed', (job) => {
        console.log(`Upload job ${job.id} completed successfully`);
    });

    return uploadWorker;
}
