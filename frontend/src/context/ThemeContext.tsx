"use client";

import type React from "react";
import { createContext, useState, useContext, useEffect } from "react";

type Theme = "light" | "dark";

type ThemeContextType = {
    theme: Theme;
    toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({
    children,
}) => {
    const [theme, setTheme] = useState<Theme>("light");
    const [isInitialized, setIsInitialized] = useState(false);

    useEffect(() => {
        // This code will only run on the client side
        const savedTheme = localStorage.getItem("theme") as Theme | null;
        const initialTheme = savedTheme || "light"; // Default to light theme

        setTheme(initialTheme);
        setIsInitialized(true);
    }, []);

    useEffect(() => {
        if (isInitialized) {
            localStorage.setItem("theme", theme);

            // -----------------------------------------------------------------
            // ВАЖНО: сохраняем тему ещё и в cookie.
            //
            // Зачем:
            //   Keycloak-страницы (login, register и т.д.) отдаются с другого
            //   origin'а (:8090), где localStorage React-приложения НЕ доступен.
            //   Cookie же разделяются между портами одного хоста (scope cookie
            //   — домен + путь, порт не учитывается). Поэтому cookie — это
            //   единственный способ передать тему из SPA в Keycloak.
            //
            // Формат имени 'uchaly_theme' выбран произвольно, чтобы не
            // конфликтовать с другими cookie.
            //
            // max-age=31536000 — год, path=/ — на весь сайт,
            // SameSite=Lax — защита от CSRF, но при этом cookie отправляется
            // при top-level GET-переходах на Keycloak.
            // -----------------------------------------------------------------
            document.cookie = `uchaly_theme=${theme}; path=/; max-age=31536000; SameSite=Lax`;

            if (theme === "dark") {
                document.documentElement.classList.add("dark");
            } else {
                document.documentElement.classList.remove("dark");
            }
        }
    }, [theme, isInitialized]);

    const toggleTheme = () => {
        setTheme((prevTheme) => (prevTheme === "light" ? "dark" : "light"));
    };

    return (
        <ThemeContext.Provider value={{ theme, toggleTheme }}>
            {children}
        </ThemeContext.Provider>
    );
};

export const useTheme = () => {
    const context = useContext(ThemeContext);
    if (context === undefined) {
        throw new Error("useTheme must be used within a ThemeProvider");
    }
    return context;
};