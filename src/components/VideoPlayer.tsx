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
    audioTracks?: {
        index: number;
        language: string;
        title: string;
        codec: string;
    }[];
}

export default function VideoPlayer({ videoId, mimeType, codec, audioTracks = [], className = '' }: VideoPlayerProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);
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
                
                // Add the default main mixed track
                const defaultTrack = new (videojs as any).AudioTrack({
                    id: 'default',
                    kind: 'main',
                    label: 'Default Audio',
                    language: 'en',
                    enabled: true
                });
                list.addTrack(defaultTrack);

                // Add the separated tracks
                if (audioTracks && audioTracks.length > 0) {
                    audioTracks.forEach((track, i) => {
                        const trackName = track.title || track.language || `Track ${i + 1}`;
                        list.addTrack(new (videojs as any).AudioTrack({
                            id: String(track.index),
                            kind: 'translation',
                            label: trackName,
                            language: trackName, // Force text rendering
                            enabled: false
                        }));
                    });
                }

                const refresh = () => buildTracks(player);
                list.addEventListener('addtrack', refresh);
                list.addEventListener('removetrack', refresh);
                
                if (!useHls) {
                    let activeTrackId: string | null = null;
                    
                    // Hijack the underlying video element's audio output without telling VideoJS
                    // This lets VideoJS's UI sliders and state stay perfectly normal
                    // while we manually mute the background video element.
                    let fakeVolume = 1;
                    let fakeMuted = false;
                    
                    // Intercept the tech's actual volume/mute setters to prevent VideoJS
                    // from applying them to the video when a secondary track is active
                    const tech = player.tech(true) as any;
                    if (tech) {
                        const originalSetVolume = tech.setVolume && tech.setVolume.bind(tech);
                        const originalSetMuted = tech.setMuted && tech.setMuted.bind(tech);
                        const originalVolume = tech.volume && tech.volume.bind(tech);
                        const originalMuted = tech.muted && tech.muted.bind(tech);

                        if (originalSetVolume) tech.setVolume = (percentAsDecimal: number) => {
                            fakeVolume = percentAsDecimal;
                            if (activeTrackId) {
                                // Apply to our shadow audio tag, NOT the video
                                if (audioRef.current) audioRef.current.volume = percentAsDecimal;
                                player.trigger('volumechange'); 
                            } else {
                                originalSetVolume(percentAsDecimal);
                            }
                        };

                        if (originalSetMuted) tech.setMuted = (muted: boolean) => {
                            fakeMuted = muted;
                            if (activeTrackId) {
                                // Apply to shadow audio tag, force video to stay muted
                                if (audioRef.current) audioRef.current.muted = muted;
                                originalSetMuted(true); 
                                player.trigger('volumechange');
                            } else {
                                originalSetMuted(muted);
                            }
                        };

                        if (originalVolume) tech.volume = () => {
                            return activeTrackId ? fakeVolume : originalVolume();
                        };

                        if (originalMuted) tech.muted = () => {
                            return activeTrackId ? fakeMuted : originalMuted();
                        };
                    }
                    
                    // Handle fallback audio sync for standard MP4 playback
                    list.addEventListener('change', () => {
                        let newActiveId: string | null = null;
                        for (let i = 0; i < list.length; i++) {
                            const track = (list as any)[i];
                            if (track.enabled && track.id !== 'default') {
                                newActiveId = track.id;
                                break;
                            }
                        }
                        activeTrackId = newActiveId;

                        if (activeTrackId) {
                           // Force underlying video to mute, but don't tell the tech state
                            if (tech) {
                                (tech as any).setMuted(true, true); // internal bypass if exists, or just:
                                videoEl.muted = true;
                            }

                            // MP4 Alternative Track Playback
                            if (audioRef.current) {
                                const audioUrl = `/api/stream/${videoId}/audio/${activeTrackId}`;
                                if (audioRef.current.src !== audioUrl) {
                                    audioRef.current.src = audioUrl;
                                    const cTime = player.currentTime();
                                    if (typeof cTime === 'number') {
                                        audioRef.current.currentTime = cTime;
                                    }
                                    audioRef.current.volume = fakeVolume;
                                    audioRef.current.muted = fakeMuted;
                                    
                                    if (!player.paused()) {
                                        audioRef.current.play().catch(() => {});
                                    }
                                }
                            }
                        } else {
                            // Switched back to default audio
                            if (tech) {
                                videoEl.muted = fakeMuted;
                                videoEl.volume = fakeVolume;
                            }
                            
                            // Stop secondary audio
                            if (audioRef.current) {
                                audioRef.current.pause();
                                audioRef.current.removeAttribute('src');
                                audioRef.current.load();
                            }
                        }
                    });
                    
                    // Keep secondary audio synced to main video player
                    player.on('play', () => {
                        if (audioRef.current && audioRef.current.src && activeTrackId) {
                            audioRef.current.play().catch(() => {});
                        }
                    });
                    player.on('pause', () => {
                        if (audioRef.current) audioRef.current.pause();
                    });
                    player.on('waiting', () => {
                        if (audioRef.current) audioRef.current.pause();
                    });
                    player.on('playing', () => {
                        if (audioRef.current && audioRef.current.src && activeTrackId) {
                            audioRef.current.play().catch(() => {});
                        }
                    });
                    player.on('seeked', () => {
                        if (audioRef.current && audioRef.current.src) {
                            const cTime = player.currentTime();
                            if (typeof cTime === 'number') {
                                audioRef.current.currentTime = cTime;
                            }
                        }
                    });
                    player.on('ratechange', () => {
                        if (audioRef.current) {
                            const rate = player.playbackRate();
                            if (typeof rate === 'number') {
                                audioRef.current.playbackRate = rate;
                            }
                        }
                    });
                }

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
        <div className={`video-player-container relative ${className}`}>
            <div ref={containerRef} style={{ maxHeight: '70vh' }} />
            <audio ref={audioRef} className="hidden" preload="auto" />
        </div>
    );
}
