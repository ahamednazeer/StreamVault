import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IVideo extends Document {
    _id: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
    title: string;
    description: string;
    telegramChannelId: string;
    telegramMessageId: number;
    parts: {
        index: number;
        telegramChannelId: string;
        telegramMessageId: number;
        size: number;
        startByte: number;
        endByte: number;
    }[];
    storageChannelIndex: number;
    fileSize: number;
    duration: number;
    resolution: string;
    codec: string;
    mimeType: string;
    thumbnailPath: string;
    status: 'queued' | 'uploading' | 'processing' | 'ready' | 'failed' | 'canceled';
    uploadProgress: number;
    uploadAttempts: number;
    lastError: string | null;
    uploadStartedAt: Date | null;
    uploadCompletedAt: Date | null;
    canceledAt: Date | null;
    tempFilePath: string;
    createdAt: Date;
}

const videoSchema = new Schema<IVideo>({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    title: {
        type: String,
        required: true,
        trim: true,
        maxlength: 200,
    },
    description: {
        type: String,
        default: '',
        maxlength: 2000,
    },
    telegramChannelId: {
        type: String,
        default: '',
    },
    telegramMessageId: {
        type: Number,
        default: 0,
    },
    parts: {
        type: [
            {
                index: { type: Number, required: true },
                telegramChannelId: { type: String, required: true },
                telegramMessageId: { type: Number, required: true },
                size: { type: Number, required: true },
                startByte: { type: Number, required: true },
                endByte: { type: Number, required: true },
            },
        ],
        default: [],
    },
    storageChannelIndex: {
        type: Number,
        default: 0,
    },
    fileSize: {
        type: Number,
        default: 0,
    },
    duration: {
        type: Number,
        default: 0,
    },
    resolution: {
        type: String,
        default: '',
    },
    codec: {
        type: String,
        default: '',
    },
    mimeType: {
        type: String,
        default: 'video/mp4',
    },
    thumbnailPath: {
        type: String,
        default: '',
    },
    status: {
        type: String,
        enum: ['queued', 'uploading', 'processing', 'ready', 'failed', 'canceled'],
        default: 'queued',
    },
    uploadProgress: {
        type: Number,
        default: 0,
        min: 0,
        max: 100,
    },
    uploadAttempts: {
        type: Number,
        default: 0,
    },
    lastError: {
        type: String,
        default: null,
    },
    uploadStartedAt: {
        type: Date,
        default: null,
    },
    uploadCompletedAt: {
        type: Date,
        default: null,
    },
    canceledAt: {
        type: Date,
        default: null,
    },
    tempFilePath: {
        type: String,
        default: '',
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
});

// Text index for search
videoSchema.index({ title: 'text', description: 'text' });

const Video: Model<IVideo> = mongoose.models.Video || mongoose.model<IVideo>('Video', videoSchema);
export default Video;
