import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import App from './App.tsx';
import { ThemeProvider } from './context/ThemeContext.tsx';
import { HelmetProvider } from 'react-helmet-async';
import { AuthProvider } from './context/AuthContext.tsx';

// 1. Создаём экземпляр QueryClient
const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            refetchOnWindowFocus: false,
            retry: 1,
            staleTime: 5 * 60 * 1000,
        },
    },
});

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <QueryClientProvider client={queryClient}>
            <ThemeProvider>
                <HelmetProvider>
                    <AuthProvider>
                        <App />
                    </AuthProvider>
                </HelmetProvider>
            </ThemeProvider>
        </QueryClientProvider>
    </StrictMode>,
);