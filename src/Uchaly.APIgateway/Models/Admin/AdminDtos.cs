// src/Uchaly.APIgateway/Models/Admin/AdminDtos.cs
// =============================================================================
// DTO-модели для админ-панели.
//
// Здесь собраны ТРИ группы моделей:
//
//   1. Публичные DTO, которые отдаются фронтенду.
//      Их поля совпадают с типами TypeScript:
//        - AdminStatsDto     -> AdminStats     (types/auth.ts)
//        - AdminUserDto      -> UserDto        (types/auth.ts)
//        - AdminGroupDto     -> RoleDto        (types/auth.ts)
//        - PagedResultDto<T> -> PagedResultDto<T>
//
//   2. Request-DTO, которые фронтенд присылает в контроллер.
//      Имена и поля совпадают с payload-типами axios-запросов.
//
//   3. Internal-DTO — приватные модели для десериализации
//      ответов Authentik Admin API. Они повторяют структуру
//      объекта User/Group из Authentik (см.
//      https://docs.goauthentik.io/docs/developer-docs/api/).
//      Клиенту AuthentikAdminClient они нужны, чтобы читать
//      ответы и преобразовывать их в публичные DTO.
//
// ВАЖНО ПРО NAMING:
//   В Authentik нет понятия "роль" в том виде, в котором мы
//   его используем в UI. Группа (Group) — это и есть роль.
//   Поэтому DTO группы и роль — это одна и та же модель.
//   Мы держим имена RoleDto/AdminGroupDto как алиасы одного
//   и того же контракта.
//
// ВАЖНО ПРО ПОЛЕ groups У ПОЛЬЗОВАТЕЛЯ:
//   Authentik возвращает user.groups как массив UUID-СТРОК,
//   а не массив объектов. Пример:
//
//     "groups": ["uuid-group-1", "uuid-group-2"]
//
//   Это отличается от того, что можно было бы ожидать
//   интуитивно. Чтобы показать имена групп в UI, нужно
//   либо делать отдельный запрос за всеми группами и
//   строить словарь UUID -> name, либо полагаться на поле
//   groups_obj (если оно пришло). Оба подхода реализованы
//   в AuthentikAdminClient.
//
//   Поэтому AuthentikUser.Groups имеет тип List<string>?,
//   а не List<AuthentikUserGroupRef>?. Ошибка в типе
//   приводит к JsonException на каждом пользователе.
//
// ВАЖНО ПРО ПОЛЕ pk У ПОЛЬЗОВАТЕЛЯ:
//   Authentik Admin API на эндпоинтах /api/v3/core/users/{id}/
//   ожидает в URL ЧИСЛОВОЙ pk, а не UUID. Поэтому в публичный
//   AdminUserDto.Id мы кладём именно pk (см. MapUser в
//   AuthentikAdminClient). Если положить туда UUID —
//   пользователь не найдётся, и мы получим 404.
//
//   У групп, в отличие от пользователей, pk — это строка UUID,
//   поэтому /api/v3/core/groups/{uuid}/ работает корректно.
// =============================================================================

using System.Text.Json.Serialization;

namespace Uchaly.APIgateway.Models.Admin;

// =============================================================================
// ПУБЛИЧНЫЕ DTO (отдаются фронтенду)
// =============================================================================

/// <summary>
/// Агрегированная статистика для дашборда админа.
/// Соответствует TypeScript-типу AdminStats из types/auth.ts.
/// </summary>
public class AdminStatsDto
{
    /// <summary>Общее число пользователей в системе.</summary>
    public int TotalUsers { get; set; }

    /// <summary>Число активных пользователей (is_active=true).</summary>
    public int ActiveUsers { get; set; }

    /// <summary>Пользователей, зарегистрированных за последние 7 дней.</summary>
    public int NewUsersThisWeek { get; set; }

    /// <summary>Общее число ролей (в Authentik — групп).</summary>
    public int TotalRoles { get; set; }
}

