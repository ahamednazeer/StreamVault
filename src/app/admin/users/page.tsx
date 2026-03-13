'use client';

import React, { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import DataTable from '@/components/DataTable';
import { StatusBadge } from '@/components/StatusBadge';
import Modal from '@/components/Modal';
import { Users, Pulse, Trash } from '@phosphor-icons/react';

interface UserItem {
    _id: string;
    username: string;
    email: string;
    role: string;
    videoCount: number;
    createdAt: string;
}

export default function AdminUsersPage() {
    const [users, setUsers] = useState<UserItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [deleteTarget, setDeleteTarget] = useState<UserItem | null>(null);

    useEffect(() => {
        async function fetchUsers() {
            try {
                const data = await api.getAdminUsers();
                setUsers(data.users);
            } catch (error) {
                console.error('Failed to fetch users:', error);
            } finally {
                setLoading(false);
            }
        }
        fetchUsers();
    }, []);

    const handleDelete = async () => {
        if (!deleteTarget) return;
        try {
            await api.deleteUser(deleteTarget._id);
            setUsers(prev => prev.filter(u => u._id !== deleteTarget._id));
            setDeleteTarget(null);
        } catch (error: any) {
            console.error('Delete failed:', error);
        }
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center h-64 gap-4">
                <div className="relative">
                    <div className="w-12 h-12 rounded-full border-2 border-slate-700 border-t-violet-500 animate-spin" />
                    <Pulse size={24} className="absolute inset-0 m-auto text-violet-400 animate-pulse" />
                </div>
                <p className="text-slate-500 font-mono text-xs uppercase tracking-widest animate-pulse">Loading Users...</p>
            </div>
        );
    }

    const columns = [
        { key: 'username' as const, label: 'Username', sortable: true },
        { key: 'email' as const, label: 'Email', sortable: true },
        {
            key: 'role' as const,
            label: 'Role',
            render: (user: UserItem) => <StatusBadge status={user.role} />,
        },
        {
            key: 'videoCount' as const,
            label: 'Videos',
            render: (user: UserItem) => <span className="font-mono">{user.videoCount}</span>,
        },
        {
            key: 'createdAt' as const,
            label: 'Joined',
            sortable: true,
            render: (user: UserItem) => (
                <span className="text-slate-400 font-mono text-xs">
                    {new Date(user.createdAt).toLocaleDateString()}
                </span>
            ),
        },
        {
            key: 'actions' as string,
            label: 'Actions',
            render: (user: UserItem) => (
                <button
                    onClick={(e) => { e.stopPropagation(); setDeleteTarget(user); }}
                    className="text-red-400 hover:text-red-300 transition-colors p-1"
                    title="Delete User"
                >
                    <Trash size={16} />
                </button>
            ),
        },
    ];

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-chivo font-bold uppercase tracking-wider flex items-center gap-3">
                    <Users size={28} weight="duotone" className="text-violet-400" />
                    User Management
                </h1>
                <p className="text-slate-500 mt-1">{users.length} registered users</p>
            </div>

            <DataTable
                data={users}
                columns={columns}
                emptyMessage="No users found"
            />

            <Modal
                isOpen={!!deleteTarget}
                onClose={() => setDeleteTarget(null)}
                title="Delete User"
                size="sm"
            >
                <div className="space-y-4">
                    <p className="text-slate-400 text-sm">
                        Delete user <strong className="text-slate-200">{deleteTarget?.username}</strong> and all their videos? This cannot be undone.
                    </p>
                    <div className="flex gap-3">
                        <button onClick={() => setDeleteTarget(null)} className="btn-secondary flex-1">Cancel</button>
                        <button onClick={handleDelete} className="btn-danger flex-1">Delete User</button>
                    </div>
                </div>
            </Modal>
        </div>
    );
}
