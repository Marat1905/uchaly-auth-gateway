# setup-env.ps1 — запускать из корня uchaly-auth-gateway

function New-UrlSafeSecret {
    param([int]$Length = 60)
    $bytes = New-Object byte[] $Length
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    return [Convert]::ToBase64String($bytes).Replace('+','-').Replace('/','_').Replace('=','')
}

# Генерация секретов (URL-safe)
$authentikSecret    = New-UrlSafeSecret -Length 60
$authentikApiToken  = New-UrlSafeSecret -Length 40
$authentikDbPass    = New-UrlSafeSecret -Length 24
$postgresPassword   = New-UrlSafeSecret -Length 24

# -------- .env (корневой) --------
$rootEnv = @"
# ============================================================
# UCHALY PLATFORM (общие)
# ============================================================
POSTGRES_USER=postgresuser
POSTGRES_PASSWORD=$postgresPassword
DOCKER_REGISTRY=

# Порты
GATEWAY_HTTP_PORT=30006
GATEWAY_HTTPS_PORT=30007
VIBROMONITORING_HTTP_PORT=30003
VIBROMONITORING_HTTPS_PORT=30004
ASSETTRACKER_API_PORT=30005
ASSETTRACKER_DB_PORT=30006
HUMIDITY_HTTP_PORT=30007
HUMIDITY_DB_PORT=30008
SAFETY_INJURIES_HTTP_PORT=30009
SAFETY_INJURIES_DB_PORT=30010
PGADMIN_PORT=30011
RABBITMQ_AMQP_PORT=5672
RABBITMQ_MANAGEMENT_PORT=15672

# БД микросервисов
VIBROMONITORING_DB_NAME=uchalyvibromonitoring
ASSETTRACKER_DB_NAME=assettracker
HUMIDITY_DB_NAME=humidity
SAFETY_INJURIES_DB_NAME=safetyinjuries

# AUTHENTIK
AUTHENTIK_DB_NAME=authentik
AUTHENTIK_DB_USER=authentik
AUTHENTIK_DB_PASSWORD=$authentikDbPass
AUTHENTIK_SECRET_KEY=$authentikSecret
AUTHENTIK_BOOTSTRAP_PASSWORD=Admin123!
AUTHENTIK_BOOTSTRAP_TOKEN=$authentikApiToken
AUTHENTIK_BOOTSTRAP_EMAIL=admin@uchaly.com
AUTHENTIK_HTTP_PORT=9000

# RABBITMQ
RABBITMQ_DEFAULT_USER=guest
RABBITMQ_DEFAULT_PASS=guest

# PGADMIN
PGADMIN_DEFAULT_EMAIL=admin@uchaly.com
PGADMIN_DEFAULT_PASSWORD=Admin123!
"@

# -------- authentik/.env --------
$authentikEnv = @"
AUTHENTIK_DB_NAME=authentik
AUTHENTIK_DB_USER=authentik
AUTHENTIK_DB_PASSWORD=$authentikDbPass
AUTHENTIK_SECRET_KEY=$authentikSecret
AUTHENTIK_BOOTSTRAP_PASSWORD=Admin123!
AUTHENTIK_BOOTSTRAP_TOKEN=$authentikApiToken
AUTHENTIK_BOOTSTRAP_EMAIL=admin@uchaly.com
AUTHENTIK_HTTP_PORT=9000
"@

# Запись файлов в UTF-8 без BOM
[System.IO.File]::WriteAllText("$PWD\.env", $rootEnv, (New-Object System.Text.UTF8Encoding $false))
[System.IO.File]::WriteAllText("$PWD\authentik\.env", $authentikEnv, (New-Object System.Text.UTF8Encoding $false))

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  Файлы .env созданы успешно!" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Сгенерированные секреты (сохраните их в надёжном месте):"
Write-Host "  AUTHENTIK_SECRET_KEY      = $authentikSecret"
Write-Host "  AUTHENTIK_BOOTSTRAP_TOKEN = $authentikApiToken"
Write-Host "  AUTHENTIK_DB_PASSWORD     = $authentikDbPass"
Write-Host "  POSTGRES_PASSWORD         = $postgresPassword"
Write-Host ""
Write-Host "Следующий шаг: docker compose up -d" -ForegroundColor Cyan