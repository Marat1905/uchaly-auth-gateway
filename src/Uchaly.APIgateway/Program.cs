using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Serilog;
using Uchaly.APIgateway.Extensions;
using Uchaly.APIgateway.Middleware;

// ============================================================
// Создание builder'а веб-приложения
// ============================================================
var builder = WebApplication.CreateBuilder(args);

// ============================================================
// 1. Serilog — логирование
// ============================================================
Log.Logger = new LoggerConfiguration()
    .ReadFrom.Configuration(builder.Configuration)
    .Enrich.FromLogContext()
    .CreateLogger();

builder.Host.UseSerilog();

// ============================================================
// 2. Контроллеры
// ============================================================
builder.Services.AddControllers();

// ============================================================
// 3. OpenAPI / Swagger
// ============================================================
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("gateway", new()
    {
        Title = "Uchaly API Gateway",
        Version = "v2.0-authentik",
        Description = "API Gateway для платформы Uchaly с аутентификацией через Authentik"
    });

    // Определение Bearer-схемы для Swagger UI
    c.AddSecurityDefinition("Bearer", new Microsoft.OpenApi.Models.OpenApiSecurityScheme
    {
        Description = "JWT Authorization header using the Bearer scheme. Пример: \"Authorization: Bearer {token}\"",
        Name = "Authorization",
        In = Microsoft.OpenApi.Models.ParameterLocation.Header,
        Type = Microsoft.OpenApi.Models.SecuritySchemeType.ApiKey,
        Scheme = "Bearer"
    });

    // Требование Bearer-токена для всех эндпоинтов
    c.AddSecurityRequirement(new Microsoft.OpenApi.Models.OpenApiSecurityRequirement
    {
        {
            new Microsoft.OpenApi.Models.OpenApiSecurityScheme
            {
                Reference = new Microsoft.OpenApi.Models.OpenApiReference
                {
                    Type = Microsoft.OpenApi.Models.ReferenceType.SecurityScheme,
                    Id = "Bearer"
                }
            },
            Array.Empty<string>()
        }
    });
});

// ============================================================
// 4. YARP — Reverse Proxy
// ============================================================
builder.Services.AddReverseProxy()
    .LoadFromConfig(builder.Configuration.GetSection("ReverseProxy"));

// ============================================================
// 5. Аутентификация через Authentik
// ============================================================
builder.Services.AddAuthentikAuthentication(builder.Configuration);

// ============================================================
// 6. Авторизация
// ============================================================
builder.Services.AddAuthorization();

// ============================================================
// 7. CORS
// ============================================================
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowFrontend", policy =>
    {
        policy.WithOrigins(
                "http://localhost:62080",
                "https://localhost:62080",
                "http://10.0.9.100:62080",
                "https://10.0.9.100:62080",
                "http://localhost:3000",
                "https://localhost:3000",
                "http://localhost:30008",
                "http://localhost"
            )
            .AllowAnyHeader()
            .AllowAnyMethod()
            .AllowCredentials()
            .WithExposedHeaders("Content-Disposition");
    });
});

// ============================================================
// 8. Health Checks
// ============================================================
builder.Services.AddHealthChecks();

// ============================================================
// 9. HttpClient для Swagger-прокси
// ============================================================
builder.Services.AddHttpClient();

// ============================================================
// Построение приложения
// ============================================================
var app = builder.Build();

// ============================================================
// 10. Пайплайн обработки запросов
// ============================================================

// ----- Swagger UI -----
// Включаем в Development (и опционально в других средах по требованию)
if (app.Environment.IsDevelopment())
{
    // Генерация JSON-документа OpenAPI
    app.UseSwagger();

    // UI для Swagger с указанием endpoints всех сервисов
    app.UseSwaggerUI(c =>
    {
        // Документация самого шлюза
        c.SwaggerEndpoint("/swagger/gateway/swagger.json", "Gateway API");

        // Документация микросервисов (проксируется через YARP)
        c.SwaggerEndpoint("/monitoring/swagger/v1/swagger.json", "Monitoring Service");
        c.SwaggerEndpoint("/motor/swagger/v1/swagger.json", "AssetTracker Service");
        c.SwaggerEndpoint("/humidity/swagger/v1/swagger.json", "Humidity Service");
        c.SwaggerEndpoint("/safety/swagger/v1/swagger.json", "Safety Injuries Service");

        // Префикс, по которому будет доступен UI: /swagger/index.html
        c.RoutePrefix = "swagger";
    });
}

// ----- CORS -----
app.UseCors("AllowFrontend");

// ----- HTTPS-редирект -----
// В Development можно отключить для упрощения локальной отладки
if (!app.Environment.IsDevelopment())
{
    app.UseHttpsRedirection();
}

// ----- Аутентификация через Authentik -----
// Проверяет JWT-токен, выпущенный Authentik, через OIDC discovery
app.UseAuthentication();

// ----- Дополнительный middleware для извлечения ролей из групп Authentik -----
// Добавляет claim'ы ролей из claim'а groups и пробрасывает X-Authentik-* заголовки
app.UseAuthentikTokenValidation();

// ----- Авторизация -----
app.UseAuthorization();

// ----- Swagger-прокси -----
// Модифицирует пути в Swagger JSON микросервисов (удаляет префиксы)
app.UseSwaggerProxy();

// ----- Маршрутизация контроллеров шлюза -----
app.MapControllers();

// ----- YARP Reverse Proxy -----
// Должен быть после аутентификации/авторизации
app.MapReverseProxy();

// ----- Health Checks -----
app.MapHealthChecks("/health", new HealthCheckOptions
{
    Predicate = _ => true,
    ResponseWriter = async (context, report) =>
    {
        context.Response.ContentType = "application/json";

        var result = System.Text.Json.JsonSerializer.Serialize(new
        {
            status = report.Status.ToString(),
            duration = report.TotalDuration,
            timestamp = DateTime.UtcNow,
            checks = report.Entries.Select(e => new
            {
                name = e.Key,
                status = e.Value.Status.ToString(),
                duration = e.Value.Duration,
                description = e.Value.Description
            })
        });

        await context.Response.WriteAsync(result);
    }
});

// ============================================================
// Запуск приложения
// ============================================================
Log.Information("Uchaly API Gateway (Authentik edition) запускается...");

try
{
    app.Run();
}
catch (Exception ex)
{
    Log.Fatal(ex, "Uchaly API Gateway аварийно завершил работу");
}
finally
{
    Log.CloseAndFlush();
}