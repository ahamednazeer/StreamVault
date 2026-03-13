import fs from 'fs';
import path from 'path';
import input from 'input';
import { TelegramClient } from '@mtcute/node';
import { MemoryStorage } from '@mtcute/core';

const API_ID = Number.parseInt(process.env.TELEGRAM_API_ID || '0', 10);
const API_HASH = process.env.TELEGRAM_API_HASH || '';
const SESSION_FILE = path.join(process.cwd(), 'telegram.session');

if (!API_ID || !API_HASH) {
    console.error('Missing TELEGRAM_API_ID or TELEGRAM_API_HASH in environment.');
    process.exit(1);
}

const existingSession = fs.existsSync(SESSION_FILE)
    ? fs.readFileSync(SESSION_FILE, 'utf-8').trim()
    : '';

const client = new TelegramClient({
    apiId: API_ID,
    apiHash: API_HASH,
    storage: new MemoryStorage(),
});

try {
    if (existingSession) {
        await client.importSession(existingSession);
    }

    const user = await client.start({
        phone: () => input.text('Phone number (with country code): '),
        code: () => input.text('Telegram code: '),
        password: () => input.password('2FA password (if enabled): '),
    });

    console.log(`Logged in as ${user.displayName || user.firstName}`);

    const session = await client.exportSession();
    fs.writeFileSync(SESSION_FILE, session, 'utf-8');
    console.log('Saved generated session string to telegram.session');
    process.exit(0);
} catch (err) {
    console.error('Login error:', err?.message || err);
    process.exit(1);
}
