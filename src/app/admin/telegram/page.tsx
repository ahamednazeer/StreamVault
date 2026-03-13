'use client';

import React, { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { DataCard } from '@/components/DataCard';
import { HardDrives, ShieldCheck, Pulse, WarningCircle, Key } from '@phosphor-icons/react';

type TelegramUser = {
    id?: string | number;
    username?: string;
    phone?: string;
    firstName?: string;
    lastName?: string;
};

type StatusResponse = {
    authorized: boolean;
    user: TelegramUser | null;
};

export default function AdminTelegramPage() {
    const [loading, setLoading] = useState(true);
    const [status, setStatus] = useState<StatusResponse | null>(null);
    const [phoneNumber, setPhoneNumber] = useState('');
    const [forceSMS, setForceSMS] = useState(false);
    const [loginId, setLoginId] = useState<string | null>(null);
    const [phoneCode, setPhoneCode] = useState('');
    const [password, setPassword] = useState('');
    const [step, setStep] = useState<'phone' | 'code' | 'password'>('phone');
    const [error, setError] = useState('');
    const [info, setInfo] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [loggingOut, setLoggingOut] = useState(false);

    const refreshStatus = async () => {
        setLoading(true);
        setError('');
        try {
            const data = await api.getTelegramStatus();
            setStatus(data);
            if (!data.authorized) {
                setStep('phone');
            }
        } catch (err: any) {
            setError(err?.message || 'Failed to load Telegram status');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        refreshStatus();
    }, []);

    const handleStart = async () => {
        if (!phoneNumber.trim()) {
            setError('Phone number is required');
            return;
        }
        setSubmitting(true);
        setError('');
        setInfo('');
        try {
            const result = await api.startTelegramLogin(phoneNumber.trim(), forceSMS);
            if (result.status === 'authorized') {
                setStatus({ authorized: true, user: result.user || null });
                setStep('phone');
                setLoginId(null);
                setInfo('Already authorized.');
                return;
            }
            setLoginId(result.loginId);
            setStep('code');
            setInfo(result.isCodeViaApp ? 'Code sent via Telegram app.' : 'Code sent.');
        } catch (err: any) {
            setError(err?.message || 'Failed to send code');
        } finally {
            setSubmitting(false);
        }
    };

    const handleVerifyCode = async () => {
        if (!loginId) {
            setError('Login session expired. Please start again.');
            setStep('phone');
            return;
        }
        if (!phoneCode.trim()) {
            setError('Enter the code you received');
            return;
        }
        setSubmitting(true);
        setError('');
        setInfo('');
        try {
            const result = await api.verifyTelegramLogin(loginId, phoneCode.trim());
            if (result.status === 'password_required') {
                setStep('password');
                setInfo('Two-factor password required.');
                return;
            }
            if (result.status === 'authorized') {
                setStatus({ authorized: true, user: result.user || null });
                setStep('phone');
                setLoginId(null);
                setPhoneCode('');
                setPassword('');
                setInfo('Telegram connected.');
            }
        } catch (err: any) {
            setError(err?.message || 'Failed to verify code');
        } finally {
            setSubmitting(false);
        }
    };

    const handleVerifyPassword = async () => {
        if (!loginId) {
            setError('Login session expired. Please start again.');
            setStep('phone');
            return;
        }
        if (!password.trim()) {
            setError('Password is required');
            return;
        }
        setSubmitting(true);
        setError('');
        setInfo('');
        try {
            const result = await api.verifyTelegramPassword(loginId, password.trim());
            if (result.status === 'authorized') {
                setStatus({ authorized: true, user: result.user || null });
                setStep('phone');
                setLoginId(null);
                setPhoneCode('');
                setPassword('');
                setInfo('Telegram connected.');
            }
        } catch (err: any) {
            setError(err?.message || 'Failed to verify password');
        } finally {
            setSubmitting(false);
        }
    };

    const handleLogout = async () => {
        setLoggingOut(true);
        setError('');
        setInfo('');
        try {
            await api.logoutTelegram();
            setStatus({ authorized: false, user: null });
            setLoginId(null);
            setPhoneCode('');
            setPassword('');
            setStep('phone');
            setInfo('Telegram session cleared.');
        } catch (err: any) {
            setError(err?.message || 'Failed to log out');
        } finally {
            setLoggingOut(false);
        }
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center h-64 gap-4">
                <div className="relative">
                    <div className="w-12 h-12 rounded-full border-2 border-slate-700 border-t-violet-500 animate-spin" />
                    <Pulse size={24} className="absolute inset-0 m-auto text-violet-400 animate-pulse" />
                </div>
                <p className="text-slate-500 font-mono text-xs uppercase tracking-widest animate-pulse">
                    Loading Telegram Status...
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-8">
            <div>
                <h1 className="text-2xl font-chivo font-bold uppercase tracking-wider flex items-center gap-3">
                    <ShieldCheck size={28} weight="duotone" className="text-violet-400" />
                    Telegram Auth
                </h1>
                <p className="text-slate-500 mt-1">Connect the Telegram account used for uploads</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <DataCard
                    title="Status"
                    value={status?.authorized ? 'Connected' : 'Not Connected'}
                    icon={status?.authorized ? ShieldCheck : WarningCircle}
                    className={status?.authorized ? 'border-emerald-700/50' : 'border-yellow-700/50'}
                />
                <DataCard
                    title="Username"
                    value={status?.user?.username || '-'}
                    icon={Key}
                />
                <DataCard
                    title="Phone"
                    value={status?.user?.phone ? `+${status.user.phone}` : '-'}
                    icon={HardDrives}
                />
            </div>

            <div className="bg-slate-800/40 border border-slate-700/60 rounded-sm p-6 space-y-4">
                <h3 className="text-sm font-mono text-slate-400 uppercase tracking-widest">Admin Login</h3>

                {info && (
                    <div className="bg-emerald-950/50 border border-emerald-800 rounded-sm p-3 text-sm text-emerald-300">
                        {info}
                    </div>
                )}

                {error && (
                    <div className="bg-red-950/50 border border-red-800 rounded-sm p-3 text-sm text-red-400">
                        {error}
                    </div>
                )}

                {step === 'phone' && (
                    <div className="space-y-3">
                        <div>
                            <label className="block text-slate-400 text-xs uppercase tracking-wider mb-2 font-mono">
                                Phone Number
                            </label>
                            <input
                                type="text"
                                value={phoneNumber}
                                onChange={(e) => setPhoneNumber(e.target.value)}
                                className="input-modern"
                                placeholder="+1 555 123 4567"
                                disabled={submitting}
                            />
                        </div>
                        <label className="flex items-center gap-2 text-xs font-mono text-slate-400">
                            <input
                                type="checkbox"
                                checked={forceSMS}
                                onChange={(e) => setForceSMS(e.target.checked)}
                                disabled={submitting}
                            />
                            Send code via SMS (if Telegram app delivery fails)
                        </label>
                        <button
                            onClick={handleStart}
                            disabled={submitting}
                            className="btn-primary"
                        >
                            {submitting ? 'Sending...' : 'Send Code'}
                        </button>
                        {status?.authorized && (
                            <button
                                onClick={handleLogout}
                                disabled={loggingOut}
                                className="btn-secondary"
                            >
                                {loggingOut ? 'Logging out...' : 'Logout Telegram'}
                            </button>
                        )}
                    </div>
                )}

                {step === 'code' && (
                    <div className="space-y-3">
                        <div>
                            <label className="block text-slate-400 text-xs uppercase tracking-wider mb-2 font-mono">
                                Telegram Code
                            </label>
                            <input
                                type="text"
                                value={phoneCode}
                                onChange={(e) => setPhoneCode(e.target.value)}
                                className="input-modern"
                                placeholder="12345"
                                disabled={submitting}
                            />
                        </div>
                        <div className="flex gap-3">
                            <button
                                onClick={() => setStep('phone')}
                                disabled={submitting}
                                className="btn-secondary"
                            >
                                Change Number
                            </button>
                            {status?.authorized && (
                                <button
                                    onClick={handleLogout}
                                    disabled={loggingOut}
                                    className="btn-secondary"
                                >
                                    {loggingOut ? 'Logging out...' : 'Logout Telegram'}
                                </button>
                            )}
                            <button
                                onClick={handleVerifyCode}
                                disabled={submitting}
                                className="btn-primary"
                            >
                                {submitting ? 'Verifying...' : 'Verify Code'}
                            </button>
                        </div>
                    </div>
                )}

                {step === 'password' && (
                    <div className="space-y-3">
                        <div>
                            <label className="block text-slate-400 text-xs uppercase tracking-wider mb-2 font-mono">
                                2FA Password
                            </label>
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="input-modern"
                                placeholder="Telegram 2FA password"
                                disabled={submitting}
                            />
                        </div>
                        <button
                            onClick={handleVerifyPassword}
                            disabled={submitting}
                            className="btn-primary"
                        >
                            {submitting ? 'Verifying...' : 'Verify Password'}
                        </button>
                        {status?.authorized && (
                            <button
                                onClick={handleLogout}
                                disabled={loggingOut}
                                className="btn-secondary"
                            >
                                {loggingOut ? 'Logging out...' : 'Logout Telegram'}
                            </button>
                        )}
                    </div>
                )}

                <p className="text-xs text-slate-500 font-mono">
                    The account must be an admin/member of all configured channels to upload.
                </p>
            </div>
        </div>
    );
}
