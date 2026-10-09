// src/Uchaly.APIgateway/Services/AuthentikAdminClient.cs
// =============================================================================
// Реализация клиента Authentik Admin REST API.
//
// ОСОБЕННОСТИ:
//   1. Аутентификация — Bearer-токен сервисного пользователя
//      (AuthentikAdminOptions.ApiToken). НЕ OIDC-токен.
//
//   2. Все запросы идут на {BaseUrl}/api/v3/core/...
//      BaseUrl = http://authentik-server:9000 внутри docker-сети
//      (или http://localhost:9000 при запуске Gateway вне docker).
//
//   3. Автоматически преобразует ответы Authentik (AuthentikUser,
//      AuthentikGroup) в публичные DTO (AdminUserDto, AdminGroupDto).
//
//   4. Обрабатывает 404 как "не найдено" (возвращает null там,
//      где это допустимо), остальные ошибки бросает как
//      HttpRequestException.
//
//   5. РАЗВОРАЧИВАНИЕ UUID ГРУПП В ИМЕНА:
//      Authentik возвращает user.groups как массив UUID-строк.
//      Чтобы показать в UI имена групп, клиент один раз
//      загружает все группы (BuildGroupNameLookupAsync)
//      и строит словарь UUID -> name. Это дешевле, чем
//      делать N+1 запросов на каждого пользователя.
//
//   6. ЧИСЛОВОЙ pk У ПОЛЬЗОВАТЕЛЯ:
//      Authentik Admin API на /api/v3/core/users/{id}/
//      ожидает ЧИСЛОВОЙ pk пользователя, а не UUID.
//      Поэтому в публичный AdminUserDto.Id кладём pk
//      (см. MapUser). UUID (AuthentikUser.Uuid) остаётся
//      доступен для логирования, но в URL не используется.
//
//   7. ОСОБЕННОСТЬ add_user / remove_user:
//      Эндпоинты /api/v3/core/groups/{uuid}/add_user/ и
//      /remove_user/ — это кастомные @action Django REST
//      Framework. Они НЕ ЧИТАЮТ тело запроса в режиме
//      Transfer-Encoding: chunked (в отличие от стандартных
//      ModelViewSet'ов). А HttpClient.PostAsJsonAsync для
//      POCO-объектов отправляет именно chunked (JsonContent
//      не знает длину заранее, поэтому идёт потоком).
//
//      Симптом: тело {"pk":15} доходит до Authentik как
//      "пустое", DRF возвращает 400 {"pk":["This field is required."]}.
//
//      Решение: сериализуем JSON заранее и шлём через
//      StringContent — тогда Content-Length известен до
//      начала отправки, и Django нормально парсит тело.
//
//      Это подтверждено логами: ручной curl с Content-Length
//      возвращает 204, а PostAsJsonAsync — 400.
//
//   8. FULLNAME ИЗ АТРИБУТОВ:
//      Enrollment-flow (см. uchaly-app.yaml) сохраняет ФИО
//      пользователя в трёх отдельных атрибутах:
//      attributes.family_name / given_name / middle_name.
//      Единое поле user.name при этом остаётся ПУСТЫМ.
//
//      Поэтому в MapUser FullName собирается сначала из этих
//      трёх атрибутов в порядке "Фамилия Имя Отчество",
//      и только если их нет — падаем на u.Name, а затем
//      на username. Иначе у всех зарегистрированных через
//      SPA пользователей в админке показывался бы username
//      вместо реального ФИО.
//
//   9. DESCRIPTION У ГРУППЫ:
//      В Authentik у группы нет отдельного поля description.
//      Мы храним описание в attributes.description (JSONB).
//      При создании/обновлении группы запаковываем description
//      в attributes, при чтении — извлекаем через
//      GetAttrString(g.Attributes, "description").
// =============================================================================

using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;
using Uchaly.APIgateway.Models.Admin;
using Uchaly.APIgateway.Options;

namespace Uchaly.APIgateway.Services;

