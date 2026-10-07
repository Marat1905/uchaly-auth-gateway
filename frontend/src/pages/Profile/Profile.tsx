// src/pages/Profile/Profile.tsx
// =============================================================================
// Страница профиля. После перехода на Keycloak редактирование профиля
// выполняется через Account Console Keycloak. Мы лишь показываем данные
// текущего пользователя и предоставляем кнопку перехода в Account Console.
// =============================================================================

import React from 'react';
import { useAuth } from '../../context/AuthContext';
import PageMeta from '../../components/common/PageMeta';
import PageBreadcrumb from '../../components/common/PageBreadCrumb';

const Profile: React.FC = () => {
    const { user, openAccountConsole, refreshUser } = useAuth();

    const handleRefresh = async () => {
        try {
            await refreshUser();
        } catch (error) {
            console.error('[Profile] Не удалось обновить данные:', error);
        }
    };

    if (!user) {
        return (
            <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
                <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-brand-600"></div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
            <div className="container mx-auto px-4 py-8">
                <PageMeta
                    title="Профиль - Uchaly"
                    description="Страница профиля пользователя"
                />

                <PageBreadcrumb pageTitle="Профиль" />

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Карточка пользователя */}
                    <div className="lg:col-span-1">
                        <div className="bg-white dark:bg-gray-800 rounded-3xl shadow-xl p-6">
                            <div className="flex flex-col items-center">
                                <div className="h-32 w-32 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg mb-4">
                                    <span className="text-4xl font-bold text-white">
                                        {user.firstName?.[0]}{user.lastName?.[0]}
                                    </span>
                                </div>
                                <h2 className="text-xl font-bold text-gray-900 dark:text-white text-center">
                                    {user.fullName}
                                </h2>
                                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                                    {user.email}
                                </p>
                                <div className="flex flex-wrap gap-2 mt-4 justify-center">
                                    {user.roles.map((role) => (
                                        <span
                                            key={role}
                                            className="px-3 py-1 text-xs font-semibold bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 rounded-full"
                                        >
                                            {role}
                                        </span>
                                    ))}
                                </div>
                            </div>

                            <div className="mt-6 space-y-3">
                                <button
                                    onClick={openAccountConsole}
                                    className="w-full px-4 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white font-bold rounded-2xl hover:from-blue-700 hover:to-purple-700 transition-all duration-200 shadow-lg"
                                >
                                    Редактировать в Keycloak
                                </button>
                                <button
                                    onClick={handleRefresh}
                                    className="w-full px-4 py-3 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 font-semibold rounded-2xl hover:bg-gray-300 dark:hover:bg-gray-600 transition-all duration-200"
                                >
                                    Обновить данные
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Детали */}
                    <div className="lg:col-span-2">
                        <div className="bg-white dark:bg-gray-800 rounded-3xl shadow-xl p-8">
                            <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
                                Данные профиля
                            </h3>

                            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                                <div>
                                    <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                                        Имя
                                    </dt>
                                    <dd className="mt-1 text-lg text-gray-900 dark:text-white">
                                        {user.firstName}
                                    </dd>
                                </div>
                                <div>
                                    <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                                        Фамилия
                                    </dt>
                                    <dd className="mt-1 text-lg text-gray-900 dark:text-white">
                                        {user.lastName}
                                    </dd>
                                </div>
                                <div>
                                    <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                                        Отчество
                                    </dt>
                                    <dd className="mt-1 text-lg text-gray-900 dark:text-white">
                                        {user.patronymic || '—'}
                                    </dd>
                                </div>
                                <div>
                                    <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                                        Email
                                    </dt>
                                    <dd className="mt-1 text-lg text-gray-900 dark:text-white">
                                        {user.email}
                                    </dd>
                                </div>
                                <div>
                                    <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                                        Идентификатор (sub)
                                    </dt>
                                    <dd className="mt-1 text-sm font-mono text-gray-700 dark:text-gray-300 break-all">
                                        {user.id}
                                    </dd>
                                </div>
                                <div>
                                    <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                                        Статус
                                    </dt>
                                    <dd className="mt-1">
                                        <span className={`px-3 py-1 inline-flex text-xs leading-5 font-bold rounded-2xl ${user.isActive
                                            ? 'bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100'
                                            : 'bg-red-100 text-red-800 dark:bg-red-800 dark:text-red-100'
                                            }`}>
                                            {user.isActive ? 'Активен' : 'Неактивен'}
                                        </span>
                                    </dd>
                                </div>
                            </dl>

                            <div className="mt-8 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-2xl">
                                <p className="text-sm text-blue-800 dark:text-blue-200">
                                    Для изменения личных данных и смены пароля перейдите в{' '}
                                    <button
                                        onClick={openAccountConsole}
                                        className="font-bold underline hover:no-underline"
                                    >
                                        Account Console Keycloak
                                    </button>
                                    .
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Profile;