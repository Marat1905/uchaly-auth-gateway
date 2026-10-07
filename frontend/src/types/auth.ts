// src/types/auth.ts
// =============================================================================
// Типы, используемые в приложении после перехода на Keycloak.
// UserDto — это "наша" проекция пользователя Keycloak, собранная из токена
// и/или Admin REST API. Она НЕ совпадает с Keycloak's UserRepresentation.
// =============================================================================

/**
 * Упрощённое представление пользователя, используемое в UI.
 * Формируется из access-токена (роли, sub, email, given_name, family_name)
 * плюс при необходимости — из Admin REST API (id, enabled, createdTimestamp).
 */
export interface UserDto {
    /** Уникальный идентификатор пользователя в Keycloak (sub / id). */
    id: string;
    /** Email. */
    email: string;
    /** Имя. */
    firstName: string;
    /** Фамилия. */
    lastName: string;
    /** Отчество (кастомный атрибут). */
    patronymic?: string;
    /** URL аватара (опционально, если вы храните его вне Keycloak). */
    avatarUrl?: string;
    /** Признак активности (enabled в Keycloak). */
    isActive: boolean;
    /** Признак удаления (в Keycloak нет мягкого удаления — всегда false). */
    isDeleted: boolean;
    /** Список realm-ролей пользователя. */
    roles: string[];
    /** Дата создания (из createdTimestamp / 1000). */
    createdAt: string;
    /** Вычисляемое полное имя. */
    fullName: string;
}

/**
 * Запрос на создание пользователя через Keycloak Admin API.
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
 * DTO роли (упрощённая проекция Keycloak RoleRepresentation).
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
 * Полезная нагрузка access-токена Keycloak (то, что нам нужно).
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
    /** Массив realm-ролей. */
    roles?: string[];
    /** Ресурсные роли (по клиентам). */
    resource_access?: Record<string, { roles: string[] }>;
    /** Аудитория. */
    aud?: string | string[];
}