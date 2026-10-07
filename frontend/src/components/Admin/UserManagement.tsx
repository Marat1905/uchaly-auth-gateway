// src/components/Admin/UserManagement.tsx
// =============================================================================
// Управление пользователями через Keycloak Admin REST API.
// =============================================================================

import React, { useState, useEffect } from 'react';
import adminService from '../../services/adminService';
import type { UserDto, PagedResultDto, RoleDto, UserManagementFilters } from '../../types/auth';
import Pagination from '../common/Pagination';

const UserManagement: React.FC = () => {
    const [users, setUsers] = useState<PagedResultDto<UserDto> | null>(null);
    const [roles, setRoles] = useState<RoleDto[]>([]);
    const [loading, setLoading] = useState(false);
    const [filters, setFilters] = useState<UserManagementFilters>({
        search: '',
        role: '',
        isActive: null,
        isDeleted: null,
        page: 1,
        pageSize: 10
    });

    const [passwordModalData, setPasswordModalData] = useState<{
        isOpen: boolean;
        email: string;
        newPassword: string;
    }>({
        isOpen: false,
        email: '',
        newPassword: ''
    });

    useEffect(() => {
        loadUsers();
        loadRoles();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filters]);

    const loadUsers = async () => {
        setLoading(true);
        try {
            const result = await adminService.getUsers(filters);
            setUsers(result);
        } catch (error) {
            console.error('Error loading users:', error);
        } finally {
            setLoading(false);
        }
    };

    const loadRoles = async () => {
        try {
            const result = await adminService.getRoles();
            setRoles(result);
        } catch (error) {
            console.error('Error loading roles:', error);
        }
    };

    const handleFilterChange = (key: keyof UserManagementFilters, value: any) => {
        setFilters(prev => ({ ...prev, [key]: value, page: 1 }));
    };

    const handlePageChange = (page: number) => {
        setFilters(prev => ({ ...prev, page }));
    };

    const handlePageSizeChange = (pageSize: number) => {
        setFilters(prev => ({ ...prev, pageSize, page: 1 }));
    };

    const toggleUserStatus = async (userId: string, isActive: boolean) => {
        try {
            await adminService.setUserEnabled(userId, isActive);
            loadUsers();
        } catch (error) {
            console.error('Error updating user status:', error);
        }
    };

    const updateUserRoles = async (userId: string, roleNames: string[]) => {
        try {
            await adminService.setUserRolesByName(userId, roleNames);
            loadUsers();
        } catch (error) {
            console.error('Error updating user roles:', error);
        }
    };

    const handleDeleteUser = async (userId: string) => {
        if (!confirm('Вы уверены, что хотите удалить этого пользователя? Это действие необратимо.')) return;

        try {
            await adminService.deleteUser(userId);
            await loadUsers();
        } catch (error: any) {
            alert(error.response?.data?.errorMessage || 'Ошибка удаления пользователя');
        }
    };

    const handleRestoreUser = async (_userId: string) => {
        // В Keycloak нет мягкого удаления — восстановление невозможно.
        alert('В Keycloak нет функции восстановления удалённых пользователей.');
    };

    const handleResetPassword = async (userId: string, userEmail: string) => {
        if (!confirm(`Вы уверены, что хотите сбросить пароль для пользователя ${userEmail}? Новый пароль будет сгенерирован автоматически.`)) return;

        try {
            const newPassword = await adminService.resetUserPassword(userId);

            setPasswordModalData({
                isOpen: true,
                email: userEmail,
                newPassword: newPassword
            });
        } catch (error: any) {
            alert(error.response?.data?.errorMessage || 'Ошибка сброса пароля');
        }
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h3 className="text-2xl font-bold text-gray-900 dark:text-white">
                    Управление пользователями
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                    Поиск и управление пользователями системы (Keycloak)
                </p>
            </div>

            {/* Filters */}
            <div className="bg-gradient-to-br from-white/70 to-gray-50/70 dark:from-gray-800/70 dark:to-gray-900/70 rounded-3xl shadow-xl border border-white/50 dark:border-gray-700/50 p-6 backdrop-blur-sm">
                <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                            Поиск
                        </label>
                        <input
                            type="text"
                            value={filters.search}
                            onChange={(e) => handleFilterChange('search', e.target.value)}
                            placeholder="Поиск по email или имени..."
                            className="w-full px-4 py-3 border-2 border-gray-200 dark:border-gray-600 rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 dark:bg-gray-700 dark:text-white transition-all duration-200"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                            Роль
                        </label>
                        <select
                            value={filters.role}
                            onChange={(e) => handleFilterChange('role', e.target.value)}
                            className="w-full px-4 py-3 border-2 border-gray-200 dark:border-gray-600 rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 dark:bg-gray-700 dark:text-white transition-all duration-200"
                        >
                            <option value="">Все роли</option>
                            {roles.map(role => (
                                <option key={role.id} value={role.name}>
                                    {role.name}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                            Статус
                        </label>
                        <select
                            value={filters.isActive === null ? '' : filters.isActive.toString()}
                            onChange={(e) => handleFilterChange('isActive', e.target.value === '' ? null : e.target.value === 'true')}
                            className="w-full px-4 py-3 border-2 border-gray-200 dark:border-gray-600 rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 dark:bg-gray-700 dark:text-white transition-all duration-200"
                        >
                            <option value="">Все статусы</option>
                            <option value="true">Активные</option>
                            <option value="false">Неактивные</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                            Удаленные
                        </label>
                        <select
                            value={filters.isDeleted === null ? '' : filters.isDeleted.toString()}
                            onChange={(e) => handleFilterChange('isDeleted', e.target.value === '' ? null : e.target.value === 'true')}
                            className="w-full px-4 py-3 border-2 border-gray-200 dark:border-gray-600 rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 dark:bg-gray-700 dark:text-white transition-all duration-200"
                        >
                            <option value="">Все</option>
                            <option value="false">Активные</option>
                            <option value="true">Удаленные</option>
                        </select>
                    </div>
                    <div className="flex items-end">
                        <button
                            onClick={() => setFilters({
                                search: '',
                                role: '',
                                isActive: null,
                                isDeleted: null,
                                page: 1,
                                pageSize: 10
                            })}
                            className="w-full px-4 py-3 bg-gradient-to-r from-gray-500 to-gray-600 text-white font-bold rounded-2xl hover:from-gray-600 hover:to-gray-700 transition-all duration-200 transform hover:-translate-y-0.5 shadow-lg"
                        >
                            Сбросить фильтры
                        </button>
                    </div>
                </div>
            </div>

            {/* Users Table */}
            <div className="bg-gradient-to-br from-white/70 to-gray-50/70 dark:from-gray-800/70 dark:to-gray-900/70 rounded-3xl shadow-xl border border-white/50 dark:border-gray-700/50 backdrop-blur-sm overflow-hidden">
                {loading ? (
                    <div className="flex justify-center items-center py-12">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-600"></div>
                    </div>
                ) : (
                    <>
                        <div className="overflow-x-auto scrollbar-thin custom-scrollbar">
                            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                                <thead className="bg-gray-50/80 dark:bg-gray-700/80 backdrop-blur-sm">
                                    <tr>
                                        <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
                                            Пользователь
                                        </th>
                                        <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
                                            Email
                                        </th>
                                        <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
                                            Роли
                                        </th>
                                        <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
                                            Статус
                                        </th>
                                        <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
                                            Дата регистрации
                                        </th>
                                        <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
                                            Действия
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                                    {users?.items.map((user) => (
                                        <tr key={user.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-700/50 transition-colors">
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div className="flex items-center">
                                                    <div className="flex-shrink-0 h-12 w-12">
                                                        <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-md">
                                                            <span className="text-sm font-bold text-white">
                                                                {user.firstName?.[0]}{user.lastName?.[0]}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <div className="ml-4">
                                                        <div className="text-sm font-semibold text-gray-900 dark:text-white">
                                                            {user.fullName}
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div className="text-sm text-gray-900 dark:text-white">{user.email}</div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div className="text-sm text-gray-600 dark:text-gray-300">
                                                    {user.roles.join(', ')}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <span className={`px-3 py-1 inline-flex text-xs leading-5 font-bold rounded-2xl ${user.isActive
                                                    ? 'bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100'
                                                    : 'bg-red-100 text-red-800 dark:bg-red-800 dark:text-red-100'
                                                    }`}>
                                                    {user.isActive ? 'Активен' : 'Неактивен'}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                                                {new Date(user.createdAt).toLocaleDateString('ru-RU')}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
                                                <div className="flex space-x-2">
                                                    {/* Toggle Status Button */}
                                                    <button
                                                        onClick={() => toggleUserStatus(user.id, !user.isActive)}
                                                        title={user.isActive ? 'Деактивировать' : 'Активировать'}
                                                        className={`p-2 rounded-xl transition-all duration-200 transform hover:-translate-y-0.5 shadow-md ${user.isActive
                                                            ? 'bg-gradient-to-r from-red-500 to-orange-500 text-white hover:from-red-600 hover:to-orange-600'
                                                            : 'bg-gradient-to-r from-green-500 to-emerald-500 text-white hover:from-green-600 hover:to-emerald-600'
                                                            }`}
                                                    >
                                                        {user.isActive ? (
                                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                            </svg>
                                                        ) : (
                                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" />
                                                            </svg>
                                                        )}
                                                    </button>

                                                    {/* Reset Password Button */}
                                                    <button
                                                        onClick={() => handleResetPassword(user.id, user.email)}
                                                        title="Сбросить пароль"
                                                        className="p-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-xl hover:from-purple-600 hover:to-pink-600 transition-all duration-200 transform hover:-translate-y-0.5 shadow-md"
                                                    >
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                                                        </svg>
                                                    </button>

                                                    {/* Edit Roles Button */}
                                                    <UserRoleModal user={user} roles={roles} onUpdate={updateUserRoles} />

                                                    {/* Delete User Button */}
                                                    <button
                                                        onClick={() => handleDeleteUser(user.id)}
                                                        title="Удалить пользователя"
                                                        className="p-2 bg-gradient-to-r from-red-600 to-pink-600 text-white rounded-xl hover:from-red-700 hover:to-pink-700 transition-all duration-200 transform hover:-translate-y-0.5 shadow-md"
                                                    >
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                        </svg>
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {users && (
                            <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700">
                                <Pagination
                                    currentPage={users.pageNumber}
                                    totalPages={users.totalPages}
                                    onPageChange={handlePageChange}
                                    pageSize={filters.pageSize}
                                    onPageSizeChange={handlePageSizeChange}
                                    totalCount={users.totalCount}
                                />
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* Modal for displaying new password */}
            {passwordModalData.isOpen && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl border border-white/20 dark:border-gray-700/20 w-full max-w-md transform transition-all duration-300 scale-100">
                        <div className="p-6">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                                    Пароль сброшен
                                </h3>
                                <button
                                    onClick={() => setPasswordModalData({ isOpen: false, email: '', newPassword: '' })}
                                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                                >
                                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>

                            <div className="space-y-4">
                                <p className="text-sm text-gray-600 dark:text-gray-400">
                                    Новый пароль для пользователя <strong>{passwordModalData.email}</strong>:
                                </p>

                                <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-2xl p-4">
                                    <div className="flex items-center justify-between">
                                        <code className="text-lg font-mono font-bold text-gray-900 dark:text-white">
                                            {passwordModalData.newPassword}
                                        </code>
                                        <button
                                            onClick={() => navigator.clipboard.writeText(passwordModalData.newPassword)}
                                            className="ml-2 px-3 py-1 bg-blue-500 text-white rounded-lg text-sm hover:bg-blue-600 transition-colors"
                                            title="Скопировать в буфер обмена"
                                        >
                                            Копировать
                                        </button>
                                    </div>
                                </div>

                                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl p-3">
                                    <p className="text-xs text-red-700 dark:text-red-400">
                                        ⚠️ Сохраните этот пароль! Он больше не будет показан.
                                    </p>
                                </div>
                            </div>

                            <div className="flex justify-end mt-6">
                                <button
                                    onClick={() => setPasswordModalData({ isOpen: false, email: '', newPassword: '' })}
                                    className="px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white font-bold rounded-2xl hover:from-blue-700 hover:to-purple-700 transition-all duration-200 shadow-lg"
                                >
                                    Закрыть
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// Modal for editing user roles
const UserRoleModal: React.FC<{ user: UserDto; roles: RoleDto[]; onUpdate: (userId: string, roleNames: string[]) => void }> = ({
    user,
    roles,
    onUpdate
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [selectedRoles, setSelectedRoles] = useState<string[]>([]);

    useEffect(() => {
        // user.roles содержит ИМЕНА ролей — используем напрямую
        setSelectedRoles(user.roles);
    }, [user]);

    const handleSave = () => {
        onUpdate(user.id, selectedRoles);
        setIsOpen(false);
    };

    const toggleRole = (roleName: string) => {
        setSelectedRoles(prev =>
            prev.includes(roleName)
                ? prev.filter(n => n !== roleName)
                : [...prev, roleName]
        );
    };

    return (
        <>
            <button
                onClick={() => setIsOpen(true)}
                title="Настроить роли"
                className="p-2 bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-xl hover:from-blue-600 hover:to-cyan-600 transition-all duration-200 transform hover:-translate-y-0.5 shadow-md"
            >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
            </button>

            {isOpen && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl border border-white/20 dark:border-gray-700/20 w-full max-w-md transform transition-all duration-300 scale-100 mx-4">
                        <div className="p-4 sm:p-6">
                            <div className="flex items-start justify-between mb-4">
                                <div className="flex-1 pr-4 min-w-0">
                                    <h3 className="text-lg font-bold text-gray-900 dark:text-white break-words leading-relaxed">
                                        Роли пользователя
                                    </h3>
                                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 break-words leading-tight">
                                        {user.fullName}
                                    </p>
                                </div>
                                <button
                                    onClick={() => setIsOpen(false)}
                                    className="flex-shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors mt-1"
                                >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>

                            <div className="space-y-3 mb-6 max-h-64 overflow-y-auto scrollbar-thin custom-scrollbar">
                                {roles.map(role => (
                                    <label key={role.id} className="flex items-start space-x-3 p-3 rounded-xl border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                                        <input
                                            type="checkbox"
                                            checked={selectedRoles.includes(role.name)}
                                            onChange={() => toggleRole(role.name)}
                                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 w-4 h-4 mt-0.5 flex-shrink-0"
                                        />
                                        <div className="flex-1 min-w-0">
                                            <span className="text-sm font-medium text-gray-900 dark:text-white break-words block">
                                                {role.name}
                                            </span>
                                            <span className="block text-xs text-gray-500 dark:text-gray-400 mt-1">
                                                {role.userCount} пользователей
                                            </span>
                                        </div>
                                    </label>
                                ))}
                            </div>

                            <div className="flex flex-col sm:flex-row justify-end space-y-2 sm:space-y-0 sm:space-x-3">
                                <button
                                    onClick={() => setIsOpen(false)}
                                    className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 font-medium transition-colors rounded-xl border border-gray-300 dark:border-gray-600"
                                >
                                    Отмена
                                </button>
                                <button
                                    onClick={handleSave}
                                    className="px-4 py-2 bg-gradient-to-r from-blue-600 to-purple-600 text-white font-bold rounded-xl hover:from-blue-700 hover:to-purple-700 transition-all duration-200 shadow-lg"
                                >
                                    Сохранить
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default UserManagement;