'use client';

import React, { useRef, useEffect } from 'react';
import { api } from '@/lib/api';
import { shouldUseHls, isHlsEnabled } from '@/lib/media';
import videojs from 'video.js';

type VideoJsPlayer = any;
type VideoJsPlayerOptions = any;

interface VideoPlayerProps {
    videoId: string;
    mimeType?: string;
    codec?: string;
    className?: string;
}

export default function VideoPlayer({ videoId, mimeType, codec, className = '' }: VideoPlayerProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const playerRef = useRef<VideoJsPlayer | null>(null);
    const hlsUrl = api.getHlsUrl(videoId);
    const streamUrl = api.getStreamUrl(videoId);
    const forceHlsRef = useRef(false);

    const shouldPlayHls = () => {
        if (forceHlsRef.current) return true;
        return shouldUseHls(mimeType, codec);
    };

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const buildTracks = (player: VideoJsPlayer) => {
            const list = player.audioTracks();
            if (!list || list.length === 0) return;
        };

        const useHls = shouldPlayHls();
        const sourceUrl = useHls ? hlsUrl : streamUrl;
        const sourceType = useHls ? 'application/x-mpegURL' : (mimeType || 'video/mp4');

        if (!playerRef.current) {
            const options: VideoJsPlayerOptions = {
                controls: true,
                preload: 'metadata',
                autoplay: false,
                fluid: true,
                playsinline: true,
                sources: [{ src: sourceUrl, type: sourceType }],
                controlBar: {
                    audioTrackButton: true,
                },
                techOrder: ['html5'],
            };

            const videoEl = document.createElement('video');
            videoEl.className = 'video-js vjs-default-skin w-full';
            videoEl.setAttribute('playsinline', 'true');
            container.appendChild(videoEl);

            const player = videojs(videoEl, options, () => {
                const list = player.audioTracks();
                const refresh = () => buildTracks(player);
                list.addEventListener('addtrack', refresh);
                list.addEventListener('removetrack', refresh);
                list.addEventListener('change', refresh);
                player.on('loadedmetadata', refresh);
                player.on('loadeddata', refresh);
            });

            player.on('error', () => {
                const err = player.error();
                if (err?.code === 4 && !forceHlsRef.current && isHlsEnabled()) {
                    forceHlsRef.current = true;
                    player.src({ src: hlsUrl, type: 'application/x-mpegURL' });
                    player.load();
                }
            });

            playerRef.current = player;
        } else {
            playerRef.current.src({ src: sourceUrl, type: sourceType });
        }

        return () => {
            if (playerRef.current) {
                playerRef.current.dispose();
                playerRef.current = null;
            }
            if (container.firstChild) {
                container.innerHTML = '';
            }
        };
    }, [hlsUrl, streamUrl, mimeType, codec]);

    return (
        <div className={`video-player-container ${className}`}>
            <div ref={containerRef} style={{ maxHeight: '70vh' }} />
        </div>
    );
}
