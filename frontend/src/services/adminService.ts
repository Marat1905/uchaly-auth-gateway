// src/services/adminService.ts
// =============================================================================
// Сервис администрирования пользователей и групп через API Gateway.
//
// ВАЖНО: этот сервис НЕ обращается к Authentik Admin API напрямую.
// Все запросы идут через Gateway (по /api/admin/*), который:
//   1. Проверяет, что у текущего пользователя есть роль "Admin"
//      (policy AdminOnly на контроллере).
//   2. Использует серверный Bearer-токен для вызовов
//      Authentik Admin API (/api/v3/core/...).
//   3. Преобразует ответы Authentik в публичные DTO, которые
//      совпадают с типами types/auth.ts.
//
// Эндпоинты Gateway (реализованы в AdminController.cs):
//
//   GET    /api/admin/stats
//   GET    /api/admin/users?search=&group=&isActive=&page=&pageSize=
//   GET    /api/admin/users/{id}
//   POST   /api/admin/users
//   PATCH  /api/admin/users/{id}
//   DELETE /api/admin/users/{id}
//   POST   /api/admin/users/{id}/set-password
//   POST   /api/admin/users/{id}/reset-password
//   PATCH  /api/admin/users/{id}/enabled
//   PATCH  /api/admin/users/{id}/roles
//   GET    /api/admin/roles
//   GET    /api/admin/groups
//   POST   /api/admin/groups
//   PATCH  /api/admin/groups/{id}
//   DELETE /api/admin/groups/{id}
//
// СЕРВИС ПРЕДОСТАВЛЯЕТ МЕТОДЫ, КОТОРЫЕ ВЫЗЫВАЮТСЯ ИЗ:
//   - AdminPanel.tsx           — getStats()
//   - UserManagement.tsx       — getUsers, getRoles, setUserEnabled,
//                                setUserRolesByName, deleteUser,
//                                resetUserPassword
//   - RoleManagement.tsx       — getRoles, createRole, updateRole, deleteRole
//
// АХИТЕКТУРНЫЙ КОММЕНТАРИЙ:
//   Роли в этом приложении == группы Authentik.
//   В UI мы называем их "роли", потому что семантически они
//   играют роль RBAC-ролей. Но на уровне API и Gateway это
//   всегда /api/admin/groups или /api/admin/users/{id}/roles.
// =============================================================================

import axios from "axios";
import type {
    UserDto,
    RoleDto,
    PagedResultDto,
    AdminStats,
    UserManagementFilters,
    CreateRoleRequest,
    UpdateRoleRequest,
} from "../types/auth";
import {
    requestInterceptor,
    requestErrorInterceptor,
    responseInterceptor,
    responseErrorInterceptor,
} from "./axiosInterceptors";

// ============================================================
// ТИПЫ PAYLOAD (приватные, не экспортируются)
// ============================================================

/**
 * Payload для создания пользователя.
 * Отправляется в POST /api/admin/users.
 *
 * Соответствует C# CreateUserRequest из AdminDtos.cs.
 */
interface CreateUserPayload {
    username: string;
    email: string;
    name: string;
    password: string;
    isActive?: boolean;
    /** Имена групп, в которые сразу добавить пользователя. */
    groups?: string[];
}

/**
 * Payload для обновления пользователя.
 * Отправляется в PATCH /api/admin/users/{id}.
 *
 * Соответствует C# UpdateUserRequest.
 */
interface UpdateUserPayload {
    email?: string;
    name?: string;
    isActive?: boolean;
}

/**
 * Payload для создания группы (роли).
 * Отправляется в POST /api/admin/groups.
 */
interface CreateGroupPayload {
    name: string;
    isSuperuser?: boolean;
    parent?: string | null;
}

/**
 * Payload для обновления группы.
 */
interface UpdateGroupPayload {
    name?: string;
    isSuperuser?: boolean;
    parent?: string | null;
}

