// src/Uchaly.APIgateway/Extensions/AuthentikAuthenticationExtensions.cs

using System.Security.Claims;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;
using Uchaly.APIgateway.Options;

namespace Uchaly.APIgateway.Extensions;

/// <summary>
/// Расширения для настройки аутентификации через Authentik (OAuth2/OIDC).
/// Заменяет кастомную JWT-аутентификацию (CustomJWTtokenExtension).
/// </summary>
public static class AuthentikAuthenticationExtensions
{
    /// <summary>
    /// Регистрирует аутентификацию через Authentik.
    /// JWT-токены валидируются по OpenID Connect discovery-документу.
    /// </summary>
    public static IServiceCollection AddAuthentikAuthentication(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        // Привязываем опции из секции "Authentik"
        var authentikOptions = configuration
            .GetSection(AuthentikOptions.SectionName)
            .Get<AuthentikOptions>()
            ?? throw new InvalidOperationException(
                "Секция 'Authentik' не найдена в конфигурации.");

        if (string.IsNullOrWhiteSpace(authentikOptions.Authority))
        {
            throw new InvalidOperationException(
                "Authentik:Authority не задан. Укажите базовый URL инстанса Authentik.");
        }

        if (string.IsNullOrWhiteSpace(authentikOptions.MetadataAddress))
        {
            // Формируем стандартный URL discovery для Authentik
            authentikOptions.MetadataAddress =
                $"{authentikOptions.Authority.TrimEnd('/')}/application/o/uchaly/.well-known/openid-configuration";
        }

        services.AddSingleton(authentikOptions);

        services.AddAuthentication(options =>
        {
            options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
            options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
        })
        .AddJwtBearer(JwtBearerDefaults.AuthenticationScheme, options =>
        {
            options.RequireHttpsMetadata = authentikOptions.RequireHttpsMetadata;
            options.MetadataAddress = authentikOptions.MetadataAddress;
            options.Authority = authentikOptions.Authority;

            options.TokenValidationParameters = new TokenValidationParameters
            {
                // ============================================================
                // ВАЛИДАЦИЯ ИЗДАТЕЛЯ (iss)
                //
                // ВАЖНО: Authentik кладёт в iss полный URL приложения:
                //   {scheme}://{host}/application/o/{slug}/
                //
                // Хост зависит от того, по какому адресу клиент
                // обратился к Authentik:
                //   - Браузер логинится на http://localhost:9000
                //     → iss = "http://localhost:9000/application/o/uchaly/"
                //   - Gateway внутри docker-сети видит Authentik
                //     по http://authentik-server:9000
                //     → если бы SPA тоже ходила сюда, iss был бы
                //       "http://authentik-server:9000/application/o/uchaly/",
                //       но из браузера это имя не резолвится.
                //
                // В итоге один и тот же Authentik отдаёт разные iss
                // в зависимости от того, кто его спрашивает. Чтобы
                // Gateway принимал токены и от SPA (localhost), и от
                // внутренних клиентов (docker-имя), используется
                // список ValidIssuers.
                //
                // Сам список формируется методом BuildValidIssuers
                // (см. ниже). Если он задан явно в appsettings.json —
                // используется он. Если пуст — строится fallback
                // из Authority + типичных вариантов.
                // ============================================================
                ValidateIssuer = authentikOptions.ValidateIssuer,
                ValidIssuers = BuildValidIssuers(authentikOptions).ToList(),

                // Валидация audience (aud).
                //
                // В нашем случае Authentik кладёт в aud client_id
                // приложения (uchaly-frontend), что совпадает
                // с нашей конфигурацией.
                ValidateAudience = authentikOptions.ValidateAudience,
                ValidAudience = authentikOptions.Audience,

                // Валидация времени жизни (exp / nbf).
                ValidateLifetime = authentikOptions.ValidateLifetime,
                ClockSkew = TimeSpan.FromMinutes(authentikOptions.ClockSkewMinutes),

                // Валидация подписи ключом издателя.
                ValidateIssuerSigningKey = authentikOptions.ValidateIssuerSigningKey,

                // Маппинг claim'ов.
                //
                // NameClaimType = Email — потому что в нашем приложении
                // имя пользователя для отображения — это email.
                // RoleClaimType = Role — потому что middleware
                // AuthentikTokenValidationMiddleware добавляет роли
                // из claim'а groups в ClaimTypes.Role.
                NameClaimType = ClaimTypes.Email,
                RoleClaimType = ClaimTypes.Role
            };

            // Логирование событий аутентификации.
            options.Events = new JwtBearerEvents
            {
                OnAuthenticationFailed = context =>
                {
                    var logger = context.HttpContext.RequestServices
                        .GetRequiredService<ILogger<JwtBearerEvents>>();
                    logger.LogWarning(
                        context.Exception,
                        "Authentik: ошибка аутентификации. Path={Path}",
                        context.HttpContext.Request.Path);
                    return Task.CompletedTask;
                },
                OnTokenValidated = context =>
                {
                    var logger = context.HttpContext.RequestServices
                        .GetRequiredService<ILogger<JwtBearerEvents>>();
                    var userId = context.Principal?.FindFirst(ClaimTypes.NameIdentifier)?.Value
                        ?? context.Principal?.FindFirst("sub")?.Value;
                    logger.LogDebug(
                        "Authentik: токен валиден. UserId={UserId}",
                        userId);
                    return Task.CompletedTask;
                },
                OnChallenge = context =>
                {
                    // Переопределяем ответ 401: возвращаем JSON, а не HTML.
                    //
                    // ВАЖНО: этот обработчик вызывается, когда
                    // [Authorize] не пропустил запрос (нет токена,
                    // токен невалиден, роль не подходит). Мы отдаём
                    // структурированный JSON, который фронт может
                    // показать пользователю.
                    context.HandleResponse();
                    context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                    context.Response.ContentType = "application/json";

                    var result = System.Text.Json.JsonSerializer.Serialize(new
                    {
                        Type = "Unauthorized",
                        Title = "Требуется аутентификация через Authentik.",
                        Status = 401,
                        Detail = "Токен отсутствует, истёк или недействителен.",
                        LoginUrl = authentikOptions.FrontendLoginUrl
                    });

                    return context.Response.WriteAsync(result);
                }
            };
        });

        // Политики авторизации на основе групп Authentik.
        //
        // ВАЖНО: имена групп соответствуют name в blueprint
        // (uchaly-app.yaml). Они передаются в claim'е groups
        // и middleware AuthentikTokenValidationMiddleware
        // конвертирует их в ClaimTypes.Role.
        services.AddAuthorizationBuilder()
            .AddPolicy("AdminOnly", policy =>
                policy.RequireRole("Admin"))
            .AddPolicy("AdminOrDiagnost", policy =>
                policy.RequireRole("Admin", "Diagnost"))
            .AddPolicy("AdminOrDiagnostOrService", policy =>
                policy.RequireRole("Admin", "Diagnost", "Service"))
            .AddPolicy("AdminOrSafety", policy =>
                policy.RequireRole("Admin", "Safety"))
            .AddPolicy("AdminOrTcx", policy =>
                policy.RequireRole("Admin", "TCX"))
            .AddPolicy("AdminOrElectric", policy =>
                policy.RequireRole("Admin", "Electric"))
            .AddPolicy("AuthenticatedUser", policy =>
                policy.RequireAuthenticatedUser());

        return services;
    }

