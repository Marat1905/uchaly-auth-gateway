// src/pages/Profile/Profile.tsx
// =============================================================================
// Страница профиля пользователя.
//
// АРХИТЕКТУРНОЕ РЕШЕНИЕ:
//   Редактирование профиля и смена пароля выполняются НЕ в этом
//   компоненте, а в нативных flow Authentik. Этот компонент
//   предоставляет:
//     - Отображение текущих данных пользователя (ФИО, email, роли).
//     - Кнопку «Редактировать профиль» → редирект на
//       /if/flow/uchaly-user-settings/.
//     - Кнопку «Сменить пароль» → редирект на
//       /if/flow/uchaly-password-change/.
//
//   Такой подход:
//     - Не требует AdminToken на Gateway (безопаснее).
//     - Использует штатные механизмы Authentik.
//     - Исключает передачу пароля через промежуточные сервисы.
//
// EMAIL:
//   Email отображается как read-only и дополнительно защищён
//   атрибутом goauthentik.io/user/can-change-email: false,
//   который выставлен всем пользователям в blueprint.
//   Это значит, что даже если пользователь откроет
//   /if/user/ напрямую — поле email будет недоступно
//   для редактирования.
//
// ОБНОВЛЕНИЕ ДАННЫХ ПОСЛЕ ВОЗВРАТА ИЗ FLOW:
//   После завершения user settings flow Authentik редиректит
//   пользователя обратно в SPA. Компонент Profile при монтировании
//   вызывает refreshUser() — это подтягивает свежие ФИО из userinfo.
//   Дополнительно есть ручная кнопка «Обновить данные».
// =============================================================================

