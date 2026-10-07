import { useCallback, useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import { useSidebar } from "../context/SidebarContext";
import { useAuth } from "../context/AuthContext";
import {FaHome, FaUserShield} from "react-icons/fa";
import { FiGrid, FiMoreHorizontal } from "react-icons/fi";
import { FiChevronDown } from "react-icons/fi";

// Тип пункта меню
type MenuItem = {
    name: string;
    icon?: React.ReactNode;
    path?: string;
    pro?: boolean;
    new?: boolean;
    children?: MenuItem[];
    key: string; // Уникальный идентификатор
    adminOnly?: boolean; // Только для администраторов
};

// Генератор уникальных ключей для пунктов меню (не используется напрямую, оставлен для совместимости)
const generateKey = (prefix: string, index: number, parentKey?: string) => {
    return parentKey ? `${parentKey}-${prefix}-${index}` : `${prefix}-${index}`;
};

// Данные для главного меню
const navItems: MenuItem[] = [
    {
        key: "home",
        icon: <FaHome />,
        name: "Домашняя",
        children: [
            {
                key: "home-main",
                name: "Главная страница",
                path: "/",
                icon: <FiGrid />, // добавленная иконка
            },
        ],
    },
    {
        key: "admin",
        icon: <FaUserShield />,
        name: "Админ панель",
        path: "/admin",
        adminOnly: true,
    },
];

// Данные для меню "Отчеты по выпускаемой продукции" (пустое)
const othersItems: MenuItem[] = [];

// Данные для меню поддержки (пустое)
const supportItems: MenuItem[] = [];

// Типы групп меню
type MenuType = "main" | "support" | "others";

const AppSidebar: React.FC = () => {
    // Получение состояния сайдбара из контекста
    const { isExpanded, isMobileOpen, isHovered, setIsHovered } = useSidebar();
    const { isAdmin } = useAuth();
    const location = useLocation();

    // Состояние для хранения открытых ключей меню
    const [openKeys, setOpenKeys] = useState<Record<MenuType, Set<string>>>({
        main: new Set(),
        support: new Set(),
        others: new Set(),
    });

    /**
     * Проверяет, активен ли пункт меню по его пути.
     * Для пути "/electric-motors" активным считается любой путь, начинающийся с "/electric-motors",
     * чтобы подсвечивать пункт "Электродвигатели" при открытии страницы деталей двигателя.
     * Аналогично для "/humidity" – любой путь, начинающийся с "/humidity",
     * чтобы подсвечивать пункт "Контроль влажности" при открытии деталей транспортных средств.
     * Для всех остальных путей используется точное совпадение.
     * @param path - Путь пункта меню
     * @returns true, если пункт активен
     */
    const isActive = useCallback((path?: string): boolean => {
        if (!path) return false;
        // Специальная обработка для раздела электродвигателей
        if (path === "/electric-motors" && location.pathname.startsWith("/electric-motors")) {
            return true;
        }
        // Специальная обработка для раздела контроля влажности
        if (path === "/humidity" && location.pathname.startsWith("/humidity")) {
            return true;
        }
        // Для всех остальных путей – точное совпадение
        return location.pathname === path;
    }, [location.pathname]);

    /**
     * Рекурсивная проверка активности родительского пункта (активен ли сам или любой потомок)
     * @param item - Пункт меню
     * @returns true, если пункт или его потомок активен
     */
    const isParentActive = useCallback((item: MenuItem): boolean => {
        // Если текущий пункт активен
        if (item.path && isActive(item.path)) return true;

        // Если есть дети, проверяем активность любого из них
        if (item.children) {
            return item.children.some(child => isParentActive(child));
        }
        return false;
    }, [isActive]);

    /**
     * Переключение состояния подменю (открыть/закрыть)
     * @param key - Ключ пункта меню
     * @param menuType - Тип меню (main/support/others)
     */
    const toggleSubmenu = (key: string, menuType: MenuType) => {
        setOpenKeys(prev => {
            // Создаем копию Set для текущего типа меню
            const newSet = new Set(prev[menuType]);

            if (newSet.has(key)) {
                // Закрытие меню и его дочерних элементов
                newSet.delete(key);
                const keysToRemove = Array.from(newSet).filter(k => k.startsWith(`${key}-`));
                keysToRemove.forEach(k => newSet.delete(k));
            } else {
                // Определение родительского ключа
                const parentKey = key.includes('-') ? key.substring(0, key.lastIndexOf('-')) : null;

                // Поиск ключей того же уровня
                const sameLevelKeys = Array.from(newSet).filter(k => {
                    const kParent = k.includes('-') ? k.substring(0, k.lastIndexOf('-')) : null;
                    return kParent === parentKey;
                });

                // Удаление ключей того же уровня
                sameLevelKeys.forEach(k => newSet.delete(k));

                // Добавление текущего ключа
                newSet.add(key);
            }

            // Обновляем состояние для текущего типа меню
            return { ...prev, [menuType]: newSet };
        });
    };

    // Автоматическое открытие меню при загрузке/изменении пути
    useEffect(() => {
        /**
         * Рекурсивный поиск активных ключей (путей, которые должны быть открыты)
         * @param items - Массив пунктов меню
         * @param menuType - Тип меню
         * @param parentKey - Ключ родителя (для вложенных)
         * @returns Массив ключей, которые должны быть открыты
         */
        const findActiveKeys = (
            items: MenuItem[],
            menuType: MenuType,
            parentKey?: string
        ): string[] => {
            let activeKeys: string[] = [];

            for (const item of items) {
                // Пропускаем элементы, доступные только админам, если пользователь не админ
                if (item.adminOnly && !isAdmin) continue;

                // Формирование полного ключа
                const fullKey = parentKey ? `${parentKey}-${item.key}` : item.key;

                // Если путь активен, добавляем ключ и родительские ключи
                if (item.path && isActive(item.path)) {
                    activeKeys.push(fullKey);
                    if (parentKey) {
                        // Разделяем родительский ключ и добавляем все части
                        const parentParts = parentKey.split('-');
                        for (let i = 1; i <= parentParts.length; i++) {
                            activeKeys.push(parentParts.slice(0, i).join('-'));
                        }
                    }
                }

                // Рекурсивный поиск в дочерних элементах
                if (item.children) {
                    const childKeys = findActiveKeys(item.children, menuType, fullKey);
                    if (childKeys.length > 0) {
                        // Добавляем текущий ключ и ключи детей
                        activeKeys.push(fullKey, ...childKeys);
                    }
                }
            }

            // Удаление дубликатов
            return Array.from(new Set(activeKeys));
        };

        // Инициализация открытых ключей для каждой группы
        const newOpenKeys = { ...openKeys };
        newOpenKeys.main = new Set(findActiveKeys(navItems, "main"));
        newOpenKeys.support = new Set(findActiveKeys(supportItems, "support"));
        newOpenKeys.others = new Set(findActiveKeys(othersItems, "others"));

        setOpenKeys(newOpenKeys);
    }, [location.pathname, isAdmin]);

    /**
     * Рекурсивный рендеринг пунктов меню с поддержкой вложенности и вертикальных полосок
     * @param items - Массив пунктов меню
     * @param menuType - Тип меню
     * @param parentKey - Ключ родителя (для формирования вложенных ключей)
     * @param level - Уровень вложенности (для отрисовки вертикальной линии)
     * @returns JSX-элементы меню
     */
    const renderMenuItems = (
        items: MenuItem[],
        menuType: MenuType,
        parentKey?: string,
        level = 0
    ) => {
        return (
            <ul className="flex flex-col gap-4">
                {items.map((item) => {
                    // Пропускаем элементы, доступные только админам, если пользователь не админ
                    if (item.adminOnly && !isAdmin) return null;

                    // Формирование уникального ключа с учетом родителя
                    const fullKey = parentKey ? `${parentKey}-${item.key}` : item.key;
                    const hasChildren = !!item.children?.length;
                    const isOpen = openKeys[menuType].has(fullKey);
                    const isActiveItem = isParentActive(item);

                    // Для вложенных элементов (level > 0) добавляем вертикальную полоску и отступ
                    const containerClass = level > 0
                        ? `relative pl-4 border-l-2 ${isActiveItem ? 'border-blue-500' : 'border-gray-200 dark:border-gray-700'}`
                        : '';

                    return (
                        <li key={fullKey} className={containerClass}>
                            {/* Рендер пункта меню */}
                            {hasChildren ? (
                                // Кнопка для пунктов с подменю
                                <button
                                    onClick={() => toggleSubmenu(fullKey, menuType)}
                                    className={`menu-item group cursor-pointer w-full flex items-center py-3 px-4 rounded-lg transition-colors 
                                        ${!isExpanded && !isHovered ? "lg:justify-center" : "lg:justify-start"}
                                        ${isActiveItem ? "text-brand-500" : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"}
                                    `}
                                >
                                    {/* Иконка */}
                                    <span
                                        className={`menu-item-icon-size ${isActiveItem ? "text-brand-500" : "text-gray-500"}`}
                                    >
                                        {item.icon}
                                    </span>

                                    {/* Название (если сайдбар развернут) */}
                                    {(isExpanded || isHovered || isMobileOpen) && (
                                        <span className="ml-3 text-sm font-medium menu-item-text">
                                            {item.name}
                                        </span>
                                    )}

                                    {/* Стрелка для подменю (если есть дети) */}
                                    {(isExpanded || isHovered || isMobileOpen) && hasChildren && (
                                        <FiChevronDown
                                            className={`ml-auto w-5 h-5 transition-transform duration-200 ${isOpen ? "rotate-180 text-brand-500" : "text-gray-400"}`}
                                        />
                                    )}
                                </button>
                            ) : (
                                // Ссылка для конечных пунктов
                                item.path && (
                                    <Link
                                        to={item.path}
                                        className={`menu-item group w-full flex items-center py-3 px-4 rounded-lg transition-colors 
                                            ${isActive(item.path) ? "text-brand-500" : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"}
                                        `}
                                    >
                                        {/* Иконка */}
                                        <span
                                            className={`menu-item-icon-size ${isActive(item.path) ? "text-brand-500" : "text-gray-500"}`}
                                        >
                                            {item.icon}
                                        </span>

                                        {/* Название (если сайдбар развернут) */}
                                        {(isExpanded || isHovered || isMobileOpen) && (
                                            <span className="ml-3 text-sm font-medium menu-item-text">
                                                {item.name}
                                            </span>
                                        )}
                                    </Link>
                                )
                            )}

                            {/* Рендер дочерних элементов (подменю) */}
                            {hasChildren && (isExpanded || isHovered || isMobileOpen) && (
                                <div
                                    className={`overflow-hidden transition-all duration-300`}
                                >
                                    <div
                                        className={`${isOpen ? "max-h-[1000px]" : "max-h-0"
                                            } transition-all duration-300`}
                                    >
                                        {renderMenuItems(
                                            item.children!,
                                            menuType,
                                            fullKey,
                                            level + 1 // Увеличение уровня вложенности
                                        )}
                                    </div>
                                </div>
                            )}
                        </li>
                    );
                })}
            </ul>
        );
    };

    return (
        <aside
            className={`fixed mt-16 flex flex-col lg:mt-0 top-0 px-5 left-0 bg-white dark:bg-gray-900 dark:border-gray-800 text-gray-900 h-screen transition-all duration-300 ease-in-out z-50 border-r border-gray-200 
                ${isExpanded || isMobileOpen
                    ? "w-[290px]"
                    : isHovered
                        ? "w-[290px]"
                        : "w-[90px]"
                }
                ${isMobileOpen ? "translate-x-0" : "-translate-x-full"}
                lg:translate-x-0`}
            onMouseEnter={() => !isExpanded && setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            {/* Логотип */}
            <div
                className={`py-8 flex ${!isExpanded && !isHovered ? "lg:justify-center" : "justify-start"
                    }`}
            >
                <Link to="/">
                    {isExpanded || isHovered || isMobileOpen ? (
                        // Полноразмерный логотип
                        <>
                            <img
                                className="dark:hidden"
                                src="/images/logo/logo.svg"
                                alt="Logo"
                                width={150}
                                height={40}
                            />
                            <img
                                className="hidden dark:block"
                                src="/images/logo/logo-dark.svg"
                                alt="Logo"
                                width={150}
                                height={40}
                            />
                        </>
                    ) : (
                        // Иконка логотипа (свернутое состояние)
                        <>
                            <img
                                className="hidden dark:block"
                                src="/images/logo/logo-icon-dark.svg"
                                alt="Logo"
                                width={40}
                                height={40}
                            />
                            <img
                                className="dark:hidden"
                                src="/images/logo/logo-icon.svg"
                                alt="Logo"
                                width={40}
                                height={40}
                            />
                        </>
                    )}
                </Link>
            </div>

            {/* Основная навигация */}
            <div className="flex flex-col overflow-y-auto duration-300 ease-linear no-scrollbar">
                <nav className="mb-6">
                    <div className="flex flex-col gap-4">
                        {/* Группа "Главное" */}
                        <div>
                            <h2
                                className={`mb-4 text-xs uppercase flex leading-[20px] text-gray-400 ${!isExpanded && !isHovered
                                    ? "lg:justify-center"
                                    : "justify-start"
                                    }`}
                            >
                                {isExpanded || isHovered || isMobileOpen ? (
                                    "Главное"
                                ) : (
                                        <FiMoreHorizontal className="size-6" />
                                )}
                            </h2>
                            {renderMenuItems(navItems, "main")}
                        </div>  
                    </div>
                </nav>
            </div>
        </aside>
    );
};

export default AppSidebar;