// src/context/AuthContext.tsx
import React, {
    createContext,
    useContext,
    useState,
    useEffect,
    useMemo,
    useCallback,
    type ReactNode,
} from "react";
import { authService } from "../services/authService";
import type { UserDto } from "../types/auth";

/**
 * Контекст аутентификации, работающий с Authentik.
 *
 * ИЗМЕНЕНИЯ (путь A):
 *   - Добавлен метод fullLogout() — полный выход с завершением
 *     сессии Authentik. Раньше был только logout() (локальная
 *     очистка localStorage без редиректа на end-session).
 *   - fullLogout используется кнопкой «Выйти» в UserDropdown —
 *     это гарантирует, что после выхода сессия Authentik убита,
 *     и следующий вход покажет форму логина/пароля.
 *   - AuthProvider переключён на дефолтные flow Authentik в
 *     blueprint — поэтому silent-возврат из user settings flow
 *     и password change flow работает без повторного логина.
 */

export type TestRole = "User" | "Safety" | "TCX" | "Admin";

interface AuthContextType {
    user: UserDto | null;
    isAuthenticated: boolean;
    isAdmin: boolean;
    isAdminOrDiagnost: boolean;
    isAdminOrDiagnostOrService: boolean;
    isElectric: boolean;
    isAdminOrElectric: boolean;
    isTcx: boolean;
    isAdminOrTcx: boolean;
    isSafety: boolean;
    isAdminOrSafety: boolean;
    fullNameInitials: string;

    testRole: TestRole;
    setTestRole: (role: TestRole) => void;
    cycleTestRole: () => void;

    /** Запускает OAuth2-редирект на Authentik. */
    login: () => Promise<void>;

    /**
     * Запускает редирект на enrollment-флоу Authentik —
     * страницу регистрации нового пользователя.
     */
    register: () => Promise<void>;

    /**
     * ЛОКАЛЬНЫЙ выход.
     *
     * Что делает:
     *   - Очищает localStorage (токены, профиль).
     *   - НЕ делает редирект.
     *   - НЕ убивает сессию Authentik (cookie authentik_session
     *     остаётся живой).
     *
     * Когда использовать:
     *   - При обработке 401 в responseInterceptor, когда refresh
     *     не удался — там нельзя редиректить, иначе зациклится.
     *   - Когда нужно сбросить локальное состояние, но оставить
     *     пользователя в SPA.
     *
     * Для смены пользователя используйте fullLogout().
     */
    logout: () => void;

    /**
     * ПОЛНЫЙ выход.
     *
     * Что делает:
     *   1. Очищает localStorage (токены, профиль) — то же,
     *      что logout().
     *   2. Редиректит на /application/o/uchaly/end-session/ —
     *      это убивает cookie authentik_session на сервере.
     *   3. Authentik после этого редиректит на
     *      post_logout_redirect_uri (http://localhost:62080/).
     *
     * Когда использовать:
     *   - Кнопка «Выйти» в UserDropdown — именно этот сценарий.
     *   - Любой другой, когда нужно сменить пользователя.
     *
     * ПОСЛЕ ВЫЗОВА:
     *   Пользователь попадает на /login (или на главную).
     *   Следующий клик «Войти» гарантированно покажет форму
     *   логина Authentik, потому что сессии больше нет.
     */
    fullLogout: () => void;

    refreshUser: () => Promise<void>;
    loading: boolean;

    /**
     * Открывает нативный user settings flow Authentik —
     * страницу редактирования профиля (ФИО).
     *
     * Внутри — редирект браузера на /if/flow/uchaly-user-settings/
     * с next=<относительный OAuth2-authorize URL>. После
     * завершения flow пользователь вернётся в SPA на /profile.
     */
    openUserSettingsFlow: () => Promise<void>;

    /**
     * Открывает нативный password change flow Authentik —
     * страницу смены пароля.
     */
    openPasswordChangeFlow: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error("useAuth must be used within an AuthProvider");
    }
    return context;
};

interface AuthProviderProps {
    children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
    const [user, setUser] = useState<UserDto | null>(null);
    const [loading, setLoading] = useState(true);

    // Вычисляемые свойства ролей
    const isAdmin = useMemo(
        () => user?.roles.includes("Admin") || false,
        [user]
    );
    const isAdminOrDiagnost = useMemo(
        () =>
            user?.roles.some((r) => r === "Admin" || r === "Diagnost") || false,
        [user]
    );
    const isAdminOrDiagnostOrService = useMemo(
        () =>
            user?.roles.some(
                (r) => r === "Admin" || r === "Diagnost" || r === "Service"
            ) || false,
        [user]
    );
    const isElectric = useMemo(
        () => user?.roles.includes("Electric") || false,
        [user]
    );
    const isAdminOrElectric = useMemo(
        () => isAdmin || isElectric,
        [isAdmin, isElectric]
    );
    const isTcx = useMemo(() => user?.roles.includes("TCX") || false, [user]);
    const isAdminOrTcx = useMemo(() => isAdmin || isTcx, [isAdmin, isTcx]);
    const isSafety = useMemo(
        () => user?.roles.includes("Safety") || false,
        [user]
    );
    const isAdminOrSafety = useMemo(
        () => isAdmin || isSafety,
        [isAdmin, isSafety]
    );

