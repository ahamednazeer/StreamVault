const TELEGRAM_MAX_PARTS = 4000;
const TELEGRAM_PART_SIZE = 512 * 1024; // 512KB
const TELEGRAM_MAX_BYTES = TELEGRAM_MAX_PARTS * TELEGRAM_PART_SIZE; // 2,097,152,000 bytes
const DEFAULT_MAX_UPLOAD_BYTES = 20 * 1024 * 1024 * 1024; // 20GB

export function getTelegramMaxUploadSizeBytes(): number {
    return TELEGRAM_MAX_BYTES;
}

export function getEffectiveMaxUploadSizeBytes(): number {
    const envMax = parseInt(process.env.MAX_UPLOAD_SIZE || `${DEFAULT_MAX_UPLOAD_BYTES}`);
    if (Number.isNaN(envMax) || envMax <= 0) return DEFAULT_MAX_UPLOAD_BYTES;
    return envMax;
}

export function isOverTelegramLimit(size: number): boolean {
    return size > TELEGRAM_MAX_BYTES;
}
