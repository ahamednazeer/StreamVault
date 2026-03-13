import { randomUUID } from 'crypto';
import { initClient, saveClientSession, resetClientSession } from './telegram';

const API_ID = parseInt(process.env.TELEGRAM_API_ID || '0', 10);
const API_HASH = process.env.TELEGRAM_API_HASH || '';
const LOGIN_TTL_MS = 10 * 60 * 1000;
const CONNECT_TIMEOUT_MS = Number.parseInt(process.env.TELEGRAM_CONNECT_TIMEOUT_MS || '30000', 10);
const SEND_CODE_TIMEOUT_MS = Number.parseInt(process.env.TELEGRAM_SEND_CODE_TIMEOUT_MS || '60000', 10);
const VERIFY_TIMEOUT_MS = Number.parseInt(process.env.TELEGRAM_VERIFY_TIMEOUT_MS || '30000', 10);

export interface PendingLogin {
    phoneNumber: string;
    phoneCodeHash: string;
    createdAt: number;
}

export interface TelegramUserInfo {
    id?: string | number;
    username?: string;
    phone?: string;
    firstName?: string;
    lastName?: string;
}

declare global {
    var telegramLoginStore: Map<string, PendingLogin> | undefined;
    var telegramLoginInProgress: boolean | undefined;
}

function getLoginStore(): Map<string, PendingLogin> {
    if (!global.telegramLoginStore) {
        global.telegramLoginStore = new Map();
    }
    return global.telegramLoginStore;
}

function pruneLoginStore(store: Map<string, PendingLogin>) {
    const now = Date.now();
    for (const [key, value] of store.entries()) {
        if (now - value.createdAt > LOGIN_TTL_MS) {
            store.delete(key);
        }
    }
}

function ensureApiCredentials() {
    if (!API_ID || !API_HASH) {
        throw new Error('Missing TELEGRAM_API_ID or TELEGRAM_API_HASH');
    }
}

function normalizePhone(phone: string): string {
    const cleaned = phone.replace(/[^\d+]/g, '');
    if (!cleaned) return '';
    if (cleaned.startsWith('+')) return cleaned;
    return `+${cleaned}`;
}

function maskPhone(phone: string): string {
    if (!phone) return 'unknown';
    const last = phone.slice(-2);
    return `${phone.slice(0, 2)}***${last}`;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) => {
            setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
        }),
    ]);
}

async function getMeInfo() {
    const client = await initClient();
    try {
        const me = await client.getMe();
        if (!me) return null;
        return {
            id: me.id.toString(),
            username: me.username || undefined,
            phone: me.phoneNumber || undefined,
            firstName: me.firstName,
            lastName: me.lastName || undefined,
        } satisfies TelegramUserInfo;
    } catch {
        return null;
    }
}

export async function getTelegramStatus() {
    const client = await initClient();
    try {
        const user = await getMeInfo();
        return { authorized: !!user, user };
    } catch {
        return { authorized: false, user: null as TelegramUserInfo | null };
    }
}

export async function startTelegramLogin(phoneNumber: string, forceSMS = false) {
    ensureApiCredentials();
    if (global.telegramLoginInProgress) {
        throw new Error('Telegram login already in progress');
    }
    global.telegramLoginInProgress = true;

    try {
        const normalizedPhone = normalizePhone(phoneNumber);
        if (!normalizedPhone || normalizedPhone === '+') {
            throw new Error('Invalid phone number');
        }

        const client = await withTimeout(initClient(), CONNECT_TIMEOUT_MS, 'telegram connect');

        const me = await getMeInfo();
        if (me) {
            return { status: 'authorized' as const, loginId: null, isCodeViaApp: true, user: me };
        }

        console.info('[telegram] sendCode start', { phone: maskPhone(normalizedPhone) });
        // Correct return type handling for mtcute sendCode
        const sentCode = await withTimeout(
            client.sendCode({
                phone: normalizedPhone,
            }),
            SEND_CODE_TIMEOUT_MS,
            'telegram sendCode'
        );
        
        const phoneCodeHash = (sentCode as any).phoneCodeHash;
        const deliveryType = (sentCode as any).type;

        console.info('[telegram] sendCode ok', { deliveryType });

        const store = getLoginStore();
        pruneLoginStore(store);
        const loginId = randomUUID();
        store.set(loginId, {
            phoneNumber: normalizedPhone,
            phoneCodeHash,
            createdAt: Date.now(),
        });

        return { 
            status: 'code_sent' as const, 
            loginId, 
            isCodeViaApp: deliveryType === 'app', // mtcute uses 'app' for app-delivered codes
            user: null 
        };
    } finally {
        global.telegramLoginInProgress = false;
    }
}

export async function verifyTelegramCode(loginId: string, phoneCode: string) {
    ensureApiCredentials();
    const store = getLoginStore();
    pruneLoginStore(store);
    const pending = store.get(loginId);
    if (!pending) {
        throw new Error('Login expired. Please start again.');
    }

    const client = await withTimeout(initClient(), CONNECT_TIMEOUT_MS, 'telegram connect');
    try {
        await withTimeout(
            (client as any).signIn({
                phone: pending.phoneNumber,
                phoneCodeHash: pending.phoneCodeHash,
                code: phoneCode,
            }),
            VERIFY_TIMEOUT_MS,
            'telegram verify code'
        );

        await saveClientSession();
        store.delete(loginId);

        const user = await getMeInfo();
        return { status: 'authorized' as const, user };
    } catch (error: any) {
        if (error?.message?.includes('SESSION_PASSWORD_NEEDED') || error?.constructor?.name?.includes('PasswordNeeded')) {
            return { status: 'password_required' as const };
        }
        throw error;
    }
}

export async function verifyTelegramPassword(loginId: string, password: string) {
    ensureApiCredentials();
    const store = getLoginStore();
    pruneLoginStore(store);
    const pending = store.get(loginId);
    if (!pending) {
        throw new Error('Login expired. Please start again.');
    }

    const client = await withTimeout(initClient(), CONNECT_TIMEOUT_MS, 'telegram connect');
    
    await withTimeout(
        (client as any).signIn({
            password
        }),
        VERIFY_TIMEOUT_MS,
        'telegram verify password'
    );

    await saveClientSession();
    store.delete(loginId);

    const user = await getMeInfo();
    return { status: 'authorized' as const, user };
}

export async function logoutTelegram() {
    await resetClientSession();
    return { status: 'logged_out' as const };
}
