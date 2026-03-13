import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { validateVideoFile } from '@/lib/validation';
import { enqueueUpload } from '@/lib/uploadQueue';
import Video from '@/models/Video';
import fs from 'fs';
import path from 'path';
import mime from 'mime-types';
import Busboy from 'busboy';
import { Readable } from 'stream';
import { getEffectiveMaxUploadSizeBytes } from '@/lib/limits';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './tmp/uploads';
const MAX_UPLOAD_SIZE = getEffectiveMaxUploadSizeBytes();

function ensureUploadDir() {
    if (!fs.existsSync(UPLOAD_DIR)) {
        fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    }
}

function sanitizeFileName(name: string): string {
    return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

async function parseMultipartUpload(request: NextRequest): Promise<{
    filePath: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    fields: Record<string, string>;
}> {
    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
        throw new Error('Invalid content type');
    }

    const fields: Record<string, string> = {};
    let filePath = '';
    let fileName = '';
    let mimeType = '';
    let fileSize = 0;
    let fileWritePromise: Promise<void> | null = null;
    let fileTruncated = false;

    const bb = Busboy({
        headers: { 'content-type': contentType },
        limits: { fileSize: MAX_UPLOAD_SIZE },
    });

    bb.on('field', (name, value) => {
        fields[name] = value;
    });

    bb.on('file', (name, file, info) => {
        if (name !== 'file') {
            file.resume();
            return;
        }

        fileName = info.filename || 'upload.bin';
        mimeType = info.mimeType || '';

        const tempFileName = `${Date.now()}_${sanitizeFileName(fileName)}`;
        filePath = path.join(UPLOAD_DIR, tempFileName);

        const writeStream = fs.createWriteStream(filePath);
        file.on('data', (data) => {
            fileSize += data.length;
        });
        file.on('limit', () => {
            fileTruncated = true;
        });
        fileWritePromise = new Promise((resolve, reject) => {
            writeStream.on('finish', resolve);
            writeStream.on('error', reject);
            file.on('error', reject);
        });

        file.pipe(writeStream);
    });

    const body = request.body;
    if (!body) {
        throw new Error('Missing request body');
    }

    const nodeStream = Readable.fromWeb(body as any);
    const finished = new Promise<void>((resolve, reject) => {
        bb.on('finish', resolve);
        bb.on('error', reject);
    });

    nodeStream.pipe(bb);
    await finished;
    if (fileWritePromise) await fileWritePromise;

    if (!filePath) {
        throw new Error('No file provided');
    }
    if (fileTruncated) {
        if (filePath && fs.existsSync(filePath)) {
            try { fs.unlinkSync(filePath); } catch { }
        }
        throw new Error('File too large');
    }

    return { filePath, fileName, fileSize, mimeType, fields };
}

// GET /api/videos — list user's videos
export async function GET(request: NextRequest) {
    try {
        const user = await getAuthUser(request);
        await connectDB();

        const url = new URL(request.url);
        const page = parseInt(url.searchParams.get('page') || '1');
        const limit = parseInt(url.searchParams.get('limit') || '20');
        const search = url.searchParams.get('search') || '';
        const skip = (page - 1) * limit;

        const query: any = { userId: user._id };
        if (search) {
            query.$text = { $search: search };
        }

        const [videos, total] = await Promise.all([
            Video.find(query)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Video.countDocuments(query),
        ]);

        return NextResponse.json({
            videos,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit),
            },
        });

    } catch (error: any) {
        if (error.message === 'No token provided' || error.message === 'User not found') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        console.error('Get videos error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

// POST /api/videos — upload new video
export async function POST(request: NextRequest) {
    try {
        const user = await getAuthUser(request);
        await connectDB();
        ensureUploadDir();
        let parsed;
        try {
            parsed = await parseMultipartUpload(request);
        } catch (err: any) {
            return NextResponse.json({ error: err?.message || 'Invalid upload' }, { status: 400 });
        }

        const { filePath, fileName, fileSize, mimeType, fields } = parsed;
        const title = fields.title || '';
        const description = fields.description || '';

        if (!title) {
            if (filePath && fs.existsSync(filePath)) {
                try { fs.unlinkSync(filePath); } catch { }
            }
            return NextResponse.json({ error: 'Title is required' }, { status: 400 });
        }

        const ext = path.extname(fileName).toLowerCase();
        const inferredMime = mime.lookup(ext);
        const normalizedMime = (mimeType && mimeType !== 'application/octet-stream')
            ? mimeType
            : (typeof inferredMime === 'string' ? inferredMime : 'video/mp4');

        // Server-side validation
        const validation = validateVideoFile(fileName, fileSize, normalizedMime);
        if (!validation.valid) {
            if (filePath && fs.existsSync(filePath)) {
                try { fs.unlinkSync(filePath); } catch { }
            }
            return NextResponse.json({ error: validation.error }, { status: 400 });
        }

        // Create video record
        const video = await Video.create({
            userId: user._id,
            title,
            description,
            mimeType: normalizedMime,
            fileSize: fileSize,
            status: 'queued',
            uploadProgress: 0,
            uploadAttempts: 0,
            tempFilePath: filePath,
        });

        // Enqueue upload job
        await enqueueUpload({
            videoId: video._id.toString(),
            filePath: filePath,
            fileName: fileName,
        });

        return NextResponse.json({
            video: {
                id: video._id,
                title: video.title,
                status: video.status,
            },
            message: 'Video queued for upload',
        }, { status: 202 });

    } catch (error: any) {
        if (error.message === 'No token provided' || error.message === 'User not found') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        console.error('Upload error:', error);
        return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
    }
}
