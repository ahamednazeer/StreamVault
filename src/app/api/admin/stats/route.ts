import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getAuthUser, requireAdmin } from '@/lib/auth';
import User from '@/models/User';
import Video from '@/models/Video';

// GET /api/admin/stats
export async function GET(request: NextRequest) {
    try {
        const user = await getAuthUser(request);
        requireAdmin(user);
        await connectDB();

        const [totalUsers, totalVideos, storageAgg, statusCounts, usersByRole] = await Promise.all([
            User.countDocuments(),
            Video.countDocuments(),
            Video.aggregate([
                { $group: { _id: null, totalSize: { $sum: '$fileSize' } } },
            ]),
            Video.aggregate([
                { $group: { _id: '$status', count: { $sum: 1 } } },
            ]),
            User.aggregate([
                { $group: { _id: '$role', count: { $sum: 1 } } },
            ]),
        ]);

        const totalStorage = storageAgg[0]?.totalSize || 0;
        const statusMap: Record<string, number> = {};
        statusCounts.forEach((s: any) => { statusMap[s._id] = s.count; });

        const roleMap: Record<string, number> = {};
        usersByRole.forEach((r: any) => { roleMap[r._id] = r.count; });

        return NextResponse.json({
            users: {
                total: totalUsers,
                byRole: roleMap,
            },
            videos: {
                total: totalVideos,
                byStatus: statusMap,
                ready: statusMap['ready'] || 0,
                uploading: statusMap['uploading'] || 0,
                queued: statusMap['queued'] || 0,
                failed: statusMap['failed'] || 0,
            },
            storage: {
                totalBytes: totalStorage,
                totalGB: (totalStorage / (1024 * 1024 * 1024)).toFixed(2),
            },
        });

    } catch (error: any) {
        if (error.message === 'Admin access required') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
        if (error.message === 'No token provided') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
