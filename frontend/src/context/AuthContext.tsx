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
 * Убраны все вызовы кастомного Identity (login/refresh/revoke).
 * Теперь:
 * - login() выполняет редирект на Authentik.
 * - register() выполняет редирект на страницу регистрации Authentik.
 * - logout() выполняет редирект на end-session Authentik.
 * - Профиль пользователя приходит из userinfo Authentik.
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
     *
     * В отличие от login(), здесь НЕ используется OAuth2 — это
     * отдельный HTML-интерфейс Authentik. После успешной регистрации
     * пользователь попадёт обратно в SPA (на /login?registered=true),
     * где сможет войти со своими новыми учётными данными.
     */
    register: () => Promise<void>;

    logout: () => void;
    refreshUser: () => Promise<void>;
    loading: boolean;
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
     *
     * Не путать с login(): login() идёт через OAuth2 authorize endpoint
     * и возвращается на /auth/callback с code/state. register() идёт
     * напрямую на /if/flow/uchaly-enrollment/ и возвращается на
     * /login?registered=true (URL задаётся в authService).
     */
    const register = async () => {
        await authService.registerWithAuthentik();
    };

    const logout = () => {
        authService.logout();
        setUser(null);
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
        refreshUser,
        loading,
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};