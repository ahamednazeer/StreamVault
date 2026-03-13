import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { NextRequest } from 'next/server';
import { connectDB } from './db';
import User from '@/models/User';

const JWT_SECRET = process.env.JWT_SECRET || 'streamvault-secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const REFRESH_SECRET = JWT_SECRET + '-refresh';

export interface TokenPayload {
    userId: string;
    role: string;
}

export function signToken(userId: string, role: string): string {
    return jwt.sign({ userId, role }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions);
}

export function signRefreshToken(userId: string): string {
    return jwt.sign({ userId }, REFRESH_SECRET, { expiresIn: '30d' } as jwt.SignOptions);
}

export function verifyToken(token: string): TokenPayload {
    return jwt.verify(token, JWT_SECRET) as TokenPayload;
}

export function verifyRefreshToken(token: string): { userId: string } {
    return jwt.verify(token, REFRESH_SECRET) as { userId: string };
}

export async function hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 12);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
}

export async function getAuthUser(request: NextRequest) {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
        throw new Error('No token provided');
    }

    const token = authHeader.substring(7);
    const payload = verifyToken(token);

    await connectDB();
    const user = await User.findById(payload.userId).select('-passwordHash -refreshToken');
    if (!user) throw new Error('User not found');

    return user;
}

export function requireAdmin(user: any) {
    if (user.role !== 'admin') {
        throw new Error('Admin access required');
    }
}
