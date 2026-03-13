const API_BASE = '/api';

class ApiClient {
    private token: string | null = null;
    private refreshToken: string | null = null;

    constructor() {
        if (typeof window !== 'undefined') {
            this.token = localStorage.getItem('sv_token');
            this.refreshToken = localStorage.getItem('sv_refresh_token');
        }
    }

    getToken(): string | null {
        return this.token;
    }

    setToken(token: string, refreshToken?: string) {
        this.token = token;
        localStorage.setItem('sv_token', token);
        if (refreshToken) {
            this.refreshToken = refreshToken;
            localStorage.setItem('sv_refresh_token', refreshToken);
        }
    }

    clearToken() {
        this.token = null;
        this.refreshToken = null;
        localStorage.removeItem('sv_token');
        localStorage.removeItem('sv_refresh_token');
    }

    private async request(url: string, options: RequestInit = {}): Promise<any> {
        const headers: Record<string, string> = {
            ...(options.headers as Record<string, string> || {}),
        };

        if (this.token) {
            headers['Authorization'] = `Bearer ${this.token}`;
        }

        // Don't set content-type for FormData
        if (!(options.body instanceof FormData)) {
            headers['Content-Type'] = 'application/json';
        }

        const response = await fetch(`${API_BASE}${url}`, {
            ...options,
            headers,
        });

        // Try refresh on 401
        if (response.status === 401 && this.refreshToken) {
            const refreshed = await this.tryRefresh();
            if (refreshed) {
                headers['Authorization'] = `Bearer ${this.token}`;
                const retryResponse = await fetch(`${API_BASE}${url}`, {
                    ...options,
                    headers,
                });
                if (!retryResponse.ok) {
                    const error = await retryResponse.json().catch(() => ({}));
                    throw new Error(error.error || 'Request failed');
                }
                return retryResponse.json();
            }
            this.clearToken();
            window.location.href = '/';
            throw new Error('Session expired');
        }

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || `Request failed: ${response.status}`);
        }

        return response.json();
    }

    private async tryRefresh(): Promise<boolean> {
        try {
            const res = await fetch(`${API_BASE}/auth/refresh`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refreshToken: this.refreshToken }),
            });
            if (!res.ok) return false;
            const data = await res.json();
            this.token = data.token;
            localStorage.setItem('sv_token', data.token);
            return true;
        } catch {
            return false;
        }
    }

    // Auth
    async signup(username: string, email: string, password: string) {
        const data = await this.request('/auth/signup', {
            method: 'POST',
            body: JSON.stringify({ username, email, password }),
        });
        this.setToken(data.token, data.refreshToken);
        return data;
    }

    async login(email: string, password: string) {
        const data = await this.request('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, password }),
        });
        this.setToken(data.token, data.refreshToken);
        return data;
    }

    async getMe() {
        return this.request('/auth/me');
    }

    // Videos
    async getVideos(page = 1, search = '') {
        const params = new URLSearchParams({ page: String(page) });
        if (search) params.set('search', search);
        return this.request(`/videos?${params}`);
    }

    async uploadVideo(formData: FormData, onProgress?: (progress: number) => void) {
        // Use XMLHttpRequest for progress tracking
        return new Promise<any>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', `${API_BASE}/videos`);

            if (this.token) {
                xhr.setRequestHeader('Authorization', `Bearer ${this.token}`);
            }

            if (onProgress) {
                xhr.upload.onprogress = (e) => {
                    if (e.lengthComputable) {
                        onProgress(Math.round((e.loaded / e.total) * 100));
                    }
                };
            }

            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    resolve(JSON.parse(xhr.responseText));
                } else {
                    try {
                        const err = JSON.parse(xhr.responseText);
                        reject(new Error(err.error || 'Upload failed'));
                    } catch {
                        reject(new Error('Upload failed'));
                    }
                }
            };

            xhr.onerror = () => reject(new Error('Network error'));
            xhr.send(formData);
        });
    }

    async getVideo(id: string) {
        return this.request(`/videos/${id}`);
    }

    async getVideoProgress(id: string) {
        return this.request(`/videos/${id}/progress`);
    }

    async updateVideo(id: string, data: { title?: string; description?: string }) {
        return this.request(`/videos/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
        });
    }

    async deleteVideo(id: string) {
        return this.request(`/videos/${id}`, { method: 'DELETE' });
    }

    async cancelVideo(id: string) {
        return this.request(`/videos/${id}/cancel`, { method: 'POST' });
    }

    getStreamUrl(id: string): string {
        return `${API_BASE}/stream/${id}`;
    }

    getHlsUrl(id: string): string {
        return `${API_BASE}/stream/${id}/hls`;
    }

    // Admin
    async getAdminStats() {
        return this.request('/admin/stats');
    }

    async getAdminStorage() {
        return this.request('/admin/storage');
    }

    async getTelegramStatus() {
        return this.request('/admin/telegram/status');
    }

    async startTelegramLogin(phoneNumber: string, forceSMS = false) {
        return this.request('/admin/telegram/login/start', {
            method: 'POST',
            body: JSON.stringify({ phoneNumber, forceSMS }),
        });
    }

    async verifyTelegramLogin(loginId: string, phoneCode: string) {
        return this.request('/admin/telegram/login/verify', {
            method: 'POST',
            body: JSON.stringify({ loginId, phoneCode }),
        });
    }

    async verifyTelegramPassword(loginId: string, password: string) {
        return this.request('/admin/telegram/login/password', {
            method: 'POST',
            body: JSON.stringify({ loginId, password }),
        });
    }

    async logoutTelegram() {
        return this.request('/admin/telegram/logout', { method: 'POST' });
    }

    async getAdminUsers(page = 1) {
        return this.request(`/admin/users?page=${page}`);
    }

    async deleteUser(id: string) {
        return this.request(`/admin/users?id=${id}`, { method: 'DELETE' });
    }

    async getAdminVideos(page = 1) {
        return this.request(`/admin/videos?page=${page}`);
    }

    async adminDeleteVideo(id: string) {
        return this.request(`/admin/videos?id=${id}`, { method: 'DELETE' });
    }
}

export const api = new ApiClient();
