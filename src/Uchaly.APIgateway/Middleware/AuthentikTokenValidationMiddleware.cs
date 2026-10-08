using System.Security.Claims;
using Uchaly.APIgateway.Options;

namespace Uchaly.APIgateway.Middleware;

/// <summary>
/// Middleware для извлечения claims из токена Authentik
/// и добавления их в контекст запроса (например, группы → роли).
/// </summary>
public class AuthentikTokenValidationMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<AuthentikTokenValidationMiddleware> _logger;
    private readonly AuthentikOptions _options;

    public AuthentikTokenValidationMiddleware(
        RequestDelegate next,
        ILogger<AuthentikTokenValidationMiddleware> logger,
        AuthentikOptions options)
    {
        _next = next;
        _logger = logger;
        _options = options;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        // Если пользователь аутентифицирован, извлекаем группы из claim'а
        if (context.User?.Identity?.IsAuthenticated == true)
        {
            var groupsClaim = context.User.FindAll(_options.GroupsClaim).ToList();

            if (groupsClaim.Count > 0)
            {
                var identity = context.User.Identity as ClaimsIdentity;

                if (identity is not null)
                {
                    foreach (var group in groupsClaim)
                    {
                        // Добавляем claim роли (Role) для каждого значения группы
                        var roleValue = string.IsNullOrEmpty(_options.RoleClaimPrefix)
                            ? group.Value
                            : $"{_options.RoleClaimPrefix}{group.Value}";

                        // Проверяем, нет ли уже такого role claim
                        if (!context.User.IsInRole(roleValue))
                        {
                            identity.AddClaim(new Claim(ClaimTypes.Role, roleValue));
                        }
                    }

                    _logger.LogDebug(
                        "Authentik: добавлено {Count} ролей из claim'а '{Claim}'",
                        groupsClaim.Count,
                        _options.GroupsClaim);
                }
            }

            // Пробрасываем ID пользователя в заголовок для downstream-сервисов
            var userId = context.User.FindFirst(ClaimTypes.NameIdentifier)?.Value
                ?? context.User.FindFirst("sub")?.Value;

            if (!string.IsNullOrEmpty(userId))
            {
                context.Request.Headers["X-Authentik-User-Id"] = userId;
            }

            // Пробрасываем email
            var email = context.User.FindFirst(ClaimTypes.Email)?.Value
                ?? context.User.FindFirst("email")?.Value;

            if (!string.IsNullOrEmpty(email))
            {
                context.Request.Headers["X-Authentik-Email"] = email;
            }
        }

        await _next(context);
    }
}

/// <summary>
/// Расширение для подключения middleware.
/// </summary>
public static class AuthentikTokenValidationMiddlewareExtensions
{
    public static IApplicationBuilder UseAuthentikTokenValidation(
        this IApplicationBuilder builder)
    {
        return builder.UseMiddleware<AuthentikTokenValidationMiddleware>();
    }
}