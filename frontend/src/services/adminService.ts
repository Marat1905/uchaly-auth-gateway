/**
 * adminService.ts
 *
 * Сервис администрирования пользователей и групп через API Gateway.
 *
 * ВАЖНО: этот сервис НЕ обращается к Authentik Admin API напрямую.
 * Все запросы идут через Gateway, который:
 *   1. Проверяет, что у текущего пользователя есть роль "Admin".
 *   2. Использует серверный токен для вызова Authentik Admin API.
 *   3. Возвращает результат фронтенду в нормализованном виде.
 *
 * Эндпоинты Gateway:
 *   GET    /api/admin/stats
 *   GET    /api/admin/users?search=&group=&isActive=&page=&pageSize=
 *   GET    /api/admin/users/{id}
 *   POST   /api/admin/users
 *   PATCH  /api/admin/users/{id}
 *   DELETE /api/admin/users/{id}
 *   POST   /api/admin/users/{id}/set-password
 *   POST   /api/admin/users/{id}/activate
 *   POST   /api/admin/users/{id}/deactivate
 *   GET    /api/admin/groups
 *   POST   /api/admin/groups
 *   PATCH  /api/admin/groups/{id}
 *   DELETE /api/admin/groups/{id}
 *   PATCH  /api/admin/users/{id}/groups   (привязка пользователя к группам)
 */

import axios from 'axios';
import {
    requestInterceptor,
    requestErrorInterceptor,
    responseInterceptor,
    responseErrorInterceptor,
} from './axiosInterceptors';

// ============================================================
// Типы данных
// ============================================================

/** Пользователь (совместим со старым UserDto). */
export interface AdminUserDto {
    id: string;              // UUID (pk в Authentik)
    username: string;        // username в Authentik
    email: string;
    firstName: string;       // given_name
    lastName: string;        // family_name
    patronymic?: string;     // middle_name (если настроено)
    name: string;            // полное имя
    avatarUrl?: string;      // picture
    isActive: boolean;       // is_active
    isSuperuser: boolean;    // is_superuser
    isDeleted: boolean;      // вычисляется (в Authentik нет soft-delete)
    roles: string[];         // группы пользователя
    createdAt: string;       // date_joined
    lastLogin?: string;      // last_login
}

/** Группа (аналог роли). */
export interface AdminGroupDto {
    id: string;
    name: string;
    isSuperuser: boolean;
    parent?: string | null;
    userCount: number;
    createdAt: string;
}

/** Статистика для админ-панели. */
export interface AdminStats {
    totalUsers: number;
    activeUsers: number;
    newUsersThisWeek: number;
    totalGroups: number;
    totalApplications: number;
}

/** Фильтры для поиска пользователей. */
export interface AdminUserFilters {
    search: string;
    group: string;
    isActive: boolean | null;
    page: number;
    pageSize: number;
}

/** Пагинированный ответ. */
export interface PagedResult<T> {
    items: T[];
    totalCount: number;
    pageNumber: number;
    pageSize: number;
    totalPages: number;
}

/** Запрос на создание пользователя. */
export interface CreateUserPayload {
    username: string;
    email: string;
    name: string;
    password: string;
    isActive?: boolean;
    groups?: string[];       // имена групп
}

/** Запрос на обновление пользователя. */
export interface UpdateUserPayload {
    email?: string;
    name?: string;
    isActive?: boolean;
}

/** Запрос на создание/обновление группы. */
export interface CreateGroupPayload {
    name: string;
    isSuperuser?: boolean;
    parent?: string | null;
}

export interface UpdateGroupPayload {
    name?: string;
    isSuperuser?: boolean;
    parent?: string | null;
}

// ============================================================
// Axios-клиент с интерцепторами
// ============================================================

const API_BASE_URL = '/api';

const apiClient = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        'Content-Type': 'application/json',
    },
});

apiClient.interceptors.request.use(requestInterceptor, requestErrorInterceptor);
apiClient.interceptors.response.use(responseInterceptor, responseErrorInterceptor);

// ============================================================
// Сервис
// ============================================================

