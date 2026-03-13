'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { Clock, HardDrive, Play } from '@phosphor-icons/react';
import { StatusBadge } from './StatusBadge';

interface VideoCardProps {
    video: {
        _id: string;
        title: string;
        description?: string;
        status: string;
        fileSize: number;
        duration: number;
        resolution?: string;
        uploadProgress?: number;
        createdAt: string;
        thumbnailPath?: string;
    };
    onDelete?: (id: string) => void;
    onCancel?: (id: string) => void;
}

function formatDuration(seconds: number): string {
    if (!seconds) return '0:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatSize(bytes: number): string {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let size = bytes;
    while (size >= 1024 && i < units.length - 1) {
        size /= 1024;
        i++;
    }
    return `${size.toFixed(1)} ${units[i]}`;
}

export default function VideoCard({ video, onDelete, onCancel }: VideoCardProps) {
    const router = useRouter();
    const isReady = video.status === 'ready';
    const isUploading = video.status === 'uploading' || video.status === 'queued';
    const canCancel = video.status === 'uploading' && !!onCancel;
    const canDelete = ['queued', 'failed', 'ready', 'processing', 'canceled'].includes(video.status) && !!onDelete;
    const deleteLabel = video.status === 'queued'
        ? 'Remove queued'
        : video.status === 'failed'
            ? 'Remove failed'
            : video.status === 'canceled'
                ? 'Remove'
                : 'Delete';

    const handleClick = () => {
        if (isReady) {
            router.push(`/watch/${video._id}`);
        }
    };

    return (
        <div
            className={`video-card ${isReady ? 'cursor-pointer' : ''}`}
            onClick={handleClick}
        >
            {/* Thumbnail area */}
            <div className="relative aspect-video bg-gradient-to-br from-slate-800 to-slate-900 flex items-center justify-center group">
                {isReady && (
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40">
                        <div className="w-14 h-14 rounded-full bg-violet-600/90 flex items-center justify-center shadow-lg">
                            <Play size={24} weight="fill" className="text-white ml-1" />
                        </div>
                    </div>
                )}

                {isUploading && (
                    <div className="text-center space-y-2">
                        <div className="w-10 h-10 rounded-full border-2 border-slate-700 border-t-violet-500 animate-spin mx-auto" />
                        <p className="text-xs font-mono text-slate-500">
                            {video.uploadProgress || 0}%
                        </p>
                    </div>
                )}

                {video.status === 'failed' && (
                    <p className="text-xs font-mono text-red-400 uppercase">Upload Failed</p>
                )}

                {video.status === 'canceled' && (
                    <p className="text-xs font-mono text-orange-300 uppercase">Canceled</p>
                )}

                {video.status === 'processing' && (
                    <p className="text-xs font-mono text-violet-400 uppercase animate-pulse">Processing...</p>
                )}

                {/* Duration badge */}
                {isReady && video.duration > 0 && (
                    <div className="absolute bottom-2 right-2 bg-black/80 text-white text-xs font-mono px-1.5 py-0.5 rounded">
                        {formatDuration(video.duration)}
                    </div>
                )}

                {/* Resolution badge */}
                {isReady && video.resolution && (
                    <div className="absolute top-2 right-2 bg-violet-600/80 text-white text-[10px] font-mono px-1.5 py-0.5 rounded">
                        {video.resolution}
                    </div>
                )}
            </div>

            {/* Info */}
            <div className="p-3 space-y-2">
                <h3 className="text-sm font-medium text-slate-200 truncate">{video.title}</h3>

                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 text-xs text-slate-500">
                        {video.fileSize > 0 && (
                            <span className="flex items-center gap-1">
                                <HardDrive size={12} />
                                {formatSize(video.fileSize)}
                            </span>
                        )}
                        {video.duration > 0 && (
                            <span className="flex items-center gap-1">
                                <Clock size={12} />
                                {formatDuration(video.duration)}
                            </span>
                        )}
                    </div>
                    <StatusBadge status={video.status} />
                </div>

                {/* Progress bar for uploading */}
                {isUploading && (
                    <div className="progress-bar">
                        <div
                            className="progress-fill"
                            style={{ width: `${video.uploadProgress || 0}%` }}
                        />
                    </div>
                )}

                {(canCancel || canDelete) && (
                    <div className="flex items-center gap-2 pt-1">
                        {canCancel && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onCancel?.(video._id);
                                }}
                                className="btn-chip-warn"
                            >
                                Stop Upload
                            </button>
                        )}
                        {canDelete && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onDelete?.(video._id);
                                }}
                                className="btn-chip-danger"
                            >
                                {deleteLabel}
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
