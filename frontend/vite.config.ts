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
        port: 62080, // Vite dev server (совпадает с webOrigins клиента Keycloak)
        proxy: {
            // Keycloak: OIDC-эндпоинты и Admin REST API.
            // Фронт ходит на /realms/... и /admin/realms/... — проксируем в Keycloak.
            '/realms': {
                target: 'http://localhost:8090',
                changeOrigin: true,
                secure: false,
            },
            '/admin': {
                target: 'http://localhost:8090',
                changeOrigin: true,
                secure: false,
            },
            '/resources': {
                target: 'http://localhost:8090',
                changeOrigin: true,
                secure: false,
            },
        }
    }
})