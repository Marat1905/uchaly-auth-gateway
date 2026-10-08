using System.Text;
using System.Text.Json;

namespace Uchaly.APIgateway.Middleware;

/// <summary>
/// Middleware для проксирования Swagger JSON от микросервисов
/// и модификации путей (удаление префиксов) для корректного отображения в Swagger UI шлюза.
/// </summary>
public class SwaggerProxyMiddleware
{
    private readonly RequestDelegate _next;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ILogger<SwaggerProxyMiddleware> _logger;

    public SwaggerProxyMiddleware(
        RequestDelegate next,
        IHttpClientFactory httpClientFactory,
        ILogger<SwaggerProxyMiddleware> logger)
    {
        _next = next;
        _httpClientFactory = httpClientFactory;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        var path = context.Request.Path;

        // Swagger для Monitoring Service
        if (path.StartsWithSegments("/monitoring/swagger"))
        {
            await ProxyAndModifySwaggerJson(
                context,
                path,
                "http://uchaly-vibrationmonitoring-api:8080",
                "/monitoring");
            return;
        }

        // Swagger для Identity Service — УДАЛЕНО (заменено на Authentik)
        // Identity Service больше не существует как отдельный микросервис.
        // Swagger для Authentik не требуется, т.к. это внешний IdP.

        // Swagger для AssetTracker (если требуется модификация)
        if (path.StartsWithSegments("/motor/swagger"))
        {
            await ProxySwaggerJson(
                context,
                path,
                "http://assettracker-api:8080",
                "/motor");
            return;
        }

        // Swagger для Humidity
        if (path.StartsWithSegments("/humidity/swagger"))
        {
            await ProxySwaggerJson(
                context,
                path,
                "http://humidity-api:8080",
                "/humidity");
            return;
        }

        // Swagger для Safety Injuries
        if (path.StartsWithSegments("/safety/swagger"))
        {
            await ProxySwaggerJson(
                context,
                path,
                "http://safety-injuries-api:8080",
                "/safety");
            return;
        }

        await _next(context);
    }

    /// <summary>
    /// Проксирует Swagger JSON с удалением указанного префикса из путей.
    /// </summary>
    private async Task ProxyAndModifySwaggerJson(
        HttpContext context,
        PathString path,
        string baseUrl,
        string prefixToRemove)
    {
        try
        {
            var client = _httpClientFactory.CreateClient();
            var targetPath = path.Value!.Replace(prefixToRemove, string.Empty);
            var targetUrl = $"{baseUrl}{targetPath}";

            _logger.LogInformation(
                "Проксирование Swagger (с модификацией) на: {TargetUrl}",
                targetUrl);

            var response = await client.GetAsync(targetUrl);

            if (response.IsSuccessStatusCode)
            {
                var content = await response.Content.ReadAsStringAsync();
                var modifiedContent = RemovePrefixFromSwagger(content, prefixToRemove);

                context.Response.ContentType = "application/json";
                await context.Response.WriteAsync(modifiedContent);
            }
            else
            {
                context.Response.StatusCode = (int)response.StatusCode;
                await context.Response.WriteAsync(
                    $"Ошибка получения Swagger: {response.StatusCode}");
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Ошибка проксирования Swagger-запроса");
            context.Response.StatusCode = 500;
            await context.Response.WriteAsync(
                $"Ошибка проксирования Swagger: {ex.Message}");
        }
    }

    /// <summary>
    /// Проксирует Swagger JSON без модификации.
    /// </summary>
    private async Task ProxySwaggerJson(
        HttpContext context,
        PathString path,
        string baseUrl,
        string prefixToRemove)
    {
        try
        {
            var client = _httpClientFactory.CreateClient();
            var targetPath = path.Value!.Replace(prefixToRemove, string.Empty);
            var targetUrl = $"{baseUrl}{targetPath}";

            _logger.LogInformation(
                "Проксирование Swagger на: {TargetUrl}",
                targetUrl);

            var response = await client.GetAsync(targetUrl);

            if (response.IsSuccessStatusCode)
            {
                var content = await response.Content.ReadAsStringAsync();
                context.Response.ContentType = "application/json";
                await context.Response.WriteAsync(content);
            }
            else
            {
                context.Response.StatusCode = (int)response.StatusCode;
                await context.Response.WriteAsync(
                    $"Ошибка получения Swagger: {response.StatusCode}");
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Ошибка проксирования Swagger-запроса");
            context.Response.StatusCode = 500;
            await context.Response.WriteAsync(
                $"Ошибка проксирования Swagger: {ex.Message}");
        }
    }

    /// <summary>
    /// Удаляет указанный префикс из путей Swagger JSON
    /// и заменяет servers на корень шлюза.
    /// </summary>
    private string RemovePrefixFromSwagger(string swaggerJson, string prefix)
    {
        try
        {
            using var document = JsonDocument.Parse(swaggerJson);
            using var stream = new MemoryStream();
            using var writer = new Utf8JsonWriter(
                stream,
                new JsonWriterOptions { Indented = true });

            writer.WriteStartObject();

            foreach (var property in document.RootElement.EnumerateObject())
            {
                if (property.NameEquals("paths"))
                {
                    writer.WritePropertyName("paths");
                    writer.WriteStartObject();

                    foreach (var path in property.Value.EnumerateObject())
                    {
                        // Удаляем префикс из пути
                        var cleanPath = path.Name.StartsWith(prefix)
                            ? path.Name.Substring(prefix.Length)
                            : path.Name;

                        // Если путь стал пустым — заменяем на "/"
                        if (string.IsNullOrEmpty(cleanPath))
                        {
                            cleanPath = "/";
                        }

                        writer.WritePropertyName(cleanPath);
                        path.Value.WriteTo(writer);
                    }

                    writer.WriteEndObject();
                }
                else if (property.NameEquals("servers"))
                {
                    // Заменяем servers на корень шлюза
                    writer.WritePropertyName("servers");
                    writer.WriteStartArray();
                    writer.WriteStartObject();
                    writer.WriteString("url", "/");
                    writer.WriteString("description", "API Gateway");
                    writer.WriteEndObject();
                    writer.WriteEndArray();
                }
                else
                {
                    property.WriteTo(writer);
                }
            }

            writer.WriteEndObject();
            writer.Flush();

            return Encoding.UTF8.GetString(stream.ToArray());
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Ошибка модификации Swagger JSON");
            return swaggerJson; // Возвращаем исходный JSON при ошибке
        }
    }
}

/// <summary>
/// Расширение для подключения middleware.
/// </summary>
public static class SwaggerProxyMiddlewareExtensions
{
    public static IApplicationBuilder UseSwaggerProxy(this IApplicationBuilder builder)
    {
        return builder.UseMiddleware<SwaggerProxyMiddleware>();
    }
}