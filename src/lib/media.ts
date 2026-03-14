export function isHlsEnabled(): boolean {
    const flag = process.env.NEXT_PUBLIC_ENABLE_HLS ?? process.env.ENABLE_HLS;
    if (!flag) return false;
    return flag === 'true';
}

export function isMkvRemuxEnabled(): boolean {
    const flag = process.env.NEXT_PUBLIC_ENABLE_MKV_REMUX ?? process.env.ENABLE_MKV_REMUX;
    if (flag === 'false') return false;
    return true;
}

export function shouldUseHls(mimeType?: string, codec?: string): boolean {
    if (!isHlsEnabled()) return false;
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