/// <summary>
/// Проекция пользователя для UI админ-панели.
/// Соответствует TypeScript-типу UserDto из types/auth.ts.
///
/// ВАЖНО: НЕ путать с AuthentikUser (internal) — тот повторяет
/// структуру ответа Authentik Admin API один-в-один, а этот DTO
/// специально "выпрямлен" под нужды фронтенда.
/// </summary>
public class AdminUserDto
{
    /// <summary>
    /// Идентификатор пользователя для использования в URL
    /// Admin API Gateway. Это ЧИСЛОВОЙ pk пользователя в Authentik,
    /// приведённый к строке (например, "3").
    ///
    /// ВАЖНО: НЕ путать с UUID пользователя из Authentik.
    ///   Authentik Admin API на эндпоинтах /api/v3/core/users/{id}/
    ///   ожидает числовой pk, а не UUID.
    ///   Если передать UUID — вернётся 404, и Gateway бросит
    ///   KeyNotFoundException (что и приводило к 500 на
    ///   PATCH /api/admin/users/{id}/roles).
    ///
    /// UUID пользователя остаётся доступен на стороне Gateway
    /// (в модели AuthentikUser), но в публичный DTO для фронта
    /// не выводится — фронту он не нужен.
    /// </summary>
    public string Id { get; set; } = string.Empty;

    /// <summary>Username (логин).</summary>
    public string Username { get; set; } = string.Empty;

    /// <summary>Email.</summary>
    public string Email { get; set; } = string.Empty;

    /// <summary>Имя (из user.attributes.given_name либо из user.name).</summary>
    public string FirstName { get; set; } = string.Empty;

    /// <summary>Фамилия (из user.attributes.family_name либо из user.name).</summary>
    public string LastName { get; set; } = string.Empty;

    /// <summary>Отчество (user.attributes.middle_name). Может быть пустым.</summary>
    public string Patronymic { get; set; } = string.Empty;

    /// <summary>Полное имя пользователя (user.name).</summary>
    public string FullName { get; set; } = string.Empty;

    /// <summary>URL аватара (может быть null — тогда фронт берёт Gravatar).</summary>
    public string? AvatarUrl { get; set; }

    /// <summary>Активен ли пользователь (is_active).</summary>
    public bool IsActive { get; set; }

    /// <summary>Суперпользователь.</summary>
    public bool IsSuperuser { get; set; }

    /// <summary>
    /// Признак "удалён". В Authentik мягкого удаления нет —
    /// всегда false. Оставлено для совместимости с UserDto фронта.
    /// </summary>
    public bool IsDeleted { get; set; }

    /// <summary>
    /// Список ИМЁН групп (ролей) пользователя.
    ///
    /// ЗАМЕЧАНИЕ: в Authentik в user.groups приходят UUID-строки,
    /// а не имена. Здесь — уже развёрнутые имена, потому что
    /// AuthentikAdminClient строит справочник UUID -> name
    /// и подставляет его при маппинге.
    /// </summary>
    public List<string> Roles { get; set; } = new();

    /// <summary>Дата регистрации (date_joined).</summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>Дата последнего входа (может быть null).</summary>
    public DateTime? LastLogin { get; set; }
}

/// <summary>
/// Проекция группы (роли) для UI админ-панели.
/// Соответствует TypeScript-типу RoleDto из types/auth.ts.
///
/// ВАЖНО: в UI это называется "роль", потому что семантически
/// группа Authentik выполняет роль RBAC-роли.
/// </summary>
public class AdminGroupDto
{
    /// <summary>UUID группы в Authentik.</summary>
    public string Id { get; set; } = string.Empty;

    /// <summary>Имя группы (оно же — имя роли в UI).</summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// Описание группы. В Authentik у группы нет поля description —
    /// мы храним описание в attributes["description"], если оно
    /// есть. Если нет — пустая строка.
    /// </summary>
    public string Description { get; set; } = string.Empty;

    /// <summary>Суперпользовательская группа (is_superuser).</summary>
    public bool IsSuperuser { get; set; }

    /// <summary>UUID родительской группы (может быть null).</summary>
    public string? Parent { get; set; }

    /// <summary>Количество пользователей в группе.</summary>
    public int UserCount { get; set; }

    /// <summary>Дата создания (в Authentik может отсутствовать — используем fallback).</summary>
    public DateTime CreatedAt { get; set; }
}

/// <summary>
/// Пагинированный ответ. Соответствует TypeScript-типу
/// PagedResultDto<T> из types/auth.ts.
/// </summary>
public class PagedResultDto<T>
{
    /// <summary>Элементы текущей страницы.</summary>
    public List<T> Items { get; set; } = new();

    /// <summary>Общее количество элементов по фильтру.</summary>
    public int TotalCount { get; set; }

