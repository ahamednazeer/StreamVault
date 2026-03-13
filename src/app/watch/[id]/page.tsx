'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import VideoPlayer from '@/components/VideoPlayer';
import Modal from '@/components/Modal';
import { StatusBadge } from '@/components/StatusBadge';
import { ArrowLeft, Clock, HardDrive, MonitorPlay, PencilSimple, Trash, Pulse } from '@phosphor-icons/react';

function formatDuration(seconds: number): string {
    if (!seconds) return '0:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatSize(bytes: number): string {
    if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(2)} GB`;
    if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
    return `${(bytes / 1024).toFixed(0)} KB`;
}

function formatDate(date: string): string {
    return new Date(date).toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
}

export default function WatchPage() {
    const params = useParams();
    const router = useRouter();
    const videoId = params.id as string;

    const [video, setVideo] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [showEdit, setShowEdit] = useState(false);
    const [showDelete, setShowDelete] = useState(false);
    const [editTitle, setEditTitle] = useState('');
    const [editDescription, setEditDescription] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        async function fetchVideo() {
            try {
                const data = await api.getVideo(videoId);
                setVideo(data.video);
                setEditTitle(data.video.title);
                setEditDescription(data.video.description || '');
            } catch (error) {
                console.error('Failed to fetch video:', error);
                router.push('/dashboard');
            } finally {
                setLoading(false);
            }
        }
        fetchVideo();
    }, [videoId, router]);

    const handleSave = async () => {
        setSaving(true);
        try {
            const data = await api.updateVideo(videoId, { title: editTitle, description: editDescription });
            setVideo(data.video);
            setShowEdit(false);
        } catch (error: any) {
            console.error('Update failed:', error);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        try {
            await api.deleteVideo(videoId);
            router.push('/dashboard');
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
                <p className="text-slate-500 font-mono text-xs uppercase tracking-widest animate-pulse">Loading Video...</p>
            </div>
        );
    }

    if (!video) return null;

    return (
        <div className="max-w-6xl mx-auto space-y-6">
            {/* Back button */}
            <button
                onClick={() => router.back()}
                className="flex items-center gap-2 text-slate-400 hover:text-slate-200 transition-colors text-sm font-mono"
            >
                <ArrowLeft size={16} />
                Back
            </button>

            {/* Video Player */}
            {video.status === 'ready' ? (
                <VideoPlayer videoId={videoId} mimeType={video.mimeType} codec={video.codec} />
            ) : (
                <div className="aspect-video bg-slate-800/40 border border-slate-700/60 rounded-sm flex items-center justify-center">
                    <div className="text-center space-y-3">
                        <MonitorPlay size={48} weight="duotone" className="text-slate-600 mx-auto" />
                        <p className="text-slate-400 font-mono text-sm uppercase">
                            Video is {video.status}
                        </p>
                        {(video.status === 'uploading' || video.status === 'queued') && (
                            <div className="w-48 mx-auto progress-bar">
                                <div className="progress-fill" style={{ width: `${video.uploadProgress || 0}%` }} />
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Video Info */}
            <div className="bg-slate-800/40 border border-slate-700/60 rounded-sm p-6">
                <div className="flex items-start justify-between mb-4">
                    <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                            <h1 className="text-2xl font-chivo font-bold text-slate-100">{video.title}</h1>
                            <StatusBadge status={video.status} />
                        </div>
                        {video.description && (
                            <p className="text-slate-400 text-sm mt-2">{video.description}</p>
                        )}
                    </div>
                    <div className="flex gap-2 ml-4">
                        <button onClick={() => setShowEdit(true)} className="btn-secondary text-xs flex items-center gap-1.5">
                            <PencilSimple size={14} /> Edit
                        </button>
                        <button onClick={() => setShowDelete(true)} className="btn-danger text-xs flex items-center gap-1.5">
                            <Trash size={14} /> Delete
                        </button>
                    </div>
                </div>

                {/* Metadata grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4 pt-4 border-t border-slate-700/50">
                    {video.duration > 0 && (
                        <div className="flex items-center gap-2 text-sm">
                            <Clock size={16} className="text-slate-500" />
                            <span className="text-slate-400 font-mono">{formatDuration(video.duration)}</span>
                        </div>
                    )}
                    {video.fileSize > 0 && (
                        <div className="flex items-center gap-2 text-sm">
                            <HardDrive size={16} className="text-slate-500" />
                            <span className="text-slate-400 font-mono">{formatSize(video.fileSize)}</span>
                        </div>
                    )}
                    {video.resolution && (
                        <div className="text-sm text-slate-400 font-mono">{video.resolution}</div>
                    )}
                    {video.codec && (
                        <div className="text-sm text-slate-400 font-mono uppercase">{video.codec}</div>
                    )}
                </div>

                <p className="text-xs text-slate-600 font-mono mt-4">
                    Uploaded {formatDate(video.createdAt)}
                </p>
            </div>

            {/* Edit Modal */}
            <Modal isOpen={showEdit} onClose={() => setShowEdit(false)} title="Edit Video">
                <div className="space-y-4">
                    <div>
                        <label className="block text-slate-400 text-xs uppercase tracking-wider mb-2 font-mono">Title</label>
                        <input
                            type="text"
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            className="input-modern"
                        />
                    </div>
                    <div>
                        <label className="block text-slate-400 text-xs uppercase tracking-wider mb-2 font-mono">Description</label>
                        <textarea
                            value={editDescription}
                            onChange={(e) => setEditDescription(e.target.value)}
                            className="input-modern min-h-[80px] resize-y"
                        />
                    </div>
                    <div className="flex gap-3">
                        <button onClick={() => setShowEdit(false)} className="btn-secondary flex-1">Cancel</button>
                        <button onClick={handleSave} disabled={saving} className="btn-primary flex-1">
                            {saving ? 'Saving...' : 'Save Changes'}
                        </button>
                    </div>
                </div>
            </Modal>

            {/* Delete Confirmation */}
            <Modal isOpen={showDelete} onClose={() => setShowDelete(false)} title="Delete Video" size="sm">
                <div className="space-y-4">
                    <p className="text-slate-400 text-sm">
                        Are you sure you want to delete <strong className="text-slate-200">{video.title}</strong>? This will also remove it from Telegram. This action cannot be undone.
                    </p>
                    <div className="flex gap-3">
                        <button onClick={() => setShowDelete(false)} className="btn-secondary flex-1">Cancel</button>
                        <button onClick={handleDelete} className="btn-danger flex-1">Delete</button>
                    </div>
                </div>
            </Modal>
        </div>
    );
}
