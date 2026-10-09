import { useEffect } from "react";
import { Outlet, useNavigate } from "react-router";
import { SidebarProvider, useSidebar } from "../context/SidebarContext";
import AppHeader from "./AppHeader";
import Backdrop from "./Backdrop";
import AppSidebar from "./AppSidebar";

const LayoutContent: React.FC = () => {
    const { isExpanded, isHovered, isMobileOpen } = useSidebar();
    const navigate = useNavigate();

    /**
     * Восстановление страницы после полного выхода (fullLogout).
     *
     * ЗАЧЕМ ЭТОТ ЭФФЕКТ:
     *   OIDC end-session endpoint Authentik умеет редиректить только
     *   на URL из whitelist `logout_uris` OAuth2-провайдера. Whitelist
     *   сравнивает URL по точному совпадению и не умеет матчить
     *   произвольные пути. В нашем случае там только корни доменов
     *   (http://localhost:62080/ и т.п.).
     *
     *   Чтобы вернуть пользователя именно на ту страницу, с которой
     *   он вышел, authService.fullLogout() перед редиректом на
     *   end-session сохраняет текущий путь в sessionStorage под
     *   ключом "post_logout_return_path".
     *
     *   Authentik после завершения сессии редиректит обратно на
     *   корень SPA. Этот эффект срабатывает при монтировании
     *   LayoutContent (то есть после возврата в SPA), читает
     *   сохранённый путь и навигирует туда через react-router.
     *
     * ПОЧЕМУ ЭФФЕКТ СРАБАТЫВАЕТ ТОЛЬКО ОДИН РАЗ:
     *   Зависимостей нет — эффект выполняется один раз при
     *   монтировании. Мы вручную удаляем ключ из sessionStorage
     *   сразу после чтения, чтобы при следующих заходах на корень
     *   SPA навигация не повторялась.
     *
     * ПОЧЕМУ AppLayout, А НЕ App:
     *   AppLayout монтируется только для маршрутов, использующих
     *   основной layout (Home, Profile, Admin). Он находится
     *   внутри <Router>, поэтому у него есть доступ к useNavigate().
     *
     * ПОВЕДЕНИЕ НА ЗАЩИЩЁННЫХ СТРАНИЦАХ:
     *   Если пользователь вышел со страницы /profile, эффект
     *   навигирует на /profile. Сразу после этого ProtectedRoute
     *   увидит, что пользователь не аутентифицирован. Однако
     *   флаг "just_logged_out" в sessionStorage заставит его
     *   показать плейсхолдер «Вы вышли из системы» вместо
     *   немедленного редиректа на /login — это и есть
     *   запрошенное поведение «вернуться на ту же страницу».
     */
    useEffect(() => {
        const returnPath = sessionStorage.getItem("post_logout_return_path");
        if (!returnPath) {
            return;
        }

        // Удаляем ключ сразу, чтобы эффект не срабатывал повторно
        // при следующих заходах пользователя на корень SPA.
        sessionStorage.removeItem("post_logout_return_path");

        const currentPath = window.location.pathname + window.location.search;

        // Навигируем только если путь действительно другой.
        // Иначе получим лишний ре-рендер на тот же маршрут.
        if (returnPath !== currentPath) {
            navigate(returnPath, { replace: true });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        // ВАЖНО: добавили "bg-gray-50 dark:bg-gray-900" —
        // без этого прослойки между сайдбаром, шапкой и контентом
        // просвечивали фоном <body> (в тёмной теме оставался светлым,
        // т.к. .dark body в index.css не переопределён).
        <div className="min-h-screen xl:flex bg-gray-50 dark:bg-gray-900">
            <div>
                <AppSidebar />
                <Backdrop />
            </div>
            <div
                className={`flex-1 transition-all duration-300 ease-in-out ${isExpanded || isHovered ? "lg:ml-[290px]" : "lg:ml-[90px]"
                    } ${isMobileOpen ? "ml-0" : ""}`}
            >
                <AppHeader />
                <div className="p-4 mx-auto max-w-(--breakpoint-2xl) md:p-3">
                    <Outlet />
                </div>
            </div>
        </div>
    );
};

const AppLayout: React.FC = () => {
    return (
        <SidebarProvider>
            <LayoutContent />
        </SidebarProvider>
    );
};

export default AppLayout;