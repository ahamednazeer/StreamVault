'use client';

import React, { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { DataCard } from '@/components/DataCard';
import DataTable from '@/components/DataTable';
import { StatusBadge } from '@/components/StatusBadge';
import { HardDrives, FilmStrip, Gauge, Pulse, WarningCircle, CloudArrowUp } from '@phosphor-icons/react';

interface StorageTotals {
    totalBytes: number;
    totalVideos: number;
}

interface ChannelUsage {
    channelIndex: number;
    channelId: string | null;
    capacityBytes: number | null;
    totalBytes: number;
    count: number;
}

interface StatusUsage {
    status: string;
    totalBytes: number;
    count: number;
}

interface RoleUsage {
    role: string;
    totalBytes: number;
    count: number;
}

interface LargestVideo {
    _id: string;
    title: string;
    fileSize: number;
    status: string;
    createdAt: string;
    storageChannelIndex: number;
    userId: { username?: string; email?: string } | null;
}

interface UserUsage {
    userId: string;
    totalBytes: number;
    count: number;
    user: { username?: string; email?: string; role?: string } | null;
}

interface DayUsage {
    date: string;
    totalBytes: number;
    count: number;
}

interface WeekUsage {
    year: number;
    week: number;
    totalBytes: number;
    count: number;
}

interface MonthUsage {
    year: number;
    month: number;
    totalBytes: number;
    count: number;
}

interface StorageResponse {
    totals: StorageTotals;
    byChannel: ChannelUsage[];
    byStatus: StatusUsage[];
    byUser: UserUsage[];
    byRole: RoleUsage[];
    uploadsByDay: DayUsage[];
    uploadsByWeek: WeekUsage[];
    uploadsByMonth: MonthUsage[];
    windowDays: number;
    windowWeeks: number;
    windowMonths: number;
    temperature: {
        hotDays: number;
        hot: { totalBytes: number; count: number };
        cold: { totalBytes: number; count: number };
    };
    largestVideos: LargestVideo[];
}

function formatBytes(bytes: number): string {
    if (!bytes || bytes <= 0) return '0 B';
    if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(2)} GB`;
    if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${bytes} B`;
}

function channelLabel(index: number): string {
    if (index === null || index === undefined || index < 0) return 'Unassigned';
    return `Channel ${index + 1}`;
}

function shortDate(dateStr: string): string {
    if (!dateStr) return '-';
    return dateStr;
}

function weekLabel(row: WeekUsage): string {
    if (!row?.year || !row?.week) return '-';
    return `${row.year}-W${String(row.week).padStart(2, '0')}`;
}

function monthLabel(row: MonthUsage): string {
    if (!row?.year || !row?.month) return '-';
    return `${row.year}-${String(row.month).padStart(2, '0')}`;
}

