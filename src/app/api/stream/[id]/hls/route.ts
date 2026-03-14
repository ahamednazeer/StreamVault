import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import Video from '@/models/Video';
import { ensureHlsPlaylist, touchHlsAccess } from '@/lib/hls';
import { getVideoParts } from '@/lib/videoParts';
import { isHlsEnabled } from '@/lib/media';
import fs from 'fs';

type RouteParams = { params: Promise<{ id: string }> };

// GET /api/stream/[id]/hls — HLS playlist
export async function GET(request: NextRequest, { params }: RouteParams) {
    try {
        const { id } = await params;
        if (!isHlsEnabled()) {
            return NextResponse.json({ error: 'HLS disabled' }, { status: 404 });
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

        const playlistPath = await ensureHlsPlaylist(
            video._id.toString(),
            parts
        );
        touchHlsAccess(video._id.toString());

        const playlist = await fs.promises.readFile(playlistPath, 'utf-8');
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
    } catch (error: any) {
        const message = String(error?.message || '');
        if (message.includes('Telegram not authorized') || message.includes('AUTH_KEY_UNREGISTERED')) {
            return NextResponse.json({ error: 'Telegram not authorized' }, { status: 401 });
        }
        console.error('HLS playlist error:', error);
        return NextResponse.json({ error: 'Streaming failed' }, { status: 500 });
    }
}
