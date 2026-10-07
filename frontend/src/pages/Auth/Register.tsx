// src/pages/Auth/Register.tsx
import React, { useEffect } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../../context/AuthContext";

/**
 * Страница регистрации.
 * В Authentik регистрация управляется через flows.
 * Просто перенаправляем на страницу логина, которая
 * запустит OAuth2-flow (там же будет ссылка на регистрацию).
 */
const Register: React.FC = () => {
    const navigate = useNavigate();
    const { isAuthenticated, loading } = useAuth();

    useEffect(() => {
        // Если уже авторизован — на главную
        if (!loading && isAuthenticated) {
            navigate("/", { replace: true });
            return;
        }

        // Иначе — на страницу логина (оттуда запускается Authentik-flow)
        navigate("/login", { replace: true });
    }, [isAuthenticated, loading, navigate]);

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-600"></div>
        </div>
    );
};

export default Register;