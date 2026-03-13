'use client';

import React from 'react';
import Modal from './Modal';

interface ConfirmDialogProps {
    isOpen: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: 'danger' | 'warn' | 'neutral';
    isLoading?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}

export default function ConfirmDialog({
    isOpen,
    title,
    message,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    variant = 'neutral',
    isLoading = false,
    onConfirm,
    onCancel,
}: ConfirmDialogProps) {
    const confirmClass =
        variant === 'danger'
            ? 'btn-chip-danger'
            : variant === 'warn'
                ? 'btn-chip-warn'
                : 'btn-chip';

    return (
        <Modal isOpen={isOpen} onClose={onCancel} title={title} size="sm">
            <div className="space-y-4">
                <p className="text-sm text-slate-300 leading-relaxed">
                    {message}
                </p>
                <div className="flex items-center justify-end gap-2">
                    <button
                        onClick={onCancel}
                        className="btn-chip"
                        disabled={isLoading}
                    >
                        {cancelLabel}
                    </button>
                    <button
                        onClick={onConfirm}
                        className={confirmClass}
                        disabled={isLoading}
                    >
                        {isLoading ? 'Working...' : confirmLabel}
                    </button>
                </div>
            </div>
        </Modal>
    );
}
