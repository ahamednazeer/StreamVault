import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, requireAdmin } from '@/lib/auth';
import { verifyTelegramCode } from '@/lib/telegramAdmin';

export const runtime = 'nodejs';

// POST /api/admin/telegram/login/verify
export async function POST(request: NextRequest) {
    try {
        const user = await getAuthUser(request);
        requireAdmin(user);

        const body = await request.json().catch(() => ({}));
        const loginId = String(body.loginId || '').trim();
        const phoneCode = String(body.phoneCode || '').trim();

        if (!loginId || !phoneCode) {
            return NextResponse.json({ error: 'loginId and phoneCode required' }, { status: 400 });
        }

        const result = await verifyTelegramCode(loginId, phoneCode);
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
