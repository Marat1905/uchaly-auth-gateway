// src/Uchaly.APIgateway/Services/IAuthentikAdminClient.cs
// =============================================================================
// Интерфейс клиента Authentik Admin API.
//
// Слой абстракции нужен, чтобы:
//   1. Изолировать контроллер от HTTP-деталей.
//   2. Позволить подменить реализацию в тестах.
//   3. Держать все вызовы /api/v3/core/... в одном месте.
//
// Методы возвращают публичные DTO (AdminUserDto/AdminGroupDto),
// а не Authentik-объекты — контроллер не знает о внутреннем
// устройстве Authentik API.
// =============================================================================

using Uchaly.APIgateway.Models.Admin;

namespace Uchaly.APIgateway.Services;

/// <summary>
/// Клиент для работы с Authentik Admin REST API.
/// </summary>
public interface IAuthentikAdminClient
{
    // -------------------------------------------------------------------------
    // СТАТИСТИКА
    // -------------------------------------------------------------------------

    /// <summary>
    /// Возвращает агрегированную статистику для дашборда.
    /// Делает несколько запросов к Authentik и суммирует:
    ///   - totalUsers        — общее число пользователей
    ///   - activeUsers       — число активных
    ///   - newUsersThisWeek  — зарегистрированных за 7 дней
    ///   - totalRoles        — число групп
    /// </summary>
    Task<AdminStatsDto> GetStatsAsync(CancellationToken ct = default);

    // -------------------------------------------------------------------------
    // ПОЛЬЗОВАТЕЛИ
    // -------------------------------------------------------------------------

    /// <summary>
    /// Поиск пользователей с фильтрами и пагинацией.
    /// </summary>
    Task<PagedResultDto<AdminUserDto>> ListUsersAsync(
        string? search,
        string? group,
        bool? isActive,
        int page,
        int pageSize,
        CancellationToken ct = default);

    /// <summary>Получить одного пользователя по UUID.</summary>
    Task<AdminUserDto?> GetUserAsync(string id, CancellationToken ct = default);

    /// <summary>Создать пользователя.</summary>
    Task<AdminUserDto> CreateUserAsync(
        CreateUserRequest request,
        CancellationToken ct = default);

    /// <summary>Обновить пользователя (email, name, isActive).</summary>
    Task<AdminUserDto> UpdateUserAsync(
        string id,
        UpdateUserRequest request,
        CancellationToken ct = default);

    /// <summary>Удалить пользователя. В Authentik — физическое удаление.</summary>
    Task DeleteUserAsync(string id, CancellationToken ct = default);

    /// <summary>
    /// Установить пароль. Если password == null — генерирует
    /// случайный пароль и возвращает его.
    /// </summary>
    Task<string> SetPasswordAsync(
        string id,
        string? password,
        CancellationToken ct = default);

    /// <summary>Активировать/деактивировать пользователя.</summary>
    Task<AdminUserDto> SetUserEnabledAsync(
        string id,
        bool isActive,
        CancellationToken ct = default);

    /// <summary>
    /// Полностью заменить список групп пользователя.
    /// Передаётся список ИМЁН групп (не UUID).
    /// </summary>
    Task<AdminUserDto> SetUserGroupsAsync(
        string id,
        List<string> groupNames,
        CancellationToken ct = default);

    // -------------------------------------------------------------------------
    // ГРУППЫ (РОЛИ)
    // -------------------------------------------------------------------------

    /// <summary>Получить все группы.</summary>
    Task<List<AdminGroupDto>> ListGroupsAsync(CancellationToken ct = default);

    /// <summary>Получить одну группу по UUID.</summary>
    Task<AdminGroupDto?> GetGroupAsync(string id, CancellationToken ct = default);

    /// <summary>Создать группу.</summary>
    Task<AdminGroupDto> CreateGroupAsync(
        CreateGroupRequest request,
        CancellationToken ct = default);

    /// <summary>Обновить группу.</summary>
    Task<AdminGroupDto> UpdateGroupAsync(
        string id,
        UpdateGroupRequest request,
        CancellationToken ct = default);

    /// <summary>Удалить группу.</summary>
    Task DeleteGroupAsync(string id, CancellationToken ct = default);
}