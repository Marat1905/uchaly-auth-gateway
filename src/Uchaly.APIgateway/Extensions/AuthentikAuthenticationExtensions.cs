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
                // Валидация издателя (iss)
                ValidateIssuer = authentikOptions.ValidateIssuer,
                ValidIssuer = authentikOptions.Authority.TrimEnd('/'),

                // Валидация audience (aud)
                ValidateAudience = authentikOptions.ValidateAudience,
                ValidAudience = authentikOptions.Audience,

                // Валидация времени жизни
                ValidateLifetime = authentikOptions.ValidateLifetime,
                ClockSkew = TimeSpan.FromMinutes(authentikOptions.ClockSkewMinutes),

                // Валидация подписи
                ValidateIssuerSigningKey = authentikOptions.ValidateIssuerSigningKey,

                // Маппинг claim'ов
                NameClaimType = ClaimTypes.Email,
                RoleClaimType = ClaimTypes.Role
            };

            // Логирование событий аутентификации
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
                    // Переопределяем ответ 401: возвращаем JSON, а не HTML
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

        // Политики авторизации на основе групп Authentik
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
}