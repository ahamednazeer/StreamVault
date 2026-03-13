import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { deleteVideoFromTelegram } from '@/lib/telegram';
import { deleteCachedVideo } from '@/lib/streamCache';
import { deleteHlsCache, ensureHlsPlaylist } from '@/lib/hls';
import { shouldUseHls } from '@/lib/media';
import { getUploadQueue } from '@/lib/uploadQueue';
import { getVideoParts } from '@/lib/videoParts';
import Video from '@/models/Video';
import fs from 'fs';

type RouteParams = { params: Promise<{ id: string }> };

// GET /api/videos/[id]
export async function GET(request: NextRequest, { params }: RouteParams) {
    try {
        const { id } = await params;
        await getAuthUser(request);
        await connectDB();

        const video = await Video.findById(id).populate('userId', 'username email');
        if (!video) {
            return NextResponse.json({ error: 'Video not found' }, { status: 404 });
        }

        if (
            video.status === 'ready' &&
            shouldUseHls(video.mimeType, video.codec)
        ) {
            const parts = getVideoParts(video);
            if (parts.length > 0) {
                ensureHlsPlaylist(video._id.toString(), parts)
                    .catch((err) => console.error('HLS prebuild failed:', err.message));
            }
        }

        return NextResponse.json({ video });

    } catch (error: any) {
        if (error.message === 'No token provided') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

// PATCH /api/videos/[id]
export async function PATCH(request: NextRequest, { params }: RouteParams) {
    try {
        const { id } = await params;
        const user = await getAuthUser(request);
        await connectDB();

        const video = await Video.findById(id);
        if (!video) {
            return NextResponse.json({ error: 'Video not found' }, { status: 404 });
        }

        if (video.userId.toString() !== user._id.toString()) {
            return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
        }

        const body = await request.json();
        const { title, description } = body;

        if (title) video.title = title;
        if (description !== undefined) video.description = description;

        await video.save();

        return NextResponse.json({ video });

    } catch (error: any) {
        if (error.message === 'No token provided') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

// DELETE /api/videos/[id]
export async function DELETE(request: NextRequest, { params }: RouteParams) {
    try {
        const { id } = await params;
        const user = await getAuthUser(request);
        await connectDB();

        const video = await Video.findById(id);
        if (!video) {
            return NextResponse.json({ error: 'Video not found' }, { status: 404 });
        }

        if (video.userId.toString() !== user._id.toString() && user.role !== 'admin') {
            return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
        }

        if (video.status === 'uploading') {
            return NextResponse.json({ error: 'Upload in progress. Stop upload first.' }, { status: 409 });
        }

        if (video.status === 'queued' || video.status === 'failed' || video.status === 'canceled') {
            const queue = getUploadQueue();
            const job = await queue.getJob(id);
            if (job) {
                try {
                    await job.remove();
                } catch {
                    try { await job.discard(); } catch { }
                }
            }

            if (video.tempFilePath && fs.existsSync(video.tempFilePath)) {
                try { fs.unlinkSync(video.tempFilePath); } catch { }
            }
        } else {
            const parts = getVideoParts(video);
            if (parts.length > 0) {
                for (const part of parts) {
                    await deleteVideoFromTelegram(part.telegramChannelId, part.telegramMessageId);
                }
            } else if (video.telegramChannelId && video.telegramMessageId) {
                await deleteVideoFromTelegram(video.telegramChannelId, video.telegramMessageId);
            }

            if (video.telegramChannelId && video.telegramMessageId) {
                deleteCachedVideo(video.telegramChannelId, video.telegramMessageId);
            }
            deleteHlsCache(video._id.toString());
        }

        await Video.findByIdAndDelete(id);

        return NextResponse.json({ message: 'Video deleted' });

    } catch (error: any) {
        if (error.message === 'No token provided') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