    /// <summary>
    /// Формирует список допустимых issuer'ов для TokenValidationParameters.
    ///
    /// Логика:
    ///   1. Если в appsettings.json задан явный массив ValidIssuers —
    ///      используем его как есть (это рекомендуемый путь).
    ///
    ///   2. Если массив пуст — строим fallback из Authority,
    ///      добавляя к нему типичный path Authentik
    ///      /application/o/uchaly/, а также вариант с localhost
    ///      (на случай, когда SPA логинится снаружи, а Gateway
    ///      находится внутри docker-сети).
    ///
    /// Возвращаемый список используется в
    /// TokenValidationParameters.ValidIssuers.
    ///
    /// ПРИМЕР:
    ///   Authority = "http://authentik-server:9000"
    ///   MetadataAddress = "http://authentik-server:9000/application/o/uchaly/.well-known/openid-configuration"
    ///
    ///   Fallback вернёт:
    ///     - "http://authentik-server:9000"
    ///     - "http://authentik-server:9000/application/o/uchaly/"
    ///     - "http://localhost:9000/application/o/uchaly/"
    ///
    ///   Из них реально совпадёт только второй или третий —
    ///   в зависимости от того, откуда пришёл токен.
    /// </summary>
    private static IEnumerable<string> BuildValidIssuers(AuthentikOptions opts)
    {
        // 1. Явный список из конфигурации — приоритетный.
        if (opts.ValidIssuers is { Count: > 0 })
        {
            // Нормализуем: убираем пустые/пробельные значения,
            // дедуплицируем (без учёта регистра).
            return opts.ValidIssuers
                .Where(s => !string.IsNullOrWhiteSpace(s))
                .Select(s => s.Trim())
                .Distinct(StringComparer.OrdinalIgnoreCase);
        }

        // 2. Fallback: Authority + типичные варианты Authentik.
        var authority = opts.Authority.TrimEnd('/');

        var issuers = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            // 2.1. «Голый» Authority — вдруг кто-то настроил Authentik
            //      так, что iss не содержит path приложения.
            //      В стандартном Authentik такого не бывает, но
            //      пусть будет — на случай кастомных конфигураций.
            authority,

            // 2.2. Полный URL приложения — именно так формирует iss
            //      Authentik по умолчанию. Slug берём из
            //      MetadataAddress, если он там есть, иначе
            //      используем дефолтный "uchaly".
            BuildIssuerWithAppPath(authority, opts.MetadataAddress),

            // 2.3. Вариант с localhost — для случая, когда SPA
            //      логинится снаружи по http://localhost:9000,
            //      а Gateway находится внутри docker-сети и видит
            //      Authentik по http://authentik-server:9000.
            //      Это самый частый сценарий в dev-окружении.
            BuildIssuerWithAppPath("http://localhost:9000", opts.MetadataAddress),
        };