export default function AdminStoragePage() {
    const [data, setData] = useState<StorageResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        async function fetchStorage() {
            try {
                const storage = await api.getAdminStorage();
                setData(storage);
            } catch (err: any) {
                setError(err?.message || 'Failed to load storage data');
            } finally {
                setLoading(false);
            }
        }
        fetchStorage();
    }, []);

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center h-64 gap-4">
                <div className="relative">
                    <div className="w-12 h-12 rounded-full border-2 border-slate-700 border-t-violet-500 animate-spin" />
                    <Pulse size={24} className="absolute inset-0 m-auto text-violet-400 animate-pulse" />
                </div>
                <p className="text-slate-500 font-mono text-xs uppercase tracking-widest animate-pulse">
                    Loading Storage...
                </p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="bg-red-950/40 border border-red-800/50 rounded-sm p-6 flex items-start gap-3">
                <WarningCircle size={20} weight="duotone" className="text-red-400 mt-0.5" />
                <div>
                    <p className="text-red-300 font-mono text-sm uppercase tracking-wider">Failed to load storage data</p>
                    <p className="text-red-400 text-xs mt-1">{error}</p>
                </div>
            </div>
        );
    }

    const totalBytes = data?.totals?.totalBytes || 0;
    const totalVideos = data?.totals?.totalVideos || 0;
    const avgBytes = totalVideos > 0 ? totalBytes / totalVideos : 0;
    const largestBytes = data?.largestVideos?.[0]?.fileSize || 0;
    const windowDays = data?.windowDays || 30;
    const windowWeeks = data?.windowWeeks || 12;
    const windowMonths = data?.windowMonths || 12;
    const hotDays = data?.temperature?.hotDays || 7;
    const hotBytes = data?.temperature?.hot?.totalBytes || 0;
    const coldBytes = data?.temperature?.cold?.totalBytes || 0;

    const uploadsMap = new Map(
        (data?.uploadsByDay || []).map((row) => [row.date, row])
    );

    const dailySeries: DayUsage[] = [];
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - (windowDays - 1));
    startDate.setHours(0, 0, 0, 0);
    for (let i = 0; i < windowDays; i += 1) {
        const current = new Date(startDate);
        current.setDate(startDate.getDate() + i);
        const key = current.toISOString().slice(0, 10);
        const match = uploadsMap.get(key);
        dailySeries.push({
            date: key,
            totalBytes: match?.totalBytes || 0,
            count: match?.count || 0,
        });
    }

    const uploadsLastWindow = dailySeries.reduce((sum, row) => sum + row.count, 0);
    const storageLastWindow = dailySeries.reduce((sum, row) => sum + row.totalBytes, 0);
    const maxDailyBytes = dailySeries.reduce((max, row) => Math.max(max, row.totalBytes), 0);
    const maxUserBytes = (data?.byUser || []).reduce((max, row) => Math.max(max, row.totalBytes), 0);

    const weekMap = new Map(
        (data?.uploadsByWeek || []).map((row) => [`${row.year}-${row.week}`, row])
    );
    const monthMap = new Map(
        (data?.uploadsByMonth || []).map((row) => [`${row.year}-${row.month}`, row])
    );

    const weeklySeries: WeekUsage[] = [];
    const weekStart = new Date();
    weekStart.setHours(0, 0, 0, 0);
    weekStart.setDate(weekStart.getDate() - (7 * (windowWeeks - 1)));
    for (let i = 0; i < windowWeeks; i += 1) {
        const current = new Date(weekStart);
        current.setDate(weekStart.getDate() + (i * 7));
        const iso = (() => {
            const temp = new Date(Date.UTC(current.getFullYear(), current.getMonth(), current.getDate()));
            temp.setUTCDate(temp.getUTCDate() + 4 - (temp.getUTCDay() || 7));
            const yearStart = new Date(Date.UTC(temp.getUTCFullYear(), 0, 1));
            const week = Math.ceil((((temp.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
            return { year: temp.getUTCFullYear(), week };
        })();
        const key = `${iso.year}-${iso.week}`;
        const match = weekMap.get(key);
        weeklySeries.push({
            year: iso.year,
            week: iso.week,
            totalBytes: match?.totalBytes || 0,
            count: match?.count || 0,
        });
    }

    const monthlySeries: MonthUsage[] = [];
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    monthStart.setMonth(monthStart.getMonth() - (windowMonths - 1));
    for (let i = 0; i < windowMonths; i += 1) {
        const current = new Date(monthStart);
        current.setMonth(monthStart.getMonth() + i);
        const year = current.getFullYear();
        const month = current.getMonth() + 1;
        const key = `${year}-${month}`;
        const match = monthMap.get(key);
        monthlySeries.push({
            year,
            month,
            totalBytes: match?.totalBytes || 0,
            count: match?.count || 0,
        });
    }

    const maxWeeklyBytes = weeklySeries.reduce((max, row) => Math.max(max, row.totalBytes), 0);
    const maxMonthlyBytes = monthlySeries.reduce((max, row) => Math.max(max, row.totalBytes), 0);

    const channelAlerts = (data?.byChannel || []).filter((row) => {
        if (!row.capacityBytes) return false;
        return row.capacityBytes > 0 && (row.totalBytes / row.capacityBytes) >= 0.85;
    });

    const channelColumns = [
        {
            key: 'channelIndex',
            label: 'Channel',
            render: (row: ChannelUsage) => (
                <div className="flex flex-col">
                    <span className="font-mono text-xs">{channelLabel(row.channelIndex)}</span>
                    {row.channelId && (
                        <span className="text-[10px] text-slate-500 font-mono">{row.channelId}</span>
                    )}
                </div>
            ),
        },
        {
            key: 'count',
            label: 'Videos',
            sortable: true,
            render: (row: ChannelUsage) => <span className="font-mono">{row.count}</span>,
        },
        {
            key: 'totalBytes',
            label: 'Storage',
            render: (row: ChannelUsage) => <span className="font-mono">{formatBytes(row.totalBytes)}</span>,
        },
        {
            key: 'capacity',
            label: 'Capacity',
            render: (row: ChannelUsage) => (
                <span className="font-mono text-xs">
                    {row.capacityBytes ? formatBytes(row.capacityBytes) : '-'}
                </span>
            ),
        },
        {
            key: 'avg',
            label: 'Avg Size',
            render: (row: ChannelUsage) => (
                <span className="font-mono text-xs">
                    {formatBytes(row.count ? row.totalBytes / row.count : 0)}
                </span>
            ),
        },
        {
            key: 'utilization',
            label: 'Utilization',
            render: (row: ChannelUsage) => {
                if (!row.capacityBytes) {
                    return <span className="text-slate-500 font-mono text-xs">-</span>;
                }
                const ratio = row.capacityBytes > 0 ? row.totalBytes / row.capacityBytes : 0;
                const percent = Math.min(999, Math.round(ratio * 100));
                const barWidth = Math.min(100, ratio * 100);
                const barClass = ratio >= 0.95
                    ? 'bg-red-500/80'
                    : ratio >= 0.85
                        ? 'bg-yellow-500/80'
                        : 'bg-emerald-500/70';
                return (
                    <div className="flex items-center gap-2">
                        <div className="w-20 h-1.5 bg-slate-800 rounded">
                            <div className={`h-1.5 rounded ${barClass}`} style={{ width: `${barWidth}%` }} />
                        </div>
                        <span className="font-mono text-xs text-slate-400">{percent}%</span>
                    </div>
                );
            },
        },
    ];

    const statusColumns = [
        {
            key: 'status',
            label: 'Status',
            render: (row: StatusUsage) => <StatusBadge status={row.status} />,
        },
        {
            key: 'count',
            label: 'Videos',
            sortable: true,
            render: (row: StatusUsage) => <span className="font-mono">{row.count}</span>,
        },
        {
            key: 'totalBytes',
            label: 'Storage',
            render: (row: StatusUsage) => <span className="font-mono">{formatBytes(row.totalBytes)}</span>,
        },
    ];

    const roleColumns = [
        {
            key: 'role',
            label: 'Role',
            render: (row: RoleUsage) => <StatusBadge status={row.role} />,
        },
        {
            key: 'count',
            label: 'Videos',
            render: (row: RoleUsage) => <span className="font-mono">{row.count}</span>,
        },
        {
            key: 'totalBytes',
            label: 'Storage',
            render: (row: RoleUsage) => <span className="font-mono">{formatBytes(row.totalBytes)}</span>,
        },
        {
            key: 'share',
            label: 'Share',
            render: (row: RoleUsage) => {
                const pct = totalBytes > 0 ? (row.totalBytes / totalBytes) * 100 : 0;
                return <span className="font-mono text-xs text-slate-400">{pct.toFixed(1)}%</span>;
            },
        },
    ];

    const userColumns = [
        {
            key: 'user',
            label: 'User',
            render: (row: UserUsage) => (
                <div className="flex flex-col">
                    <span className="text-slate-200">{row.user?.username || 'Unknown'}</span>
                    <span className="text-[10px] text-slate-500 font-mono">{row.user?.email || '-'}</span>
                </div>
            ),
        },
        {
            key: 'count',
            label: 'Videos',
            sortable: true,
            render: (row: UserUsage) => <span className="font-mono">{row.count}</span>,
        },
        {
            key: 'totalBytes',
            label: 'Storage',
            render: (row: UserUsage) => <span className="font-mono">{formatBytes(row.totalBytes)}</span>,
        },
        {
            key: 'avg',
            label: 'Avg Size',
            render: (row: UserUsage) => (
                <span className="font-mono text-xs">
                    {formatBytes(row.count ? row.totalBytes / row.count : 0)}
                </span>
            ),
        },
        {
            key: 'share',
            label: 'Share',
            render: (row: UserUsage) => {
                const pct = totalBytes > 0 ? (row.totalBytes / totalBytes) * 100 : 0;
                const barWidth = maxUserBytes > 0 ? (row.totalBytes / maxUserBytes) * 100 : 0;
                return (
                    <div className="flex items-center gap-2">
                        <div className="w-20 h-1.5 bg-slate-800 rounded">
                            <div
                                className="h-1.5 rounded bg-violet-500/80"
                                style={{ width: `${barWidth}%` }}
                            />
                        </div>
                        <span className="font-mono text-xs text-slate-400">{pct.toFixed(1)}%</span>
                    </div>
                );
            },
        },
    ];

    const dailyColumns = [
        {
            key: 'date',
            label: 'Date',
            render: (row: DayUsage) => <span className="font-mono text-xs">{shortDate(row.date)}</span>,
        },
        {
            key: 'count',
            label: 'Videos',
            render: (row: DayUsage) => <span className="font-mono">{row.count}</span>,
        },
        {
            key: 'totalBytes',
            label: 'Storage',
            render: (row: DayUsage) => (
                <div className="flex items-center gap-2">
                    <div className="w-20 h-1.5 bg-slate-800 rounded">
                        <div
                            className="h-1.5 rounded bg-blue-500/80"
                            style={{ width: `${maxDailyBytes ? (row.totalBytes / maxDailyBytes) * 100 : 0}%` }}
                        />
                    </div>
                    <span className="font-mono text-xs">{formatBytes(row.totalBytes)}</span>
                </div>
            ),
        },
    ];

    const weeklyColumns = [
        {
            key: 'week',
            label: 'Week',
            render: (row: WeekUsage) => <span className="font-mono text-xs">{weekLabel(row)}</span>,
        },
        {
            key: 'count',
            label: 'Videos',
            render: (row: WeekUsage) => <span className="font-mono">{row.count}</span>,
        },
        {
            key: 'totalBytes',
            label: 'Storage',
            render: (row: WeekUsage) => (
                <div className="flex items-center gap-2">
                    <div className="w-20 h-1.5 bg-slate-800 rounded">
                        <div
                            className="h-1.5 rounded bg-emerald-500/80"
                            style={{ width: `${maxWeeklyBytes ? (row.totalBytes / maxWeeklyBytes) * 100 : 0}%` }}
                        />
                    </div>
                    <span className="font-mono text-xs">{formatBytes(row.totalBytes)}</span>
                </div>
            ),
        },
    ];

    const monthlyColumns = [
        {
            key: 'month',
            label: 'Month',
            render: (row: MonthUsage) => <span className="font-mono text-xs">{monthLabel(row)}</span>,
        },
        {
            key: 'count',
            label: 'Videos',
            render: (row: MonthUsage) => <span className="font-mono">{row.count}</span>,
        },
        {
            key: 'totalBytes',
            label: 'Storage',
            render: (row: MonthUsage) => (
                <div className="flex items-center gap-2">
                    <div className="w-20 h-1.5 bg-slate-800 rounded">
                        <div
                            className="h-1.5 rounded bg-violet-500/80"
                            style={{ width: `${maxMonthlyBytes ? (row.totalBytes / maxMonthlyBytes) * 100 : 0}%` }}
                        />
                    </div>
                    <span className="font-mono text-xs">{formatBytes(row.totalBytes)}</span>
                </div>
            ),
        },
    ];

    const largestColumns = [
        {
            key: 'title',
            label: 'Title',
            render: (row: LargestVideo) => (
                <span className="text-slate-200">{row.title || 'Untitled'}</span>
            ),
        },
        {
            key: 'userId',
            label: 'Owner',
            render: (row: LargestVideo) => (
                <span className="text-slate-400 font-mono text-xs">
                    {row.userId?.username || 'Unknown'}
                </span>
            ),
        },
        {
            key: 'fileSize',
            label: 'Size',
            render: (row: LargestVideo) => <span className="font-mono">{formatBytes(row.fileSize)}</span>,
        },
        {
            key: 'status',
            label: 'Status',
            render: (row: LargestVideo) => <StatusBadge status={row.status} />,
        },
        {
            key: 'storageChannelIndex',
            label: 'Channel',
            render: (row: LargestVideo) => (
                <span className="font-mono text-xs">{channelLabel(row.storageChannelIndex)}</span>
            ),
        },
        {
            key: 'createdAt',
            label: 'Uploaded',
            render: (row: LargestVideo) => (
                <span className="text-slate-400 font-mono text-xs">
                    {row.createdAt ? new Date(row.createdAt).toLocaleDateString() : '-'}
                </span>
            ),
        },
    ];

    return (
        <div className="space-y-8">
            <div>
                <h1 className="text-2xl font-chivo font-bold uppercase tracking-wider flex items-center gap-3">
                    <HardDrives size={28} weight="duotone" className="text-violet-400" />
                    Storage Overview
                </h1>
                <p className="text-slate-500 mt-1">Channel usage, distribution, and largest assets</p>
            </div>

            {channelAlerts.length > 0 && (
                <div className="bg-yellow-950/40 border border-yellow-800/50 rounded-sm p-4 flex items-start gap-3">
                    <WarningCircle size={18} weight="duotone" className="text-yellow-400 mt-0.5" />
                    <div>
                        <p className="text-yellow-300 font-mono text-xs uppercase tracking-wider">
                            Capacity warning on {channelAlerts.length} channel{channelAlerts.length > 1 ? 's' : ''}
                        </p>
                        <p className="text-yellow-200 text-xs mt-1">
                            Channels at or above 85% capacity. Consider adding channels or rebalancing uploads.
                        </p>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-4">
                <DataCard title="Total Storage" value={formatBytes(totalBytes)} icon={HardDrives} />
                <DataCard title="Total Videos" value={totalVideos} icon={FilmStrip} />
                <DataCard title="Average Size" value={formatBytes(avgBytes)} icon={Gauge} />
                <DataCard title={`Uploads (${windowDays}d)`} value={uploadsLastWindow} icon={FilmStrip} />
                <DataCard title={`Hot Storage (${hotDays}d)`} value={formatBytes(hotBytes)} icon={CloudArrowUp} />
                <DataCard title="Cold Storage" value={formatBytes(coldBytes)} icon={HardDrives} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="space-y-4">
                    <h3 className="text-sm font-mono text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <HardDrives size={16} weight="duotone" />
                        Storage by Channel
                    </h3>
                    <DataTable data={data?.byChannel || []} columns={channelColumns} emptyMessage="No channel data" />
                </div>
                <div className="space-y-4">
                    <h3 className="text-sm font-mono text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <Gauge size={16} weight="duotone" />
                        Storage by Status
                    </h3>
                    <DataTable data={data?.byStatus || []} columns={statusColumns} emptyMessage="No status data" />
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <h3 className="text-sm font-mono text-slate-400 uppercase tracking-widest flex items-center gap-2">
                            <FilmStrip size={16} weight="duotone" />
                            Storage by Role
                        </h3>
                    </div>
                    <DataTable data={data?.byRole || []} columns={roleColumns} emptyMessage="No role data" />
                </div>
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <h3 className="text-sm font-mono text-slate-400 uppercase tracking-widest flex items-center gap-2">
                            <FilmStrip size={16} weight="duotone" />
                            Top Users by Storage
                        </h3>
                        <span className="text-xs text-slate-500 font-mono uppercase tracking-widest">
                            {data?.byUser?.length || 0} users
                        </span>
                    </div>
                    <DataTable data={data?.byUser || []} columns={userColumns} emptyMessage="No user data" />
                </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <h3 className="text-sm font-mono text-slate-400 uppercase tracking-widest flex items-center gap-2">
                            <Gauge size={16} weight="duotone" />
                            Uploads by Day
                        </h3>
                        <span className="text-xs text-slate-500 font-mono uppercase tracking-widest">
                            {formatBytes(storageLastWindow)} in {windowDays}d
                        </span>
                    </div>
                    <DataTable data={dailySeries} columns={dailyColumns} emptyMessage="No upload history" />
                </div>
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <h3 className="text-sm font-mono text-slate-400 uppercase tracking-widest flex items-center gap-2">
                            <Gauge size={16} weight="duotone" />
                            Uploads by Week
                        </h3>
                        <span className="text-xs text-slate-500 font-mono uppercase tracking-widest">
                            Last {windowWeeks} weeks
                        </span>
                    </div>
                    <DataTable data={weeklySeries} columns={weeklyColumns} emptyMessage="No weekly data" />
                </div>
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <h3 className="text-sm font-mono text-slate-400 uppercase tracking-widest flex items-center gap-2">
                            <Gauge size={16} weight="duotone" />
                            Uploads by Month
                        </h3>
                        <span className="text-xs text-slate-500 font-mono uppercase tracking-widest">
                            Last {windowMonths} months
                        </span>
                    </div>
                    <DataTable data={monthlySeries} columns={monthlyColumns} emptyMessage="No monthly data" />
                </div>
            </div>

            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <h3 className="text-sm font-mono text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <FilmStrip size={16} weight="duotone" />
                        Largest Videos
                    </h3>
                    <span className="text-xs text-slate-500 font-mono uppercase tracking-widest">
                        Largest file: {formatBytes(largestBytes)}
                    </span>
                </div>
                <DataTable data={data?.largestVideos || []} columns={largestColumns} emptyMessage="No videos found" />
            </div>
        </div>
    );
}
