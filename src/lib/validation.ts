import path from 'path';
import mime from 'mime-types';
import { getEffectiveMaxUploadSizeBytes } from './limits';
import { isHlsEnabled, isMkvRemuxEnabled, isMkvTranscodeEnabled } from './media';

const ALLOWED_EXTENSIONS = ['.mp4', '.mkv', '.webm'];
const ALLOWED_MIMES = ['video/mp4', 'video/x-matroska', 'video/matroska', 'video/webm'];
const MAX_SIZE = getEffectiveMaxUploadSizeBytes();

export interface ValidationResult {
    valid: boolean;
    error?: string;
}

export function validateVideoFile(
    fileName: string,
    fileSize: number,
    mimeType?: string
): ValidationResult {
    const hlsEnabled = isHlsEnabled();
    const remuxEnabled = isMkvRemuxEnabled();
    const transcodeEnabled = isMkvTranscodeEnabled();
    const allowMkv = remuxEnabled || transcodeEnabled;
    const allowedExtensions = hlsEnabled ? ALLOWED_EXTENSIONS : (allowMkv ? ['.mp4', '.mkv'] : ['.mp4']);
    const allowedMimes = hlsEnabled ? ALLOWED_MIMES : (allowMkv ? ['video/mp4', 'video/x-matroska', 'video/matroska'] : ['video/mp4']);

    // Check extension
    const ext = path.extname(fileName).toLowerCase();
    if (!allowedExtensions.includes(ext)) {
        return {
            valid: false,
            error: hlsEnabled
                ? `Invalid file format. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`
                : (allowMkv
                    ? 'Invalid file format. Only MP4 or MKV is supported when HLS is disabled.'
                    : 'Invalid file format. Only MP4 is supported when HLS is disabled.'),
        };
    }

    // Check MIME type
    if (mimeType) {
        const normalizedMime = mimeType.toLowerCase();
        if (!allowedMimes.includes(normalizedMime)) {
            return {
                valid: false,
            error: hlsEnabled
                ? `Invalid MIME type: ${mimeType}. Allowed: ${ALLOWED_MIMES.join(', ')}`
                : (allowMkv
                    ? `Invalid MIME type: ${mimeType}. Only video/mp4 or Matroska is supported when HLS is disabled.`
                    : `Invalid MIME type: ${mimeType}. Only video/mp4 is supported when HLS is disabled.`),
            };
        }
    } else {
        // Infer from extension
        const inferredMime = mime.lookup(ext);
        if (inferredMime && !allowedMimes.includes(inferredMime)) {
            return {
                valid: false,
            error: hlsEnabled
                ? 'Invalid file type. Allowed: mp4, mkv, webm'
                : (allowMkv
                    ? 'Invalid file type. Only MP4 or MKV is supported when HLS is disabled.'
                    : 'Invalid file type. Only MP4 is supported when HLS is disabled.'),
            };
        }
    }

    // Check size
    if (fileSize > MAX_SIZE) {
        const maxGB = (MAX_SIZE / (1024 * 1024 * 1024)).toFixed(2);
        return {
            valid: false,
            error: `File too large. Maximum size: ${maxGB}GB`,
        };
    }

    if (fileSize === 0) {
        return { valid: false, error: 'File is empty' };
    }

    return { valid: true };
}
