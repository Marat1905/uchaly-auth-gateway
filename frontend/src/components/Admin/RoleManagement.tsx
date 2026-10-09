// src/components/Admin/RoleManagement.tsx
// =============================================================================
// Управление ролями (группами Authentik) через API Gateway.
//
// ОСОБЕННОСТИ AUTHENTIK:
//
//   1. В отличие от Keycloak, имя роли можно менять — это
//      обычное поле группы. Поэтому поле "Название роли" в
//      модалке редактирования РАЗБЛОКИРОВАНО.
//
//   2. У группы Authentik нет отдельного поля description.
//      Backend хранит описание в attributes.description
//      (JSONB). Фронт об этом не думает — он отправляет
//      обычную строку, а backend упаковывает её сам.
//
//   3. Удаление группы с пользователями Authentik запрещает
//      (вернёт 400). UI дизейблит кнопку "Удалить", если
//      userCount > 0.
// =============================================================================

import React, { useState, useEffect } from 'react';
import adminService from '../../services/adminService';
import type { RoleDto, CreateRoleRequest, UpdateRoleRequest } from '../../types/auth';

const RoleManagement: React.FC = () => {
    const [roles, setRoles] = useState<RoleDto[]>([]);
    const [loading, setLoading] = useState(false);
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

    useEffect(() => {
        loadRoles();
    }, []);

    const loadRoles = async () => {
        setLoading(true);
        try {
            const result = await adminService.getRoles();
            // Защита: если backend вернул не массив — принудительно
            // превращаем в массив, чтобы UI не падал на roles.map.
            setRoles(Array.isArray(result) ? result : []);
        } catch (error) {
            console.error('Error loading roles:', error);
            setRoles([]);
        } finally {
            setLoading(false);
        }
    };

    const handleCreateRole = async (roleData: CreateRoleRequest) => {
        try {
            await adminService.createRole(roleData);
            await loadRoles();
            setIsCreateModalOpen(false);
        } catch (error) {
            console.error('Error creating role:', error);
            throw error;
        }
    };

    const handleUpdateRole = async (id: string, roleData: UpdateRoleRequest) => {
        try {
            await adminService.updateRole(id, roleData);
            await loadRoles();
        } catch (error) {
            console.error('Error updating role:', error);
            throw error;
        }
    };

    const handleDeleteRole = async (id: string) => {
        if (!confirm('Вы уверены, что хотите удалить эту роль?')) return;

        try {
            await adminService.deleteRole(id);
            await loadRoles();
        } catch (error: any) {
            alert(error.response?.data?.errorMessage || 'Ошибка удаления роли');
        }
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex justify-between items-center">
                <div>
                    <h3 className="text-2xl font-bold text-gray-900 dark:text-white">
                        Управление ролями
                    </h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                        Создание и редактирование ролей системы (Authentik)
                    </p>
                </div>
                <button
                    onClick={() => setIsCreateModalOpen(true)}
                    className="px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white font-bold rounded-2xl hover:from-blue-700 hover:to-purple-700 transition-all duration-200 transform hover:-translate-y-1 shadow-lg hover:shadow-xl"
                >
                    <div className="flex items-center space-x-2">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        <span>Создать роль</span>
                    </div>
                </button>
            </div>

            {/* Roles Table */}
            <div className="bg-gradient-to-br from-white/70 to-gray-50/70 dark:from-gray-800/70 dark:to-gray-900/70 rounded-3xl shadow-xl border border-white/50 dark:border-gray-700/50 backdrop-blur-sm overflow-hidden">
                {loading ? (
                    <div className="flex justify-center items-center py-12">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-600"></div>
                    </div>
                ) : (
                    <div className="overflow-x-auto scrollbar-thin custom-scrollbar">
                        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                            <thead className="bg-gray-50/80 dark:bg-gray-700/80 backdrop-blur-sm">
                                <tr>
                                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
                                        Название
                                    </th>
                                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
                                        Описание
                                    </th>
                                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
                                        Пользователей
                                    </th>
                                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
                                        Дата создания
                                    </th>
                                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
                                        Действия
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                                {roles.map((role) => (
                                    <tr key={role.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-700/50 transition-colors">
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm font-semibold text-gray-900 dark:text-white">
                                                {role.name}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="text-sm text-gray-600 dark:text-gray-300 max-w-xs">
                                                {role.description || '—'}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm font-medium text-gray-900 dark:text-white">
                                                {role.userCount}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                                            {new Date(role.createdAt).toLocaleDateString('ru-RU')}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
                                            <EditRoleModal role={role} onUpdate={handleUpdateRole} />
                                            <button
                                                onClick={() => handleDeleteRole(role.id)}
                                                disabled={role.userCount > 0}
                                                className="px-4 py-2 bg-gradient-to-r from-red-500 to-orange-500 text-white rounded-xl text-sm hover:from-red-600 hover:to-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 transform hover:-translate-y-0.5 shadow-md"
                                                title={role.userCount > 0 ? 'Невозможно удалить роль с пользователями' : 'Удалить роль'}
                                            >
                                                Удалить
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Create Role Modal */}
            {isCreateModalOpen && (
                <CreateRoleModal
                    onClose={() => setIsCreateModalOpen(false)}
                    onCreate={handleCreateRole}
                />
            )}
        </div>
    );
};

// =============================================================================
// Edit Role Modal Component
//
// ВАЖНО: в отличие от Keycloak, в Authentik имя роли можно
// менять. Поэтому поле "Название роли" здесь РАЗБЛОКИРОВАНО —
// пользователь может изменить и название, и описание.
// =============================================================================
const EditRoleModal: React.FC<{ role: RoleDto; onUpdate: (id: string, data: UpdateRoleRequest) => void }> = ({
    role,
    onUpdate
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [formData, setFormData] = useState({
        name: role.name,
        description: role.description
    });
    const [loading, setLoading] = useState(false);

    const handleSave = async () => {
        setLoading(true);
        try {
            // Отправляем и name, и description.
            //
            // В Keycloak имя роли менять было нельзя, но в Authentik
            // можно — это обычное поле группы. Поэтому передаём оба
            // поля: пользователь может изменить и название, и описание.
            await onUpdate(role.id, {
                name: formData.name,
                description: formData.description,
            });
            setIsOpen(false);
        } catch (error) {
            // Обработка ошибок — в родителе
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            <button
                onClick={() => setIsOpen(true)}
                className="px-4 py-2 bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-xl text-sm hover:from-blue-600 hover:to-cyan-600 transition-all duration-200 transform hover:-translate-y-0.5 shadow-md"
            >
                Редактировать
            </button>

            {isOpen && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl border border-white/20 dark:border-gray-700/20 w-full max-w-md transform transition-all duration-300 scale-100">
                        <div className="p-8">
                            <div className="flex items-center justify-between mb-6">
                                <h3 className="text-2xl font-bold text-gray-900 dark:text-white">Редактирование роли</h3>
                                <button
                                    onClick={() => setIsOpen(false)}
                                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                                >
                                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>

                            <div className="space-y-6">
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                        Название роли
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.name}
                                        onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                                        className="w-full px-4 py-3 border-2 border-gray-200 dark:border-gray-600 rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 dark:bg-gray-700 dark:text-white transition-all duration-200"
                                    />
                                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                        Имя роли можно изменить. Оно должно быть уникальным.
                                    </p>
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                        Описание
                                    </label>
                                    <textarea
                                        value={formData.description}
                                        onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                                        rows={4}
                                        className="w-full px-4 py-3 border-2 border-gray-200 dark:border-gray-600 rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 dark:bg-gray-700 dark:text-white transition-all duration-200 resize-none"
                                    />
                                </div>
                            </div>

                            <div className="flex justify-end space-x-3 mt-8">
                                <button
                                    onClick={() => setIsOpen(false)}
                                    className="px-6 py-3 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 font-medium transition-colors"
                                    disabled={loading}
                                >
                                    Отмена
                                </button>
                                <button
                                    onClick={handleSave}
                                    disabled={loading}
                                    className="px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white font-bold rounded-2xl hover:from-blue-700 hover:to-purple-700 disabled:opacity-50 transition-all duration-200 transform hover:-translate-y-0.5 shadow-lg"
                                >
                                    {loading ? 'Сохранение...' : 'Сохранить'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

// =============================================================================
// Create Role Modal Component
//
// Здесь поле "Название роли" всегда редактируемое — при создании
// это очевидно. Описание тоже можно задать сразу — backend упакует
// его в attributes.description.
// =============================================================================
const CreateRoleModal: React.FC<{ onClose: () => void; onCreate: (data: CreateRoleRequest) => void }> = ({
    onClose,
    onCreate
}) => {
    const [formData, setFormData] = useState({
        name: '',
        description: ''
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleCreate = async () => {
        if (!formData.name.trim()) {
            setError('Название роли обязательно');
            return;
        }

        setLoading(true);
        setError('');

        try {
            await onCreate(formData);
        } catch (error: any) {
            setError(error.response?.data?.errorMessage || 'Ошибка создания роли');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl border border-white/20 dark:border-gray-700/20 w-full max-w-md transform transition-all duration-300 scale-100">
                <div className="p-8">
                    <div className="flex items-center justify-between mb-6">
                        <h3 className="text-2xl font-bold text-gray-900 dark:text-white">Создание новой роли</h3>
                        <button
                            onClick={onClose}
                            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                        >
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>

                    {error && (
                        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl text-red-700 dark:text-red-400 text-sm">
                            {error}
                        </div>
                    )}

                    <div className="space-y-6">
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                Название роли *
                            </label>
                            <input
                                type="text"
                                value={formData.name}
                                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                                className="w-full px-4 py-3 border-2 border-gray-200 dark:border-gray-600 rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 dark:bg-gray-700 dark:text-white transition-all duration-200"
                                placeholder="Введите название роли"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                Описание
                            </label>
                            <textarea
                                value={formData.description}
                                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                                rows={4}
                                className="w-full px-4 py-3 border-2 border-gray-200 dark:border-gray-600 rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 dark:bg-gray-700 dark:text-white transition-all duration-200 resize-none"
                                placeholder="Введите описание роли"
                            />
                        </div>
                    </div>

                    <div className="flex justify-end space-x-3 mt-8">
                        <button
                            onClick={onClose}
                            className="px-6 py-3 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 font-medium transition-colors"
                            disabled={loading}
                        >
                            Отмена
                        </button>
                        <button
                            onClick={handleCreate}
                            disabled={loading}
                            className="px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white font-bold rounded-2xl hover:from-blue-700 hover:to-purple-700 disabled:opacity-50 transition-all duration-200 transform hover:-translate-y-0.5 shadow-lg"
                        >
                            {loading ? 'Создание...' : 'Создать роль'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default RoleManagement;