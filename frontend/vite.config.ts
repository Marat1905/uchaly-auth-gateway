import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import svgr from "vite-plugin-svgr";

// https://vite.dev/config/
export default defineConfig({
    plugins: [
        react(),
        svgr({
            svgrOptions: {
                icon: true,
                // This will transform your SVG to a React component
                exportType: "named",
                namedExport: "ReactComponent",
            },
        })
    ],

    server: {
        host: "0.0.0.0",
        port: 62080, // Vite dev server (совпадает с redirect_uri в Authentik)
        proxy: {
            // ============================================================
            // API Gateway (YARP + админ-панель)
            //
            // Все запросы на /api/* уходят в Gateway, который:
            //   - валидирует JWT от Authentik;
            //   - проксирует /api/admin/* в AdminController;
            //   - проксирует /api/Nodes, /api/Alerts и т.д.
            //     в микросервисы.
            //
            // Gateway слушает GATEWAY_HTTP_PORT (по умолчанию 8080).
            // ВАЖНО: НЕ используйте здесь /admin — это маршрут SPA,
            // а не backend-эндпоинт.
            // ============================================================
            '/api': {
                target: 'http://localhost:30006',
                changeOrigin: true,
                secure: false,
            },

            // ============================================================
            // Аутентификация через Authentik (прокси через Gateway)
            //
            // Gateway проксирует /auth/authentik/* на Authentik Server.
            // Это нужно, если вы хотите ходить в Authentik через
            // тот же origin, что и SPA.
            //
            // ВАЖНО: OAuth2/OIDC-эндпоинты (/application/o/*)
            // SPA вызывает напрямую по VITE_AUTHENTIK_URL
            // (http://localhost:9000). Их проксировать не нужно.
            // ============================================================
            '/auth/authentik': {
                target: 'http://localhost:30006',
                changeOrigin: true,
                secure: false,
            },

            // ============================================================
            // Swagger UI микросервисов (проксируется через Gateway)
            // ============================================================
            '/monitoring': {
                target: 'http://localhost:30006',
                changeOrigin: true,
                secure: false,
            },
            '/motor': {
                target: 'http://localhost:30006',
                changeOrigin: true,
                secure: false,
            },
            '/humidity': {
                target: 'http://localhost:30006',
                changeOrigin: true,
                secure: false,
            },
            '/safety': {
                target: 'http://localhost:30006',
                changeOrigin: true,
                secure: false,
            },
        }
    }
})