'use client';

import React, { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import VideoCard from '@/components/VideoCard';
import ConfirmDialog from '@/components/ConfirmDialog';
import { MagnifyingGlass, Pulse, FunnelSimple } from '@phosphor-icons/react';

interface Video {
    _id: string;
    title: string;
    status: string;
    fileSize: number;
    duration: number;
    resolution: string;
    uploadProgress: number;
    createdAt: string;
}

export default function BrowsePage() {
    const [videos, setVideos] = useState<Video[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [actionId, setActionId] = useState<string | null>(null);
    const [confirmAction, setConfirmAction] = useState<{ type: 'delete' | 'cancel'; id: string } | null>(null);

    useEffect(() => {
        async function fetchVideos() {
            try {
                setLoading(true);
                const data = await api.getVideos(page, search);
                setVideos(data.videos);
                setTotalPages(data.pagination.pages);
            } catch (error) {
                console.error('Failed to fetch videos:', error);
            } finally {
                setLoading(false);
            }
        }
        const debounce = setTimeout(fetchVideos, 300);
        return () => clearTimeout(debounce);
    }, [page, search]);

    const handleDelete = async (id: string) => {
        try {
            setActionId(id);
            await api.deleteVideo(id);
            setVideos(prev => prev.filter(v => v._id !== id));
        } catch (error) {
            console.error('Failed to delete video:', error);
        } finally {
            setActionId(null);
            setConfirmAction(null);
        }
    };

    const handleCancel = async (id: string) => {
        try {
            setActionId(id);
            await api.cancelVideo(id);
            setVideos(prev => prev.map(v => (
                v._id === id ? { ...v, status: 'canceled', uploadProgress: 0 } : v
            )));
        } catch (error) {
            console.error('Failed to cancel upload:', error);
        } finally {
            setActionId(null);
            setConfirmAction(null);
        }
    };

    const selected = confirmAction ? videos.find(v => v._id === confirmAction.id) : null;
    const isDelete = confirmAction?.type === 'delete';
    const isCancel = confirmAction?.type === 'cancel';
    const deleteLabel = selected?.status === 'queued' || selected?.status === 'failed' || selected?.status === 'canceled'
        ? 'Remove'
        : 'Delete';
    const deleteTitle = selected?.status === 'queued'
        ? 'Remove queued upload'
        : selected?.status === 'failed'
            ? 'Remove failed upload'
            : 'Delete video';
    const deleteMessage = selected?.status === 'ready' || selected?.status === 'processing'
        ? 'This will delete the video from Telegram and remove it from your library.'
        : 'This will remove the upload and delete the temporary file.';

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-chivo font-bold uppercase tracking-wider flex items-center gap-3">
                    <MagnifyingGlass size={28} weight="duotone" className="text-violet-400" />
                    Browse Videos
                </h1>
                <p className="text-slate-500 mt-1">Search and discover videos</p>
            </div>

            {/* Search Bar */}
            <div className="relative">
                <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                <input
                    type="text"
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                    className="input-modern pl-10"
                    placeholder="Search by title..."
                />
            </div>

            {/* Results */}
            {loading ? (
                <div className="flex flex-col items-center justify-center h-40 gap-4">
                    <div className="relative">
                        <div className="w-10 h-10 rounded-full border-2 border-slate-700 border-t-violet-500 animate-spin" />
                        <Pulse size={20} className="absolute inset-0 m-auto text-violet-400 animate-pulse" />
                    </div>
                    <p className="text-slate-500 font-mono text-xs uppercase tracking-widest animate-pulse">Searching...</p>
                </div>
            ) : videos.length === 0 ? (
                <div className="bg-slate-800/40 border border-slate-700/60 rounded-sm p-12 text-center">
                    <FunnelSimple size={48} weight="duotone" className="text-slate-600 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-slate-300 mb-2">No videos found</h3>
                    <p className="text-slate-500 text-sm">Try a different search term</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {videos.map(video => (
                        <VideoCard
                            key={video._id}
                            video={video}
                            onDelete={(video.status === 'queued' || video.status === 'failed' || video.status === 'ready' || video.status === 'processing' || video.status === 'canceled') && actionId !== video._id ? (id) => setConfirmAction({ type: 'delete', id }) : undefined}
                            onCancel={video.status === 'uploading' && actionId !== video._id ? (id) => setConfirmAction({ type: 'cancel', id }) : undefined}
                        />
                    ))}
                </div>
            )}

            <ConfirmDialog
                isOpen={!!confirmAction}
                title={isDelete ? deleteTitle : 'Stop upload'}
                message={isDelete ? deleteMessage : 'This will stop the current upload and mark it as canceled.'}
                confirmLabel={isDelete ? deleteLabel : 'Stop'}
                cancelLabel="Back"
                variant={isDelete && (selected?.status === 'ready' || selected?.status === 'processing') ? 'danger' : 'warn'}
                isLoading={!!actionId}
                onCancel={() => setConfirmAction(null)}
                onConfirm={() => {
                    if (!confirmAction) return;
                    if (confirmAction.type === 'delete') {
                        handleDelete(confirmAction.id);
                    } else {
                        handleCancel(confirmAction.id);
                    }
                }}
            />

            {/* Pagination */}
            {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 pt-4">
                    <button
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={page === 1}
                        className="btn-secondary text-xs disabled:opacity-30"
                    >
                        Previous
                    </button>
                    <span className="text-sm text-slate-400 font-mono px-4">
                        {page} / {totalPages}
                    </span>
                    <button
                        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                        disabled={page === totalPages}
                        className="btn-secondary text-xs disabled:opacity-30"
                    >
                        Next
                    </button>
                </div>
            )}
        </div>
    );
}
