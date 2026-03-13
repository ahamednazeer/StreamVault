import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, requireAdmin } from '@/lib/auth';
import { verifyTelegramPassword } from '@/lib/telegramAdmin';

export const runtime = 'nodejs';

// POST /api/admin/telegram/login/password
export async function POST(request: NextRequest) {
    try {
        const user = await getAuthUser(request);
        requireAdmin(user);

        const body = await request.json().catch(() => ({}));
        const loginId = String(body.loginId || '').trim();
        const password = String(body.password || '').trim();

        if (!loginId || !password) {
            return NextResponse.json({ error: 'loginId and password required' }, { status: 400 });
        }

        const result = await verifyTelegramPassword(loginId, password);
        return NextResponse.json(result);
    } catch (error: any) {
        if (error.message === 'Admin access required') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
        if (error.message === 'No token provided') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        return NextResponse.json({ error: error?.message || 'Internal server error' }, { status: 500 });
    }
}
