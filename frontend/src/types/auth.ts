// src/types/auth.ts
// =============================================================================
// Типы, используемые в приложении после перехода на Keycloak/Authentik.
// UserDto — это "наша" проекция пользователя, собранная из токена
// и/или Admin REST API. Она НЕ совпадает с Authentik's UserRepresentation.
// =============================================================================

/**
 * Упрощённое представление пользователя, используемое в UI.
 * Формируется из access-токена (роли, sub, email, given_name, family_name)
 * плюс при необходимости — из Admin REST API (id, enabled, createdTimestamp).
 */
export interface UserDto {
    /** Уникальный идентификатор пользователя в Authentik (sub). */
    id: string;
    /** Email. */
    email: string;
    /** Имя. */
    firstName: string;
    /** Фамилия. */
    lastName: string;
    /** Отчество (кастомный атрибут). */
    patronymic?: string;
    /** URL аватара (опционально, если вы храните его вне IdP). */
    avatarUrl?: string;
    /** Признак активности (is_active). */
    isActive: boolean;
    /** Признак удаления (в Authentik нет мягкого удаления — всегда false). */
    isDeleted: boolean;
    /** Список групп/ролей пользователя. */
    roles: string[];
    /** Дата создания (ISO-строка). */
    createdAt: string;
    /** Вычисляемое полное имя. */
    fullName: string;
}

/**
 * Ответ с токенами OAuth2/OIDC.
 *
 * idToken — ID Token из OIDC (JWT). Он нужен для:
 *   - корректного завершения сессии Authentik (end-session),
 *   - проверки подлинности сессии на бэкенде при необходимости.
 */
export interface TokenResponse {
    accessToken: string;
    refreshToken: string;
    idToken: string;
    expiresAt: string;
    user: UserDto;
}

/**
 * Запрос на вход (задел на будущее — на данный момент не используется,
 * вход идёт через OAuth2-редирект).
 */
export interface LoginRequest {
    username?: string;
    password?: string;
}

/**
 * Запрос на создание пользователя через Admin API.
 */
export interface CreateUserRequest {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    patronymic?: string;
    roleIds: string[];
}

/**
 * Запрос на обновление пользователя.
 */
export interface UpdateUserRequest {
    firstName?: string;
    lastName?: string;
    patronymic?: string;
    isActive?: boolean;
    roleIds?: string[];
}

/**
 * Запрос на смену пароля.
 */
export interface ChangePasswordRequest {
    currentPassword: string;
    newPassword: string;
}

/**
 * DTO роли (упрощённая проекция RoleRepresentation).
 */
export interface RoleDto {
    id: string;
    name: string;
    description: string;
    userCount: number;
    createdAt: string;
}

export interface CreateRoleRequest {
    name: string;
    description: string;
}

export interface UpdateRoleRequest {
    name?: string;
    description?: string;
}

/**
 * Постраничный ответ.
 */
export interface PagedResultDto<T> {
    items: T[];
    totalCount: number;
    pageNumber: number;
    pageSize: number;
    totalPages: number;
}

/**
 * Статистика для админ-панели.
 */
export interface AdminStats {
    totalUsers: number;
    activeUsers: number;
    newUsersThisWeek: number;
    totalRoles: number;
}

/**
 * Фильтры для управления пользователями.
 */
export interface UserManagementFilters {
    search: string;
    role: string;
    isActive: boolean | null;
    isDeleted: boolean | null;
    page: number;
    pageSize: number;
}

/**
 * Полезная нагрузка access-токена Authentik (то, что нам нужно).
 */
export interface KeycloakTokenPayload {
    exp: number;
    iat: number;
    jti: string;
    iss: string;
    sub: string;
    typ: string;
    azp: string;
    session_state?: string;
    acr?: string;
    scope?: string;
    email?: string;
    email_verified?: boolean;
    preferred_username?: string;
    given_name?: string;
    family_name?: string;
    name?: string;
    patronymic?: string;
    /** Массив групп/ролей. */
    groups?: string[];
    roles?: string[];
    /** Ресурсные роли (по клиентам). */
    resource_access?: Record<string, { roles: string[] }>;
    /** Аудитория. */
    aud?: string | string[];
}