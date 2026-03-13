import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getAuthUser, requireAdmin } from '@/lib/auth';
import User from '@/models/User';
import Video from '@/models/Video';

// GET /api/admin/users
export async function GET(request: NextRequest) {
    try {
        const user = await getAuthUser(request);
        requireAdmin(user);
        await connectDB();

        const url = new URL(request.url);
        const page = parseInt(url.searchParams.get('page') || '1');
        const limit = parseInt(url.searchParams.get('limit') || '50');
        const skip = (page - 1) * limit;

        const [users, total] = await Promise.all([
            User.find()
                .select('-passwordHash -refreshToken')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            User.countDocuments(),
        ]);

        // Get video counts per user
        const videoCounts = await Video.aggregate([
            { $group: { _id: '$userId', count: { $sum: 1 } } },
        ]);
        const videoCountMap: Record<string, number> = {};
        videoCounts.forEach((v: any) => { videoCountMap[v._id.toString()] = v.count; });

        const usersWithCounts = users.map((u: any) => ({
            ...u,
            videoCount: videoCountMap[u._id.toString()] || 0,
        }));

        return NextResponse.json({
            users: usersWithCounts,
            pagination: { page, limit, total, pages: Math.ceil(total / limit) },
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

// DELETE /api/admin/users?id=xxx
export async function DELETE(request: NextRequest) {
    try {
        const adminUser = await getAuthUser(request);
        requireAdmin(adminUser);
        await connectDB();

        const url = new URL(request.url);
        const userId = url.searchParams.get('id');

        if (!userId) {
            return NextResponse.json({ error: 'User ID required' }, { status: 400 });
        }

        // Don't allow self-deletion
        if (userId === adminUser._id.toString()) {
            return NextResponse.json({ error: 'Cannot delete yourself' }, { status: 400 });
        }

        const user = await User.findById(userId);
        if (!user) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        // Delete user's videos
        await Video.deleteMany({ userId });
        await User.findByIdAndDelete(userId);

        return NextResponse.json({ message: 'User and their videos deleted' });

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
