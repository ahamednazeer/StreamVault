import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { comparePassword, signToken, signRefreshToken } from '@/lib/auth';
import User from '@/models/User';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { email, password } = body;

        if (!email || !password) {
            return NextResponse.json(
                { error: 'Email and password are required' },
                { status: 400 }
            );
        }

        await connectDB();

        const user = await User.findOne({ email: email.toLowerCase() });
        if (!user) {
            return NextResponse.json(
                { error: 'Invalid credentials' },
                { status: 401 }
            );
        }

        const isMatch = await comparePassword(password, user.passwordHash);
        if (!isMatch) {
            return NextResponse.json(
                { error: 'Invalid credentials' },
                { status: 401 }
            );
        }

        const token = signToken(user._id.toString(), user.role);
        const refreshToken = signRefreshToken(user._id.toString());

        // Update refresh token
        user.refreshToken = refreshToken;
        await user.save();

        return NextResponse.json({
            token,
            refreshToken,
            user: {
                id: user._id,
                username: user.username,
                email: user.email,
                role: user.role,
                createdAt: user.createdAt,
            },
        });

    } catch (error: any) {
        console.error('Login error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
