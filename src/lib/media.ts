export function shouldUseHls(mimeType?: string, codec?: string): boolean {
    const mime = (mimeType || '').toLowerCase();
    const c = (codec || '').toLowerCase();

    if (mime.includes('matroska') || mime.includes('webm')) return true;

    if (c.includes('hevc') || c.includes('h265') || c.includes('hev1') || c.includes('hvc1')) {
        return true;
    }
    if (c.includes('av1')) return true;

    if (mime.includes('mp4')) return false;

    return true;
}

