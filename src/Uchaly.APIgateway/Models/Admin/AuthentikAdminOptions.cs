// src/Uchaly.APIgateway/Options/AuthentikAdminOptions.cs
// =============================================================================
// Опции подключения к Authentik ADMIN API.
//
// ВАЖНОЕ ОТЛИЧИЕ ОТ AuthentikOptions:
//   - AuthentikOptions  — параметры OIDC (Authority, ClientId, Audience).
//     Используются в JwtBearer для валидации токенов.
//   - AuthentikAdminOptions (этот класс) — параметры Admin REST API.
//     Нужны ТОЛЬКО для вызовов /api/v3/core/... из админ-панели.
//     Требуют API-токен (не OIDC-токен!), выпущенный в Authentik
//     для сервисного пользователя.
//
// КАК ПОЛУЧИТЬ API-ТОКЕН:
//   1. В Authentik: Directory -> Tokens and App passwords -> Create.
//   2. Указать Intent = API, User = akadmin (или сервисный пользователь).
//   3. Скопировать значение и положить в ENV AUTHENTIK_ADMIN_TOKEN.
//
// БЕЗОПАСНОСТЬ:
//   Токен НЕ должен попадать на фронтенд. Все вызовы идут
//   через API Gateway, который сам подкладывает токен в заголовок
//   Authorization. Фронт общается только с Gateway по /api/admin/*.
// =============================================================================

namespace Uchaly.APIgateway.Options;

/// <summary>
/// Опции подключения к Admin API Authentik.
/// Секция конфигурации: "AuthentikAdmin"
/// </summary>
public class AuthentikAdminOptions
{
    /// <summary>Имя секции в appsettings.json.</summary>
    public const string SectionName = "AuthentikAdmin";

    /// <summary>
    /// Базовый URL инстанса Authentik, например
    /// http://authentik-server:9000. Должен совпадать с
    /// Authentik:Authority (либо явно указываться отдельно).
    /// </summary>
    public string BaseUrl { get; set; } = "http://authentik-server:9000";

    /// <summary>
    /// API-токен сервисного пользователя.
    /// Задаётся через переменную окружения AUTHENTIK_ADMIN_TOKEN.
    /// </summary>
    public string ApiToken { get; set; } = string.Empty;

    /// <summary>
    /// Таймаут запросов к Admin API в секундах. По умолчанию 30.
    /// </summary>
    public int TimeoutSeconds { get; set; } = 30;
}