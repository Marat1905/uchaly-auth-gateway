// src/Uchaly.APIgateway/Options/AuthentikOptions.cs

namespace Uchaly.APIgateway.Options;

/// <summary>
/// Опции подключения к Authentik как OAuth2/OIDC-провайдеру.
/// Секция конфигурации: "Authentik"
///
/// ВАЖНО: этот класс НЕ содержит AdminToken и настроек
/// ROPC-клиента. Gateway не вызывает Authentik Admin API
/// от имени пользователя — редактирование профиля и смена
/// пароля выполняются нативными flow Authentik
/// (см. uchaly-app.yaml), а админ-панель работает через
/// отдельный класс AuthentikAdminOptions.
/// </summary>
public class AuthentikOptions
{
    /// <summary>
    /// Название секции в appsettings.json.
    /// </summary>
    public const string SectionName = "Authentik";

    /// <summary>
    /// Базовый URL инстанса Authentik (например, http://authentik-server:9000
    /// внутри Docker-сети или https://auth.uchaly.com снаружи).
    /// Используется для OIDC-валидации токенов и как fallback
    /// для построения списка допустимых issuer'ов.
    /// </summary>
    public string Authority { get; set; } = string.Empty;

    /// <summary>
    /// URL discovery-документа OpenID Connect.
    /// По умолчанию: {Authority}/application/o/uchaly/.well-known/openid-configuration
    ///
    /// Из этого URL извлекается slug приложения (uchaly)
    /// для построения корректных значений ValidIssuers.
    /// </summary>
    public string MetadataAddress { get; set; } = string.Empty;

    /// <summary>
    /// Client ID, созданный в Authentik (Blueprint: uchaly-frontend).
    /// </summary>
    public string ClientId { get; set; } = "uchaly-frontend";

    /// <summary>
    /// Ожидаемая audience токена (обычно совпадает с ClientId).
    /// </summary>
    public string Audience { get; set; } = "uchaly-frontend";

    /// <summary>
    /// Требовать HTTPS для метаданных. В dev-окружении false.
    /// </summary>
    public bool RequireHttpsMetadata { get; set; } = true;

    /// <summary>
    /// Валидировать издателя токена (iss).
    ///
    /// Если true — используется список ValidIssuers.
    /// Если false — валидация issuer полностью пропускается
    /// (не рекомендуется в production).
    /// </summary>
    public bool ValidateIssuer { get; set; } = true;

    /// <summary>
    /// Список допустимых значений claim'а `iss` в токене.
    ///
    /// ЗАЧЕМ ЭТО НУЖНО:
    ///   Authentik формирует `iss` в формате:
    ///     {scheme}://{host}/{path}/application/o/{slug}/
    ///   например: http://localhost:9000/application/o/uchaly/
    ///
    ///   Хост зависит от того, по какому URL клиент обратился
    ///   к Authentik:
    ///     - SPA из браузера ходит на http://localhost:9000
    ///       → iss = "http://localhost:9000/application/o/uchaly/"
    ///     - Gateway внутри docker-сети видит Authentik
    ///       по http://authentik-server:9000
    ///       → iss = "http://authentik-server:9000/application/o/uchaly/"
    ///
    ///   Если задать только один ValidIssuer, то половина
    ///   окружений (dev-браузер или docker-внутренний клиент)
    ///   получит 401 SecurityTokenInvalidIssuerException.
    ///
    ///   Решение — перечислить здесь ВСЕ варианты, которые
    ///   могут встретиться в вашей инфраструктуре.
    ///
    /// ВАЖНО ПРО ЗАВЕРШАЮЩИЙ СЛЕШ:
    ///   Authentik всегда добавляет "/" в конце iss.
    ///   Строка "http://localhost:9000/application/o/uchaly"
    ///   (без слеша) НЕ совпадёт с iss из токена.
    ///   Всегда указывайте слеш в конце.
    ///
    /// Если список пуст — fallback на Authority + путь
    /// /application/o/uchaly/ (см. BuildValidIssuers
    /// в AuthentikAuthenticationExtensions).
    /// </summary>
    public List<string> ValidIssuers { get; set; } = new();

    /// <summary>
    /// Валидировать audience токена (aud).
    /// </summary>
    public bool ValidateAudience { get; set; } = true;

    /// <summary>
    /// Валидировать время жизни токена (exp / nbf).
    /// </summary>
    public bool ValidateLifetime { get; set; } = true;

    /// <summary>
    /// Валидировать подпись ключом издателя.
    /// </summary>
    public bool ValidateIssuerSigningKey { get; set; } = true;

    /// <summary>
    /// Допустимый разброс по времени (в минутах) при валидации.
    /// </summary>
    public int ClockSkewMinutes { get; set; } = 5;

    /// <summary>
    /// Claim, в котором Authentik передаёт группы (роли).
    /// По умолчанию: "groups".
    /// </summary>
    public string GroupsClaim { get; set; } = "groups";

    /// <summary>
    /// Префикс claim'а ролей. Если Authentik передаёт группы как "Admin",
    /// а в приложении ожидается "ROLE_Admin" — укажите здесь "ROLE_".
    /// </summary>
    public string RoleClaimPrefix { get; set; } = string.Empty;

    /// <summary>
    /// URL для редиректа после логина (frontend callback).
    /// </summary>
    public string FrontendCallbackUrl { get; set; } = "/auth/callback";

    /// <summary>
    /// URL страницы логина фронтенда (куда редиректить неавторизованных).
    /// </summary>
    public string FrontendLoginUrl { get; set; } = "/login";
}