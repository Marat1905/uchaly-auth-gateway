// src/Uchaly.APIgateway/Controllers/AdminController.cs
// =============================================================================
// Контроллер админ-панели.
//
// Все эндпоинты доступны только пользователям с ролью "Admin".
// Проверка роли делается через [Authorize(Policy = "AdminOnly")].
// Политика объявлена в AuthentikAuthenticationExtensions.
//
// Контроллер НЕ работает с Authentik напрямую — он делегирует
// всю работу IAuthentikAdminClient, который уже знает, как
// общаться с /api/v3/core/... и подкладывать Bearer-токен.
//
// МАРШРУТИЗАЦИЯ:
//   Все эндпоинты под /api/admin/*. Фронт ходит туда через
//   тот же origin (Vite proxy или nginx), поэтому CORS настроен
//   политикой AllowFrontend (см. Program.cs).
// =============================================================================

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Uchaly.APIgateway.Models.Admin;
using Uchaly.APIgateway.Services;

namespace Uchaly.APIgateway.Controllers;

/// <summary>
/// REST-контроллер для админ-панели: управление пользователями
/// и ролями через Authentik Admin API.
/// </summary>
[ApiController]
[Route("api/admin")]
[Authorize(Policy = "AdminOnly")]
public class AdminController : ControllerBase
{
    private readonly IAuthentikAdminClient _admin;
    private readonly ILogger<AdminController> _logger;

    public AdminController(
        IAuthentikAdminClient admin,
        ILogger<AdminController> logger)
    {
        _admin = admin;
        _logger = logger;
    }

    // =========================================================================
    // СТАТИСТИКА
    // =========================================================================

    /// <summary>
    /// Агрегированная статистика для дашборда админа.
    /// GET /api/admin/stats
    /// </summary>
    [HttpGet("stats")]
    public async Task<ActionResult<AdminStatsDto>> GetStats(
        CancellationToken ct)
    {
        var stats = await _admin.GetStatsAsync(ct);
        return Ok(stats);
    }

    // =========================================================================
    // ПОЛЬЗОВАТЕЛИ
    // =========================================================================

    /// <summary>
    /// Список пользователей с фильтрами и пагинацией.
    /// GET /api/admin/users?search=&amp;group=&amp;isActive=&amp;page=&amp;pageSize=
    ///
    /// Query-параметры:
    ///   - search   — подстрока для поиска (username/name/email)
    ///   - group    — имя группы (роли), в которой состоит пользователь
    ///   - isActive — true/false (опционально)
    ///   - page     — номер страницы (1-based, по умолчанию 1)
    ///   - pageSize — размер страницы (по умолчанию 10, максимум 100)
    /// </summary>
    [HttpGet("users")]
    public async Task<ActionResult<PagedResultDto<AdminUserDto>>> GetUsers(
        [FromQuery] string? search,
        [FromQuery] string? group,
        [FromQuery] bool? isActive,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 10,
        CancellationToken ct = default)
    {
        var result = await _admin.ListUsersAsync(
            search, group, isActive, page, pageSize, ct);

        return Ok(result);
    }

    /// <summary>
    /// Один пользователь по UUID.
    /// GET /api/admin/users/{id}
    /// </summary>
    [HttpGet("users/{id}")]
    public async Task<ActionResult<AdminUserDto>> GetUser(
        string id, CancellationToken ct)
    {
        var user = await _admin.GetUserAsync(id, ct);
        if (user is null)
        {
            return NotFound(new
            {
                type = "NotFound",
                title = "Пользователь не найден.",
                status = 404,
                detail = $"Пользователь с id={id} отсутствует в Authentik.",
            });
        }

        return Ok(user);
    }

