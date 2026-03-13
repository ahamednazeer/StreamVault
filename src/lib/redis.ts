import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

declare global {
    var redisClient: Redis | undefined;
}

export function getRedis(): Redis {
    if (global.redisClient) return global.redisClient;

    global.redisClient = new Redis(REDIS_URL, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
    });

    return global.redisClient;
}
