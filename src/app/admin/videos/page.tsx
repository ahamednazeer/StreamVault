'use client';

import React, { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import DataTable from '@/components/DataTable';
import { StatusBadge } from '@/components/StatusBadge';
import Modal from '@/components/Modal';
import { FilmStrip, Pulse, Trash } from '@phosphor-icons/react';

interface VideoItem {
    _id: string;
    title: string;
    userId: { _id: string; username: string; email: string } | null;
    status: string;
    fileSize: number;
    duration: number;
    createdAt: string;
}

function formatSize(bytes: number): string {
    if (!bytes) return '-';
    if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(2)} GB`;
    if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
    return `${(bytes / 1024).toFixed(0)} KB`;
}

export default function AdminVideosPage() {
    const [videos, setVideos] = useState<VideoItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [deleteTarget, setDeleteTarget] = useState<VideoItem | null>(null);

    useEffect(() => {
        async function fetchVideos() {
            try {
                const data = await api.getAdminVideos();
                setVideos(data.videos);
            } catch (error) {
                console.error('Failed to fetch videos:', error);
            } finally {
                setLoading(false);
            }
        }
        fetchVideos();
    }, []);

    const handleDelete = async () => {
        if (!deleteTarget) return;
        try {
            await api.adminDeleteVideo(deleteTarget._id);
            setVideos(prev => prev.filter(v => v._id !== deleteTarget._id));
            setDeleteTarget(null);
        } catch (error: any) {
            console.error('Delete failed:', error);
        }
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center h-64 gap-4">
                <div className="relative">
                    <div className="w-12 h-12 rounded-full border-2 border-slate-700 border-t-violet-500 animate-spin" />
                    <Pulse size={24} className="absolute inset-0 m-auto text-violet-400 animate-pulse" />
                </div>
                <p className="text-slate-500 font-mono text-xs uppercase tracking-widest animate-pulse">Loading Videos...</p>
            </div>
        );
    }

    const columns = [
        { key: 'title' as const, label: 'Title', sortable: true },
        {
            key: 'userId' as const,
            label: 'Owner',
            render: (video: VideoItem) => (
                <span className="text-slate-400 font-mono text-xs">
                    {video.userId?.username || 'Unknown'}
                </span>
            ),
        },
        {
            key: 'fileSize' as const,
            label: 'Size',
            render: (video: VideoItem) => (
                <span className="font-mono text-xs">{formatSize(video.fileSize)}</span>
            ),
        },
        {
            key: 'status' as const,
            label: 'Status',
            render: (video: VideoItem) => <StatusBadge status={video.status} />,
        },
        {
            key: 'createdAt' as const,
            label: 'Uploaded',
            sortable: true,
            render: (video: VideoItem) => (
                <span className="text-slate-400 font-mono text-xs">
                    {new Date(video.createdAt).toLocaleDateString()}
                </span>
            ),
        },
        {
            key: 'actions' as string,
            label: 'Actions',
            render: (video: VideoItem) => (
                <button
                    onClick={(e) => { e.stopPropagation(); setDeleteTarget(video); }}
                    className="text-red-400 hover:text-red-300 transition-colors p-1"
                    title="Delete Video"
                >
                    <Trash size={16} />
                </button>
            ),
        },
    ];

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-chivo font-bold uppercase tracking-wider flex items-center gap-3">
                    <FilmStrip size={28} weight="duotone" className="text-violet-400" />
                    Video Management
                </h1>
                <p className="text-slate-500 mt-1">{videos.length} videos across all users</p>
            </div>

            <DataTable
                data={videos}
                columns={columns}
                emptyMessage="No videos found"
            />

            <Modal
                isOpen={!!deleteTarget}
                onClose={() => setDeleteTarget(null)}
                title="Delete Video"
                size="sm"
            >
                <div className="space-y-4">
                    <p className="text-slate-400 text-sm">
                        Delete <strong className="text-slate-200">{deleteTarget?.title}</strong>? This will remove it from Telegram and cannot be undone.
                    </p>
                    <div className="flex gap-3">
                        <button onClick={() => setDeleteTarget(null)} className="btn-secondary flex-1">Cancel</button>
                        <button onClick={handleDelete} className="btn-danger flex-1">Delete Video</button>
                    </div>
                </div>
            </Modal>
        </div>
    );
}
