import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { downloadVideoChunkFromTelegram, downloadVideoStreamFromTelegram } from '@/lib/telegram';
import Video from '@/models/Video';
import { Readable } from 'stream';
import { getVideoParts, getTotalSize } from '@/lib/videoParts';

type RouteParams = { params: Promise<{ id: string }> };

// GET /api/stream/[id] — stream video with range request support + disk cache
export async function GET(request: NextRequest, { params }: RouteParams) {
    try {
        const { id } = await params;
        await connectDB();

        const video = await Video.findById(id);
        if (!video) {
            return NextResponse.json({ error: 'Video not found' }, { status: 404 });
        }

        if (video.status !== 'ready') {
            return NextResponse.json(
                { error: 'Video is not ready for playback' },
                { status: 425 }
            );
        }

        const { mimeType } = video;
        const parts = getVideoParts(video);
        const totalSize = getTotalSize(video, parts);
        const rangeHeader = request.headers.get('range');

        if (rangeHeader && totalSize && parts.length > 0) {
            const rangeParts = rangeHeader.replace(/bytes=/, '').split('-');
            const start = parseInt(rangeParts[0], 10);
            let end = rangeParts[1] ? parseInt(rangeParts[1], 10) : totalSize - 1;
            if (Number.isNaN(start)) {
                return NextResponse.json({ error: 'Invalid range' }, { status: 416 });
            }

            const maxChunk = 1024 * 1024; // 1MB
            const part = parts.find((p: any) => start >= p.startByte && start <= p.endByte);
            if (!part) {
                return new NextResponse(null, {
                    status: 416,
                    headers: {
                        'Content-Range': `bytes */${totalSize}`,
                    },
                });
            }
            const cappedEnd = Math.min(end, part.endByte, start + maxChunk - 1);

            if (start >= totalSize || cappedEnd >= totalSize) {
                return new NextResponse(null, {
                    status: 416,
                    headers: {
                        'Content-Range': `bytes */${totalSize}`,
                    },
                });
            }

            const chunk = await downloadVideoChunkFromTelegram(
                part.telegramChannelId,
                part.telegramMessageId,
                start - part.startByte,
                cappedEnd - start + 1
            );

            return new NextResponse(chunk as any, {
                status: 206,
                headers: {
                    'Content-Range': `bytes ${start}-${cappedEnd}/${totalSize}`,
                    'Accept-Ranges': 'bytes',
                    'Content-Length': String(chunk.length),
                    'Content-Type': mimeType || 'video/mp4',
                    'Cache-Control': 'no-store',
                },
            });
        }

        if (parts.length === 0) {
            return NextResponse.json({ error: 'Video parts not found' }, { status: 404 });
        }

        const nodeStream = Readable.from(async function* () {
            for (const part of parts) {
                const stream = await downloadVideoStreamFromTelegram(
                    part.telegramChannelId,
                    part.telegramMessageId
                );
                for await (const chunk of stream as any) {
                    yield chunk;
                }
            }
        }());

        const toWeb = (Readable as any).toWeb;
        const webStream = typeof toWeb === 'function' ? toWeb(nodeStream as any) : (nodeStream as any);

        return new NextResponse(webStream as any, {
            status: 200,
            headers: {
                'Content-Type': mimeType || 'video/mp4',
                ...(totalSize ? { 'Content-Length': String(totalSize) } : {}),
                'Cache-Control': 'no-store',
            },
        });

    } catch (error: any) {
        console.error('Stream error:', error);
        return NextResponse.json({ error: 'Streaming failed' }, { status: 500 });
    }
}
