import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getAuthUser, requireAdmin } from '@/lib/auth';
import User from '@/models/User';
import Video from '@/models/Video';

// GET /api/admin/storage
export async function GET(request: NextRequest) {
    const startedAt = Date.now();
    try {
        const user = await getAuthUser(request);
        requireAdmin(user);
        await connectDB();

        const channelIds = (process.env.TELEGRAM_CHANNEL_IDS || '')
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean);
        const capacityRaw = (process.env.TELEGRAM_CHANNEL_CAPACITY_GB || '')
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean)
            .map((value) => Number.parseFloat(value))
            .filter((value) => Number.isFinite(value) && value > 0);
        const capacityBytesList = capacityRaw.map((value) => Math.round(value * 1024 * 1024 * 1024));
        const userCollection = User.collection?.name || 'users';

        const now = new Date();
        const startDate = new Date(now);
        startDate.setDate(now.getDate() - 29);
        startDate.setHours(0, 0, 0, 0);

        const hotDays = 7;
        const hotStart = new Date(now);
        hotStart.setDate(now.getDate() - (hotDays - 1));
        hotStart.setHours(0, 0, 0, 0);

        const weeklyWindow = 12;
        const weekStart = new Date(now);
        weekStart.setDate(now.getDate() - (7 * (weeklyWindow - 1)));
        weekStart.setHours(0, 0, 0, 0);

        const monthlyWindow = 12;
        const monthStart = new Date(now);
        monthStart.setDate(1);
        monthStart.setHours(0, 0, 0, 0);
        monthStart.setMonth(monthStart.getMonth() - (monthlyWindow - 1));

        const [
            totalsAgg,
            byChannelAgg,
            byStatusAgg,
            byUserAgg,
            byRoleAgg,
            uploadsByDayAgg,
            uploadsByWeekAgg,
            uploadsByMonthAgg,
            hotAgg,
            coldAgg,
            largestVideos,
        ] = await Promise.all([
            Video.aggregate([
                {
                    $group: {
                        _id: null,
                        totalBytes: { $sum: '$fileSize' },
                        totalVideos: { $sum: 1 },
                    },
                },
            ]),
            Video.aggregate([
                {
                    $group: {
                        _id: '$storageChannelIndex',
                        totalBytes: { $sum: '$fileSize' },
                        count: { $sum: 1 },
                    },
                },
                { $sort: { totalBytes: -1 } },
            ]),
            Video.aggregate([
                {
                    $group: {
                        _id: '$status',
                        totalBytes: { $sum: '$fileSize' },
                        count: { $sum: 1 },
                    },
                },
                { $sort: { totalBytes: -1 } },
            ]),
            Video.aggregate([
                {
                    $group: {
                        _id: '$userId',
                        totalBytes: { $sum: '$fileSize' },
                        count: { $sum: 1 },
                    },
                },
                { $sort: { totalBytes: -1 } },
                { $limit: 20 },
                {
                    $lookup: {
                        from: userCollection,
                        localField: '_id',
                        foreignField: '_id',
                        as: 'user',
                    },
                },
                { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
                {
                    $project: {
                        _id: 1,
                        totalBytes: 1,
                        count: 1,
                        user: {
                            username: '$user.username',
                            email: '$user.email',
                            role: '$user.role',
                        },
                    },
                },
            ]),
            Video.aggregate([
                {
                    $lookup: {
                        from: userCollection,
                        localField: 'userId',
                        foreignField: '_id',
                        as: 'user',
                    },
                },
                { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
                {
                    $group: {
                        _id: '$user.role',
                        totalBytes: { $sum: '$fileSize' },
                        count: { $sum: 1 },
                    },
                },
                { $sort: { totalBytes: -1 } },
            ]),
            Video.aggregate([
                {
                    $match: {
                        createdAt: { $gte: startDate },
                    },
                },
                {
                    $group: {
                        _id: {
                            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
                        },
                        totalBytes: { $sum: '$fileSize' },
                        count: { $sum: 1 },
                    },
                },
                { $sort: { _id: 1 } },
            ]),
            Video.aggregate([
                {
                    $match: {
                        createdAt: { $gte: weekStart },
                    },
                },
                {
                    $group: {
                        _id: {
                            year: { $isoWeekYear: '$createdAt' },
                            week: { $isoWeek: '$createdAt' },
                        },
                        totalBytes: { $sum: '$fileSize' },
                        count: { $sum: 1 },
                    },
                },
                { $sort: { '_id.year': 1, '_id.week': 1 } },
            ]),
            Video.aggregate([
                {
                    $match: {
                        createdAt: { $gte: monthStart },
                    },
                },
                {
                    $group: {
                        _id: {
                            year: { $year: '$createdAt' },
                            month: { $month: '$createdAt' },
                        },
                        totalBytes: { $sum: '$fileSize' },
                        count: { $sum: 1 },
                    },
                },
                { $sort: { '_id.year': 1, '_id.month': 1 } },
            ]),
            Video.aggregate([
                { $match: { createdAt: { $gte: hotStart } } },
                {
                    $group: {
                        _id: null,
                        totalBytes: { $sum: '$fileSize' },
                        count: { $sum: 1 },
                    },
                },
            ]),
            Video.aggregate([
                { $match: { createdAt: { $lt: hotStart } } },
                {
                    $group: {
                        _id: null,
                        totalBytes: { $sum: '$fileSize' },
                        count: { $sum: 1 },
                    },
                },
            ]),
            Video.find()
                .select('title fileSize status createdAt storageChannelIndex userId')
                .populate('userId', 'username email')
                .sort({ fileSize: -1 })
                .limit(10)
                .lean(),
        ]);

        const totalBytes = totalsAgg[0]?.totalBytes || 0;
        const totalVideos = totalsAgg[0]?.totalVideos || 0;

        const response = NextResponse.json({
            totals: {
                totalBytes,
                totalVideos,
            },
            byChannel: byChannelAgg.map((row: any) => ({
                channelIndex: row._id ?? -1,
                channelId:
                    typeof row._id === 'number' && row._id >= 0 && row._id < channelIds.length
                        ? channelIds[row._id]
                        : null,
                capacityBytes:
                    typeof row._id === 'number'
                        ? (capacityBytesList[row._id] || capacityBytesList[0] || null)
                        : null,
                totalBytes: row.totalBytes || 0,
                count: row.count || 0,
            })),
            byStatus: byStatusAgg.map((row: any) => ({
                status: row._id || 'unknown',
                totalBytes: row.totalBytes || 0,
                count: row.count || 0,
            })),
            byUser: byUserAgg.map((row: any) => ({
                userId: row._id?.toString?.() || row._id,
                totalBytes: row.totalBytes || 0,
                count: row.count || 0,
                user: row.user
                    ? {
                        username: row.user.username,
                        email: row.user.email,
                        role: row.user.role,
                    }
                    : null,
            })),
            byRole: byRoleAgg.map((row: any) => ({
                role: row._id || 'unknown',
                totalBytes: row.totalBytes || 0,
                count: row.count || 0,
            })),
            uploadsByDay: uploadsByDayAgg.map((row: any) => ({
                date: row._id,
                totalBytes: row.totalBytes || 0,
                count: row.count || 0,
            })),
            uploadsByWeek: uploadsByWeekAgg.map((row: any) => ({
                year: row._id?.year,
                week: row._id?.week,
                totalBytes: row.totalBytes || 0,
                count: row.count || 0,
            })),
            uploadsByMonth: uploadsByMonthAgg.map((row: any) => ({
                year: row._id?.year,
                month: row._id?.month,
                totalBytes: row.totalBytes || 0,
                count: row.count || 0,
            })),
            windowDays: 30,
            windowWeeks: weeklyWindow,
            windowMonths: monthlyWindow,
            temperature: {
                hotDays,
                hot: {
                    totalBytes: hotAgg[0]?.totalBytes || 0,
                    count: hotAgg[0]?.count || 0,
                },
                cold: {
                    totalBytes: coldAgg[0]?.totalBytes || 0,
                    count: coldAgg[0]?.count || 0,
                },
            },
            largestVideos: (largestVideos || []).map((video: any) => ({
                _id: video._id?.toString?.() || video._id,
                title: video.title,
                fileSize: video.fileSize || 0,
                status: video.status || 'unknown',
                createdAt: video.createdAt,
                storageChannelIndex: typeof video.storageChannelIndex === 'number' ? video.storageChannelIndex : -1,
                userId: video.userId
                    ? {
                        username: video.userId.username,
                        email: video.userId.email,
                    }
                    : null,
            })),
        });

        console.info('[admin/storage] ok', {
            durationMs: Date.now() - startedAt,
            totalVideos,
            totalBytes,
            channels: byChannelAgg.length,
            users: byUserAgg.length,
        });

        return response;
    } catch (error: any) {
        console.error('[admin/storage] error', {
            durationMs: Date.now() - startedAt,
            message: error?.message || String(error),
        });
        if (error.message === 'Admin access required') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
        if (error.message === 'No token provided') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