// ============================================================
// AXIOS-КЛИЕНТ С ИНТЕРЦЕПТОРАМИ
// ============================================================
//
// Интерцепторы добавляют Authorization: Bearer <accessToken>
// и автоматически обновляют токен при 401.
// См. axiosInterceptors.ts.

const API_BASE_URL = "/api";

const apiClient = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        "Content-Type": "application/json",
    },
});

apiClient.interceptors.request.use(
    requestInterceptor,
    requestErrorInterceptor,
);
apiClient.interceptors.response.use(
    responseInterceptor,
    responseErrorInterceptor,
);

// ============================================================
// СЕРВИС
// ============================================================

export const adminService = {
    // ==========================================================
    // СТАТИСТИКА
    // ==========================================================

    /**
     * Получить агрегированную статистику для дашборда админа.
     *
     * Backend возвращает AdminStatsDto:
     *   { totalUsers, activeUsers, newUsersThisWeek, totalRoles }
     *
     * Вызывается из AdminPanel.tsx через loadStats().
     */
    async getStats(): Promise<AdminStats> {
        const response = await apiClient.get<AdminStats>("/admin/stats");
        return response.data;
    },

    // ==========================================================
    // ПОЛЬЗОВАТЕЛИ
    // ==========================================================

    /**
     * Поиск пользователей с фильтрами и пагинацией.
     *
     * Фильтры (UserManagementFilters):
     *   - search   — поиск по username/name/email
     *   - role     — имя группы (== имени роли)
     *   - isActive — true/false/null
     *   - isDeleted — не используется в Authentik (всегда null)
     *   - page, pageSize
     *
     * Возвращает PagedResultDto<UserDto>, как ожидает UI.
     */
    async getUsers(
        filters: UserManagementFilters,
    ): Promise<PagedResultDto<UserDto>> {
        const params = new URLSearchParams();

        params.append("page", String(filters.page));
        params.append("pageSize", String(filters.pageSize));

        if (filters.search) {
            params.append("search", filters.search);
        }

        if (filters.role) {
            // Поле role в фильтре — это имя группы (роли).
            params.append("group", filters.role);
        }

        if (filters.isActive !== null) {
            params.append("isActive", String(filters.isActive));
        }

        // isDeleted не передаём — в Authentik нет мягкого удаления.

        const response = await apiClient.get<PagedResultDto<UserDto>>(
            `/admin/users?${params.toString()}`,
        );
        return response.data;
    },

    /**
     * Получить пользователя по UUID.
     */
    async getUserById(id: string): Promise<UserDto> {
        const response = await apiClient.get<UserDto>(`/admin/users/${id}`);
        return response.data;
    },

    /**
     * Создать нового пользователя.
     *
     * Требует обязательных полей: username, email, password.
     * Поле name — необязательно, если пустое — backend использует username.
     */
    async createUser(payload: CreateUserPayload): Promise<UserDto> {
        const response = await apiClient.post<UserDto>(
            "/admin/users",
            payload,
        );
        return response.data;
    },

    /**
     * Обновить пользователя (email, name, isActive).
     */
    async updateUser(
        id: string,
        payload: UpdateUserPayload,
    ): Promise<UserDto> {
        const response = await apiClient.patch<UserDto>(
            `/admin/users/${id}`,
            payload,
        );
        return response.data;
    },

    /**
     * Удалить пользователя.
     *
     * ВНИМАНИЕ: в Authentik это физическое удаление, не soft-delete.
     * Восстановить пользователя нельзя (только из бэкапа БД).
     * В UI вместо удаления предпочтительна деактивация.
     */
    async deleteUser(id: string): Promise<void> {
        await apiClient.delete(`/admin/users/${id}`);
    },

    /**
     * Установить новый пароль пользователю.
     * Если password не передан — backend сгенерирует случайный
     * и вернёт его.
     */
    async setPassword(
        id: string,
        password?: string,
    ): Promise<{ password: string }> {
        const response = await apiClient.post<{ password: string }>(
            `/admin/users/${id}/set-password`,
            { password },
        );
        return response.data;
    },

    /**
     * Сбросить пароль пользователя — сгенерировать случайный
     * и вернуть его. Удобно для UI без формы ввода.
     *
     * Возвращает сам новый пароль строкой, потому что так
     * ожидает UserManagement.handleResetPassword.
     */
    async resetUserPassword(id: string): Promise<string> {
        const response = await apiClient.post<{ password: string }>(
            `/admin/users/${id}/reset-password`,
        );
        return response.data.password;
    },

    /**
     * Активировать/деактивировать пользователя.
     *
     * Вызывается из UserManagement.toggleUserStatus.
     */
    async setUserEnabled(id: string, isActive: boolean): Promise<UserDto> {
        const response = await apiClient.patch<UserDto>(
            `/admin/users/${id}/enabled`,
            { isActive },
        );
        return response.data;
    },

    /**
     * Активировать пользователя. Обёртка над setUserEnabled.
     */
    async activateUser(id: string): Promise<UserDto> {
        return this.setUserEnabled(id, true);
    },

    /**
     * Деактивировать пользователя. Обёртка над setUserEnabled.
     */
    async deactivateUser(id: string): Promise<UserDto> {
        return this.setUserEnabled(id, false);
    },

    /**
     * Установить список групп (ролей) пользователя.
     * Передаётся ПОЛНЫЙ желаемый список имён — старые группы,
     * которых нет в новом списке, будут отвязаны.
     */
    async setUserGroups(
        id: string,
        groupNames: string[],
    ): Promise<UserDto> {
        const response = await apiClient.patch<UserDto>(
            `/admin/users/${id}/roles`,
            { groups: groupNames },
        );
        return response.data;
    },

    /**
     * Алиас для setUserGroups — используется в UserManagement.tsx
     * под именем setUserRolesByName (роли == группы).
     */
    async setUserRolesByName(
        userId: string,
        roleNames: string[],
    ): Promise<UserDto> {
        return this.setUserGroups(userId, roleNames);
    },

    /**
     * Добавить пользователя в одну группу (без удаления из остальных).
     */
    async addUserToGroup(
        userId: string,
        groupName: string,
    ): Promise<UserDto> {
        const user = await this.getUserById(userId);
        const groups = Array.from(new Set([...user.roles, groupName]));
        return this.setUserGroups(userId, groups);
    },

    /**
     * Удалить пользователя из одной группы.
     */
    async removeUserFromGroup(
        userId: string,
        groupName: string,
    ): Promise<UserDto> {
        const user = await this.getUserById(userId);
        const groups = user.roles.filter((g) => g !== groupName);
        return this.setUserGroups(userId, groups);
    },

    // ==========================================================
    // ГРУППЫ / РОЛИ
    // ==========================================================

    /**
     * Получить список всех ролей (групп) с количеством пользователей.
     *
     * Backend возвращает List<AdminGroupDto>, который в точности
     * соответствует TypeScript-типу RoleDto.
     */
    async getRoles(): Promise<RoleDto[]> {
        const response = await apiClient.get<RoleDto[]>("/admin/roles");
        return response.data;
    },

    /**
     * Алиас getRoles — на случай, если где-то зовут getAllGroups.
     */
    async getAllGroups(): Promise<RoleDto[]> {
        return this.getRoles();
    },

    /**
     * Получить роль (группу) по UUID.
     */
    async getGroupById(id: string): Promise<RoleDto> {
        const response = await apiClient.get<RoleDto>(
            `/admin/groups/${id}`,
        );
        return response.data;
    },

    /**
     * Создать новую роль (группу).
     */
    async createRole(payload: CreateRoleRequest): Promise<RoleDto> {
        const body: CreateGroupPayload = {
            name: payload.name,
        };
        const response = await apiClient.post<RoleDto>(
            "/admin/groups",
            body,
        );
        return response.data;
    },

    /**
     * Обновить роль (группу).
     *
     * ВНИМАНИЕ: в Authentik имя группы переименовать нельзя —
     * поэтому UI блокирует поле name. Backend тоже примет name,
     * но реально применится только к описанию (которое мы храним
     * в attributes, если оно есть).
     */
    async updateRole(
        id: string,
        payload: UpdateRoleRequest,
    ): Promise<RoleDto> {
        const body: UpdateGroupPayload = {
            name: payload.name,
        };
        const response = await apiClient.patch<RoleDto>(
            `/admin/groups/${id}`,
            body,
        );
        return response.data;
    },

    /**
     * Удалить роль (группу).
     *
     * Authentik вернёт ошибку 400, если в группе есть пользователи.
     * UI должен показать её.
     */
    async deleteRole(id: string): Promise<void> {
        await apiClient.delete(`/admin/groups/${id}`);
    },

    // ==========================================================
    // ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ
    // ==========================================================

    /**
     * Сформировать URL аватара пользователя.
     * В Authentik используется Gravatar или внешний URL из `avatar`.
     */
    getAvatarUrl(userId: string, email?: string): string {
        if (email) {
            const hash = this.md5(email.trim().toLowerCase());
            return `https://www.gravatar.com/avatar/${hash}?d=mp&s=200`;
        }
        return `https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&s=200`;
    },

    /**
     * Простой MD5-хеш для Gravatar.
     * Реализация без внешних зависимостей.
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
            t: number,
        ): number {
            a = addUnsigned(addUnsigned(a, q), addUnsigned(x, t));
            return addUnsigned(rotateLeft(a, s), b);
        }
        function ff(a: number, b: number, c: number, d: number, x: number, s: number, t: number) {
            return cmn((b & c) | (~b & d), a, b, x, s, t);
        }
        function gg(a: number, b: number, c: number, d: number, x: number, s: number, t: number) {
            return cmn((b & d) | (c & ~d), a, b, x, s, t);
        }
        function hh(a: number, b: number, c: number, d: number, x: number, s: number, t: number) {
            return cmn(b ^ c ^ d, a, b, x, s, t);
        }
        function ii(a: number, b: number, c: number, d: number, x: number, s: number, t: number) {
            return cmn(c ^ (b | ~d), a, b, x, s, t);
        }
        function convertToWordArray(str: string): number[] {
            const utf8 = unescape(encodeURIComponent(str));
            const lWordCount = utf8.length;
            const lMessageLength = lWordCount;
            const lNumberOfWordsTemp1 = lMessageLength + 8;
            const lNumberOfWordsTemp2 =
                (lNumberOfWordsTemp1 - (lNumberOfWordsTemp1 % 64)) / 64;
            const lNumberOfWords = (lNumberOfWordsTemp2 + 1) * 16;
            const lWordArray: number[] = new Array(lNumberOfWords - 1).fill(0);
            let lBytePosition = 0;
            let lByteCount = 0;
            while (lByteCount < lMessageLength) {
                const lWordCount2 = (lByteCount - (lByteCount % 4)) / 4;
                const lBytePosition2 = (lByteCount % 4) * 8;
                lWordArray[lWordCount2] =
                    lWordArray[lWordCount2] |
                    (utf8.charCodeAt(lByteCount) << lBytePosition2);
                lByteCount++;
            }
            const lWordCount3 = (lByteCount - (lByteCount % 4)) / 4;
            const lBytePosition3 = (lByteCount % 4) * 8;
            lWordArray[lWordCount3] =
                lWordArray[lWordCount3] | (0x80 << lBytePosition3);
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
            const AA = a;
            const BB = b;
            const CC = c;
            const DD = d;
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

export default adminService;