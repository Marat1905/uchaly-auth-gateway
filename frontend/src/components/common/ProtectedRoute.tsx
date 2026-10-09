// src/components/common/ProtectedRoute.tsx
import React from 'react';
import { Navigate, useLocation } from 'react-router';
import { useAuth } from '../../context/AuthContext';

interface ProtectedRouteProps {
    children: React.ReactNode;
    requireAdmin?: boolean;
}

/**
 * Компонент-обёртка для маршрутов, требующих авторизации.
 *
 * ЛОГИКА:
 *   - Если пользователь не аутентифицирован — редирект на /login,
 *     запоминая текущий location в state (чтобы после логина
 *     вернуться туда же).
 *   - Если requireAdmin=true и пользователь не админ — показ
 *     страницы «Доступ запрещён».
 *   - Иначе — рендер children.
 *
 * ВАЖНО ПРО ВОЗВРАТ ПОСЛЕ ВЫХОДА:
 *   Логика возврата на исходную страницу после logout реализована
 *   в AuthContext.fullLogout. Он определяет путь возврата так:
 *     - публичная страница → возвращаемся на неё же;
 *     - защищённая страница → возвращаемся на главную (/).
 *
 *   Поэтому ProtectedRoute НЕ нуждается в специальных флагах —
 *   после выхода пользователь просто не попадёт на защищённый
 *   маршрут, и этот компонент не сработает.
 */
const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
    children,
    requireAdmin = false
}) => {
    const { isAuthenticated, isAdmin, loading } = useAuth();
    const location = useLocation();

    // Пока идёт инициализация аутентификации — показываем спиннер,
    // чтобы не мигнуть экраном «Доступ запрещён» или редиректом.
    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-600"></div>
            </div>
        );
    }

    // Пользователь не аутентифицирован — отправляем на /login,
    // запоминая откуда пришёл (для возврата после успешного логина).
    if (!isAuthenticated) {
        return <Navigate to="/login" state={{ from: location }} replace />;
    }

    // Маршрут требует прав администратора, но их нет.
    if (requireAdmin && !isAdmin) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <div className="text-center">
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
                        Доступ запрещен
                    </h1>
                    <p className="text-gray-600 dark:text-gray-400">
                        У вас недостаточно прав для доступа к этой странице.
                    </p>
                    <button
                        onClick={() => window.history.back()}
                        className="mt-4 px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700"
                    >
                        Назад
                    </button>
                </div>
            </div>
        );
    }

    return <>{children}</>;
};

export default ProtectedRoute;