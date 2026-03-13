import React from 'react';

interface StatusBadgeProps {
    status: string;
    className?: string;
}

const statusStyles: Record<string, string> = {
    ready: 'text-green-400 bg-green-950/50 border-green-800',
    uploading: 'text-blue-400 bg-blue-950/50 border-blue-800',
    queued: 'text-yellow-400 bg-yellow-950/50 border-yellow-800',
    processing: 'text-violet-400 bg-violet-950/50 border-violet-800',
    failed: 'text-red-400 bg-red-950/50 border-red-800',
    canceled: 'text-orange-300 bg-orange-950/50 border-orange-800',
    user: 'text-blue-400 bg-blue-950/50 border-blue-800',
    admin: 'text-purple-400 bg-purple-950/50 border-purple-800',
};

export function StatusBadge({ status, className = '' }: StatusBadgeProps) {
    const style = statusStyles[status] || 'text-slate-400 bg-slate-950/50 border-slate-800';

    return (
        <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-mono uppercase tracking-wider border ${style} ${className}`}
        >
            {status.replace('_', ' ')}
        </span>
    );
}
