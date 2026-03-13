import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connectDB } from '@/lib/db';
import { getRedis } from '@/lib/redis';

const DEFAULT_TIMEOUT_MS = 3000;

function timeout<T>(ms: number, label: string): Promise<T> {
    return new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
    });
}

async function checkMongo() {
    const startedAt = Date.now();
    try {
        await connectDB();

        if (mongoose.connection.db) {
            await Promise.race([
                mongoose.connection.db.admin().ping(),
                timeout(DEFAULT_TIMEOUT_MS, 'mongo ping'),
            ]);
        }

        return {
            ok: true,
            latencyMs: Date.now() - startedAt,
            state: mongoose.connection.readyState,
        };
    } catch (error: any) {
        return {
            ok: false,
            latencyMs: Date.now() - startedAt,
            state: mongoose.connection.readyState,
            error: error?.message || String(error),
        };
    }
}

async function checkRedis() {
    const startedAt = Date.now();
    try {
        const redis = getRedis();
        await Promise.race([
            redis.ping(),
            timeout(DEFAULT_TIMEOUT_MS, 'redis ping'),
        ]);
        return {
            ok: true,
            latencyMs: Date.now() - startedAt,
        };
    } catch (error: any) {
        return {
            ok: false,
            latencyMs: Date.now() - startedAt,
            error: error?.message || String(error),
        };
    }
}

// GET /api/health
export async function GET() {
    const startedAt = Date.now();
    const [mongo, redis] = await Promise.all([checkMongo(), checkRedis()]);

    const ok = mongo.ok && redis.ok;
    const status = ok ? 200 : 503;

    return NextResponse.json(
        {
            ok,
            durationMs: Date.now() - startedAt,
            timestamp: new Date().toISOString(),
            mongo,
            redis,
        },
        { status }
    );
}