        // Убираем возможные null/пустые после BuildIssuerWithAppPath.
        return issuers.Where(s => !string.IsNullOrWhiteSpace(s));
    }

    /// <summary>
    /// Собирает issuer в формате Authentik:
    ///   {authority}/application/o/{slug}/
    ///
    /// Slug извлекается из MetadataAddress, если он там есть.
    /// Формат MetadataAddress:
    ///   {authority}/application/o/{slug}/.well-known/openid-configuration
    ///
    /// Если MetadataAddress пуст или не содержит /application/o/,
    /// используется slug по умолчанию — "uchaly".
    /// </summary>
    /// <param name="authority">Базовый URL Authentik без завершающего слеша.</param>
    /// <param name="metadataAddress">URL discovery-документа OIDC.</param>
    /// <returns>Issuer в формате Authentik с завершающим слешем.</returns>
    private static string BuildIssuerWithAppPath(
        string authority, string metadataAddress)
    {
        // Значение по умолчанию — slug нашего приложения.
        const string defaultSlug = "uchaly";
        var slug = defaultSlug;

        // Пытаемся извлечь slug из MetadataAddress.
        if (!string.IsNullOrWhiteSpace(metadataAddress))
        {
            const string marker = "/application/o/";
            var idx = metadataAddress.IndexOf(
                marker, StringComparison.OrdinalIgnoreCase);

            if (idx >= 0)
            {
                // Отрезаем всё до marker включительно.
                var tail = metadataAddress[(idx + marker.Length)..];

                // Ищем следующий слеш — до него и есть slug.
                var slash = tail.IndexOf('/');
                if (slash > 0)
                {
                    slug = tail[..slash];
                }
                else if (tail.Length > 0)
                {
                    // Случай, когда MetadataAddress заканчивается
                    // сразу после slug (без .well-known/...).
                    slug = tail;
                }
            }
        }

        return $"{authority.TrimEnd('/')}/application/o/{slug}/";
    }
}