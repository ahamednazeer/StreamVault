import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import Video from '@/models/Video';
import { ensureHlsPlaylist, getHlsSegmentPath } from '@/lib/hls';
import { getVideoParts } from '@/lib/videoParts';
import fs from 'fs';

type RouteParams = { params: Promise<{ id: string; segment: string }> };

function isSafeSegment(name: string): boolean {
    return /^[a-zA-Z0-9._-]+$/.test(name);
}

// GET /api/stream/[id]/[segment] — fallback for HLS playlists/segments
export async function GET(request: NextRequest, { params }: RouteParams) {
    try {
        const { id, segment } = await params;
        if (!isSafeSegment(segment)) {
            return NextResponse.json({ error: 'Invalid segment' }, { status: 400 });
        }

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

        const parts = getVideoParts(video);
        if (parts.length === 0) {
            return NextResponse.json({ error: 'Video parts not found' }, { status: 404 });
        }

        await ensureHlsPlaylist(video._id.toString(), parts);

        const segmentPath = getHlsSegmentPath(video._id.toString(), segment);
        if (!fs.existsSync(segmentPath)) {
            return NextResponse.json({ error: 'Segment not found' }, { status: 404 });
        }

        if (segment.endsWith('.m3u8')) {
            const playlist = await fs.promises.readFile(segmentPath, 'utf-8');
            const baseUrl = new URL(request.url);
            baseUrl.pathname = `/api/stream/${id}/`;
            const base = baseUrl.toString();

            const rewritten = playlist
                .split('\n')
                .map((line) => {
                    const trimmed = line.trim();
                    if (!trimmed) return line;
                    if (trimmed.startsWith('#EXT-X-MEDIA')) {
                        return line.replace(/URI=\"([^\"]+)\"/g, (match, uri) => {
                            if (uri.startsWith('http://') || uri.startsWith('https://')) return match;
                            return `URI=\"${base}${uri}\"`;
                        });
                    }
                    if (trimmed.startsWith('#')) return line;
                    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return line;
                    return `${base}${trimmed}`;
                })
                .join('\n');

            return new NextResponse(rewritten, {
                status: 200,
                headers: {
                    'Content-Type': 'application/vnd.apple.mpegurl',
                    'Cache-Control': 'no-store',
                },
            });
        }

        const data = await fs.promises.readFile(segmentPath);
        return new NextResponse(data, {
            status: 200,
            headers: {
                'Content-Type': 'video/mp2t',
                'Cache-Control': 'no-store',
            },
        });
    } catch (error: any) {
        console.error('HLS fallback error:', error);
        return NextResponse.json({ error: 'Streaming failed' }, { status: 500 });
    }
}