    /// <summary>Номер текущей страницы (1-based).</summary>
    public int PageNumber { get; set; }

    /// <summary>Размер страницы.</summary>
    public int PageSize { get; set; }

    /// <summary>Общее число страниц.</summary>
    public int TotalPages { get; set; }
}

// =============================================================================
// REQUEST-DTO (фронтенд -> backend)
// =============================================================================

/// <summary>
/// Тело запроса на создание пользователя.
/// </summary>
public class CreateUserRequest
{
    public string Username { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;

    /// <summary>
    /// Полное имя (ФИО одной строкой). Если передан — используется
    /// как user.name. Если не передан — склеивается из given_name
    /// и family_name.
    /// </summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>Пароль. Обязателен для new-пользователя.</summary>
    public string Password { get; set; } = string.Empty;

    /// <summary>Активен ли пользователь сразу после создания.</summary>
    public bool IsActive { get; set; } = true;

    /// <summary>
    /// Имена групп, в которые нужно добавить пользователя сразу.
    /// Может быть null/пустым.
    /// </summary>
    public List<string>? Groups { get; set; }
}

/// <summary>
/// Тело запроса на обновление пользователя.
/// Все поля опциональны — обновляются только переданные.
/// </summary>
public class UpdateUserRequest
{
    public string? Email { get; set; }
    public string? Name { get; set; }
    public bool? IsActive { get; set; }
}

/// <summary>
/// Тело запроса на смену пароля пользователя.
/// Если Password не передан — backend сгенерирует случайный
/// и вернёт его в ответе.
/// </summary>
public class SetPasswordRequest
{
    public string? Password { get; set; }
}

/// <summary>
/// Тело запроса на полную замену списка групп пользователя.
/// </summary>
public class SetUserGroupsRequest
{
    public List<string> Groups { get; set; } = new();
}

/// <summary>
/// Тело запроса на активацию/деактивацию пользователя.
/// </summary>
public class SetUserEnabledRequest
{
    public bool IsActive { get; set; }
}

/// <summary>
/// Тело запроса на создание группы.
/// </summary>
public class CreateGroupRequest
{
    public string Name { get; set; } = string.Empty;
    public bool? IsSuperuser { get; set; }
    public string? Parent { get; set; }
}

/// <summary>
/// Тело запроса на обновление группы.
/// </summary>
public class UpdateGroupRequest
{
    public string? Name { get; set; }
    public bool? IsSuperuser { get; set; }
    public string? Parent { get; set; }
}

// =============================================================================
// INTERNAL DTO (для десериализации ответов Authentik Admin API)
// Эти модели НЕ отдаются наружу — только внутри AuthentikAdminClient.
// =============================================================================

/// <summary>
/// Ответ со страницей от Authentik Admin API.
/// Пример: GET /api/v3/core/users/?page=1&amp;page_size=20
/// </summary>
internal class AuthentikPagedResponse<T>
{
    [JsonPropertyName("pagination")]
    public AuthentikPaginationInfo Pagination { get; set; } = new();

    [JsonPropertyName("results")]
    public List<T> Results { get; set; } = new();
}

/// <summary>
/// Метаданные пагинации в ответе Authentik.
/// </summary>
internal class AuthentikPaginationInfo
{
    [JsonPropertyName("count")]
    public int Count { get; set; }

    [JsonPropertyName("current")]
    public int Current { get; set; }

    [JsonPropertyName("page_size")]
    public int PageSize { get; set; }

    [JsonPropertyName("total_pages")]
    public int TotalPages { get; set; }

    [JsonPropertyName("start_index")]
    public int StartIndex { get; set; }

    [JsonPropertyName("end_index")]
    public int EndIndex { get; set; }
}

/// <summary>
/// Пользователь в нотации Authentik Admin API.
/// Соответствует объекту из /api/v3/core/users/.
///
/// ВАЖНО ПРО ПОЛЕ groups:
///   Authentik возвращает `groups` как массив UUID-СТРОК,
///   а не массив объектов:
///
///     "groups": ["uuid-group-1", "uuid-group-2"]
///
///   Чтобы получить имена групп, нужно либо разворачивать
///   их отдельным запросом (см. AuthentikAdminClient.MapUser
///   и BuildGroupNameLookupAsync), либо использовать поле
///   groups_obj (если оно пришло).
///
///   Раньше модель ошибочно ожидала List<AuthentikUserGroupRef>,
///   что приводило к JsonException на каждом пользователе.
///
/// ВАЖНО ПРО ПОЛЕ pk:
///   pk — это ЧИСЛОВОЙ первичный ключ пользователя. Именно
///   он используется в URL Admin API /api/v3/core/users/{pk}/,
///   а также в теле /groups/{uuid}/add_user/ и remove_user/.
///   Не путать с Uuid (строкой), который используется только
///   для отображения и логирования.
/// </summary>
internal class AuthentikUser
{
    [JsonPropertyName("pk")]
    public int Pk { get; set; }

