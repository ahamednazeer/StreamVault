import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { hashPassword, signToken, signRefreshToken } from '@/lib/auth';
import User from '@/models/User';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { username, email, password } = body;

        if (!username || !email || !password) {
            return NextResponse.json(
                { error: 'Username, email, and password are required' },
                { status: 400 }
            );
        }

        if (username.length < 3 || username.length > 30) {
            return NextResponse.json(
                { error: 'Username must be 3-30 characters' },
                { status: 400 }
            );
        }

        if (password.length < 6) {
            return NextResponse.json(
                { error: 'Password must be at least 6 characters' },
                { status: 400 }
            );
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return NextResponse.json(
                { error: 'Invalid email format' },
                { status: 400 }
            );
        }

        await connectDB();

        // Check existing
        const existingUser = await User.findOne({
            $or: [{ username }, { email: email.toLowerCase() }],
        });

        if (existingUser) {
            const field = existingUser.username === username ? 'Username' : 'Email';
            return NextResponse.json(
                { error: `${field} already exists` },
                { status: 409 }
            );
        }

        const passwordHash = await hashPassword(password);

        const user = await User.create({
            username,
            email: email.toLowerCase(),
            passwordHash,
            role: 'user',
        });

        const token = signToken(user._id.toString(), user.role);
        const refreshToken = signRefreshToken(user._id.toString());

        // Save refresh token
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
        }, { status: 201 });

    } catch (error: any) {
        console.error('Signup error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
