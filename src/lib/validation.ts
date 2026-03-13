import path from 'path';
import mime from 'mime-types';
import { getEffectiveMaxUploadSizeBytes } from './limits';

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
    // Check extension
    const ext = path.extname(fileName).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
        return {
            valid: false,
            error: `Invalid file format. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`,
        };
    }

    // Check MIME type
    if (mimeType) {
        const normalizedMime = mimeType.toLowerCase();
        if (!ALLOWED_MIMES.includes(normalizedMime)) {
            return {
                valid: false,
                error: `Invalid MIME type: ${mimeType}. Allowed: ${ALLOWED_MIMES.join(', ')}`,
            };
        }
    } else {
        // Infer from extension
        const inferredMime = mime.lookup(ext);
        if (inferredMime && !ALLOWED_MIMES.includes(inferredMime)) {
            return {
                valid: false,
                error: `Invalid file type. Allowed: mp4, mkv, webm`,
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