import React, { useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import PageMeta from '../../components/common/PageMeta';
import PageBreadcrumb from '../../components/common/PageBreadCrumb';

const Profile: React.FC = () => {
    // user — источник данных для отображения.
    // refreshUser — метод для подтягивания свежего профиля из userinfo.
    // openUserSettingsFlow / openPasswordChangeFlow — редиректы на flow Authentik.
    const {
        user,
        refreshUser,
        openUserSettingsFlow,
        openPasswordChangeFlow,
    } = useAuth();

    /**
     * Ref-флаг, чтобы refreshUser() при монтировании
     * сработал ровно один раз — даже в React StrictMode,
     * где useEffect вызывается дважды в dev-режиме.
     */
    const hasRefreshedOnMount = useRef(false);

    // ---------------------------------------------------------------------
    // При монтировании компонента подтягиваем свежий профиль.
    // Это особенно важно после возврата из user settings flow —
    // пользователь изменил ФИО, и мы хотим сразу показать новые значения.
    // ---------------------------------------------------------------------
    useEffect(() => {
        if (hasRefreshedOnMount.current) return;
        hasRefreshedOnMount.current = true;

        // Тихое обновление — без toast, чтобы не раздражать пользователя
        // при каждом входе на страницу.
        refreshUser().catch((error) => {
            console.warn('[Profile] Не удалось обновить профиль при монтировании:', error);
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Если пользователя ещё нет — показываем спиннер.
    // (Теоретически страница защищена ProtectedRoute, но после
    // logout в фоне user может стать null до навигации.)
    if (!user) {
        return (
            <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
                <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-brand-600"></div>
            </div>
        );
    }

    // =====================================================================
    // ОБРАБОТЧИКИ
    // =====================================================================

    /**
     * Ручное обновление данных из Authentik (userinfo).
     * Полезно, если профиль был изменён в другом месте,
     * или просто для проверки, что токен ещё валиден.
     */
    const handleRefreshUser = async () => {
        const toastId = toast.loading('Обновление данных...');
        try {
            await refreshUser();
            toast.success('Данные обновлены', { id: toastId });
        } catch (error) {
            console.error('[Profile] Не удалось обновить данные:', error);
            toast.error('Не удалось обновить данные', { id: toastId });
        }
    };

    /**
     * Переход на нативный user settings flow Authentik.
     *
     * Что произойдёт:
     *   1. Браузер перейдёт на /if/flow/uchaly-user-settings/.
     *   2. Пользователь увидит форму Authentik с полями
     *      Фамилия / Имя / Отчество (предзаполненными).
     *   3. Изменит значения, нажмёт «Сохранить».
     *   4. Authentik запишет новые значения в user.attributes
     *      и редиректит обратно в SPA.
     *   5. Компонент Profile при монтировании подтянет
     *      обновлённые ФИО через refreshUser().
     *
     * ВАЖНО: email в этой форме отсутствует — его нельзя
     * изменить ни через этот flow, ни через /if/user/
     * (запрещено атрибутом goauthentik.io/user/can-change-email).
     */
    const handleOpenUserSettings = () => {
        openUserSettingsFlow();
    };

    /**
     * Переход на нативный password change flow Authentik.
     *
     * Что произойдёт:
     *   1. Браузер перейдёт на /if/flow/uchaly-password-change/.
     *   2. Пользователь введёт текущий пароль — Password Stage
     *      проверит его. Если пароль неверный — flow прервётся.
     *   3. Если пароль верный — появится форма нового пароля
     *      (два поля: новый пароль и подтверждение).
     *   4. User Write Stage запишет новый пароль.
     *   5. Пользователь вернётся в SPA.
     *
     * ВАЖНО: текущий access-токен остаётся валидным до
     * истечения exp. Пользователю не нужно логиниться заново.
     */
    const handleOpenPasswordChange = () => {
        openPasswordChangeFlow();
    };

    // =====================================================================
    // РЕНДЕР
    // =====================================================================
    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
            <div className="container mx-auto px-4 py-8">
                <PageMeta
                    title="Профиль - Uchaly"
                    description="Страница профиля пользователя"
                />

                <PageBreadcrumb pageTitle="Профиль" />

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* =====================================================
                        Левая колонка: карточка пользователя
                        ===================================================== */}
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
                                    onClick={handleOpenUserSettings}
                                    className="w-full px-4 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white font-bold rounded-2xl hover:from-blue-700 hover:to-purple-700 transition-all duration-200 shadow-lg"
                                >
                                    Редактировать профиль
                                </button>
                                <button
                                    onClick={handleOpenPasswordChange}
                                    className="w-full px-4 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold rounded-2xl hover:from-purple-700 hover:to-pink-700 transition-all duration-200 shadow-lg"
                                >
                                    Сменить пароль
                                </button>
                                <button
                                    onClick={handleRefreshUser}
                                    className="w-full px-4 py-3 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 font-semibold rounded-2xl hover:bg-gray-300 dark:hover:bg-gray-600 transition-all duration-200"
                                >
                                    Обновить данные
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* =====================================================
                        Правая колонка: детали профиля
                        ===================================================== */}
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
                                        {user.firstName || '—'}
                                    </dd>
                                </div>
                                <div>
                                    <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                                        Фамилия
                                    </dt>
                                    <dd className="mt-1 text-lg text-gray-900 dark:text-white">
                                        {user.lastName || '—'}
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

                                {/*
                                 * Email — всегда read-only.
                                 *
                                 * Дополнительная защита: в blueprint
                                 * всем пользователям выставлен атрибут
                                 * goauthentik.io/user/can-change-email: false.
                                 * Это значит, что даже если пользователь
                                 * откроет /if/user/ напрямую — поле email
                                 * будет недоступно для редактирования.
                                 */}
                                <div>
                                    <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                                        Email (нельзя изменить)
                                    </dt>
                                    <dd className="mt-1">
                                        <div className="relative">
                                            <input
                                                type="email"
                                                value={user.email}
                                                readOnly
                                                disabled
                                                className="w-full px-4 py-3 rounded-2xl border-2 border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 cursor-not-allowed"
                                            />
                                            <svg
                                                className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400"
                                                fill="none"
                                                stroke="currentColor"
                                                viewBox="0 0 24 24"
                                            >
                                                <path
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                    strokeWidth={2}
                                                    d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                                                />
                                            </svg>
                                        </div>
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

                            {/*
                             * Информационный блок: объясняем пользователю,
                             * что редактирование профиля и смена пароля
                             * происходят в интерфейсе Authentik.
                             */}
                            <div className="mt-8 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-2xl">
                                <p className="text-sm text-blue-800 dark:text-blue-200">
                                    Редактирование профиля и смена пароля выполняются
                                    в защищённом интерфейсе системы аутентификации
                                    Authentik. Нажмите соответствующую кнопку — браузер
                                    откроет форму Authentik, где вы сможете внести
                                    изменения. Email изменить нельзя.
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