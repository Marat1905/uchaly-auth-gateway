// src/App.tsx
import { BrowserRouter as Router, Routes, Route } from "react-router";
import { Toaster } from "react-hot-toast";
import { ScrollToTop } from "./components/common/ScrollToTop";
import AppLayout from "./layout/AppLayout";
import './index.css';
import Home from "./pages/Main/Home";
import Login from "./pages/Auth/Login";
import Register from "./pages/Auth/Register";
import ProtectedRoute from "./components/common/ProtectedRoute";
import Profile from "./pages/Profile/Profile";
import AdminPanel from "./pages/Admin/AdminPanel";
import AuthCallback from "./pages/Auth/AuthCallback";



export default function App() {
    return (
        <>
            <Router>
                <ScrollToTop />
                <Routes>
                    {/* Публичные маршруты — теперь просто редиректят в Keycloak */}
                    <Route path="/login" element={<Login />} />
                    <Route path="/register" element={<Register />} />
                    <Route path="/auth/callback" element={<AuthCallback />} />
                    {/* Защищённые маршруты */}
                    <Route element={<AppLayout />}>
                        <Route index path="/" element={<Home />} />


                        <Route
                            path="/profile"
                            element={
                                <ProtectedRoute>
                                    <Profile />
                                </ProtectedRoute>
                            }
                        />

                        <Route
                            path="/admin"
                            element={
                                <ProtectedRoute requireAdmin>
                                    <AdminPanel />
                                </ProtectedRoute>
                            }
                        />
                    </Route>
                </Routes>
            </Router>

            {/* Глобальный контейнер для тост-уведомлений с поддержкой темы */}
            <Toaster
                position="top-right"
                containerStyle={{
                    top: 80,
                }}
                toastOptions={{
                    duration: 4000,
                    style: {
                        background: 'var(--toast-bg)',
                        color: 'var(--toast-text)',
                        border: '1px solid var(--toast-border)',
                        borderRadius: '0.5rem',
                        padding: '0.75rem 1rem',
                        fontSize: '0.875rem',
                        boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
                    },
                    success: {
                        iconTheme: {
                            primary: '#10b981',
                            secondary: 'var(--toast-bg)',
                        },
                    },
                    error: {
                        iconTheme: {
                            primary: '#ef4444',
                            secondary: 'var(--toast-bg)',
                        },
                    },
                }}
            />
        </>
    );
}