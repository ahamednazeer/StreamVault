import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getAuthUser, requireAdmin } from '@/lib/auth';
import { deleteVideoFromTelegram } from '@/lib/telegram';
import { deleteCachedVideo } from '@/lib/streamCache';
import Video from '@/models/Video';

// GET /api/admin/videos
export async function GET(request: NextRequest) {
    try {
        const user = await getAuthUser(request);
        requireAdmin(user);
        await connectDB();

        const url = new URL(request.url);
        const page = parseInt(url.searchParams.get('page') || '1');
        const limit = parseInt(url.searchParams.get('limit') || '50');
        const skip = (page - 1) * limit;

        const [videos, total] = await Promise.all([
            Video.find()
                .populate('userId', 'username email')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Video.countDocuments(),
        ]);

        return NextResponse.json({
            videos,
            pagination: { page, limit, total, pages: Math.ceil(total / limit) },
        });

    } catch (error: any) {
        if (error.message === 'Admin access required') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
        if (error.message === 'No token provided') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

// DELETE /api/admin/videos?id=xxx
export async function DELETE(request: NextRequest) {
    try {
        const user = await getAuthUser(request);
        requireAdmin(user);
        await connectDB();

        const url = new URL(request.url);
        const videoId = url.searchParams.get('id');

        if (!videoId) {
            return NextResponse.json({ error: 'Video ID required' }, { status: 400 });
        }

        const video = await Video.findById(videoId);
        if (!video) {
            return NextResponse.json({ error: 'Video not found' }, { status: 404 });
        }

        // Delete from Telegram
        if (video.telegramChannelId && video.telegramMessageId) {
            await deleteVideoFromTelegram(video.telegramChannelId, video.telegramMessageId);
            deleteCachedVideo(video.telegramChannelId, video.telegramMessageId);
        }

        await Video.findByIdAndDelete(videoId);

        return NextResponse.json({ message: 'Video deleted' });

    } catch (error: any) {
        if (error.message === 'Admin access required') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
        if (error.message === 'No token provided') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
