// src/pages/Auth/Login.tsx
import React, { useEffect, useState } from "react";
import { Link, useNavigate, useLocation } from "react-router";
import { useAuth } from "../../context/AuthContext";
import PageMeta from "../../components/common/PageMeta";

/**
 * Страница входа.
 * Вместо собственной формы email/пароль — редирект на Authentik.
 * Если пользователь уже аутентифицирован — редирект на главную.
 */
const Login: React.FC = () => {
    const { login, isAuthenticated, loading: authLoading } = useAuth();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const navigate = useNavigate();
    const location = useLocation();

    // Если уже авторизован — редирект на главную
    useEffect(() => {
        if (!authLoading && isAuthenticated) {
            const from = (location.state as any)?.from?.pathname || "/";
            navigate(from, { replace: true });
        }
    }, [isAuthenticated, authLoading, navigate, location]);

    // Проверяем сообщение из state (например, после регистрации)
    useEffect(() => {
        if ((location.state as any)?.message) {
            setError((location.state as any).message);
        }
    }, [location]);

    const handleLogin = async () => {
        setLoading(true);
        setError("");

        try {
            // Редирект на Authentik
            await login();
        } catch (err: any) {
            setError(
                err.message ||
                "Не удалось перенаправить на страницу входа. Попробуйте позже."
            );
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 py-12 px-4 sm:px-6 lg:px-8">
            <PageMeta
                title="Вход в систему - Uchaly"
                description="Вход в систему Uchaly через Authentik"
            />

            <div className="max-w-md w-full space-y-8">
                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8 transition-all duration-300 hover:shadow-2xl">
                    <div className="text-center">
                        {/* Логотип */}
                        <div className="flex justify-center mb-6">
                            <div className="relative">
                                <div className="absolute inset-0 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full blur opacity-25 animate-pulse"></div>
                                <Link to="/" className="flex justify-center relative">
                                    <img
                                        className="h-14 w-auto dark:hidden transform transition-transform hover:scale-105"
                                        src="/images/logo/logo.svg"
                                        alt="Uchaly"
                                    />
                                    <img
                                        className="h-14 w-auto hidden dark:block transform transition-transform hover:scale-105"
                                        src="/images/logo/logo-dark.svg"
                                        alt="Uchaly"
                                    />
                                </Link>
                            </div>
                        </div>

                        <h2 className="text-3xl font-bold bg-gradient-to-r from-gray-900 to-gray-700 dark:from-white dark:to-gray-300 bg-clip-text text-transparent">
                            С возвращением!
                        </h2>
                        <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">
                            Войдите через корпоративную систему аутентификации Authentik
                        </p>
                    </div>

                    {error && (
                        <div className="mt-6 rounded-xl bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 p-4">
                            <p className="text-sm font-medium text-red-800 dark:text-red-200">
                                {error}
                            </p>
                        </div>
                    )}

                    <div className="mt-8 space-y-6">
                        <button
                            type="button"
                            onClick={handleLogin}
                            disabled={loading || authLoading}
                            className="group relative w-full flex justify-center py-3.5 px-4 border border-transparent text-sm font-semibold rounded-xl text-white bg-gradient-to-r from-brand-600 to-purple-600 hover:from-brand-700 hover:to-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 transform hover:-translate-y-0.5 shadow-lg hover:shadow-xl"
                        >
                            {loading ? (
                                <span className="flex items-center">
                                    <svg
                                        className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                    >
                                        <circle
                                            className="opacity-25"
                                            cx="12"
                                            cy="12"
                                            r="10"
                                            stroke="currentColor"
                                            strokeWidth="4"
                                        ></circle>
                                        <path
                                            className="opacity-75"
                                            fill="currentColor"
                                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                                        ></path>
                                    </svg>
                                    Перенаправление...
                                </span>
                            ) : (
                                <>
                                    <svg
                                        className="mr-2 h-5 w-5"
                                        fill="none"
                                        stroke="currentColor"
                                        viewBox="0 0 24 24"
                                    >
                                        <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            strokeWidth={2}
                                            d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"
                                        />
                                    </svg>
                                    <span>Войти через Authentik</span>
                                </>
                            )}
                        </button>

                        <div className="text-center">
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                Нажимая кнопку, вы будете перенаправлены на страницу входа
                                корпоративной системы аутентификации.
                            </p>
                        </div>
                    </div>
                </div>

                <div className="text-center">
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                        © 2025 Uchaly. Все права защищены.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default Login;