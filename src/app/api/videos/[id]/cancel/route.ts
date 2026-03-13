import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { getUploadQueue } from '@/lib/uploadQueue';
import Video from '@/models/Video';
import fs from 'fs';

type RouteParams = { params: Promise<{ id: string }> };

// POST /api/videos/[id]/cancel
export async function POST(request: NextRequest, { params }: RouteParams) {
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

        if (video.status === 'ready' || video.status === 'processing') {
            return NextResponse.json({ error: 'Cannot cancel after upload started processing' }, { status: 409 });
        }

        if (video.status === 'canceled') {
            return NextResponse.json({ message: 'Already canceled' });
        }

        if (video.status === 'queued') {
            const queue = getUploadQueue();
            const job = await queue.getJob(id);
            if (job) {
                try {
                    await job.remove();
                } catch {
                    try { await job.discard(); } catch { }
                }
            }
        }

        await Video.findByIdAndUpdate(id, {
            status: 'canceled',
            lastError: 'Canceled by user',
            uploadCompletedAt: new Date(),
            canceledAt: new Date(),
            uploadProgress: 0,
            tempFilePath: '',
        });

        if (video.tempFilePath && fs.existsSync(video.tempFilePath)) {
            try { fs.unlinkSync(video.tempFilePath); } catch { }
        }

        return NextResponse.json({ message: 'Upload canceled' });

    } catch (error: any) {
        if (error.message === 'No token provided') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
