import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';

export async function GET(request: NextRequest) {
    try {
        const user = await getAuthUser(request);

        return NextResponse.json({
            id: user._id,
            username: user.username,
            email: user.email,
            role: user.role,
            createdAt: user.createdAt,
        });

    } catch (error: any) {
        return NextResponse.json(
            { error: 'Unauthorized' },
            { status: 401 }
        );
    }
}
