import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/streamvault';

interface MongooseCache {
    conn: typeof mongoose | null;
    promise: Promise<typeof mongoose> | null;
}

declare global {
    var mongooseCache: MongooseCache | undefined;
    var mongooseListenersAttached: boolean | undefined;
}

const cached: MongooseCache = global.mongooseCache || { conn: null, promise: null };

if (!global.mongooseCache) {
    global.mongooseCache = cached;
}

function getMongoMeta(uri: string) {
    const hostMatch = uri.match(/@([^/?]+)/);
    const host = hostMatch ? hostMatch[1] : 'unknown';
    const dbMatch = uri.match(/\/([^/?]+)(\?|$)/);
    const dbName = dbMatch ? dbMatch[1] : 'unknown';
    return { host, dbName };
}

function attachMongooseListeners() {
    if (global.mongooseListenersAttached) return;
    global.mongooseListenersAttached = true;

    mongoose.connection.on('connected', () => {
        const meta = getMongoMeta(MONGODB_URI);
        console.info('[db] connected', meta);
    });
    mongoose.connection.on('disconnected', () => {
        console.warn('[db] disconnected');
    });
    mongoose.connection.on('reconnected', () => {
        console.info('[db] reconnected');
    });
    mongoose.connection.on('error', (err) => {
        console.error('[db] connection error', { message: err?.message || String(err) });
    });
}

export async function connectDB() {
    if (cached.conn) return cached.conn;

    attachMongooseListeners();

    if (!cached.promise) {
        const meta = getMongoMeta(MONGODB_URI);
        console.info('[db] connecting', meta);

        cached.promise = mongoose.connect(MONGODB_URI, {
            bufferCommands: false,
            serverSelectionTimeoutMS: 10000,
            socketTimeoutMS: 45000,
            connectTimeoutMS: 10000,
            maxPoolSize: 10,
        });
    }

    try {
        cached.conn = await cached.promise;
    } catch (e) {
        cached.promise = null;
        throw e;
    }

    return cached.conn;
}
