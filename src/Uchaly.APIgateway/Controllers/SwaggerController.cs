using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Uchaly.APIgateway.Controllers;

/// <summary>
/// Контроллер для получения списка доступных сервисов и их Swagger-документации.
/// </summary>
[ApiExplorerSettings(IgnoreApi = true)]
[AllowAnonymous]
public class SwaggerController : ControllerBase
{
    /// <summary>
    /// Возвращает список доступных микросервисов с URL их Swagger-документации.
    /// </summary>
    [HttpGet("/swagger/services")]
    public IActionResult GetAvailableServices()
    {
        var services = new[]
        {
            new
            {
                Name = "Vibration Monitoring Service",
                SwaggerUrl = "/monitoring/swagger/v1/swagger.json",
                BasePath = "/monitoring",
                HealthCheck = "/monitoring/health"
            },
            new
            {
                Name = "AssetTracker Service",
                SwaggerUrl = "/motor/swagger/v1/swagger.json",
                BasePath = "/motor",
                HealthCheck = "/motor/health"
            },
            new
            {
                Name = "Humidity Service",
                SwaggerUrl = "/humidity/swagger/v1/swagger.json",
                BasePath = "/humidity",
                HealthCheck = "/humidity/health"
            },
            new
            {
                Name = "Safety Injuries Service",
                SwaggerUrl = "/safety/swagger/v1/swagger.json",
                BasePath = "/safety",
                HealthCheck = "/safety/health"
            }
        };

        return Ok(services);
    }
}