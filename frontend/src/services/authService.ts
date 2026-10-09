/**
 * authService.ts
 *
 * Сервис аутентификации через Authentik (OAuth2/OIDC + PKCE).
 *
 * Что делает:
 *   - loginWithAuthentik() — запускает OAuth2 Authorization Code Flow с PKCE,
 *     редиректит браузер на страницу входа Authentik.
 *   - registerWithAuthentik() — запускает регистрацию нового пользователя
 *     через enrollment-flow Authentik.
 *   - handleCallback(code, state) — обменивает authorization code на токены,
 *     загружает профиль пользователя и сохраняет всё в localStorage.
 *   - refreshToken() — обновляет access-токен через refresh-токен.
 *   - logout() — локальный выход (без завершения сессии Authentik).
 *   - fullLogout() — полный выход с завершением сессии Authentik.
 *
 * РЕДАКТИРОВАНИЕ ПРОФИЛЯ И СМЕНА ПАРОЛЯ:
 *   Эти операции выполняются НЕ через Gateway, а через нативные
 *   flow Authentik. Сервис предоставляет методы
 *   getUserSettingsFlowUrl() и getPasswordChangeFlowUrl(),
 *   которые возвращают URL соответствующих flow. SPA делает
 *   редирект браузера на эти URL — пользователь видит нативный
 *   интерфейс Authentik, где и выполняет операцию.
 *
 *   Такой подход:
 *     - Не требует AdminToken на Gateway (безопаснее).
 *     - Использует штатные механизмы Authentik (проверка
 *       текущего пароля выполняется Password Stage).
 *     - Исключает передачу пароля через промежуточные сервисы.
 *
 * Администрирование пользователей и групп вынесено в отдельный сервис:
 *   - adminService.ts (см. соседний файл).
 *
 * ВАЖНО: эндпоинты OAuth2/OIDC берутся напрямую из Authentik
 * (authorize, token, userinfo, end-session), а не через Gateway.
 * Gateway проверяет уже выпущенные токены на своей стороне.
 */

import axios from "axios";
import type {
    LoginRequest,
    TokenResponse,
    UserDto,
} from "../types/auth";
import {
    requestInterceptor,
    requestErrorInterceptor,
    responseInterceptor,
    responseErrorInterceptor,
} from "./axiosInterceptors";

// ============================================================
// КОНФИГУРАЦИЯ
// ============================================================

/**
 * Базовый URL инстанса Authentik.
 * В dev — http://localhost:9000
 * В prod — https://auth.example.com
 *
 * Задаётся через переменную окружения Vite: VITE_AUTHENTIK_URL
 */
const AUTHENTIK_BASE_URL =
    import.meta.env.VITE_AUTHENTIK_URL || "http://localhost:9000";

/**
 * Slug приложения в Authentik (совпадает с полем `slug` в blueprint).
 */
const AUTHENTIK_APP_SLUG = "uchaly";

/**
 * Slug enrollment-флоу, определённого в blueprint (uchaly-app.yaml).
 * Используется в registerWithAuthentik() для построения URL страницы
 * регистрации: /if/flow/<slug>/
 */
const ENROLLMENT_FLOW_SLUG = "uchaly-enrollment";

/**
 * Slug user settings flow — редактирование профиля.
 * Используется в getUserSettingsFlowUrl().
 */
const USER_SETTINGS_FLOW_SLUG = "uchaly-user-settings";

/**
 * Slug password change flow — смена пароля.
 * Используется в getPasswordChangeFlowUrl().
 */
const PASSWORD_CHANGE_FLOW_SLUG = "uchaly-password-change";

/**
 * Client ID, настроенный в OAuth2-провайдере Authentik.
 */
const CLIENT_ID = "uchaly-frontend";

/**
 * Redirect URI — куда Authentik вернёт пользователя после успешного входа.
 * Должен ТОЧНО совпадать с одним из значений `redirect_uris` в провайдере.
 *
 * По умолчанию — `${window.location.origin}/auth/callback`.
 */
const REDIRECT_URI =
    import.meta.env.VITE_AUTHENTIK_REDIRECT_URI ||
    `${window.location.origin}/auth/callback`;

// ============================================================
// OAuth2 / OIDC ENDPOINTS AUTHENTIK
// ============================================================