    const fullNameInitials = useMemo(() => {
        if (!user) return "";
        const { lastName, firstName, patronymic } = user;
        let formattedName = lastName;
        if (firstName) formattedName += ` ${firstName.charAt(0)}.`;
        if (patronymic) formattedName += `${patronymic.charAt(0)}.`;
        return formattedName;
    }, [user]);

    // Заглушки testRole (совместимость)
    const testRole = useMemo<TestRole>(() => {
        if (isAdmin) return "Admin";
        if (isSafety) return "Safety";
        if (isTcx) return "TCX";
        return "User";
    }, [isAdmin, isSafety, isTcx]);

    const setTestRole = useCallback((_role: TestRole) => {
        if (import.meta.env.DEV) {
            console.warn("[AuthContext] setTestRole — no-op в production.");
        }
    }, []);

    const cycleTestRole = useCallback(() => {
        if (import.meta.env.DEV) {
            console.warn("[AuthContext] cycleTestRole — no-op в production.");
        }
    }, []);

    // Инициализация: проверяем, есть ли сохранённый токен
    useEffect(() => {
        initializeAuth();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const initializeAuth = async () => {
        try {
            const storedUser = authService.getStoredUser();
            const accessToken = localStorage.getItem("accessToken");

            if (storedUser && accessToken && authService.isAuthenticated()) {
                try {
                    const currentUser = await authService.getCurrentUser();
                    setUser(currentUser);
                    localStorage.setItem("user", JSON.stringify(currentUser));
                } catch (error) {
                    console.warn(
                        "Токен недействителен, очищаем данные аутентификации"
                    );
                    authService.logout();
                }
            }
        } catch (error) {
            console.error("Ошибка инициализации аутентификации:", error);
        } finally {
            setLoading(false);
        }
    };

    /** Запускает OAuth2-редирект на Authentik. */
    const login = async () => {
        await authService.loginWithAuthentik();
    };

    /**
     * Запускает редирект на страницу регистрации Authentik.
     */
    const register = async () => {
        await authService.registerWithAuthentik();
    };

    /**
     * Локальный выход — очищает стейт и localStorage,
     * но НЕ убивает сессию Authentik.
     *
     * Используется во внутренних сценариях (обработка 401,
     * где редирект на end-session вызвал бы зацикливание).
     */
    const logout = () => {
        authService.logout();
        setUser(null);
    };

    /**
     * Полный выход — очищает стейт, localStorage И убивает
     * сессию Authentik через /end-session/.
     *
     * После этого пользователь вернётся в SPA (по
     * post_logout_redirect_uri провайдера). Следующий вход
     * покажет форму логина.
     */
    const fullLogout = () => {
        // authService.fullLogout:
        //   1. Вызывает logout() — очищает localStorage.
        //   2. Формирует URL /application/o/uchaly/end-session/
        //      с post_logout_redirect_uri = origin.
        //   3. Редиректит браузер на этот URL.
        //
        // ВАЖНО: после вызова этой функции компонент НЕ продолжит
        // работу — браузер уйдёт на end-session. Поэтому setUser(null)
        // здесь не обязателен, но мы делаем это для чистоты стейта
        // на случай, если редирект почему-то не сработает.
        setUser(null);
        authService.fullLogout();
    };

    const refreshUser = async () => {
        try {
            const currentUser = await authService.getCurrentUser();
            setUser(currentUser);
            localStorage.setItem("user", JSON.stringify(currentUser));
        } catch (error) {
            console.error("Не удалось обновить профиль:", error);
            throw error;
        }
    };

    /**
     * Открывает нативный user settings flow Authentik
     * для редактирования ФИО.
     *
     * Внутри — асинхронный вызов сервиса (PKCE + authorize-chain),
     * затем редирект браузера. returnPath = /profile.
     */
    const openUserSettingsFlow = async () => {
        try {
            const url = await authService.getUserSettingsFlowUrl("/profile");
            window.location.href = url;
        } catch (error) {
            console.error(
                "[AuthContext] Не удалось открыть user settings flow:",
                error
            );
        }
    };

    /**
     * Открывает нативный password change flow Authentik
     * для смены пароля.
     */
    const openPasswordChangeFlow = async () => {
        try {
            const url = await authService.getPasswordChangeFlowUrl("/profile");
            window.location.href = url;
        } catch (error) {
            console.error(
                "[AuthContext] Не удалось открыть password change flow:",
                error
            );
        }
    };

    const isAuthenticated = !!user;

    const value: AuthContextType = {
        user,
        isAuthenticated,
        isAdmin,
        isAdminOrDiagnost,
        isAdminOrDiagnostOrService,
        isElectric,
        isAdminOrElectric,
        isTcx,
        isAdminOrTcx,
        isSafety,
        isAdminOrSafety,
        fullNameInitials,
        testRole,
        setTestRole,
        cycleTestRole,
        login,
        register,
        logout,
        fullLogout,
        refreshUser,
        loading,
        openUserSettingsFlow,
        openPasswordChangeFlow,
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};