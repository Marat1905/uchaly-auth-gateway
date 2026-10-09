// src/services/adminService.ts
// =============================================================================
// Сервис администрирования для Authentik (через API Gateway).
//
// АРХИТЕКТУРНОЕ ОТЛИЧИЕ ОТ KEYCLOAK-ВЕРСИИ:
//
//   Keycloak Admin REST API — публичный и делегируемый: он принимает
//   user-токен, если у пользователя есть роль Admin, и поддерживает CORS.
//   Поэтому SPA могла ходить в Keycloak напрямую.
//
//   Authentik Admin API устроен иначе:
//     1. Он требует API-токен (Bearer <API_TOKEN>), а не OIDC-токен
//        пользователя. API-токен — это секрет сервисного пользователя.
//     2. Токен НЕЛЬЗЯ отдавать в браузер: любой сможет через DevTools
//        вызвать /api/v3/core/users/ и, например, удалить всех.
//     3. CORS у Admin API по умолчанию закрыт — браузер всё равно
//        не смог бы напрямую обратиться к /api/v3/core/...
//     4. Delegated-режима (как у Keycloak) у Authentik нет.
//
//   Поэтому все вызовы идут через API Gateway, который:
//     - принимает user-токен от SPA и проверяет роль Admin
//       (policy "AdminOnly" на AdminController);
//     - подкладывает серверный API-токен (AUTHENTIK_ADMIN_TOKEN);
//     - вызывает /api/v3/core/... в Authentik;
//     - маппит ответы в публичные DTO.
//
//   Схема:
//
//     Browser ──Bearer(user)──► Gateway ──Bearer(API)──► Authentik
//            ◄────JSON────────┘         ◄────JSON──────┘
//
// ЭНДПОИНТЫ GATEWAY (реализованы в AdminController.cs):
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
// ВАЖНО ПРО «РОЛИ»:
//   В UI мы называем их «роли», потому что семантически они играют
//   RBAC-роль. В Authentik это группы (Groups). На уровне API
//   Gateway это /api/admin/groups и /api/admin/users/{id}/roles —
//   всё работает через один и тот же слой.
//
// ВАЖНО ПРО description У ГРУППЫ:
//   У группы Authentik нет отдельного поля description — в отличие
//   от Keycloak. Мы храним описание в attributes.description
//   (JSONB-поле). Фронт присылает обычную строку, а backend сам
//   упаковывает её в attributes перед отправкой в Authentik.
//
// СОВМЕСТИМОСТЬ С UI:
//   Сервис сохраняет сигнатуры, которые уже используются в:
//     - AdminPanel.tsx           → getStats()
//     - UserManagement.tsx       → getUsers, getRoles, setUserEnabled,
//                                  setUserRolesByName, deleteUser,
//                                  resetUserPassword
//     - RoleManagement.tsx       → getRoles, createRole, updateRole,
//                                  deleteRole
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
// AXIOS-КЛИЕНТ
// ============================================================
//
// Используем общие интерцепторы из axiosInterceptors.ts:
//   - добавляют Authorization: Bearer <accessToken> из localStorage;
//   - при 401 автоматически пытаются обновить токен через
//     authService.refreshToken и повторить запрос;
//   - при неудачном refresh делают локальный logout.

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
     * Агрегированная статистика для дашборда админа.
     *
     * Backend (AdminController.GetStats) делает несколько
     * запросов к Authentik Admin API и суммирует:
     *   - totalUsers
     *   - activeUsers
     *   - newUsersThisWeek
     *   - totalRoles (число групп)
     */
    async getStats(): Promise<AdminStats> {
        const response = await apiClient.get<AdminStats>("/admin/stats");
        return response.data;
    },

    // ==========================================================
    // ПОЛЬЗОВАТЕЛИ
    // ==========================================================

    /**
     * Постраничный список пользователей с фильтрами.
     *
     * Все фильтры (search / role / isActive) уходят на backend,
     * который транслирует их в query-параметры Authentik
     * (search=, groups_by_name=, is_active=).
     *
     * isDeleted — в Authentik нет мягкого удаления, всегда null.
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
            // Поле role фильтра — имя группы (роли).
            params.append("group", filters.role);
        }

        if (filters.isActive !== null) {
            params.append("isActive", String(filters.isActive));
        }

        // isDeleted не передаём — в Authentik мягкого удаления нет.

        const response = await apiClient.get<PagedResultDto<UserDto>>(
            `/admin/users?${params.toString()}`,
        );
        return response.data;
    },

    /**
     * Получить пользователя по числовому pk (в виде строки).
     *
     * ВАЖНО: на вход идёт именно pk, а не UUID. Это следствие
     * того, что Authentik Admin API на /api/v3/core/users/{id}/
     * ожидает числовой pk.
     */
    async getUserById(id: string): Promise<UserDto> {
        const response = await apiClient.get<UserDto>(`/admin/users/${id}`);
        return response.data;
    },

    /**
     * Создать пользователя.
     *
     * ВАЖНО: сигнатура совпадает с тем, что ожидает
     * UserManagement.tsx. Тип CreateUserRequest — из types/auth.ts,
     * содержит firstName/lastName/patronymic/email/password/roleIds.
     *
     * Backend склеивает firstName + lastName + patronymic в
     * user.name и создаёт пользователя в Authentik, после чего
     * назначает группы по именам из roleIds.
     */
    async createUser(data: {
        email: string;
        password: string;
        firstName: string;
        lastName: string;
        patronymic?: string;
        roleIds: string[];
    }): Promise<UserDto> {
        const fullName = [data.lastName, data.firstName, data.patronymic]
            .filter(Boolean)
            .join(" ")
            .trim();

        const payload = {
            username: data.email,
            email: data.email,
            name: fullName || data.email,
            password: data.password,
            isActive: true,
            groups: data.roleIds,
        };

        const response = await apiClient.post<UserDto>(
            "/admin/users",
            payload,
        );
        return response.data;
    },

    /**
     * Обновить пользователя.
     *
     * Backend:
     *   - пересобирает name из ФИО (если они переданы);
     *   - шлёт PATCH в Authentik;
     *   - если переданы roleIds — полностью заменяет группы.
     */
    async updateUser(
        id: string,
        data: {
            firstName?: string;
            lastName?: string;
            patronymic?: string;
            isActive?: boolean;
            roleIds?: string[];
        },
    ): Promise<UserDto> {
        const fullName =
            data.firstName !== undefined ||
                data.lastName !== undefined ||
                data.patronymic !== undefined
                ? [data.lastName, data.firstName, data.patronymic]
                    .filter(Boolean)
                    .join(" ")
                    .trim()
                : undefined;

        const payload = {
            name: fullName,
            isActive: data.isActive,
        };

        const response = await apiClient.patch<UserDto>(
            `/admin/users/${id}`,
            payload,
        );

        if (data.roleIds) {
            await this.setUserRolesByName(id, data.roleIds);
            return this.getUserById(id);
        }

        return response.data;
    },

    /**
     * Удалить пользователя.
     *
     * ВНИМАНИЕ: в Authentik это физическое удаление, не soft-delete.
     * Восстановить пользователя можно только из бэкапа БД.
     */
    async deleteUser(id: string): Promise<void> {
        await apiClient.delete(`/admin/users/${id}`);
    },

    /**
     * Включить/выключить пользователя.
     *
     * Вызывается из UserManagement.toggleUserStatus.
     */
    async setUserEnabled(id: string, enabled: boolean): Promise<void> {
        await apiClient.patch(`/admin/users/${id}/enabled`, {
            isActive: enabled,
        });
    },

    /**
     * Сбросить пароль — backend сгенерирует случайный и вернёт его.
     *
     * Сгенерированный пароль показывается пользователю в модалке
     * UserManagement и больше нигде не сохраняется.
     */
    async resetUserPassword(id: string): Promise<string> {
        const response = await apiClient.post<{ password: string }>(
            `/admin/users/${id}/reset-password`,
        );
        return response.data.password;
    },

    /**
     * Установить пароль вручную (если фронт его знает).
     * В текущем UI не используется, но оставлен для полноты.
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
     * Полностью заменить список групп (ролей) пользователя.
     *
     * Сигнатура совпадает с Keycloak-версией: setUserRolesByName.
     * Передаётся ПОЛНЫЙ список ИМЁН. Группы, которых нет в новом
     * списке, будут отвязаны.
     */
    async setUserRolesByName(
        userId: string,
        roleNames: string[],
    ): Promise<void> {
        await apiClient.patch(`/admin/users/${userId}/roles`, {
            groups: roleNames,
        });
    },

    /**
     * Добавить пользователя в одну группу (без удаления из остальных).
     * В UI сейчас не используется, но полезно как утилита.
     */
    async addUserToGroup(
        userId: string,
        groupName: string,
    ): Promise<UserDto> {
        const user = await this.getUserById(userId);
        const groups = Array.from(new Set([...user.roles, groupName]));
        await this.setUserRolesByName(userId, groups);
        return this.getUserById(userId);
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
        await this.setUserRolesByName(userId, groups);
        return this.getUserById(userId);
    },

    // ==========================================================
    // РОЛИ (== ГРУППЫ AUTHENTIK)
    // ==========================================================

    /**
     * Получить все роли (группы) системы.
     *
     * Сигнатура совпадает с Keycloak-версией. В отличие от
     * Keycloak, никаких служебных ролей (offline_access,
     * uma_authorization, default-roles-*) в Authentik нет —
     * фильтрация не нужна.
     */
    async getRoles(): Promise<RoleDto[]> {
        const response = await apiClient.get<RoleDto[]>("/admin/roles");
        return response.data;
    },

    /**
     * Алиас для getRoles — на случай, если где-то зовут getAllGroups.
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
     * Создать роль (группу).
     *
     * В Authentik у группы нет отдельного поля description —
     * backend упакует description в attributes автоматически.
     */
    async createRole(data: CreateRoleRequest): Promise<RoleDto> {
        const response = await apiClient.post<RoleDto>("/admin/groups", {
            name: data.name,
            description: data.description,
        });
        return response.data;
    },

    /**
     * Обновить роль (группу).
     *
     * В ОТЛИЧИЕ ОТ KEYCLOAK, в Authentik имя роли МОЖНО менять —
     * это обычное поле. Передаём оба поля: и name, и description.
     * Backend положит description в attributes.description, потому
     * что отдельного поля description у группы Authentik нет.
     */
    async updateRole(
        id: string,
        data: UpdateRoleRequest,
    ): Promise<RoleDto> {
        const response = await apiClient.patch<RoleDto>(
            `/admin/groups/${id}`,
            {
                name: data.name,
                description: data.description,
            },
        );
        return response.data;
    },

    /**
     * Удалить роль (группу).
     *
     * Authentik вернёт ошибку 400, если в группе есть пользователи.
     * UI покажет эту ошибку через alert (см. RoleManagement.tsx).
     */
    async deleteRole(id: string): Promise<void> {
        await apiClient.delete(`/admin/groups/${id}`);
    },

    // ==========================================================
    // ВСПОМОГАТЕЛЬНЫЕ
    // ==========================================================

    /**
     * URL аватара. В Authentik аватары хранятся как Gravatar-хеши
     * или внешние URL в поле user.avatar. Если у пользователя
     * нет avatar — используем Gravatar по email.
     */
    getAvatarUrl(userId: string, email?: string): string {
        if (email) {
            const hash = this.md5(email.trim().toLowerCase());
            return `https://www.gravatar.com/avatar/${hash}?d=mp&s=200`;
        }
        return `https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&s=200`;
    },

    /**
     * MD5 для Gravatar. Реализация без внешних зависимостей.
     * (Тот же код, что был в Keycloak-версии — тут он не зависит
     * от IdP и работает одинаково.)
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