const AUTHORIZE_URL = `${AUTHENTIK_BASE_URL}/application/o/authorize/`;
const TOKEN_URL = `${AUTHENTIK_BASE_URL}/application/o/token/`;
const USERINFO_URL = `${AUTHENTIK_BASE_URL}/application/o/userinfo/`;
const END_SESSION_URL = `${AUTHENTIK_BASE_URL}/application/o/${AUTHENTIK_APP_SLUG}/end-session/`;

/**
 * URL enrollment-флоу (страница регистрации).
 *
 * ВНИМАНИЕ: это URL самого интерфейса Authentik, а не OAuth2-эндпоинт.
 * Он открывается в браузере как обычная HTML-страница и после
 * завершения флоу редиректит пользователя на URL из параметра `next`.
 */
const ENROLLMENT_URL = `${AUTHENTIK_BASE_URL}/if/flow/${ENROLLMENT_FLOW_SLUG}/`;

// ============================================================
// OAUTH2 SCOPES
// ============================================================

/**
 * Запрашиваемые scope:
 *   - openid, email, profile — базовые OIDC-claims.
 *   - groups — кастомный scope из blueprint, добавляет в токен claim `groups`.
 *   - offline_access — даёт refresh-токен (нужен для долгих сессий).
 */
const OAUTH_SCOPES = "openid email profile groups offline_access";

// ============================================================
// STORAGE KEYS
// ============================================================

const STORAGE_KEYS = {
    accessToken: "accessToken",
    refreshToken: "refreshToken",
    user: "user",
    pkceVerifier: "pkce_code_verifier",
    oauthState: "oauth_state",
} as const;

// ============================================================
// PKCE УТИЛИТЫ
// ============================================================

/**
 * Генерирует случайную строку заданной длины.
 * Использует Web Crypto API (криптографически стойкий).
 */
function generateRandomString(length: number): string {
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);
    return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Вычисляет SHA-256 от строки и возвращает ArrayBuffer.
 */
async function sha256(plain: string): Promise<ArrayBuffer> {
    const encoder = new TextEncoder();
    const data = encoder.encode(plain);
    return crypto.subtle.digest("SHA-256", data);
}

/**
 * Кодирует ArrayBuffer в Base64URL (без padding).
 * Используется для PKCE code_challenge.
 */
function base64UrlEncode(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let str = "";
    for (const b of bytes) {
        str += String.fromCharCode(b);
    }
    return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Генерирует PKCE code_challenge из code_verifier.
 */
async function generateCodeChallenge(codeVerifier: string): Promise<string> {
    const hashed = await sha256(codeVerifier);
    return base64UrlEncode(hashed);
}

// ============================================================
// AXIOS-КЛИЕНТ ДЛЯ GATEWAY-ЗАПРОСОВ
// ============================================================

const API_BASE_URL = "/api";

const apiClient = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        "Content-Type": "application/json",
    },
});

apiClient.interceptors.request.use(requestInterceptor, requestErrorInterceptor);
apiClient.interceptors.response.use(responseInterceptor, responseErrorInterceptor);

// ============================================================
// СЕРВИС
// ============================================================

