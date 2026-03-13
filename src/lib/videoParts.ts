export type VideoPart = {
    index: number;
    telegramChannelId: string;
    telegramMessageId: number;
    size: number;
    startByte: number;
    endByte: number;
};

export function getVideoParts(video: any): VideoPart[] {
    if (Array.isArray(video?.parts) && video.parts.length > 0) {
        return [...video.parts].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    }

    if (video?.telegramChannelId && video?.telegramMessageId && video?.fileSize) {
        const total = video.fileSize;
        return [{
            index: 0,
            telegramChannelId: video.telegramChannelId,
            telegramMessageId: video.telegramMessageId,
            size: total,
            startByte: 0,
            endByte: total > 0 ? total - 1 : 0,
        }];
    }

    return [];
}

export function getTotalSize(video: any, parts?: VideoPart[]): number | null {
    if (typeof video?.fileSize === 'number' && video.fileSize > 0) {
        return video.fileSize;
    }
    const list = parts || getVideoParts(video);
    if (list.length === 0) return null;
    const last = list[list.length - 1];
    if (typeof last.endByte === 'number') {
        return last.endByte + 1;
    }
    return list.reduce((sum, p) => sum + (p.size || 0), 0);
}

