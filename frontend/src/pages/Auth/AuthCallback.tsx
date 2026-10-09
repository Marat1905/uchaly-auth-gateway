// src/pages/Auth/AuthCallback.tsx
import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { authService } from "../../services/authService";
import { useAuth } from "../../context/AuthContext";

/**
 * Компонент обработки callback от Authentik.
 * URL: /auth/callback?code=...&state=...
 *
 * Сценарии, в которых пользователь сюда попадает:
 *   1. Обычный логин через OAuth2. Тогда после обработки
 *      редирект на "/" (или на сохранённый post_flow_redirect,
 *      если он есть — см. п. 2).
 *   2. Возврат из нативного flow Authentik (user settings /
 *      password change). SPA перед открытием flow положила в
 *      sessionStorage ключ "post_flow_redirect" со значением
 *      "/profile". После обработки вернёмся туда.
 *
 * ВАЖНО:
 *   Обработка запускается РОВНО ОДИН РАЗ за всю жизнь компонента.
 *   Для этого используем ref-флаг `isProcessing`.
 *
 *   Почему это критично:
 *     - В React 18/19 StrictMode (dev) useEffect срабатывает
 *       дважды при монтировании.
 *     - Кроме того, `refreshUser` из AuthContext НЕ обёрнут в
 *       useCallback, поэтому на каждом ре-рендере AuthProvider
 *       получает новую ссылку на функцию, и если бы мы указали
 *       refreshUser в зависимостях useEffect, эффект срабатывал бы
 *       на каждом ре-рендере провайдера.
 *     - При повторном вызове handleCallback параметр `state`
 *       из sessionStorage уже удалён (первый вызов его почистил),
 *       и мы получаем ложную ошибку "Недействительный параметр state".
 *
 *   Ref-флаг решает обе проблемы: сколько бы раз ни сработал эффект,
 *   настоящая обработка произойдёт только в первый раз.
 */
const AuthCallback: React.FC = () => {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const { refreshUser } = useAuth();
    const [error, setError] = useState("");

    /**
     * Флаг "обработка уже запущена".
     * useRef сохраняет значение между ре-рендерами и не вызывает
     * ре-рендер при изменении — идеально для таких guard-ов.
     */
    const isProcessing = useRef(false);

    useEffect(() => {
        // Если уже обрабатывали — молча выходим.
        if (isProcessing.current) {
            return;
        }
        isProcessing.current = true;

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

                // Обновляем контекст аутентификации (подтягиваем user
                // из userinfo в React-состояние AuthProvider).
                try {
                    await refreshUser();
                } catch (refreshErr) {
                    console.warn(
                        "[AuthCallback] refreshUser после обмена токенов не удался:",
                        refreshErr
                    );
                }

                // Определяем, куда навигировать.
                //
                // Если SPA положила в sessionStorage значение
                // post_flow_redirect (перед открытием user settings
                // или password change flow) — возвращаемся туда.
                // Иначе — на "/" (обычный логин).
                const returnPath =
                    sessionStorage.getItem("post_flow_redirect") || "/";
                sessionStorage.removeItem("post_flow_redirect");

                navigate(returnPath, { replace: true });
            } catch (err: any) {
                console.error("Callback error:", err);
                setError(
                    err.message ||
                    "Ошибка обработки аутентификации. Попробуйте снова."
                );
            }
        };

        handleCallback();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

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