import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import Video from '@/models/Video';

type RouteParams = { params: Promise<{ id: string }> };

// GET /api/videos/[id]/progress
export async function GET(request: NextRequest, { params }: RouteParams) {
    try {
        const { id } = await params;
        
        if (!id || id === 'undefined' || !/^[0-9a-fA-F]{24}$/.test(id)) {
            return NextResponse.json({ error: 'Invalid video ID' }, { status: 400 });
        }

        await getAuthUser(request);
        await connectDB();

        const video = await Video.findById(id).select(
            'status uploadProgress uploadAttempts lastError uploadStartedAt uploadCompletedAt'
        );

        if (!video) {
            return NextResponse.json({ error: 'Video not found' }, { status: 404 });
        }

        return NextResponse.json({
            status: video.status,
            uploadProgress: video.uploadProgress,
            uploadAttempts: video.uploadAttempts,
            lastError: video.lastError,
            uploadStartedAt: video.uploadStartedAt,
            uploadCompletedAt: video.uploadCompletedAt,
        });

    } catch (error: any) {
        if (error.message === 'No token provided') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
