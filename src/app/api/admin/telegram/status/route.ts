import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, requireAdmin } from '@/lib/auth';
import { getTelegramStatus } from '@/lib/telegramAdmin';

export const runtime = 'nodejs';

// GET /api/admin/telegram/status
export async function GET(request: NextRequest) {
    try {
        const user = await getAuthUser(request);
        requireAdmin(user);

        const status = await getTelegramStatus();
        return NextResponse.json(status);
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