    [JsonPropertyName("uuid")]
    public string Uuid { get; set; } = string.Empty;

    [JsonPropertyName("username")]
    public string Username { get; set; } = string.Empty;

    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("email")]
    public string Email { get; set; } = string.Empty;

    [JsonPropertyName("is_active")]
    public bool IsActive { get; set; }

    [JsonPropertyName("is_superuser")]
    public bool IsSuperuser { get; set; }

    [JsonPropertyName("avatar")]
    public string? Avatar { get; set; }

    [JsonPropertyName("date_joined")]
    public DateTime DateJoined { get; set; }

    [JsonPropertyName("last_login")]
    public DateTime? LastLogin { get; set; }

    [JsonPropertyName("attributes")]
    public Dictionary<string, object>? Attributes { get; set; }

    /// <summary>
    /// Список UUID-строк групп, в которых состоит пользователь.
    /// Именно так Authentik отдаёт это поле по умолчанию.
    ///
    /// Может быть null — System.Text.Json перезапишет
    /// значение по умолчанию на null, если в JSON явно
    /// указано "groups": null. Защита реализована в MapUser
    /// через (u.Groups ?? new List<string>()).
    /// </summary>
    [JsonPropertyName("groups")]
    public List<string>? Groups { get; set; }

    /// <summary>
    /// Развёрнутые объекты групп. Authentik может вернуть это
    /// поле, если клиент явно попросит (или в некоторых версиях
    /// по умолчанию). Если оно есть — используем как источник
    /// имён групп, чтобы не делать лишний запрос.
    ///
    /// Если groups_obj == null или пуст — имена резолвятся
    /// через справочник UUID -> name (см. AuthentikAdminClient).
    /// </summary>
    [JsonPropertyName("groups_obj")]
    public List<AuthentikUserGroupRef>? GroupsObj { get; set; }

    [JsonPropertyName("type")]
    public string Type { get; set; } = string.Empty;

    [JsonPropertyName("path")]
    public string Path { get; set; } = string.Empty;
}

/// <summary>
/// Краткая ссылка на группу внутри объекта User.
/// Используется только если Authentik вернёт groups_obj
/// (развёрнутые группы) — в стандартном ответе /api/v3/core/users/
/// это поле обычно отсутствует.
/// </summary>
internal class AuthentikUserGroupRef
{
    [JsonPropertyName("pk")]
    public string Pk { get; set; } = string.Empty;

    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("is_superuser")]
    public bool IsSuperuser { get; set; }

    [JsonPropertyName("parent")]
    public string? Parent { get; set; }
}

/// <summary>
/// Группа в нотации Authentik Admin API.
/// Соответствует объекту из /api/v3/core/groups/.
///
/// Обратите внимание на поля users / users_obj:
///   - users     — список целочисленных pk пользователей;
///   - users_obj — развёрнутые объекты (может отсутствовать,
///                 тогда userCount считаем по users.Count).
///
/// Оба поля могут прийти как null — защищаемся в MapGroup
/// через ?? new().
///
/// ВАЖНО ПРО pk У ГРУППЫ:
///   У групп pk — это строка UUID. Именно она используется
///   в URL Admin API /api/v3/core/groups/{pk}/. Это отличается
///   от пользователей, у которых pk — число.
/// </summary>
internal class AuthentikGroup
{
    [JsonPropertyName("pk")]
    public string Pk { get; set; } = string.Empty;