export const authService = {
    // ==========================================================
    // OAuth2 AUTHORIZATION CODE FLOW + PKCE
    // ==========================================================

    /**
     * Запускает OAuth2 Authorization Code Flow + PKCE.
     * Сохраняет code_verifier и state в sessionStorage,
     * затем редиректит браузер на страницу входа Authentik.
     *
     * После успешного входа Authentik вернёт пользователя на REDIRECT_URI
     * с параметрами ?code=...&state=...
     */
    async loginWithAuthentik(): Promise<void> {
        // 1. Генерируем PKCE verifier и challenge
        const codeVerifier = generateRandomString(64);
        const codeChallenge = await generateCodeChallenge(codeVerifier);

        // 2. Генерируем state для CSRF-защиты
        const state = generateRandomString(32);

        // 3. Сохраняем verifier и state — проверим их при callback
        sessionStorage.setItem(STORAGE_KEYS.pkceVerifier, codeVerifier);
        sessionStorage.setItem(STORAGE_KEYS.oauthState, state);

        // 4. Формируем URL авторизации
        const params = new URLSearchParams({
            client_id: CLIENT_ID,
            redirect_uri: REDIRECT_URI,
            response_type: "code",
            scope: OAUTH_SCOPES,
            state,
            code_challenge: codeChallenge,
            code_challenge_method: "S256",
        });

        // 5. Редирект на Authentik
        window.location.href = `${AUTHORIZE_URL}?${params.toString()}`;
    },

    // ==========================================================
    // РЕГИСТРАЦИЯ (ENROLLMENT FLOW + OIDC-возврат в SPA)
    // ==========================================================

    /**
     * Запускает регистрацию нового пользователя через enrollment-flow
     * Authentik, с автоматическим возвратом в SPA после успеха.
     *
     * АРХИТЕКТУРНОЕ РЕШЕНИЕ (важно для понимания):
     *
     *   В Authentik 2026.8.3 функция is_url_absolute (см.
     *   flows/views/executor.py) блокирует редирект на абсолютные URL
     *   через параметр `next`. Whitelist-механизма для внешних доменов
     *   в этой версии нет ни в Brand, ни в Tenant.
     *
     *   Прямой next=http://localhost:62080/login?registered=true
     *   отклоняется с ошибкой "Invalid next URL".
     *
     *   ОБХОД: используем ОТНОСИТЕЛЬНЫЙ next, указывающий на
     *   OAuth2-authorize URL. is_url_absolute для относительного пути
     *   возвращает False, редирект разрешён. Далее authorize-эндпоинт
     *   видит, что пользователь уже залогинен (enrollment-flow его
     *   залогинил), выпускает authorization code и редиректит
     *   на redirect_uri — который уже в whitelist провайдера.
     *
     * ПОТОК:
     *   1. SPA генерирует PKCE и state (как для обычного логина).
     *   2. Редирект на /if/flow/uchaly-enrollment/?next=/application/o/authorize/?...
     *   3. Пользователь заполняет форму, Authentik создаёт его.
     *   4. enrollment-flow редиректит на относительный next.
     *   5. authorize-эндпоинт видит активную сессию, выпускает code.
     *   6. Редирект на http://localhost:62080/auth/callback?code=...
     *   7. SPA обрабатывает callback в AuthCallback → токены сохранены.
     *   8. Пользователь автоматически в главном меню приложения.
     */
    async registerWithAuthentik(): Promise<void> {
        // 1. Генерируем PKCE verifier и challenge — они понадобятся
        //    на шаге 7, когда SPA будет обменивать code на токены.
        const codeVerifier = generateRandomString(64);
        const codeChallenge = await generateCodeChallenge(codeVerifier);

        // 2. Генерируем state для CSRF-защиты.
        const state = generateRandomString(32);

        // 3. Сохраняем verifier и state — проверим их в handleCallback.
        sessionStorage.setItem(STORAGE_KEYS.pkceVerifier, codeVerifier);
        sessionStorage.setItem(STORAGE_KEYS.oauthState, state);

        // 4. Формируем параметры OAuth2-authorize URL.
        //    Этот URL будет передан в enrollment-flow как `next`.
        const authorizeParams = new URLSearchParams({
            client_id: CLIENT_ID,
            redirect_uri: REDIRECT_URI,
            response_type: "code",
            scope: OAUTH_SCOPES,
            state,
            code_challenge: codeChallenge,
            code_challenge_method: "S256",
        });

        // 5. ВАЖНО: URL ОТНОСИТЕЛЬНЫЙ — начинается с /.
        //    Именно это позволяет обойти проверку is_url_absolute
        //    в Authentik. Абсолютный URL (http://...) был бы отклонён.
        const authorizePath = `/application/o/authorize/?${authorizeParams.toString()}`;

        // 6. Формируем URL enrollment-flow с next=authorizePath.
        //    Тоже относительный URL от корня Authentik.
        const enrollParams = new URLSearchParams({
            next: authorizePath,
        });

        // 7. Редирект на enrollment-flow. Дальше Authentik сам
        //    проведёт пользователя по всей цепочке до callback в SPA.
        window.location.href = `${ENROLLMENT_URL}?${enrollParams.toString()}`;
    },

    /**
     * Обрабатывает callback от Authentik:
     *   - Проверяет state.
     *   - Обменивает authorization code на access/refresh токены.
     *   - Загружает профиль пользователя через userinfo.
     *   - Сохраняет всё в localStorage.
     *
     * Вызывается из компонента AuthCallback.
     */
    async handleCallback(code: string, state: string): Promise<TokenResponse> {
        // 1. Проверяем state
        const savedState = sessionStorage.getItem(STORAGE_KEYS.oauthState);
        if (!savedState || savedState !== state) {
            throw new Error(
                "Недействительный параметр state. Возможна CSRF-атака или истёкшая сессия."
            );
        }

        // 2. Достаём code_verifier
        const codeVerifier = sessionStorage.getItem(STORAGE_KEYS.pkceVerifier);
        if (!codeVerifier) {
            throw new Error(
                "PKCE code_verifier не найден. Возможно, страница была перезагружена."
            );
        }

        // 3. Обмениваем authorization code на токены
        const body = new URLSearchParams({
            grant_type: "authorization_code",
            client_id: CLIENT_ID,
            redirect_uri: REDIRECT_URI,
            code,
            code_verifier: codeVerifier,
        });

        const response = await fetch(TOKEN_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: body.toString(),
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(
                `Не удалось обменять код на токены: ${response.status} ${errText}`
            );
        }

        const tokenData = await response.json();

        // 4. Загружаем профиль пользователя
        const user = await this.fetchUserInfo(tokenData.access_token);

        // 5. Формируем TokenResponse
        const tokenResponse: TokenResponse = {
            accessToken: tokenData.access_token,
            refreshToken: tokenData.refresh_token || "",
            expiresAt: new Date(
                Date.now() + (tokenData.expires_in || 3600) * 1000
            ).toISOString(),
            user,
        };

        // 6. Сохраняем
        this.storeAuthData(tokenResponse);

        // 7. Чистим временные PKCE-данные
        sessionStorage.removeItem(STORAGE_KEYS.pkceVerifier);
        sessionStorage.removeItem(STORAGE_KEYS.oauthState);

        return tokenResponse;
    },

    /**
     * Запрашивает профиль пользователя у Authentik (userinfo endpoint).
     * Маппит claims Authentik в формат UserDto приложения.
     */
    async fetchUserInfo(accessToken: string): Promise<UserDto> {
        const response = await fetch(USERINFO_URL, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        });

        if (!response.ok) {
            throw new Error(`UserInfo запрос не удался: ${response.status}`);
        }

        const info = await response.json();

        // Группы Authentik приходят в claim `groups` (настроено в blueprint).
        // Иногда дополнительно в `roles` — берём оба варианта на всякий случай.
        const groups: string[] = info.groups || info.roles || [];

        // Имя и фамилия могут быть в отдельных полях или в общем `name`.
        const firstName = info.given_name || "";
        const lastName = info.family_name || "";
        const fallbackNameParts = (info.name || "").split(" ");

        return {
            id: info.sub || info.uid || "",
            email: info.email || "",
            firstName: firstName || fallbackNameParts[0] || "",
            lastName:
                lastName || fallbackNameParts.slice(1).join(" ") || "",
            patronymic: info.middle_name || undefined,
            avatarUrl: info.picture || undefined,
            isActive: true,
            isDeleted: false,
            roles: groups,
            createdAt: new Date().toISOString(),
            fullName:
                info.name ||
                `${lastName} ${firstName}`.trim() ||
                info.preferred_username ||
                info.email,
        };
    },

    // ==========================================================
    // ОБНОВЛЕНИЕ ТОКЕНА
    // ==========================================================

    /**
     * Обновляет access-токен через refresh-токен.
     * При успехе сохраняет новые токены в localStorage и возвращает TokenResponse.
     */
    async refreshToken(refreshToken: string): Promise<TokenResponse> {
        const body = new URLSearchParams({
            grant_type: "refresh_token",
            client_id: CLIENT_ID,
            refresh_token: refreshToken,
        });

        const response = await fetch(TOKEN_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: body.toString(),
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(
                `Не удалось обновить токен: ${response.status} ${errText}`
            );
        }

        const tokenData = await response.json();
        const user = await this.fetchUserInfo(tokenData.access_token);

        const tokenResponse: TokenResponse = {
            accessToken: tokenData.access_token,
            refreshToken: tokenData.refresh_token || refreshToken,
            expiresAt: new Date(
                Date.now() + (tokenData.expires_in || 3600) * 1000
            ).toISOString(),
            user,
        };

        this.storeAuthData(tokenResponse);
        return tokenResponse;
    },

    // ==========================================================
    // ВЫХОД
    // ==========================================================

    /**
     * Локальный выход:
     *   - очищает localStorage (токены, профиль);
     *   - НЕ делает редирект и НЕ завершает сессию Authentik.
     *
     * Навигацию (например, navigate('/')) выполняет вызывающий код
     * (обычно UserDropdown).
     *
     * Если нужно полностью разлогиниться — используйте fullLogout().
     */
    logout(): void {
        localStorage.removeItem(STORAGE_KEYS.accessToken);
        localStorage.removeItem(STORAGE_KEYS.refreshToken);
        localStorage.removeItem(STORAGE_KEYS.user);

        // Убираем возможный Authorization по умолчанию у axios
        delete apiClient.defaults.headers.common["Authorization"];
    },

    /**
     * Полный выход:
     *   - очищает localStorage;
     *   - редиректит на end-session endpoint Authentik;
     *   - после завершения сессии Authentik вернёт пользователя на `post_logout_redirect_uri`.
     *
     * ВАЖНО: post_logout_redirect_uri должен быть указан
     * в `logout_uris` провайдера Authentik, иначе будет ошибка.
     */
    fullLogout(): void {
        // 1. Локальная очистка
        this.logout();

        // 2. Редирект на end-session Authentik
        const params = new URLSearchParams({
            post_logout_redirect_uri: `${window.location.origin}/`,
        });

        window.location.href = `${END_SESSION_URL}?${params.toString()}`;
    },

    /**
     * Возвращает URL user settings flow Authentik —
     * редактирование профиля (ФИО).
     *
     * ПОЧЕМУ ASYNC:
     *   Мы генерируем PKCE прямо здесь, потому что после flow
     *   пользователь вернётся в SPA через OAuth2-authorize, и нам
     *   понадобится code_verifier для обмена code на токены в
     *   AuthCallback. SHA-256 (часть PKCE) — асинхронный API.
     *
     * ПОЧЕМУ НЕ next=абсолютный_URL:
     *   Flow executor Authentik блокирует абсолютные URL в `next`.
     *   Обходим это так же, как в registerWithAuthentik():
     *   передаём относительный путь на /application/o/authorize/,
     *   который выпустит свежий authorization code и редиректит
     *   на redirect_uri SPA (http://localhost:62080/auth/callback).
     *
     * КУДА ВЕРНЁТСЯ ПОЛЬЗОВАТЕЛЬ:
     *   Мы сохраняем returnPath в sessionStorage под ключом
     *   "post_flow_redirect". AuthCallback после успешного обмена
     *   токенов прочитает его и навигирует туда.
     *
     * @param returnPath — куда вернуть пользователя после flow.
     *                     По умолчанию "/profile".
     */
    async getUserSettingsFlowUrl(returnPath: string = "/profile"): Promise<string> {
        // 1. Генерируем PKCE (как для обычного логина)
        const codeVerifier = generateRandomString(64);
        const codeChallenge = await generateCodeChallenge(codeVerifier);

        // 2. Генерируем state для CSRF-защиты
        const state = generateRandomString(32);

        // 3. Сохраняем verifier и state — AuthCallback сверит их
        sessionStorage.setItem(STORAGE_KEYS.pkceVerifier, codeVerifier);
        sessionStorage.setItem(STORAGE_KEYS.oauthState, state);

        // 4. Запоминаем, куда вернуть пользователя после flow.
        //    AuthCallback прочитает этот ключ и навигирует туда.
        sessionStorage.setItem("post_flow_redirect", returnPath);

        // 5. Строим authorize URL, который будет передан в `next`.
        //    prompt=none — критично: пользователь уже аутентифицирован,
        //    повторно показывать форму логина не нужно.
        const authorizeParams = new URLSearchParams({
            client_id: CLIENT_ID,
            redirect_uri: REDIRECT_URI,
            response_type: "code",
            scope: OAUTH_SCOPES,
            state,
            code_challenge: codeChallenge,
            code_challenge_method: "S256",
            prompt: "none",
        });

        // 6. ВАЖНО: authorize URL ОТНОСИТЕЛЬНЫЙ (начинается с /).
        //    Абсолютный (http://...) Authentik отклонит.
        const authorizePath = `/application/o/authorize/?${authorizeParams.toString()}`;

        // 7. Собираем URL flow с next=authorizePath
        const flowParams = new URLSearchParams({
            next: authorizePath,
        });

        return `${AUTHENTIK_BASE_URL}/if/flow/${USER_SETTINGS_FLOW_SLUG}/?${flowParams.toString()}`;
    },

    /**
     * Возвращает URL password change flow Authentik — смена пароля.
     *
     * Логика полностью аналогична getUserSettingsFlowUrl:
     * генерируем PKCE, сохраняем returnPath, оборачиваем
     * authorize URL в next.
     *
     * @param returnPath — куда вернуть пользователя после flow.
     *                     По умолчанию "/profile".
     */
    async getPasswordChangeFlowUrl(returnPath: string = "/profile"): Promise<string> {
        // 1. Генерируем PKCE
        const codeVerifier = generateRandomString(64);
        const codeChallenge = await generateCodeChallenge(codeVerifier);

        // 2. Генерируем state
        const state = generateRandomString(32);

        // 3. Сохраняем
        sessionStorage.setItem(STORAGE_KEYS.pkceVerifier, codeVerifier);
        sessionStorage.setItem(STORAGE_KEYS.oauthState, state);
        sessionStorage.setItem("post_flow_redirect", returnPath);

        // 4. Строим authorize URL с prompt=none
        const authorizeParams = new URLSearchParams({
            client_id: CLIENT_ID,
            redirect_uri: REDIRECT_URI,
            response_type: "code",
            scope: OAUTH_SCOPES,
            state,
            code_challenge: codeChallenge,
            code_challenge_method: "S256",
            prompt: "none",
        });

        const authorizePath = `/application/o/authorize/?${authorizeParams.toString()}`;

        // 5. Собираем URL flow
        const flowParams = new URLSearchParams({
            next: authorizePath,
        });

        return `${AUTHENTIK_BASE_URL}/if/flow/${PASSWORD_CHANGE_FLOW_SLUG}/?${flowParams.toString()}`;
    },

    // ==========================================================
    // ХРАНИЛИЩЕ
    // ==========================================================

    /**
     * Проверяет, есть ли сохранённый access-токен.
     * НЕ проверяет срок действия токена — это делает Gateway.
     */
    isAuthenticated(): boolean {
        return !!localStorage.getItem(STORAGE_KEYS.accessToken);
    },

    /**
     * Возвращает сохранённого пользователя из localStorage.
     */
    getStoredUser(): UserDto | null {
        const userStr = localStorage.getItem(STORAGE_KEYS.user);
        if (!userStr) return null;

        try {
            return JSON.parse(userStr) as UserDto;
        } catch (e) {
            console.warn("Не удалось распарсить сохранённого пользователя:", e);
            return null;
        }
    },

    /**
     * Сохраняет токены и профиль в localStorage.
     */
    storeAuthData(tokenResponse: TokenResponse): void {
        localStorage.setItem(STORAGE_KEYS.accessToken, tokenResponse.accessToken);
        localStorage.setItem(STORAGE_KEYS.refreshToken, tokenResponse.refreshToken);
        localStorage.setItem(
            STORAGE_KEYS.user,
            JSON.stringify(tokenResponse.user)
        );

        // Устанавливаем Authorization по умолчанию для axios
        apiClient.defaults.headers.common["Authorization"] =
            `Bearer ${tokenResponse.accessToken}`;
    },

    // ==========================================================
    // ПРОФИЛЬ
    // ==========================================================

    /**
     * Обновляет профиль пользователя из Authentik.
     * Полезно вызывать при загрузке страницы для проверки актуальности токена,
     * а также после возврата из user settings flow — чтобы подтянуть
     * изменённые ФИО.
     */
    async getCurrentUser(): Promise<UserDto> {
        const accessToken = localStorage.getItem(STORAGE_KEYS.accessToken);
        if (!accessToken) {
            throw new Error("Пользователь не аутентифицирован");
        }
        return this.fetchUserInfo(accessToken);
    },

    // ==========================================================
    // ВСПОМОГАТЕЛЬНЫЕ
    // ==========================================================

    /**
     * Возвращает URL аватара пользователя.
     *
     * Authentik не хранит аватары в том виде, что кастомный Identity.
     * Используем Gravatar как универсальное решение:
     *   - Если у пользователя есть Gravatar на его email — покажется он.
     *   - Иначе — "mystery person" (`d=mp`).
     *
     * Если у вас есть собственный сервис аватаров — замените реализацию.
     */
    getAvatarUrl(userId: string, email?: string): string {
        const storedUser = this.getStoredUser();
        const effectiveEmail = email || storedUser?.email || "";

        if (effectiveEmail) {
            const hash = this.md5(effectiveEmail.trim().toLowerCase());
            return `https://www.gravatar.com/avatar/${hash}?d=mp&s=200`;
        }

        // Fallback: заглушка
        return `https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&s=200`;
    },

    /**
     * Простая реализация MD5 (нужна для Gravatar).
     * Без внешних зависимостей.
     */
    md5(input: string): string {
        function rotateLeft(value: number, shift: number): number {
            return (value << shift) | (value >>> (32 - shift));
        }
        function addUnsigned(x: number, y: number): number {
            const lsw = (x & 0xffff) + (y & 0xffff);
            const msw = (x >> 16) + (y >> 16) + (lsw >> 16);
            return (msw << 16) | (lsw & 0xffff);
        }
        function cmn(
            q: number,
            a: number,
            b: number,
            x: number,
            s: number,
            t: number
        ): number {
            a = addUnsigned(addUnsigned(a, q), addUnsigned(x, t));
            return addUnsigned(rotateLeft(a, s), b);
        }
        function ff(
            a: number, b: number, c: number, d: number,
            x: number, s: number, t: number
        ) { return cmn((b & c) | (~b & d), a, b, x, s, t); }
        function gg(
            a: number, b: number, c: number, d: number,
            x: number, s: number, t: number
        ) { return cmn((b & d) | (c & ~d), a, b, x, s, t); }
        function hh(
            a: number, b: number, c: number, d: number,
            x: number, s: number, t: number
        ) { return cmn(b ^ c ^ d, a, b, x, s, t); }
        function ii(
            a: number, b: number, c: number, d: number,
            x: number, s: number, t: number
        ) { return cmn(c ^ (b | ~d), a, b, x, s, t); }

        function convertToWordArray(str: string): number[] {
            const utf8 = unescape(encodeURIComponent(str));
            const lMessageLength = utf8.length;
            const lNumberOfWordsTemp1 = lMessageLength + 8;
            const lNumberOfWordsTemp2 =
                (lNumberOfWordsTemp1 - (lNumberOfWordsTemp1 % 64)) / 64;
            const lNumberOfWords = (lNumberOfWordsTemp2 + 1) * 16;
            const lWordArray: number[] = new Array(lNumberOfWords - 1).fill(0);
            let lByteCount = 0;
            while (lByteCount < lMessageLength) {
                const lWordCount = (lByteCount - (lByteCount % 4)) / 4;
                const lBytePosition = (lByteCount % 4) * 8;
                lWordArray[lWordCount] =
                    lWordArray[lWordCount] |
                    (utf8.charCodeAt(lByteCount) << lBytePosition);
                lByteCount++;
            }
            const lWordCount = (lByteCount - (lByteCount % 4)) / 4;
            const lBytePosition = (lByteCount % 4) * 8;
            lWordArray[lWordCount] = lWordArray[lWordCount] | (0x80 << lBytePosition);
            lWordArray[lNumberOfWords - 2] = lMessageLength << 3;
            lWordArray[lNumberOfWords - 1] = lMessageLength >>> 29;
            return lWordArray;
        }

        function wordToHex(value: number): string {
            let hex = "";
            for (let i = 0; i <= 3; i++) {
                const byte = (value >>> (i * 8)) & 255;
                hex += ("0" + byte.toString(16)).slice(-2);
            }
            return hex;
        }

        const x = convertToWordArray(input);
        let a = 0x67452301;
        let b = 0xefcdab89;
        let c = 0x98badcfe;
        let d = 0x10325476;

        for (let k = 0; k < x.length; k += 16) {
            const AA = a, BB = b, CC = c, DD = d;
            a = ff(a, b, c, d, x[k + 0], 7, 0xd76aa478);
            d = ff(d, a, b, c, x[k + 1], 12, 0xe8c7b756);
            c = ff(c, d, a, b, x[k + 2], 17, 0x242070db);
            b = ff(b, c, d, a, x[k + 3], 22, 0xc1bdceee);
            a = ff(a, b, c, d, x[k + 4], 7, 0xf57c0faf);
            d = ff(d, a, b, c, x[k + 5], 12, 0x4787c62a);
            c = ff(c, d, a, b, x[k + 6], 17, 0xa8304613);
            b = ff(b, c, d, a, x[k + 7], 22, 0xfd469501);
            a = ff(a, b, c, d, x[k + 8], 7, 0x698098d8);
            d = ff(d, a, b, c, x[k + 9], 12, 0x8b44f7af);
            c = ff(c, d, a, b, x[k + 10], 17, 0xffff5bb1);
            b = ff(b, c, d, a, x[k + 11], 22, 0x895cd7be);
            a = ff(a, b, c, d, x[k + 12], 7, 0x6b901122);
            d = ff(d, a, b, c, x[k + 13], 12, 0xfd987193);
            c = ff(c, d, a, b, x[k + 14], 17, 0xa679438e);
            b = ff(b, c, d, a, x[k + 15], 22, 0x49b40821);
            a = gg(a, b, c, d, x[k + 1], 5, 0xf61e2562);
            d = gg(d, a, b, c, x[k + 6], 9, 0xc040b340);
            c = gg(c, d, a, b, x[k + 11], 14, 0x265e5a51);
            b = gg(b, c, d, a, x[k + 0], 20, 0xe9b6c7aa);
            a = gg(a, b, c, d, x[k + 5], 5, 0xd62f105d);
            d = gg(d, a, b, c, x[k + 10], 9, 0x02441453);
            c = gg(c, d, a, b, x[k + 15], 14, 0xd8a1e681);
            b = gg(b, c, d, a, x[k + 4], 20, 0xe7d3fbc8);
            a = gg(a, b, c, d, x[k + 9], 5, 0x21e1cde6);
            d = gg(d, a, b, c, x[k + 14], 9, 0xc33707d6);
            c = gg(c, d, a, b, x[k + 3], 14, 0xf4d50d87);
            b = gg(b, c, d, a, x[k + 8], 20, 0x455a14ed);
            a = gg(a, b, c, d, x[k + 13], 5, 0xa9e3e905);
            d = gg(d, a, b, c, x[k + 2], 9, 0xfcefa3f8);
            c = gg(c, d, a, b, x[k + 7], 14, 0x676f02d9);
            b = gg(b, c, d, a, x[k + 12], 20, 0x8d2a4c8a);
            a = hh(a, b, c, d, x[k + 5], 4, 0xfffa3942);
            d = hh(d, a, b, c, x[k + 8], 11, 0x8771f681);
            c = hh(c, d, a, b, x[k + 11], 16, 0x6d9d6122);
            b = hh(b, c, d, a, x[k + 14], 23, 0xfde5380c);
            a = hh(a, b, c, d, x[k + 1], 4, 0xa4beea44);
            d = hh(d, a, b, c, x[k + 4], 11, 0x4bdecfa9);
            c = hh(c, d, a, b, x[k + 7], 16, 0xf6bb4b60);
            b = hh(b, c, d, a, x[k + 10], 23, 0xbebfbc70);
            a = hh(a, b, c, d, x[k + 13], 4, 0x289b7ec6);
            d = hh(d, a, b, c, x[k + 0], 11, 0xeaa127fa);
            c = hh(c, d, a, b, x[k + 3], 16, 0xd4ef3085);
            b = hh(b, c, d, a, x[k + 6], 23, 0x04881d05);
            a = hh(a, b, c, d, x[k + 9], 4, 0xd9d4d039);
            d = hh(d, a, b, c, x[k + 12], 11, 0xe6db99e5);
            c = hh(c, d, a, b, x[k + 15], 16, 0x1fa27cf8);
            b = hh(b, c, d, a, x[k + 2], 23, 0xc4ac5665);
            a = ii(a, b, c, d, x[k + 0], 6, 0xf4292244);
            d = ii(d, a, b, c, x[k + 7], 10, 0x432aff97);
            c = ii(c, d, a, b, x[k + 14], 15, 0xab9423a7);
            b = ii(b, c, d, a, x[k + 5], 21, 0xfc93a039);
            a = ii(a, b, c, d, x[k + 12], 6, 0x655b59c3);
            d = ii(d, a, b, c, x[k + 3], 10, 0x8f0ccc92);
            c = ii(c, d, a, b, x[k + 10], 15, 0xffeff47d);
            b = ii(b, c, d, a, x[k + 1], 21, 0x85845dd1);
            a = ii(a, b, c, d, x[k + 8], 6, 0x6fa87e4f);
            d = ii(d, a, b, c, x[k + 15], 10, 0xfe2ce6e0);
            c = ii(c, d, a, b, x[k + 6], 15, 0xa3014314);
            b = ii(b, c, d, a, x[k + 13], 21, 0x4e0811a1);
            a = ii(a, b, c, d, x[k + 4], 6, 0xf7537e82);
            d = ii(d, a, b, c, x[k + 11], 10, 0xbd3af235);
            c = ii(c, d, a, b, x[k + 2], 15, 0x2ad7d2bb);
            b = ii(b, c, d, a, x[k + 9], 21, 0xeb86d391);
            a = addUnsigned(a, AA);
            b = addUnsigned(b, BB);
            c = addUnsigned(c, CC);
            d = addUnsigned(d, DD);
        }

        return (
            wordToHex(a) + wordToHex(b) + wordToHex(c) + wordToHex(d)
        ).toLowerCase();
    },
};

export default authService;