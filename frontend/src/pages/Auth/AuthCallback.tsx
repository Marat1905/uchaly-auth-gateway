// src/pages/Auth/AuthCallback.tsx
import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { authService } from "../../services/authService";
import { useAuth } from "../../context/AuthContext";

/**
 * Компонент обработки callback от Authentik.
 * URL: /auth/callback?code=...&state=...
 *
 * После успешного обмена code → tokens сохраняет их
 * и редиректит пользователя на главную.
 */
const AuthCallback: React.FC = () => {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const { refreshUser } = useAuth();
    const [error, setError] = useState("");

    useEffect(() => {
        const handleCallback = async () => {
            const code = searchParams.get("code");
            const state = searchParams.get("state");
            const errorParam = searchParams.get("error");

            if (errorParam) {
                setError(`Ошибка аутентификации: ${errorParam}`);
                return;
            }

            if (!code || !state) {
                setError("Отсутствуют параметры code или state.");
                return;
            }

            try {
                await authService.handleCallback(code, state);
                // Обновляем контекст
                await refreshUser();
                // Редирект на главную
                navigate("/", { replace: true });
            } catch (err: any) {
                console.error("Callback error:", err);
                setError(
                    err.message || "Ошибка обработки аутентификации. Попробуйте снова."
                );
            }
        };

        handleCallback();
    }, [searchParams, navigate, refreshUser]);

    if (error) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-red-50 to-orange-100">
                <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
                    <h2 className="text-2xl font-bold text-red-600 mb-4">
                        Ошибка аутентификации
                    </h2>
                    <p className="text-gray-600 mb-6">{error}</p>
                    <button
                        onClick={() => navigate("/login")}
                        className="px-6 py-3 bg-brand-600 text-white rounded-xl hover:bg-brand-700 transition"
                    >
                        Вернуться на страницу входа
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
            <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-600 mx-auto mb-4"></div>
                <p className="text-gray-600">Завершение аутентификации...</p>
            </div>
        </div>
    );
};

export default AuthCallback;