    [JsonPropertyName("num_pk")]
    public int NumPk { get; set; }

    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("is_superuser")]
    public bool IsSuperuser { get; set; }

    [JsonPropertyName("parent")]
    public string? Parent { get; set; }

    /// <summary>
    /// Список числовых pk пользователей в группе.
    /// Может быть null.
    /// </summary>
    [JsonPropertyName("users")]
    public List<int>? Users { get; set; }

    /// <summary>
    /// Развёрнутые объекты пользователей. Может быть null,
    /// если API не подгружает связь.
    /// </summary>
    [JsonPropertyName("users_obj")]
    public List<AuthentikGroupUserRef>? UsersObj { get; set; }

    [JsonPropertyName("attributes")]
    public Dictionary<string, object>? Attributes { get; set; }
}

/// <summary>
/// Краткая ссылка на пользователя внутри объекта Group.
/// </summary>
internal class AuthentikGroupUserRef
{
    [JsonPropertyName("pk")]
    public int Pk { get; set; }

    [JsonPropertyName("uuid")]
    public string Uuid { get; set; } = string.Empty;

    [JsonPropertyName("username")]
    public string Username { get; set; } = string.Empty;

    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("email")]
    public string Email { get; set; } = string.Empty;

    [JsonPropertyName("is_active")]
    public bool IsActive { get; set; }
}

/// <summary>
/// Тело запроса на создание пользователя в нотации Authentik.
/// </summary>
internal class AuthentikCreateUserRequest
{
    [JsonPropertyName("username")]
    public string Username { get; set; } = string.Empty;

    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("email")]
    public string Email { get; set; } = string.Empty;

    [JsonPropertyName("is_active")]
    public bool IsActive { get; set; }

    [JsonPropertyName("password")]
    public string? Password { get; set; }

    [JsonPropertyName("attributes")]
    public Dictionary<string, object>? Attributes { get; set; }

    [JsonPropertyName("type")]
    public string? Type { get; set; } = "internal";

    [JsonPropertyName("path")]
    public string? Path { get; set; } = "users";
}

/// <summary>
/// Тело PATCH-запроса на обновление пользователя в нотации Authentik.
/// </summary>
internal class AuthentikPatchUserRequest
{
    [JsonPropertyName("name")]
    public string? Name { get; set; }

    [JsonPropertyName("email")]
    public string? Email { get; set; }

    [JsonPropertyName("is_active")]
    public bool? IsActive { get; set; }
}

/// <summary>
/// Тело запроса на установку пароля пользователя.
/// </summary>
internal class AuthentikSetPasswordRequest
{
    [JsonPropertyName("password")]
    public string Password { get; set; } = string.Empty;
}

/// <summary>
/// Тело запроса на создание группы.
/// </summary>
internal class AuthentikCreateGroupRequest
{
    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("is_superuser")]
    public bool? IsSuperuser { get; set; }

    [JsonPropertyName("parent")]
    public string? Parent { get; set; }
}

/// <summary>
/// Тело PATCH-запроса на обновление группы.
/// </summary>
internal class AuthentikPatchGroupRequest
{
    [JsonPropertyName("name")]
    public string? Name { get; set; }

    [JsonPropertyName("is_superuser")]
    public bool? IsSuperuser { get; set; }

    [JsonPropertyName("parent")]
    public string? Parent { get; set; }
}

/// <summary>
/// Тело запроса на добавление/удаление пользователя из группы.
/// Используется как для /add_user/, так и для /remove_user/.
///
/// ВАЖНО ПРО ФОРМАТ ТЕЛА:
///   Authentik 2026.8.3 принимает на эндпоинтах
///   /api/v3/core/groups/{uuid}/add_user/ и
///   /api/v3/core/groups/{uuid}/remove_user/
///   РОВНО ОДНО поле:
///
///       { "pk": <int> }
///
///   Никакие другие поля (в частности, "uuid") не допускаются —
///   на лишнее поле Authentik возвращает 400 Bad Request.
///
///   Это подтверждено логами Authentik: при отправке
///   { "pk": 15, "uuid": "..." } он отвечал 400.
///
///   Поле `pk` — это ЧИСЛОВОЙ первичный ключ пользователя
///   (не UUID). В нашей модели это AuthentikUser.Pk.
/// </summary>
internal class AuthentikAddUserToGroupRequest
{
    /// <summary>
    /// Числовой первичный ключ пользователя (AuthentikUser.Pk).
    /// Единственное поле, которое принимает Authentik на
    /// add_user / remove_user.
    /// </summary>
    [JsonPropertyName("pk")]
    public int Pk { get; set; }
}