/// <summary>
/// Клиент Authentik Admin API. Зарегистрирован как Scoped.
/// </summary>
public class AuthentikAdminClient : IAuthentikAdminClient
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ILogger<AuthentikAdminClient> _logger;
    private readonly AuthentikAdminOptions _options;

    /// <summary>
    /// Настройки System.Text.Json — те же, что использует ASP.NET
    /// по умолчанию, плюс игнорирование null-полей при сериализации
    /// (чтобы не отправлять в Authentik поля, которые не нужно менять).
    /// </summary>
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    /// <summary>Имя именованного HttpClient (для IHttpClientFactory).</summary>
    public const string HttpClientName = "AuthentikAdmin";

    public AuthentikAdminClient(
        IHttpClientFactory httpClientFactory,
        IOptions<AuthentikAdminOptions> options,
        ILogger<AuthentikAdminClient> logger)
    {
        _httpClientFactory = httpClientFactory;
        _logger = logger;
        _options = options.Value;
    }

    // -------------------------------------------------------------------------
    // ФАБРИКА HTTP-КЛИЕНТА
    // -------------------------------------------------------------------------

    /// <summary>
    /// Создаёт HttpClient с правильно настроенным BaseAddress,
    /// Authorization-заголовком и таймаутом.
    ///
    /// Используем IHttpClientFactory, а не singleton HttpClient,
    /// чтобы избежать проблемы устаревших DNS и утечек сокетов.
    /// </summary>
    private HttpClient CreateClient()
    {
        var client = _httpClientFactory.CreateClient(HttpClientName);

        client.BaseAddress = new Uri(_options.BaseUrl.TrimEnd('/') + "/");
        client.Timeout = TimeSpan.FromSeconds(_options.TimeoutSeconds);

        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", _options.ApiToken);

        client.DefaultRequestHeaders.Accept.Clear();
        client.DefaultRequestHeaders.Accept.Add(
            new MediaTypeWithQualityHeaderValue("application/json"));

        return client;
    }

    // -------------------------------------------------------------------------
    // СТАТИСТИКА
    // -------------------------------------------------------------------------

    /// <inheritdoc />
    public async Task<AdminStatsDto> GetStatsAsync(CancellationToken ct = default)
    {
        // Для статистики нужно несколько запросов:
        //   - список пользователей (page_size=1, чтобы получить только count)
        //   - список активных пользователей (is_active=true)
        //   - список новых за 7 дней (date_joined__gte)
        //   - список групп (для totalRoles)
        //
        // Чтобы не тянуть все данные, используем page_size=1 —
        // нам важны только метаданные пагинации (поле count).
        var client = CreateClient();

        // 1. Общее число пользователей
        var totalUsers = await GetCountAsync(client,
            "api/v3/core/users/?page_size=1", ct);

        // 2. Активные пользователи
        var activeUsers = await GetCountAsync(client,
            "api/v3/core/users/?page_size=1&is_active=true", ct);

        // 3. Новые за 7 дней. Формат даты — ISO 8601 с Z.
        var weekAgo = DateTime.UtcNow.AddDays(-7)
            .ToString("yyyy-MM-ddTHH:mm:ssZ");
        var newThisWeek = await GetCountAsync(client,
            $"api/v3/core/users/?page_size=1&date_joined__gte={weekAgo}", ct);

        // 4. Группы
        var totalRoles = await GetCountAsync(client,
            "api/v3/core/groups/?page_size=1", ct);

        return new AdminStatsDto
        {
            TotalUsers = totalUsers,
            ActiveUsers = activeUsers,
            NewUsersThisWeek = newThisWeek,
            TotalRoles = totalRoles,
        };
    }

    /// <summary>
    /// Вспомогательный метод: делает GET на указанный путь и
    /// возвращает pagination.count. Используется для статистики,
    /// где нужны только счётчики.
    /// </summary>
    private async Task<int> GetCountAsync(
        HttpClient client, string path, CancellationToken ct)
    {
        try
        {
            var response = await client.GetAsync(path, ct);

            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning(
                    "Authentik admin: GET {Path} вернул {Status}",
                    path, (int)response.StatusCode);
                return 0;
            }

            var page = await response.Content
                .ReadFromJsonAsync<AuthentikPagedResponse<object>>(JsonOpts, ct);

            return page?.Pagination?.Count ?? 0;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex,
                "Authentik admin: ошибка при запросе счётчика {Path}", path);
            return 0;
        }
    }

    // -------------------------------------------------------------------------
    // ПОЛЬЗОВАТЕЛИ
    // -------------------------------------------------------------------------

    /// <inheritdoc />
    public async Task<PagedResultDto<AdminUserDto>> ListUsersAsync(
        string? search,
        string? group,
        bool? isActive,
        int page,
        int pageSize,
        CancellationToken ct = default)
    {
        // Собираем query-строку фильтров.
        //
        // ВАЖНО ПРО ПАГИНАЦИЮ: клиент присылает page/pageSize
        // (1-based). Authentik тоже использует 1-based page.
        if (page < 1) page = 1;
        if (pageSize < 1) pageSize = 10;
        if (pageSize > 100) pageSize = 100;

        var query = new StringBuilder("api/v3/core/users/?");
        query.Append($"page={page}&");
        query.Append($"page_size={pageSize}&");

        // ordering=-date_joined — сортировка "свежие сверху".
        // Это стандартный UX для админ-панели.
        query.Append("ordering=-date_joined&");

        if (!string.IsNullOrWhiteSpace(search))
        {
            // Authentik поддерживает search=... — поиск по username,
            // name и email одновременно.
            query.Append($"search={Uri.EscapeDataString(search)}&");
        }

        if (isActive.HasValue)
        {
            query.Append($"is_active={isActive.Value.ToString().ToLowerInvariant()}&");
        }

        if (!string.IsNullOrWhiteSpace(group))
        {
            // Фильтрация по имени группы: groups_by_name=<name>.
            query.Append($"groups_by_name={Uri.EscapeDataString(group)}&");
        }

        var client = CreateClient();
        var response = await client.GetAsync(query.ToString().TrimEnd('&'), ct);

        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(ct);
            _logger.LogWarning(
                "Authentik admin: ListUsers вернул {Status}: {Body}",
                (int)response.StatusCode, body);
            response.EnsureSuccessStatusCode();
        }

        var pageResp = await response.Content
            .ReadFromJsonAsync<AuthentikPagedResponse<AuthentikUser>>(JsonOpts, ct)
            ?? new AuthentikPagedResponse<AuthentikUser>();

        // ВАЖНО: загружаем справочник UUID группы -> имя.
        // Это нужно, потому что Authentik возвращает `groups`
        // как массив UUID-строк, а нам для UI нужны имена.
        var groupNameById = await BuildGroupNameLookupAsync(ct);

        var items = pageResp.Results
            .Select(u => MapUser(u, groupNameById))
            .ToList();

        return new PagedResultDto<AdminUserDto>
        {
            Items = items,
            TotalCount = pageResp.Pagination.Count,
            PageNumber = pageResp.Pagination.Current,
            PageSize = pageResp.Pagination.PageSize,
            TotalPages = pageResp.Pagination.TotalPages,
        };
    }

    /// <inheritdoc />
    public async Task<AdminUserDto?> GetUserAsync(
        string id, CancellationToken ct = default)
    {
        var client = CreateClient();
        var response = await client.GetAsync(
            $"api/v3/core/users/{Uri.EscapeDataString(id)}/", ct);

        if (response.StatusCode == HttpStatusCode.NotFound)
        {
            return null;
        }

        response.EnsureSuccessStatusCode();

        var user = await response.Content
            .ReadFromJsonAsync<AuthentikUser>(JsonOpts, ct);

        if (user is null) return null;

        // Для отображения имён групп нужен справочник UUID -> имя.
        var groupNameById = await BuildGroupNameLookupAsync(ct);
        return MapUser(user, groupNameById);
    }

    /// <inheritdoc />
    public async Task<AdminUserDto> CreateUserAsync(
        CreateUserRequest request, CancellationToken ct = default)
    {
        // 1. Собираем тело запроса для Authentik.
        //
        // ВАЖНО ПРО АТРИБУТЫ:
        //   Authentik хранит ФИО в user.attributes (JSONB).
        //   При создании мы не разделяем name на части —
        //   просто пишем то, что пришло. Если фронт пришлёт
        //   "Иванов Иван Иванович", оно и запишется.
        //
        // ВАЖНО ПРО TYPE:
        //   Мы всегда создаём "internal" — чтобы пользователь
        //   мог заходить в интерфейс Authentik.
        //
        // ВАЖНО ПРО ТРАНСПОРТ:
        //   POST /api/v3/core/users/ — это стандартный
        //   ModelViewSet, он chunked-body принимает. Но на
        //   всякий случай используем тот же подход, что и
        //   в SetUserGroupsAsync (StringContent с известной
        //   длиной), чтобы единообразие было по всему файлу.
        var authentikReq = new AuthentikCreateUserRequest
        {
            Username = request.Username,
            Name = string.IsNullOrWhiteSpace(request.Name)
                ? request.Username
                : request.Name,
            Email = request.Email,
            IsActive = request.IsActive,
            Password = string.IsNullOrWhiteSpace(request.Password)
                ? null
                : request.Password,
            Type = "internal",
            Path = "users",
        };

        var jsonBody = JsonSerializer.Serialize(authentikReq, JsonOpts);
        var content = new StringContent(
            jsonBody, Encoding.UTF8, "application/json");

        var client = CreateClient();
        var response = await client.PostAsync(
            "api/v3/core/users/", content, ct);

        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(ct);
            _logger.LogWarning(
                "Authentik admin: CreateUser вернул {Status}: {Body}",
                (int)response.StatusCode, body);
            response.EnsureSuccessStatusCode();
        }

        var created = await response.Content
            .ReadFromJsonAsync<AuthentikUser>(JsonOpts, ct)
            ?? throw new InvalidOperationException(
                "Authentik не вернул созданного пользователя.");

        // 2. Если переданы группы — добавляем пользователя.
        if (request.Groups is { Count: > 0 })
        {
            await SetUserGroupsAsync(created.Uuid, request.Groups, ct);

            // Перечитываем пользователя, чтобы получить актуальный
            // список групп в ответе.
            var refreshed = await GetUserAsync(created.Uuid, ct);
            if (refreshed is not null)
            {
                return refreshed;
            }
        }

        // 3. Fallback — мапим только что созданного пользователя.
        var groupNameById = await BuildGroupNameLookupAsync(ct);
        return MapUser(created, groupNameById);
    }

    /// <inheritdoc />
    public async Task<AdminUserDto> UpdateUserAsync(
        string id, UpdateUserRequest request, CancellationToken ct = default)
    {
        var patch = new AuthentikPatchUserRequest
        {
            Email = request.Email,
            Name = request.Name,
            IsActive = request.IsActive,
        };

        // Сериализуем заранее, чтобы Content-Length был известен.
        var jsonBody = JsonSerializer.Serialize(patch, JsonOpts);
        var content = new StringContent(
            jsonBody, Encoding.UTF8, "application/json");

        var client = CreateClient();

        // PATCH, а не PUT — обновляем только переданные поля.
        var httpRequest = new HttpRequestMessage(
            HttpMethod.Patch,
            $"api/v3/core/users/{Uri.EscapeDataString(id)}/")
        {
            Content = content,
        };

        var response = await client.SendAsync(httpRequest, ct);

        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(ct);
            _logger.LogWarning(
                "Authentik admin: UpdateUser вернул {Status}: {Body}",
                (int)response.StatusCode, body);
            response.EnsureSuccessStatusCode();
        }

        var updated = await response.Content
            .ReadFromJsonAsync<AuthentikUser>(JsonOpts, ct)
            ?? throw new InvalidOperationException(
                "Authentik не вернул обновлённого пользователя.");

        var groupNameById = await BuildGroupNameLookupAsync(ct);
        return MapUser(updated, groupNameById);
    }

    /// <inheritdoc />
    public async Task DeleteUserAsync(string id, CancellationToken ct = default)
    {
        var client = CreateClient();
        var response = await client.DeleteAsync(
            $"api/v3/core/users/{Uri.EscapeDataString(id)}/", ct);

        // 404 при удалении — это тоже успех (идемпотентность).
        if (response.StatusCode == HttpStatusCode.NotFound)
        {
            return;
        }

        response.EnsureSuccessStatusCode();
    }

    /// <inheritdoc />
    public async Task<string> SetPasswordAsync(
        string id, string? password, CancellationToken ct = default)
    {
        // Если пароль не передан — генерируем случайный.
        // Требования Authentik: минимум 8 символов, буквы+цифры.
        var effectivePassword = string.IsNullOrWhiteSpace(password)
            ? GenerateRandomPassword()
            : password;

        var body = new AuthentikSetPasswordRequest
        {
            Password = effectivePassword,
        };

        // Сериализуем заранее — Content-Length известен.
        var jsonBody = JsonSerializer.Serialize(body, JsonOpts);
        var content = new StringContent(
            jsonBody, Encoding.UTF8, "application/json");

        var client = CreateClient();
        var response = await client.PostAsync(
            $"api/v3/core/users/{Uri.EscapeDataString(id)}/set_password/",
            content, ct);

        if (!response.IsSuccessStatusCode)
        {
            var respBody = await response.Content.ReadAsStringAsync(ct);
            _logger.LogWarning(
                "Authentik admin: SetPassword вернул {Status}: {Body}",
                (int)response.StatusCode, respBody);
            response.EnsureSuccessStatusCode();
        }

        return effectivePassword;
    }

    /// <inheritdoc />
    public async Task<AdminUserDto> SetUserEnabledAsync(
        string id, bool isActive, CancellationToken ct = default)
    {
        return await UpdateUserAsync(
            id, new UpdateUserRequest { IsActive = isActive }, ct);
    }

    /// <inheritdoc />
    public async Task<AdminUserDto> SetUserGroupsAsync(
        string id, List<string> groupNames, CancellationToken ct = default)
    {
        // Шаги:
        //   1. Получить "сырого" пользователя из Authentik — нам нужен
        //      числовой pk (int), потому что эндпоинты
        //      /groups/{uuid}/add_user/ и /groups/{uuid}/remove_user/
        //      принимают в теле { "pk": <int> }, а не UUID.
        //
        //   2. Получить все группы системы (нужны UUID по имени).
        //
        //   3. Вычислить add = желаемые - текущие,
        //               remove = текущие - желаемые.
        //
        //   4. Для каждой add: POST /groups/{uuid}/add_user/
        //      Для каждой remove: POST /groups/{uuid}/remove_user/
        //
        // ВАЖНО: AuthentikUser.Groups — это список UUID-строк.
        // Чтобы сравнить текущие имена с желаемыми, разворачиваем
        // UUID в имена через справочник nameByGroupUuid.
        //
        // ВАЖНО ПРО ТЕЛО ЗАПРОСА:
        //   В теле /add_user/ и /remove_user/ отправляется
        //   РОВНО ОДНО поле: { "pk": <int> }. Любое лишнее
        //   поле (в частности, "uuid") приводит к 400 Bad Request.
        //
        // ВАЖНО ПРО ТРАНСПОРТ (chunked vs Content-Length):
        //   HttpClient.PostAsJsonAsync для POCO-объектов
        //   НЕ МОЖЕТ заранее вычислить длину сериализованного JSON
        //   и отправляет тело в режиме Transfer-Encoding: chunked.
        //
        //   Authentik (Django REST Framework) на кастомных
        //   @action-эндпоинтах /add_user/ и /remove_user/
        //   НЕ ЧИТАЕТ chunked body — request.body остаётся пустым,
        //   и DRF возвращает 400 {"pk":["This field is required."]}.
        //
        //   Это подтверждено логами: ручной curl с Content-Length
        //   возвращает 204, а PostAsJsonAsync — 400.
        //
        //   Решение — сериализовать JSON заранее и отправить
        //   через StringContent, чтобы Content-Length был известен
        //   до начала отправки. Заодно убираем charset из
        //   Content-Type (Django иногда капризничает на него).

        var client = CreateClient();

        // 1. Получаем "сырого" пользователя.
        var userResp = await client.GetAsync(
            $"api/v3/core/users/{Uri.EscapeDataString(id)}/", ct);

        if (userResp.StatusCode == HttpStatusCode.NotFound)
        {
            throw new KeyNotFoundException(
                $"Пользователь {id} не найден в Authentik.");
        }

        if (!userResp.IsSuccessStatusCode)
        {
            var body = await userResp.Content.ReadAsStringAsync(ct);
            _logger.LogWarning(
                "Authentik admin: SetUserGroups — GetUser {Id} вернул {Status}: {Body}",
                id, (int)userResp.StatusCode, body);
            userResp.EnsureSuccessStatusCode();
        }

        var authentikUser = await userResp.Content
            .ReadFromJsonAsync<AuthentikUser>(JsonOpts, ct)
            ?? throw new InvalidOperationException(
                $"Authentik не вернул данные пользователя {id}.");

        // 2. Получаем все группы системы.
        var allGroups = await ListGroupsAsync(ct);

        // Словарь "имя группы" -> "UUID".
        // Регистронезависимый — в UI имена групп пользователи
        // могут вводить по-разному.
        var groupByName = allGroups.ToDictionary(
            g => g.Name, g => g.Id, StringComparer.OrdinalIgnoreCase);

        // Словарь "UUID группы" -> "имя".
        var nameByGroupUuid = allGroups.ToDictionary(
            g => g.Id, g => g.Name, StringComparer.OrdinalIgnoreCase);

        // 3. Текущие имена групп пользователя.
        //    AuthentikUser.Groups — это List<string> с UUID.
        //    Может быть null, если пользователь без групп.
        var currentNames = new HashSet<string>(
            (authentikUser.Groups ?? new List<string>())
                .Select(uuid =>
                    nameByGroupUuid.TryGetValue(uuid, out var n)
                        ? n
                        : uuid),
            StringComparer.OrdinalIgnoreCase);

        // Желаемые имена — отбрасываем те, которых нет в системе,
        // чтобы не падать из-за опечатки в UI.
        var desiredNames = new HashSet<string>(
            groupNames.Where(n => groupByName.ContainsKey(n)),
            StringComparer.OrdinalIgnoreCase);

        var toAdd = desiredNames.Except(currentNames).ToList();
        var toRemove = currentNames.Except(desiredNames).ToList();

        // 4. Добавляем пользователя в новые группы.
        foreach (var name in toAdd)
        {
            if (!groupByName.TryGetValue(name, out var groupUuid))
            {
                continue;
            }

            // ВАЖНО: отправляем РОВНО ОДНО поле pk.
            // Authentik 2026.8.3 на add_user отвергает любые
            // дополнительные поля (в частности, uuid) с 400.
            var body = new AuthentikAddUserToGroupRequest
            {
                Pk = authentikUser.Pk,
            };

            // ============================================================
            // ВАЖНО ПРО ТРАНСПОРТ:
            //   HttpClient.PostAsJsonAsync для POCO-объектов
            //   НЕ МОЖЕТ заранее вычислить длину сериализованного JSON
            //   и отправляет тело в режиме Transfer-Encoding: chunked.
            //
            //   Authentik (Django REST Framework) на эндпоинтах
            //   /add_user/ и /remove_user/ НЕ ЧИТАЕТ chunked body —
            //   request.body остаётся пустым, и DRF возвращает
            //   400 {"pk":["This field is required."]}.
            //
            //   Это подтверждено логами: ручной curl с Content-Length
            //   возвращает 204, а PostAsJsonAsync — 400.
            //
            //   Решение — сериализовать JSON заранее и отправить
            //   через StringContent, чтобы Content-Length был известен
            //   до начала отправки. Заодно убираем charset из
            //   Content-Type (Django иногда капризничает на него).
            // ============================================================
            var jsonBody = JsonSerializer.Serialize(body, JsonOpts);
            var content = new StringContent(
                jsonBody, Encoding.UTF8, "application/json");

            // Диагностический лог: покажем, что именно отправляем.
            // Уровень Debug — не шумит в проде.
            _logger.LogDebug(
                "Authentik admin: add_user POST body={Body} (Pk={Pk})",
                jsonBody, body.Pk);

            var resp = await client.PostAsync(
                $"api/v3/core/groups/{groupUuid}/add_user/",
                content, ct);

            if (!resp.IsSuccessStatusCode)
            {
                var err = await resp.Content.ReadAsStringAsync(ct);
                _logger.LogWarning(
                    "Authentik admin: add_user {User}->{Group} вернул {Status}: {Err}",
                    authentikUser.Uuid, name, (int)resp.StatusCode, err);
            }
        }

        // 5. Удаляем из групп, которых больше нет в списке.
        foreach (var name in toRemove)
        {
            // Пропускаем группы, которых нет в системе —
            // значит UUID нам неизвестен, удалить не можем.
            if (!groupByName.TryGetValue(name, out var groupUuid))
            {
                continue;
            }

            // ВАЖНО: тело с единственным полем pk.
            var body = new AuthentikAddUserToGroupRequest
            {
                Pk = authentikUser.Pk,
            };

            // См. комментарий выше про chunked encoding:
            // PostAsJsonAsync отправляет chunked, Authentik его
            // не читает на remove_user. Используем StringContent.
            var jsonBody = JsonSerializer.Serialize(body, JsonOpts);
            var content = new StringContent(
                jsonBody, Encoding.UTF8, "application/json");

            _logger.LogDebug(
                "Authentik admin: remove_user POST body={Body} (Pk={Pk})",
                jsonBody, body.Pk);

            var resp = await client.PostAsync(
                $"api/v3/core/groups/{groupUuid}/remove_user/",
                content, ct);

            if (!resp.IsSuccessStatusCode)
            {
                var err = await resp.Content.ReadAsStringAsync(ct);
                _logger.LogWarning(
                    "Authentik admin: remove_user {User}<-{Group} вернул {Status}: {Err}",
                    authentikUser.Uuid, name, (int)resp.StatusCode, err);
            }
        }

        // 6. Возвращаем актуального пользователя.
        var refreshed = await GetUserAsync(id, ct);
        if (refreshed is not null)
        {
            return refreshed;
        }

        // Fallback — мапим сырые данные, если повторный GET не удался.
        return MapUser(authentikUser, nameByGroupUuid);
    }

    // -------------------------------------------------------------------------
    // ГРУППЫ
    // -------------------------------------------------------------------------

    /// <inheritdoc />
    public async Task<List<AdminGroupDto>> ListGroupsAsync(
        CancellationToken ct = default)
    {
        // Тянем все группы (у нас их немного — до 1000).
        // Пагинация на большие объёмы: при page_size=1000
        // одна страница покрывает подавляющее большинство
        // корпоративных инсталляций.
        var client = CreateClient();
        var response = await client.GetAsync(
            "api/v3/core/groups/?page_size=1000&ordering=name", ct);

        response.EnsureSuccessStatusCode();

        var pageResp = await response.Content
            .ReadFromJsonAsync<AuthentikPagedResponse<AuthentikGroup>>(JsonOpts, ct)
            ?? new AuthentikPagedResponse<AuthentikGroup>();

        return pageResp.Results.Select(MapGroup).ToList();
    }

    /// <inheritdoc />
    public async Task<AdminGroupDto?> GetGroupAsync(
        string id, CancellationToken ct = default)
    {
        var client = CreateClient();
        var response = await client.GetAsync(
            $"api/v3/core/groups/{Uri.EscapeDataString(id)}/", ct);

        if (response.StatusCode == HttpStatusCode.NotFound)
        {
            return null;
        }

        response.EnsureSuccessStatusCode();

        var group = await response.Content
            .ReadFromJsonAsync<AuthentikGroup>(JsonOpts, ct);

        return group is null ? null : MapGroup(group);
    }

    /// <inheritdoc />
    public async Task<AdminGroupDto> CreateGroupAsync(
        CreateGroupRequest request, CancellationToken ct = default)
    {
        // В Authentik у группы НЕТ отдельного поля description.
        // Описание храним в attributes.description (JSONB).
        // Если description передан — кладём его в attributes.
        Dictionary<string, object>? attributes = null;
        if (request.Description is not null)
        {
            attributes = new Dictionary<string, object>
            {
                ["description"] = request.Description,
            };
        }

        var body = new AuthentikCreateGroupRequest
        {
            Name = request.Name,
            Attributes = attributes,
            IsSuperuser = request.IsSuperuser,
            Parent = request.Parent,
        };

        // Сериализуем заранее, чтобы Content-Length был известен.
        var jsonBody = JsonSerializer.Serialize(body, JsonOpts);
        var content = new StringContent(
            jsonBody, Encoding.UTF8, "application/json");

        var client = CreateClient();
        var response = await client.PostAsync(
            "api/v3/core/groups/", content, ct);

        if (!response.IsSuccessStatusCode)
        {
            var err = await response.Content.ReadAsStringAsync(ct);
            _logger.LogWarning(
                "Authentik admin: CreateGroup вернул {Status}: {Err}",
                (int)response.StatusCode, err);
            response.EnsureSuccessStatusCode();
        }

        var created = await response.Content
            .ReadFromJsonAsync<AuthentikGroup>(JsonOpts, ct)
            ?? throw new InvalidOperationException(
                "Authentik не вернул созданную группу.");

        return MapGroup(created);
    }

    /// <inheritdoc />
    public async Task<AdminGroupDto> UpdateGroupAsync(
        string id, UpdateGroupRequest request, CancellationToken ct = default)
    {
        // В Authentik у группы НЕТ отдельного поля description.
        // Описание храним в attributes.description (JSONB).
        // Если description передан — кладём его в attributes.
        //
        // ВАЖНО: Authentik при PATCH с attributes ЗАМЕНЯЕТ
        // весь JSONB-объект, а не мержит отдельные ключи.
        // У нас в attributes только description, поэтому
        // потери данных не будет.
        Dictionary<string, object>? attributes = null;
        if (request.Description is not null)
        {
            attributes = new Dictionary<string, object>
            {
                ["description"] = request.Description,
            };
        }

        var patch = new AuthentikPatchGroupRequest
        {
            Name = request.Name,
            Attributes = attributes,
            IsSuperuser = request.IsSuperuser,
            Parent = request.Parent,
        };

        // Сериализуем заранее — Content-Length известен.
        var jsonBody = JsonSerializer.Serialize(patch, JsonOpts);
        var content = new StringContent(
            jsonBody, Encoding.UTF8, "application/json");

        var client = CreateClient();
        var httpRequest = new HttpRequestMessage(
            HttpMethod.Patch,
            $"api/v3/core/groups/{Uri.EscapeDataString(id)}/")
        {
            Content = content,
        };

        var response = await client.SendAsync(httpRequest, ct);

        if (!response.IsSuccessStatusCode)
        {
            var err = await response.Content.ReadAsStringAsync(ct);
            _logger.LogWarning(
                "Authentik admin: UpdateGroup вернул {Status}: {Err}",
                (int)response.StatusCode, err);
            response.EnsureSuccessStatusCode();
        }

        var updated = await response.Content
            .ReadFromJsonAsync<AuthentikGroup>(JsonOpts, ct)
            ?? throw new InvalidOperationException(
                "Authentik не вернул обновлённую группу.");

        return MapGroup(updated);
    }

    /// <inheritdoc />
    public async Task DeleteGroupAsync(string id, CancellationToken ct = default)
    {
        var client = CreateClient();
        var response = await client.DeleteAsync(
            $"api/v3/core/groups/{Uri.EscapeDataString(id)}/", ct);

        if (response.StatusCode == HttpStatusCode.NotFound)
        {
            return;
        }

        response.EnsureSuccessStatusCode();
    }

    // -------------------------------------------------------------------------
    // MAPPING: Authentik -> публичные DTO
    // -------------------------------------------------------------------------

    /// <summary>
    /// Преобразует AuthentikUser в AdminUserDto.
    ///
    /// ПАРАМЕТР groupNameById:
    ///   Справочник "UUID группы" -> "имя группы".
    ///
    ///   Authentik возвращает user.groups как массив UUID-строк,
    ///   а не объектов. Чтобы показать имена групп в UI
    ///   (колонка "Роли"), нужно развернуть UUID в имена.
    ///   Справочник строится один раз в ListUsersAsync/GetUserAsync
    ///   и передаётся сюда — чтобы не делать N+1 запросов.
    ///
    ///   Если какой-то UUID не найдётся в справочнике (например,
    ///   группа была удалена, но пользователь ещё в ней), в роли
    ///   добавится сам UUID — это лучше, чем упасть или потерять
    ///   информацию.
    ///
    /// ЛОГИКА РАЗБОРА ФИО:
    ///   1. Если в attributes есть given_name/family_name/middle_name —
    ///      берём их (так делает enrollment-flow, см. uchaly-app.yaml).
    ///   2. Иначе — разбиваем user.name по пробелам.
    ///      Формат: "Фамилия Имя Отчество".
    ///   3. Если name пустой — всё пустое, fullName = username.
    ///
    /// ВАЖНО ПРО FullName:
    ///   Есть три источника ФИО в порядке приоритета:
    ///
    ///   1. Отдельные поля attributes.family_name/given_name/
    ///      middle_name — их заполняет enrollment-flow
    ///      (см. uchaly-app.yaml). Именно они есть у всех
    ///      пользователей, зарегистрированных через SPA.
    ///
    ///   2. Единое поле user.name — его заполняет blueprint
    ///      для seed-пользователей (admin, manager и т. д.)
    ///      и админ при ручном создании через Admin API.
    ///
    ///   3. Username — fallback, если ни ФИО, ни name нет.
    ///
    ///   РАНЬШЕ БЫЛА ОШИБКА:
    ///     FullName = string.IsNullOrWhiteSpace(u.Name)
    ///         ? u.Username
    ///         : u.Name
    ///
    ///   Для enrollment-пользователей u.Name пустой, поэтому
    ///   в UI показывался username ("Marat1905") вместо
    ///   "Гафаров Марат Фатихович".
    ///
    ///   ТЕПЕРЬ:
    ///     Сначала пробуем собрать ФИО из отдельных атрибутов
    ///     в русском порядке "Фамилия Имя Отчество". Если
    ///     атрибутов нет — падаем на u.Name, а затем на
    ///     username.
    ///
    /// ВАЖНО ПРО Id:
    ///   В публичное поле Id кладём ЧИСЛОВОЙ pk пользователя
    ///   (в виде строки), потому что Authentik Admin API на
    ///   эндпоинтах /api/v3/core/users/{id}/ ожидает именно pk,
    ///   а не UUID. Если положить UUID — получим 404 и
    ///   KeyNotFoundException.
    ///
    /// ВАЖНО ПРО NULL:
    ///   Authentik может вернуть "groups": null. System.Text.Json
    ///   присвоит полю null, перезаписав инициализатор = new().
    ///   Поэтому защищаемся через (u.Groups ?? new List<string>()).
    /// </summary>
    private static AdminUserDto MapUser(
        AuthentikUser u,
        Dictionary<string, string>? groupNameById = null)
    {
        var given = GetAttrString(u.Attributes, "given_name");
        var family = GetAttrString(u.Attributes, "family_name");
        var middle = GetAttrString(u.Attributes, "middle_name");

        // Fallback — разбить user.name по пробелам.
        // Используется, только если отдельных атрибутов нет
        // (например, у seed-пользователей из blueprint).
        if (string.IsNullOrEmpty(given)
            && string.IsNullOrEmpty(family)
            && !string.IsNullOrWhiteSpace(u.Name))
        {
            var parts = u.Name.Split(' ',
                StringSplitOptions.RemoveEmptyEntries);

            if (parts.Length >= 1) family = parts[0];
            if (parts.Length >= 2) given = parts[1];
            if (parts.Length >= 3)
            {
                middle = string.Join(" ", parts.Skip(2));
            }
        }

        // Разворачиваем UUID групп в имена.
        var roles = new List<string>();
        var groupUuids = u.Groups ?? new List<string>();

        foreach (var uuid in groupUuids)
        {
            if (string.IsNullOrEmpty(uuid))
            {
                continue;
            }

            if (groupNameById is not null
                && groupNameById.TryGetValue(uuid, out var name))
            {
                roles.Add(name);
            }
            else
            {
                // Не смогли найти имя — кладём UUID, чтобы UI
                // хотя бы показал, что группа есть.
                roles.Add(uuid);
            }
        }

        // ============================================================
        // ВАЖНО ПРО FullName:
        //   Есть три источника ФИО в порядке приоритета:
        //
        //   1. Отдельные поля attributes.family_name/given_name/
        //      middle_name — их заполняет enrollment-flow
        //      (см. uchaly-app.yaml). Именно они есть у всех
        //      пользователей, зарегистрированных через SPA.
        //
        //   2. Единое поле user.name — его заполняет blueprint
        //      для seed-пользователей (admin, manager и т. д.)
        //      и админ при ручном создании через Admin API.
        //
        //   3. Username — fallback, если ни ФИО, ни name нет.
        //
        //   РАНЬШЕ БЫЛА ОШИБКА:
        //     FullName = string.IsNullOrWhiteSpace(u.Name)
        //         ? u.Username
        //         : u.Name
        //
        //   Для enrollment-пользователей u.Name пустой, поэтому
        //   в UI показывался username ("Marat1905") вместо
        //   "Гафаров Марат Фатихович".
        //
        //   ТЕПЕРЬ:
        //     Сначала пробуем собрать ФИО из отдельных атрибутов
        //     в русском порядке "Фамилия Имя Отчество". Если
        //     атрибутов нет — падаем на u.Name, а затем на
        //     username.
        // ============================================================
        var fioParts = new[] { family, given, middle }
            .Where(s => !string.IsNullOrWhiteSpace(s))
            .ToArray();

        string fullName;
        if (fioParts.Length > 0)
        {
            // Русский порядок: Фамилия Имя Отчество.
            // string.Join пропустит уже отфильтрованные пустые
            // значения, поэтому "Гафаров Марат" или
            // "Гафаров Марат Фатихович" — как заполнено.
            fullName = string.Join(" ", fioParts);
        }
        else if (!string.IsNullOrWhiteSpace(u.Name))
        {
            // ФИО отдельными атрибутами не заполнено, но есть
            // единое user.name (например, из blueprint).
            fullName = u.Name;
        }
        else
        {
            // Совсем ничего — показываем username, чтобы UI
            // не остался с пустым полем.
            fullName = u.Username;
        }

        return new AdminUserDto
        {
            // ============================================================
            // ВАЖНО ПРО Id:
            //   Authentik Admin API на эндпоинтах
            //   /api/v3/core/users/{id}/ (GET, PATCH, DELETE,
            //   set_password, add_user, remove_user) ожидает в URL
            //   ЧИСЛОВОЙ первичный ключ (pk), а не UUID.
            //
            //   Если положить сюда UUID, то при попытке
            //   GET /api/v3/core/users/{uuid}/ Authentik вернёт
            //   404, и Gateway бросит KeyNotFoundException.
            //
            //   Поэтому в публичный Id кладём числовой pk в виде
            //   строки. UUID остаётся доступен в поле Uuid модели
            //   AuthentikUser и используется, когда это нужно
            //   (например, для логирования).
            // ============================================================
            Id = u.Pk.ToString(),

            Username = u.Username,
            Email = u.Email,
            FirstName = given ?? string.Empty,
            LastName = family ?? string.Empty,
            Patronymic = middle ?? string.Empty,
            FullName = fullName,
            AvatarUrl = string.IsNullOrWhiteSpace(u.Avatar) ? null : u.Avatar,
            IsActive = u.IsActive,
            IsSuperuser = u.IsSuperuser,
            IsDeleted = false,
            Roles = roles,
            CreatedAt = u.DateJoined,
            LastLogin = u.LastLogin,
        };
    }

    /// <summary>
    /// Преобразует AuthentikGroup в AdminGroupDto.
    ///
    /// UserCount берётся из users_obj.Count (если поле пришло),
    /// иначе из users.Count (список pk).
    ///
    /// ВАЖНО ПРО NULL:
    ///   В ответах Authentik поля users и users_obj могут
    ///   приходить как null:
    ///     - users_obj = null — API не подгружает объекты
    ///       пользователей (для оптимизации);
    ///     - users = null — не приходит список pk.
    ///
    ///   System.Text.Json перезаписывает значение по умолчанию
    ///   на null, и обращение к g.UsersObj.Count / g.Users.Count
    ///   падает с NullReferenceException. Поэтому защищаемся
    ///   через ?? new().
    ///
    /// ВАЖНО ПРО Description:
    ///   У группы Authentik нет отдельного поля description.
    ///   Мы храним его в attributes.description. Извлекаем
    ///   через GetAttrString.
    /// </summary>
    private static AdminGroupDto MapGroup(AuthentikGroup g)
    {
        // Описание в Authentik не стандартизировано — читаем
        // из attributes["description"], если он есть.
        var description = GetAttrString(g.Attributes, "description")
            ?? string.Empty;

        // ЗАЩИТА ОТ NULL: оба списка могут прийти как null.
        var usersObj = g.UsersObj ?? new List<AuthentikGroupUserRef>();
        var users = g.Users ?? new List<int>();

        var userCount = usersObj.Count > 0
            ? usersObj.Count
            : users.Count;

        return new AdminGroupDto
        {
            Id = g.Pk,
            Name = g.Name,
            Description = description,
            IsSuperuser = g.IsSuperuser,
            Parent = string.IsNullOrEmpty(g.Parent) ? null : g.Parent,
            UserCount = userCount,
            // В Authentik у группы нет date_joined — используем
            // текущую дату как заглушку. На UI это поле малоинформативно
            // для групп, но тип RoleDto его требует.
            CreatedAt = DateTime.UtcNow,
        };
    }

    /// <summary>
    /// Строит справочник "UUID группы" -> "имя группы".
    ///
    /// Зачем нужен:
    ///   Authentik в объекте User возвращает `groups`
    ///   как массив UUID-строк. Чтобы показать пользователю
    ///   имена групп в колонке "Роли", нужно развернуть UUID
    ///   в имена. Один раз получаем все группы и строим
    ///   словарь — это дешевле, чем делать N+1 запросов
    ///   на каждого пользователя в списке.
    ///
    /// Возвращает пустой словарь, если групп нет —
    /// вызывающий код должен быть готов к этому.
    /// </summary>
    private async Task<Dictionary<string, string>> BuildGroupNameLookupAsync(
        CancellationToken ct)
    {
        try
        {
            var groups = await ListGroupsAsync(ct);
            return groups.ToDictionary(
                g => g.Id, g => g.Name,
                StringComparer.OrdinalIgnoreCase);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex,
                "Authentik admin: не удалось построить справочник групп — " +
                "имена ролей будут показаны как UUID.");
            return new Dictionary<string, string>(
                StringComparer.OrdinalIgnoreCase);
        }
    }

    /// <summary>
    /// Достаёт строковое значение из attributes-словаря.
    /// Возвращает null, если ключа нет или значение не строка.
    /// </summary>
    private static string? GetAttrString(
        Dictionary<string, object>? attrs, string key)
    {
        if (attrs is null || !attrs.TryGetValue(key, out var value)
            || value is null)
        {
            return null;
        }

        // System.Text.Json десериализует в JsonElement.
        if (value is JsonElement el)
        {
            return el.ValueKind == JsonValueKind.String
                ? el.GetString()
                : el.ToString();
        }

        return value.ToString();
    }

    /// <summary>
    /// Генерирует случайный пароль, удовлетворяющий требованиям
    /// Authentik (мин. 8 символов, буквы и цифры).
    ///
    /// Формат: 16 символов: 4 заглавных, 4 строчных, 4 цифры,
    /// 4 спецсимвола. Перемешиваем — чтобы не было паттерна.
    /// </summary>
    private static string GenerateRandomPassword()
    {
        const string upper = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // без I, O
        const string lower = "abcdefghijkmnpqrstuvwxyz"; // без l, o
        const string digits = "23456789";                // без 0, 1
        const string special = "!@#$%^&*";

        var rng = Random.Shared;
        var chars = new List<char>(16);

        for (int i = 0; i < 4; i++) chars.Add(upper[rng.Next(upper.Length)]);
        for (int i = 0; i < 4; i++) chars.Add(lower[rng.Next(lower.Length)]);
        for (int i = 0; i < 4; i++) chars.Add(digits[rng.Next(digits.Length)]);
        for (int i = 0; i < 4; i++) chars.Add(special[rng.Next(special.Length)]);

        // Fisher-Yates shuffle
        for (int i = chars.Count - 1; i > 0; i--)
        {
            var j = rng.Next(i + 1);
            (chars[i], chars[j]) = (chars[j], chars[i]);
        }

        return new string(chars.ToArray());
    }
}