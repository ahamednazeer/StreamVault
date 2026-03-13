'use client';

import React, { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import VideoCard from '@/components/VideoCard';
import UploadModal from '@/components/UploadModal';
import ConfirmDialog from '@/components/ConfirmDialog';
import { FilmStrip, Plus, Pulse, CloudArrowUp } from '@phosphor-icons/react';

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

export default function MyVideosPage() {
    const [videos, setVideos] = useState<Video[]>([]);
    const [loading, setLoading] = useState(true);
    const [showUpload, setShowUpload] = useState(false);
    const [actionId, setActionId] = useState<string | null>(null);
    const [confirmAction, setConfirmAction] = useState<{ type: 'delete' | 'cancel'; id: string } | null>(null);

    useEffect(() => {
        async function fetchVideos() {
            try {
                const data = await api.getVideos(1, '');
                setVideos(data.videos);
            } catch (error) {
                console.error('Failed to fetch videos:', error);
            } finally {
                setLoading(false);
            }
        }
        fetchVideos();
    }, []);

    // Poll for uploading progress
    useEffect(() => {
        const active = videos.filter(v => ['queued', 'uploading', 'processing'].includes(v.status));
        if (active.length === 0) return;

        const interval = setInterval(async () => {
            const updates = await Promise.all(
                active.map(async (v) => {
                    try {
                        return { id: v._id, ...(await api.getVideoProgress(v._id)) };
                    } catch { return null; }
                })
            );
            setVideos(prev => prev.map(v => {
                const u = updates.find(x => x?.id === v._id);
                return u ? { ...v, status: u.status, uploadProgress: u.uploadProgress } : v;
            }));
        }, 3000);

        return () => clearInterval(interval);
    }, [videos]);

    const handleUploadComplete = (video: any) => {
        setShowUpload(false);
        setVideos(prev => [{
            ...video,
            _id: video.id || video._id,
            status: 'queued',
            uploadProgress: 0,
            fileSize: 0,
            duration: 0,
            resolution: '',
            createdAt: new Date().toISOString(),
        }, ...prev]);
    };

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

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-chivo font-bold uppercase tracking-wider flex items-center gap-3">
                        <FilmStrip size={28} weight="duotone" className="text-violet-400" />
                        My Videos
                    </h1>
                    <p className="text-slate-500 mt-1">{videos.length} videos</p>
                </div>
                <button onClick={() => setShowUpload(true)} className="btn-primary flex items-center gap-2">
                    <Plus size={18} weight="bold" />
                    Upload
                </button>
            </div>

            {videos.length === 0 ? (
                <div className="bg-slate-800/40 border border-slate-700/60 rounded-sm p-12 text-center">
                    <CloudArrowUp size={48} weight="duotone" className="text-slate-600 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-slate-300 mb-2">No videos yet</h3>
                    <p className="text-slate-500 text-sm mb-6">Upload your first video to get started</p>
                    <button onClick={() => setShowUpload(true)} className="btn-primary">Upload Video</button>
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

            <UploadModal
                isOpen={showUpload}
                onClose={() => setShowUpload(false)}
                onUploadComplete={handleUploadComplete}
            />
        </div>
    );
}