    /// <summary>
    /// Создать пользователя.
    /// POST /api/admin/users
    /// </summary>
    [HttpPost("users")]
    public async Task<ActionResult<AdminUserDto>> CreateUser(
        [FromBody] CreateUserRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.Username))
        {
            return BadRequest(new
            {
                type = "ValidationError",
                title = "Username обязателен.",
                status = 400,
            });
        }

        if (string.IsNullOrWhiteSpace(request.Email))
        {
            return BadRequest(new
            {
                type = "ValidationError",
                title = "Email обязателен.",
                status = 400,
            });
        }

        if (string.IsNullOrWhiteSpace(request.Password))
        {
            return BadRequest(new
            {
                type = "ValidationError",
                title = "Пароль обязателен при создании пользователя.",
                status = 400,
            });
        }

        var created = await _admin.CreateUserAsync(request, ct);
        return CreatedAtAction(
            nameof(GetUser),
            new { id = created.Id },
            created);
    }

    /// <summary>
    /// Обновить пользователя (PATCH — только переданные поля).
    /// PATCH /api/admin/users/{id}
    /// </summary>
    [HttpPatch("users/{id}")]
    public async Task<ActionResult<AdminUserDto>> UpdateUser(
        string id,
        [FromBody] UpdateUserRequest request,
        CancellationToken ct)
    {
        var updated = await _admin.UpdateUserAsync(id, request, ct);
        return Ok(updated);
    }

    /// <summary>
    /// Удалить пользователя.
    /// DELETE /api/admin/users/{id}
    ///
    /// ВНИМАНИЕ: физическое удаление. Восстановление невозможно.
    /// </summary>
    [HttpDelete("users/{id}")]
    public async Task<IActionResult> DeleteUser(
        string id, CancellationToken ct)
    {
        await _admin.DeleteUserAsync(id, ct);
        return NoContent();
    }

    /// <summary>
    /// Установить новый пароль.
    /// POST /api/admin/users/{id}/set-password
    ///
    /// Тело: { "password": "..." } — если password пустой/null,
    /// backend сгенерирует случайный и вернёт его в ответе.
    /// </summary>
    [HttpPost("users/{id}/set-password")]
    public async Task<ActionResult<object>> SetPassword(
        string id,
        [FromBody] SetPasswordRequest request,
        CancellationToken ct)
    {
        var password = await _admin.SetPasswordAsync(
            id, request.Password, ct);

        return Ok(new { password });
    }

    /// <summary>
    /// Сбросить пароль на случайный (алиас set-password без тела).
    /// POST /api/admin/users/{id}/reset-password
    ///
    /// Удобно вызывать из UI без формы ввода нового пароля —
    /// используется в UserManagement.handleResetPassword.
    /// </summary>
    [HttpPost("users/{id}/reset-password")]
    public async Task<ActionResult<object>> ResetPassword(
        string id, CancellationToken ct)
    {
        var password = await _admin.SetPasswordAsync(id, null, ct);
        return Ok(new { password });
    }

    /// <summary>
    /// Активировать/деактивировать пользователя.
    /// PATCH /api/admin/users/{id}/enabled
    ///
    /// Тело: { "isActive": true|false }
    /// </summary>
    [HttpPatch("users/{id}/enabled")]
    public async Task<ActionResult<AdminUserDto>> SetEnabled(
        string id,
        [FromBody] SetUserEnabledRequest request,
        CancellationToken ct)
    {
        var updated = await _admin.SetUserEnabledAsync(
            id, request.IsActive, ct);
        return Ok(updated);
    }

    /// <summary>
    /// Полностью заменить список групп пользователя.
    /// PATCH /api/admin/users/{id}/roles
    ///
    /// Тело: { "groups": ["Admin", "User"] }
    ///
    /// ВНИМАНИЕ: передаётся полный желаемый список ИМЁН групп.
    /// Старые группы, которых нет в новом списке, будут отвязаны.
    /// </summary>
    [HttpPatch("users/{id}/roles")]
    public async Task<ActionResult<AdminUserDto>> SetRoles(
        string id,
        [FromBody] SetUserGroupsRequest request,
        CancellationToken ct)
    {
        var updated = await _admin.SetUserGroupsAsync(
            id, request.Groups, ct);
        return Ok(updated);
    }

    /// <summary>
    /// Алиас set-roles — полная замена списка групп.
    /// PATCH /api/admin/users/{id}/groups
    /// </summary>
    [HttpPatch("users/{id}/groups")]
    public async Task<ActionResult<AdminUserDto>> SetGroups(
        string id,
        [FromBody] SetUserGroupsRequest request,
        CancellationToken ct)
    {
        var updated = await _admin.SetUserGroupsAsync(
            id, request.Groups, ct);
        return Ok(updated);
    }

    // =========================================================================
    // ГРУППЫ (РОЛИ)
    // =========================================================================

    /// <summary>
    /// Список всех групп (ролей) системы.
    /// GET /api/admin/roles (алиас: /api/admin/groups)
    /// </summary>
    [HttpGet("roles")]
    public async Task<ActionResult<List<AdminGroupDto>>> GetRoles(
        CancellationToken ct)
    {
        var groups = await _admin.ListGroupsAsync(ct);
        return Ok(groups);
    }

    /// <summary>
    /// Алиас GetRoles — то же самое, но по "правильному" URL.
    /// GET /api/admin/groups
    /// </summary>
    [HttpGet("groups")]
    public async Task<ActionResult<List<AdminGroupDto>>> GetGroups(
        CancellationToken ct)
    {
        var groups = await _admin.ListGroupsAsync(ct);
        return Ok(groups);
    }

    /// <summary>
    /// Одна группа по UUID.
    /// GET /api/admin/groups/{id}
    /// </summary>
    [HttpGet("groups/{id}")]
    public async Task<ActionResult<AdminGroupDto>> GetGroup(
        string id, CancellationToken ct)
    {
        var group = await _admin.GetGroupAsync(id, ct);
        if (group is null)
        {
            return NotFound(new
            {
                type = "NotFound",
                title = "Группа не найдена.",
                status = 404,
                detail = $"Группа с id={id} отсутствует в Authentik.",
            });
        }

        return Ok(group);
    }

    /// <summary>
    /// Создать группу (роль).
    /// POST /api/admin/groups
    /// </summary>
    [HttpPost("groups")]
    public async Task<ActionResult<AdminGroupDto>> CreateGroup(
        [FromBody] CreateGroupRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
        {
            return BadRequest(new
            {
                type = "ValidationError",
                title = "Имя группы обязательно.",
                status = 400,
            });
        }

        var created = await _admin.CreateGroupAsync(request, ct);
        return CreatedAtAction(
            nameof(GetGroup),
            new { id = created.Id },
            created);
    }

    /// <summary>
    /// Обновить группу.
    /// PATCH /api/admin/groups/{id}
    /// </summary>
    [HttpPatch("groups/{id}")]
    public async Task<ActionResult<AdminGroupDto>> UpdateGroup(
        string id,
        [FromBody] UpdateGroupRequest request,
        CancellationToken ct)
    {
        var updated = await _admin.UpdateGroupAsync(id, request, ct);
        return Ok(updated);
    }

    /// <summary>
    /// Удалить группу.
    /// DELETE /api/admin/groups/{id}
    ///
    /// ВНИМАНИЕ: если в группе есть пользователи, Authentik
    /// может вернуть ошибку. UI должен показывать её корректно.
    /// </summary>
    [HttpDelete("groups/{id}")]
    public async Task<IActionResult> DeleteGroup(
        string id, CancellationToken ct)
    {
        await _admin.DeleteGroupAsync(id, ct);
        return NoContent();
    }
}