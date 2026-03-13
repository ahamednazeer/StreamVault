import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import Video from '@/models/Video';
import { ensureHlsPlaylist, getHlsSegmentPath, touchHlsAccess } from '@/lib/hls';
import { getVideoParts } from '@/lib/videoParts';
import fs from 'fs';

type RouteParams = { params: Promise<{ id: string; segment: string }> };

function isSafeSegment(name: string): boolean {
    return /^[a-zA-Z0-9._-]+$/.test(name);
}

async function waitForFile(filePath: string, timeoutMs: number): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (fs.existsSync(filePath)) return true;
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    return false;
}

// GET /api/stream/[id]/hls/[segment] — HLS segment
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
        touchHlsAccess(video._id.toString());

        const segmentPath = getHlsSegmentPath(video._id.toString(), segment);
        const isPlaylist = segment.endsWith('.m3u8');
        if (!fs.existsSync(segmentPath)) {
            const ready = await waitForFile(segmentPath, isPlaylist ? 60000 : 20000);
            if (!ready) {
                return NextResponse.json({ error: 'Segment not ready' }, { status: 425 });
            }
        }

        if (isPlaylist) {
            const playlist = await fs.promises.readFile(segmentPath, 'utf-8');
            const baseUrl = new URL(request.url);
            baseUrl.pathname = `/api/stream/${id}/hls/`;
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
                'Cache-Control': 'public, max-age=3600',
            },
        });
    } catch (error: any) {
        console.error('HLS segment error:', error);
        return NextResponse.json({ error: 'Streaming failed' }, { status: 500 });
    }
}