export const adminService = {
    // ==========================================================
    // СТАТИСТИКА
    // ==========================================================

    /**
     * Получить агрегированную статистику для дашборда админа.
     */
    async getStats(): Promise<AdminStats> {
        const response = await apiClient.get<AdminStats>('/admin/stats');
        return response.data;
    },

    // ==========================================================
    // ПОЛЬЗОВАТЕЛИ
    // ==========================================================

    /**
     * Поиск пользователей с фильтрами и пагинацией.
     */
    async searchUsers(filters: AdminUserFilters): Promise<PagedResult<AdminUserDto>> {
        const params = new URLSearchParams();
        params.append('page', filters.page.toString());
        params.append('pageSize', filters.pageSize.toString());

        if (filters.search) params.append('search', filters.search);
        if (filters.group) params.append('group', filters.group);
        if (filters.isActive !== null) {
            params.append('isActive', filters.isActive.toString());
        }

        const response = await apiClient.get<PagedResult<AdminUserDto>>(
            `/admin/users?${params.toString()}`
        );
        return response.data;
    },

    /**
     * Получить пользователя по ID.
     */
    async getUserById(id: string): Promise<AdminUserDto> {
        const response = await apiClient.get<AdminUserDto>(`/admin/users/${id}`);
        return response.data;
    },

    /**
     * Создать нового пользователя.
     */
    async createUser(payload: CreateUserPayload): Promise<AdminUserDto> {
        const response = await apiClient.post<AdminUserDto>('/admin/users', payload);
        return response.data;
    },

    /**
     * Обновить пользователя (email, имя, активность).
     */
    async updateUser(id: string, payload: UpdateUserPayload): Promise<AdminUserDto> {
        const response = await apiClient.patch<AdminUserDto>(
            `/admin/users/${id}`,
            payload
        );
        return response.data;
    },

    /**
     * Удалить пользователя.
     *
     * ВНИМАНИЕ: в Authentik это физическое удаление, не soft-delete.
     * Восстановить пользователя нельзя (только из бэкапа БД).
     * Рекомендуется вместо удаления использовать деактивацию.
     */
    async deleteUser(id: string): Promise<void> {
        await apiClient.delete(`/admin/users/${id}`);
    },

    /**
     * Установить новый пароль пользователю.
     * Возвращает сгенерированный пароль, если он не был передан.
     */
    async setPassword(id: string, password?: string): Promise<{ password: string }> {
        const response = await apiClient.post<{ password: string }>(
            `/admin/users/${id}/set-password`,
            { password }
        );
        return response.data;
    },

    /**
     * Активировать пользователя.
     */
    async activateUser(id: string): Promise<AdminUserDto> {
        const response = await apiClient.post<AdminUserDto>(
            `/admin/users/${id}/activate`
        );
        return response.data;
    },

    /**
     * Деактивировать пользователя.
     */
    async deactivateUser(id: string): Promise<AdminUserDto> {
        const response = await apiClient.post<AdminUserDto>(
            `/admin/users/${id}/deactivate`
        );
        return response.data;
    },

    /**
     * Установить список групп пользователя.
     * Передаётся полный список — старые группы будут отвязаны.
     */
    async setUserGroups(id: string, groupNames: string[]): Promise<AdminUserDto> {
        const response = await apiClient.patch<AdminUserDto>(
            `/admin/users/${id}/groups`,
            { groups: groupNames }
        );
        return response.data;
    },

    /**
     * Добавить пользователя в группу (без удаления из остальных).
     */
    async addUserToGroup(userId: string, groupName: string): Promise<AdminUserDto> {
        const user = await this.getUserById(userId);
        const groups = Array.from(new Set([...user.roles, groupName]));
        return this.setUserGroups(userId, groups);
    },

    /**
     * Удалить пользователя из группы.
     */
    async removeUserFromGroup(userId: string, groupName: string): Promise<AdminUserDto> {
        const user = await this.getUserById(userId);
        const groups = user.roles.filter((g) => g !== groupName);
        return this.setUserGroups(userId, groups);
    },

    // ==========================================================
    // ГРУППЫ (аналог ролей)
    // ==========================================================

    /**
     * Получить список всех групп с количеством пользователей.
     */
    async getAllGroups(): Promise<AdminGroupDto[]> {
        const response = await apiClient.get<AdminGroupDto[]>('/admin/groups');
        return response.data;
    },

    /**
     * Получить группу по ID.
     */
    async getGroupById(id: string): Promise<AdminGroupDto> {
        const response = await apiClient.get<AdminGroupDto>(`/admin/groups/${id}`);
        return response.data;
    },

    /**
     * Создать новую группу.
     */
    async createGroup(payload: CreateGroupPayload): Promise<AdminGroupDto> {
        const response = await apiClient.post<AdminGroupDto>('/admin/groups', payload);
        return response.data;
    },

    /**
     * Обновить группу.
     */
    async updateGroup(id: string, payload: UpdateGroupPayload): Promise<AdminGroupDto> {
        const response = await apiClient.patch<AdminGroupDto>(
            `/admin/groups/${id}`,
            payload
        );
        return response.data;
    },

    /**
     * Удалить группу.
     */
    async deleteGroup(id: string): Promise<void> {
        await apiClient.delete(`/admin/groups/${id}`);
    },

    // ==========================================================
    // ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ
    // ==========================================================

    /**
     * Сформировать URL аватара пользователя.
     * В Authentik используется Gravatar или внешний URL из `picture`.
     */
    getAvatarUrl(userId: string, email?: string): string {
        if (email) {
            // Gravatar по email — надёжнее, чем по UUID
            // `d=mp` — "mystery person" заглушка, если у пользователя нет Gravatar
            const hash = this.md5(email.trim().toLowerCase());
            return `https://www.gravatar.com/avatar/${hash}?d=mp&s=200`;
        }
        // Fallback: заглушка-иконка
        return `https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&s=200`;
    },

    /**
     * Простой MD5-хеш для Gravatar.
     * Реализация без внешних зависимостей.
     */
    md5(input: string): string {
        // Реализация MD5 — compact version
        // Источник: адаптировано из публичного домена
        function rotateLeft(value: number, shift: number): number {
            return (value << shift) | (value >>> (32 - shift));
        }
        function addUnsigned(x: number, y: number): number {
            const lsw = (x & 0xffff) + (y & 0xffff);
            const msw = (x >> 16) + (y >> 16) + (lsw >> 16);
            return (msw << 16) | (lsw & 0xffff);
        }
        function cmn(
            q: number, a: number, b: number, x: number, s: number, t: number
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
            const lNumberOfWordsTemp2 = (lNumberOfWordsTemp1 - (lNumberOfWordsTemp1 % 64)) / 64;
            const lNumberOfWords = (lNumberOfWordsTemp2 + 1) * 16;
            const lWordArray: number[] = new Array(lNumberOfWords - 1).fill(0);
            let lBytePosition = 0;
            let lByteCount = 0;
            while (lByteCount < lMessageLength) {
                const lWordCount2 = (lByteCount - (lByteCount % 4)) / 4;
                const lBytePosition2 = (lByteCount % 4) * 8;
                lWordArray[lWordCount2] = lWordArray[lWordCount2] | (utf8.charCodeAt(lByteCount) << lBytePosition2);
                lByteCount++;
            }
            const lWordCount3 = (lByteCount - (lByteCount % 4)) / 4;
            const lBytePosition3 = (lByteCount % 4) * 8;
            lWordArray[lWordCount3] = lWordArray[lWordCount3] | (0x80 << lBytePosition3);
            lWordArray[lNumberOfWords - 2] = lMessageLength << 3;
            lWordArray[lNumberOfWords - 1] = lMessageLength >>> 29;
            return lWordArray;
        }
        function wordToHex(value: number): string {
            let hex = '';
            for (let i = 0; i <= 3; i++) {
                const byte = (value >>> (i * 8)) & 255;
                hex += ('0' + byte.toString(16)).slice(-2);
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

        const temp = wordToHex(a) + wordToHex(b) + wordToHex(c) + wordToHex(d);
        return temp.toLowerCase();
    },
};

export default adminService;