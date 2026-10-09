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
 *
 * ИЗМЕНЕНИЯ (возврат на исходную страницу):
 *   - fullLogout() принимает необязательный параметр returnPath.
 *     Если он не передан — вычисляем путь автоматически:
 *
 *       * Если текущая страница ПУБЛИЧНАЯ (/, /login, /register,
 *         /auth/callback) — возвращаем пользователя на неё же.
 *         Это логично: он вышел из системы, но остался на той же
 *         странице, где был.
 *
 *       * Если текущая страница ЗАЩИЩЁННАЯ (/profile, /admin и т.п.) —
 *         возвращаем пользователя на ГЛАВНУЮ (/). Потому что
 *         защищённые страницы требуют авторизации, и если бы мы
 *         вернули туда, ProtectedRoute сразу же выкинул бы
 *         пользователя на /login. А нам нужно, чтобы после
 *         выхода он оказался на публичной странице.
 *
 *     Вычисленный путь сохраняется в sessionStorage и
 *     восстанавливается в AppLayout после возврата с end-session
 *     Authentik.
 */

export type TestRole = "User" | "Safety" | "TCX" | "Admin";

/**
 * Список публичных путей SPA — тех, что доступны без авторизации.
 *
 * ИСПОЛЬЗУЕТСЯ В fullLogout:
 *   Если текущая страница входит в этот список — она считается
 *   публичной, и после выхода пользователь остаётся на ней.
 *   Если не входит — считается защищённой, и после выхода
 *   пользователь отправляется на главную (/).
 *
 * ВАЖНО: список должен совпадать с публичными маршрутами
 * в App.tsx. Если добавляете новый публичный маршрут — добавьте
 * его и сюда.
 */
const PUBLIC_PATHS = ["/", "/login", "/register", "/auth/callback"];

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
     *   1. Вычисляет путь возврата (см. логику ниже).
     *   2. Очищает localStorage (токены, профиль).
     *   3. Редиректит на /application/o/uchaly/end-session/ —
     *      это убивает cookie authentik_session на сервере.
     *   4. Authentik после этого редиректит на корень origin.
     *   5. Компонент AppLayout читает сохранённый в sessionStorage
     *      путь и навигирует пользователя на него.
     *
     * ЛОГИКА ВЫЧИСЛЕНИЯ ПУТИ ВОЗВРАТА:
     *
     *   Если текущая страница ПУБЛИЧНАЯ — возвращаем на неё же.
     *   Если ЗАЩИЩЁННАЯ — возвращаем на главную (/).
     *
     *   Это защищает от ситуации, когда после выхода пользователя
     *   сразу выкидывает на /login, потому что ProtectedRoute
     *   видит отсутствие авторизации на защищённом маршруте.
     *
     * Когда использовать:
     *   - Кнопка «Выйти» в UserDropdown — именно этот сценарий.
     *   - Любой другой, когда нужно сменить пользователя.
     *
     * @param returnPath — явный путь возврата. Если не передан —
     *                     вычисляется автоматически (см. выше).
     */
    fullLogout: (returnPath?: string) => void;

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
     * После этого пользователь вернётся в SPA на:
     *   - ту же страницу, если она была публичной;
     *   - главную (/), если он был на защищённой странице.
     *
     * Следующий вход покажет форму логина.
     *
     * @param returnPath — явный путь для возврата. Если не указан —
     *                     вычисляется автоматически на основе
     *                     текущего URL и списка PUBLIC_PATHS.
     */
    const fullLogout = (returnPath?: string) => {
        // Определяем путь для возврата.
        let pathToReturn: string;

        if (returnPath) {
            // Явно переданный путь имеет приоритет — используем его.
            pathToReturn = returnPath;
        } else {
            // Берём текущий URL страницы.
            //
            // window.location используется, потому что AuthProvider
            // находится ВНЕ Router и не имеет доступа к useLocation().
            const currentPath = window.location.pathname;
            const currentSearch = window.location.search;

            // Проверяем, публичная ли текущая страница.
            //
            // Сравнение двухуровневое:
            //   1. Точное совпадение с одним из PUBLIC_PATHS
            //      (например, "/login" === "/login").
            //   2. Начинается с публичного префикса + "/"
            //      (например, "/auth/callback" начинается с "/auth/").
            //
            // Это нужно, чтобы корректно обрабатывать как точные
            // совпадения, так и вложенные пути.
            const isPublic = PUBLIC_PATHS.some(
                (publicPath) =>
                    currentPath === publicPath ||
                    currentPath.startsWith(publicPath + "/")
            );

            if (isPublic) {
                // Публичная страница — возвращаемся на неё же,
                // сохраняя query-параметры (например, ?tab=info).
                pathToReturn = currentPath + currentSearch;
            } else {
                // Защищённая страница — возвращаемся на главную.
                //
                // ВАЖНО: возврат на защищённую страницу бессмыслен,
                // потому что сразу же сработает ProtectedRoute
                // и выкинет пользователя на /login. А нам нужно,
                // чтобы после выхода он оказался на публичной
                // странице — главной.
                pathToReturn = "/";
            }
        }

        // setUser(null) делаем ДО вызова authService.fullLogout.
        // Так ProtectedRoute успеет среагировать на смену стейта,
        // если браузер по какой-то причине не выполнит редирект.
        setUser(null);
        authService.fullLogout(pathToReturn);
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