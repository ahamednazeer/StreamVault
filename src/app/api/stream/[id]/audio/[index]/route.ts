import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { downloadVideoChunkFromTelegram } from '@/lib/telegram';
import Video from '@/models/Video';

type RouteParams = { params: Promise<{ id: string, index: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
    try {
        const { id, index } = await params;
        const trackIndex = parseInt(index, 10);
        
        await connectDB();
        const video = await Video.findById(id).lean();

        if (!video || !video.audioTracks) {
            return NextResponse.json({ error: 'Audio track not found' }, { status: 404 });
        }

        const track = video.audioTracks.find(t => t.index === trackIndex);
        if (!track || !track.telegramChannelId || !track.telegramMessageId || !track.size) {
            return NextResponse.json({ error: 'Audio track data missing' }, { status: 404 });
        }

        const totalSize = track.size;
        const rangeHeader = request.headers.get('range');

        if (rangeHeader && totalSize > 0) {
            const rangeParts = rangeHeader.replace(/bytes=/, '').split('-');
            const start = parseInt(rangeParts[0], 10);
            const end = rangeParts[1] ? parseInt(rangeParts[1], 10) : totalSize - 1;

            if (Number.isNaN(start)) {
                return NextResponse.json({ error: 'Invalid range' }, { status: 416 });
            }

            const desiredEnd = Math.min(end, totalSize - 1);
            if (start >= totalSize || desiredEnd < start) {
                return new NextResponse(null, {
                    status: 416,
                    headers: { 'Content-Range': `bytes */${totalSize}` },
                });
            }

            const requestedLength = desiredEnd - start + 1;
            const maxChunk = 1024 * 1024; // 1MB chunk grid alignment
            
            const alignedLimit = maxChunk;
            const alignedOffset = Math.floor(start / alignedLimit) * alignedLimit;
            
            const stripStart = start - alignedOffset;
            const maxDesired = Math.max(0, alignedLimit - stripStart);
            const desiredLength = Math.min(requestedLength, maxDesired);

            if (desiredLength <= 0) {
                 return new NextResponse(null, {
                    status: 416,
                    headers: { 'Content-Range': `bytes */${totalSize}` },
                });
            }

            const rawChunk = await downloadVideoChunkFromTelegram(
                track.telegramChannelId,
                track.telegramMessageId,
                alignedOffset,
                alignedLimit
            );
            
            const chunk = rawChunk.slice(stripStart, stripStart + desiredLength);
            const cappedEnd = start + desiredLength - 1;

            return new NextResponse(chunk as any, {
                status: 206,
                headers: {
                    'Content-Range': `bytes ${start}-${cappedEnd}/${totalSize}`,
                    'Accept-Ranges': 'bytes',
                    'Content-Length': String(chunk.length),
                    'Content-Type': 'audio/mp4',
                    'Cache-Control': 'no-store',
                },
            });
        }

        // Complete file fallback
        const MAX_BYTES = 5 * 1024 * 1024; // If not ranged, just grab first 5MB or less
        const fetchSize = Math.min(totalSize, MAX_BYTES);
        
        const rawChunk = await downloadVideoChunkFromTelegram(
            track.telegramChannelId,
            track.telegramMessageId,
            0,
            fetchSize
        );

        return new NextResponse(rawChunk as any, {
            status: 200,
            headers: {
                'Content-Type': 'audio/mp4',
                'Content-Length': String(rawChunk.length),
                'Cache-Control': 'no-store',
            },
        });

    } catch (error: any) {
        console.error('Audio stream error:', error);
        return NextResponse.json({ error: 'Streaming failed' }, { status: 500 });
    }
}
