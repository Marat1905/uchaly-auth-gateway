namespace Uchaly.APIgateway.Options;

/// <summary>
/// Опции подключения к Authentik как OAuth2/OIDC-провайдеру.
/// Секция конфигурации: "Authentik"
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
    /// </summary>
    public string Authority { get; set; } = string.Empty;

    /// <summary>
    /// URL discovery-документа OpenID Connect.
    /// По умолчанию: {Authority}/application/o/uchaly/.well-known/openid-configuration
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
    /// </summary>
    public bool ValidateIssuer { get; set; } = true;

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