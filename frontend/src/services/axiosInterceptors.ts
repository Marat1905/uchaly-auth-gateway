// src/services/axiosInterceptors.ts
import axios, {
    type InternalAxiosRequestConfig,
    type AxiosResponse,
} from "axios";
import { authService } from "./authService";

/**
 * Интерцептор запросов: добавляет access-токен Authentik.
 */
export const requestInterceptor = (
    config: InternalAxiosRequestConfig
): InternalAxiosRequestConfig => {
    const token = localStorage.getItem("accessToken");
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }

    // Для FormData не устанавливаем Content-Type
    if (config.data instanceof FormData) {
        delete config.headers["Content-Type"];
    }

    return config;
};

export const requestErrorInterceptor = (error: any) => {
    return Promise.reject(error);
};

export const responseInterceptor = (response: AxiosResponse) => {
    return response;
};

/**
 * Интерцептор ответов: при 401 пытается обновить токен через Authentik.
 */
export const responseErrorInterceptor = async (error: any) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
        // Не пытаемся обновлять токен для запросов к Authentik
        if (
            originalRequest.url?.includes("/application/o/") ||
            originalRequest.url?.includes("/auth/")
        ) {
            return Promise.reject(error);
        }

        originalRequest._retry = true;

        const refreshToken = localStorage.getItem("refreshToken");
        if (refreshToken) {
            try {
                const response = await authService.refreshToken(refreshToken);

                originalRequest.headers.Authorization = `Bearer ${response.accessToken}`;
                return axios(originalRequest);
            } catch (refreshError) {
                console.warn(
                    "Не удалось обновить токен Authentik, выполняем выход."
                );
                authService.logout();
                return Promise.reject(refreshError);
            }
        } else {
            authService.logout();
        }
    }

    return Promise.reject(error);
};