declare global {
    var uploadWorkerStarted: boolean | undefined;
}

export const runtime = 'nodejs';

function shouldStartWorker(): boolean {
    const explicit = process.env.ENABLE_UPLOAD_WORKER;
    if (explicit === 'true') return true;
    if (explicit === 'false') return false;
    return process.env.NODE_ENV !== 'production';
}

export async function register() {
    if (process.env.NEXT_RUNTIME === 'edge') {
        return;
    }

    if (!shouldStartWorker()) {
        console.info('[worker] upload worker disabled (ENABLE_UPLOAD_WORKER)');
        return;
    }

    if (global.uploadWorkerStarted) return;
    global.uploadWorkerStarted = true;

    try {
        const { startUploadWorker } = await import('./lib/uploadQueue');
        startUploadWorker();
        console.info('[worker] upload worker started');
    } catch (error: any) {
        global.uploadWorkerStarted = false;
        console.error('[worker] upload worker failed to start', {
            message: error?.message || String(error),
        });
    }
}
