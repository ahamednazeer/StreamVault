'use client';

import React, { useState, useRef, useCallback } from 'react';
import { CloudArrowUp, FilmStrip, X } from '@phosphor-icons/react';
import Modal from './Modal';
import { api } from '@/lib/api';

interface UploadModalProps {
    isOpen: boolean;
    onClose: () => void;
    onUploadComplete: (video: any) => void;
}

const ALLOWED_TYPES = ['video/mp4', 'video/x-matroska', 'video/matroska', 'video/webm'];
const ALLOWED_EXTENSIONS = ['.mp4', '.mkv', '.webm'];
const MAX_SIZE = 20 * 1024 * 1024 * 1024; // 20GB default limit

export default function UploadModal({ isOpen, onClose, onUploadComplete }: UploadModalProps) {
    const [file, setFile] = useState<File | null>(null);
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [error, setError] = useState('');
    const [isDragOver, setIsDragOver] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const validateFile = (f: File): string | null => {
        const ext = '.' + f.name.split('.').pop()?.toLowerCase();
        if (!ALLOWED_EXTENSIONS.includes(ext)) {
            return `Invalid format. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`;
        }
        if (f.size > MAX_SIZE) {
            return 'File too large. Maximum size: 20GB';
        }
        if (f.size === 0) {
            return 'File is empty';
        }
        return null;
    };

    const handleFileSelect = (f: File) => {
        const err = validateFile(f);
        if (err) {
            setError(err);
            return;
        }
        setFile(f);
        setError('');
        if (!title) {
            setTitle(f.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' '));
        }
    };

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(false);
        const f = e.dataTransfer.files[0];
        if (f) handleFileSelect(f);
    }, [title]);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(true);
    }, []);

    const handleDragLeave = useCallback(() => {
        setIsDragOver(false);
    }, []);

    const handleSubmit = async () => {
        if (!file || !title) return;

        setError('');
        setUploading(true);
        setUploadProgress(0);

        try {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('title', title);
            formData.append('description', description);

            const result = await api.uploadVideo(formData, (progress) => {
                setUploadProgress(progress);
            });

            onUploadComplete(result.video);
            handleReset();
        } catch (err: any) {
            setError(err.message || 'Upload failed');
        } finally {
            setUploading(false);
        }
    };

    const handleReset = () => {
        setFile(null);
        setTitle('');
        setDescription('');
        setUploadProgress(0);
        setError('');
    };

    const handleClose = () => {
        if (!uploading) {
            handleReset();
            onClose();
        }
    };

    const formatSize = (bytes: number): string => {
        if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(2)} GB`;
        if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
        return `${(bytes / 1024).toFixed(0)} KB`;
    };

    return (
        <Modal isOpen={isOpen} onClose={handleClose} title="Upload Video" size="lg">
            <div className="space-y-5">
                {/* Drop Zone */}
                {!file ? (
                    <div
                        className={`upload-zone ${isDragOver ? 'drag-over' : ''}`}
                        onDrop={handleDrop}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onClick={() => fileInputRef.current?.click()}
                    >
                        <CloudArrowUp
                            size={48}
                            weight="duotone"
                            className={`text-slate-500 mx-auto mb-3 ${isDragOver ? 'text-violet-400 animate-upload-bounce' : ''}`}
                        />
                        <p className="text-slate-300 font-medium mb-1">
                            Drop your video here or click to browse
                        </p>
                        <p className="text-xs text-slate-500 font-mono">
                            MP4, MKV, WebM • Max 20GB • Files are split into ~1.95GB parts for Telegram
                        </p>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".mp4,.mkv,.webm,video/mp4,video/x-matroska,video/webm"
                            onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) handleFileSelect(f);
                            }}
                            className="hidden"
                        />
                    </div>
                ) : (
                    <div className="bg-slate-800/40 border border-slate-700/60 rounded-sm p-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <FilmStrip size={24} weight="duotone" className="text-violet-400" />
                                <div>
                                    <p className="text-sm text-slate-200 font-medium truncate max-w-xs">{file.name}</p>
                                    <p className="text-xs text-slate-500 font-mono">{formatSize(file.size)}</p>
                                </div>
                            </div>
                            {!uploading && (
                                <button
                                    onClick={() => setFile(null)}
                                    className="text-slate-400 hover:text-red-400 transition-colors"
                                >
                                    <X size={18} />
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {/* Title */}
                <div>
                    <label className="block text-slate-400 text-xs uppercase tracking-wider mb-2 font-mono">
                        Title *
                    </label>
                    <input
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        className="input-modern"
                        placeholder="Enter video title"
                        disabled={uploading}
                    />
                </div>

                {/* Description */}
                <div>
                    <label className="block text-slate-400 text-xs uppercase tracking-wider mb-2 font-mono">
                        Description
                    </label>
                    <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        className="input-modern min-h-[80px] resize-y"
                        placeholder="Enter description (optional)"
                        disabled={uploading}
                    />
                </div>

                {/* Upload Progress */}
                {uploading && (
                    <div className="space-y-2">
                        <div className="flex items-center justify-between text-xs font-mono">
                            <span className="text-slate-400">Uploading to server...</span>
                            <span className="text-violet-400">{uploadProgress}%</span>
                        </div>
                        <div className="progress-bar">
                            <div className="progress-fill" style={{ width: `${uploadProgress}%` }} />
                        </div>
                    </div>
                )}

                {/* Error */}
                {error && (
                    <div className="bg-red-950/50 border border-red-800 rounded-sm p-3 text-sm text-red-400">
                        {error}
                    </div>
                )}

                {/* Actions */}
                <div className="flex gap-3 pt-2">
                    <button
                        onClick={handleClose}
                        disabled={uploading}
                        className="btn-secondary flex-1"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={!file || !title || uploading}
                        className="btn-primary flex-1"
                    >
                        {uploading ? 'Uploading...' : 'Upload Video'}
                    </button>
                </div>
            </div>
        </Modal>
    );
}
