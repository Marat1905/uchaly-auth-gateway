using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Uchaly.APIgateway.Controllers;

/// <summary>
/// Служебный контроллер шлюза: статус и конфигурация.
/// </summary>
[ApiController]
[Route("api/[controller]")]
[AllowAnonymous]
public class GatewayController : ControllerBase
{
    /// <summary>
    /// Возвращает статус шлюза и список доступных сервисов.
    /// </summary>
    [HttpGet("status")]
    public IActionResult GetStatus()
    {
        return Ok(new
        {
            status = "Gateway is running",
            timestamp = DateTime.UtcNow,
            service = "Uchaly.APIgateway",
            version = "2.0.0-authentik",
            identityProvider = "Authentik",
            endpoints = new[]
            {
                new { path = "/api", service = "Proxied API endpoints" },
                new { path = "/monitoring", service = "Vibration Monitoring API" },
                new { path = "/motor", service = "AssetTracker API" },
                new { path = "/humidity", service = "Humidity API" },
                new { path = "/safety", service = "Safety Injuries API" },
                new { path = "/swagger", service = "Swagger UI" },
                new { path = "/health", service = "Health Check" }
            }
        });
    }

    /// <summary>
    /// Возвращает конфигурацию downstream-сервисов.
    /// </summary>
    [HttpGet("config")]
    public IActionResult GetConfig(IConfiguration configuration)
    {
        var authentikAuthority = configuration["Authentik:Authority"];

        return Ok(new
        {
            identityProvider = new
            {
                type = "Authentik",
                authority = authentikAuthority,
                metadataAddress = configuration["Authentik:MetadataAddress"],
                clientId = configuration["Authentik:ClientId"],
                loginUrl = $"{authentikAuthority}/application/o/authorize/",
                tokenUrl = $"{authentikAuthority}/application/o/token/",
                userInfoUrl = $"{authentikAuthority}/application/o/userinfo/",
                endSessionUrl = $"{authentikAuthority}/application/o/uchaly/end-session/"
            },
            monitoringService = "http://uchaly-vibrationmonitoring-api:8080",
            assetTrackerService = "http://assettracker-api:8080",
            humidityService = "http://humidity-api:8080",
            safetyInjuriesService = "http://safety-injuries-api:8080",
            swaggerUrls = new[]
            {
                "/monitoring/swagger/v1/swagger.json",
                "/motor/swagger/v1/swagger.json",
                "/humidity/swagger/v1/swagger.json",
                "/safety/swagger/v1/swagger.json"
            }
        });
    }
}