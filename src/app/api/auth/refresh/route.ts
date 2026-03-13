import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { verifyRefreshToken, signToken } from '@/lib/auth';
import User from '@/models/User';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { refreshToken } = body;

        if (!refreshToken) {
            return NextResponse.json(
                { error: 'Refresh token required' },
                { status: 400 }
            );
        }

        const payload = verifyRefreshToken(refreshToken);

        await connectDB();
        const user = await User.findById(payload.userId);

        if (!user || user.refreshToken !== refreshToken) {
            return NextResponse.json(
                { error: 'Invalid refresh token' },
                { status: 401 }
            );
        }

        const newToken = signToken(user._id.toString(), user.role);

        return NextResponse.json({ token: newToken });

    } catch (error: any) {
        console.error('Refresh error:', error);
        return NextResponse.json(
            { error: 'Invalid or expired refresh token' },
            { status: 401 }
        );
    }
}
