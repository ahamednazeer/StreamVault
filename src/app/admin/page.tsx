'use client';

import React, { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { DataCard } from '@/components/DataCard';
import { Users, FilmStrip, HardDrives, Gauge, CloudArrowUp, Sparkle, ArrowSquareOut, Pulse, WarningCircle } from '@phosphor-icons/react';

interface Stats {
    users: { total: number; byRole: Record<string, number> };
    videos: { total: number; byStatus: Record<string, number>; ready: number; uploading: number; queued: number; failed: number };
    storage: { totalBytes: number; totalGB: string };
}

export default function AdminDashboard() {
    const [stats, setStats] = useState<Stats | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function fetchStats() {
            try {
                const data = await api.getAdminStats();
                setStats(data);
            } catch (error) {
                console.error('Failed to fetch stats:', error);
            } finally {
                setLoading(false);
            }
        }
        fetchStats();
    }, []);

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center h-64 gap-4">
                <div className="relative">
                    <div className="w-12 h-12 rounded-full border-2 border-slate-700 border-t-violet-500 animate-spin" />
                    <Pulse size={24} className="absolute inset-0 m-auto text-violet-400 animate-pulse" />
                </div>
                <p className="text-slate-500 font-mono text-xs uppercase tracking-widest animate-pulse">
                    Loading Admin Dashboard...
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-8">
            <div>
                <h1 className="text-2xl font-chivo font-bold uppercase tracking-wider flex items-center gap-3">
                    <Gauge size={28} weight="duotone" className="text-violet-400" />
                    Administration
                </h1>
                <p className="text-slate-500 mt-1">System overview and management</p>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <DataCard title="Total Users" value={stats?.users.total || 0} icon={Users} />
                <DataCard title="Total Videos" value={stats?.videos.total || 0} icon={FilmStrip} />
                <DataCard title="Storage Used" value={`${stats?.storage.totalGB || '0'} GB`} icon={HardDrives} />
                <DataCard title="Active Uploads" value={(stats?.videos.uploading || 0) + (stats?.videos.queued || 0)} icon={CloudArrowUp} />
            </div>

            {/* Two columns */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Users by Role */}
                <div className="bg-slate-800/40 border border-slate-700/60 rounded-xl p-6 relative overflow-hidden">
                    <Sparkle size={80} weight="duotone" className="absolute -right-4 -top-4 text-slate-700/20" />
                    <h3 className="text-sm font-mono text-slate-400 uppercase tracking-widest mb-5 flex items-center gap-2">
                        <Users size={16} weight="duotone" />
                        Users by Role
                    </h3>
                    <div className="space-y-3 relative z-10">
                        {stats?.users.byRole && Object.entries(stats.users.byRole).map(([role, count]) => (
                            <div key={role} className="flex items-center justify-between bg-slate-900/50 border border-slate-800/50 rounded-xl px-4 py-3 hover:bg-slate-800/50 transition-colors">
                                <span className="text-slate-400 text-sm font-mono uppercase tracking-wider">{role}</span>
                                <span className="text-slate-100 font-bold font-mono text-lg">{count}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Quick Actions */}
                <div className="bg-slate-800/40 border border-slate-700/60 rounded-xl p-6 relative overflow-hidden">
                    <Sparkle size={80} weight="duotone" className="absolute -right-4 -top-4 text-slate-700/20" />
                    <h3 className="text-sm font-mono text-slate-400 uppercase tracking-widest mb-5 flex items-center gap-2">
                        <ArrowSquareOut size={16} weight="duotone" />
                        Quick Actions
                    </h3>
                    <div className="grid grid-cols-2 gap-3 relative z-10">
                        <button
                            onClick={() => window.location.href = '/admin/users'}
                            className="bg-gradient-to-br from-blue-900/40 to-blue-950/60 border border-blue-700/30 hover:border-blue-600/50 rounded-xl px-4 py-3 text-blue-300 font-bold text-sm uppercase tracking-wider transition-all hover:scale-[1.02]"
                        >
                            Manage Users
                        </button>
                        <button
                            onClick={() => window.location.href = '/admin/videos'}
                            className="bg-gradient-to-br from-violet-900/40 to-violet-950/60 border border-violet-700/30 hover:border-violet-600/50 rounded-xl px-4 py-3 text-violet-300 font-bold text-sm uppercase tracking-wider transition-all hover:scale-[1.02]"
                        >
                            Manage Videos
                        </button>
                    </div>

                    {/* Failed uploads warning */}
                    {(stats?.videos.failed || 0) > 0 && (
                        <div className="mt-4 p-4 bg-red-950/50 border border-red-800/50 rounded-xl flex items-center gap-3">
                            <WarningCircle size={20} weight="duotone" className="text-red-400" />
                            <p className="text-red-400 text-sm font-mono uppercase tracking-wider">
                                {stats?.videos.failed} failed uploads
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
