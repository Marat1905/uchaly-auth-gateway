import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

/**
 * Свойства компонента пагинации.
 */
interface PaginationProps {
    /** Текущий номер страницы */
    currentPage: number;
    /** Общее количество страниц */
    totalPages: number;
    /** Функция изменения страницы */
    onPageChange: (page: number) => void;
    /** Размер страницы */
    pageSize: number;
    /** Функция изменения размера страницы */
    onPageSizeChange: (size: number) => void;
    /** Общее количество элементов */
    totalCount: number;
}

/**
 * Компонент пагинации с выбором размера страницы и отображением диапазона записей.
 * Используется в списках двигателей, истории перемещений и журнале обслуживания.
 */
export default function Pagination({
    currentPage,
    totalPages,
    onPageChange,
    pageSize,
    onPageSizeChange,
    totalCount
}: PaginationProps) {
    // Если нет записей, ничего не показываем
    if (totalCount === 0) return null;

    const startItem = (currentPage - 1) * pageSize + 1;
    const endItem = Math.min(currentPage * pageSize, totalCount);

    const maxPagesToShow = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxPagesToShow / 2));
    let endPage = Math.min(totalPages, startPage + maxPagesToShow - 1);

    if (endPage - startPage + 1 < maxPagesToShow) {
        startPage = Math.max(1, endPage - maxPagesToShow + 1);
    }

    const pageNumbers: number[] = [];
    for (let i = startPage; i <= endPage; i++) {
        pageNumbers.push(i);
    }

    return (
        <div className="flex flex-col sm:flex-row items-center justify-between mt-6 gap-4">
            <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <span>
                    Показано {startItem} — {endItem} из {totalCount}
                </span>
                <div className="flex items-center gap-1">
                    <select
                        value={pageSize}
                        onChange={(e) => onPageSizeChange(Number(e.target.value))}
                        className="border border-gray-300 dark:border-gray-600 rounded-md px-2 py-1 bg-white dark:bg-slate-800 text-gray-800 dark:text-gray-100 text-sm focus:ring-accent focus:border-accent"
                    >
                        <option value={5}>5</option>
                        <option value={10}>10</option>
                        <option value={25}>25</option>
                        <option value={50}>50</option>
                        <option value={100}>100</option>
                    </select>
                    <span>на странице</span>
                </div>
            </div>

            <div className="flex items-center gap-1">
                <button
                    onClick={() => onPageChange(1)}
                    disabled={currentPage === 1}
                    className="p-1.5 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-slate-700"
                >
                    <ChevronsLeft className="w-4 h-4 text-gray-700 dark:text-gray-300" />
                </button>
                <button
                    onClick={() => onPageChange(currentPage - 1)}
                    disabled={currentPage === 1}
                    className="p-1.5 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-slate-700"
                >
                    <ChevronLeft className="w-4 h-4 text-gray-700 dark:text-gray-300" />
                </button>

                {pageNumbers.map(page => (
                    <button
                        key={page}
                        onClick={() => onPageChange(page)}
                        className={`px-3 py-1 rounded-md border text-sm transition-colors ${currentPage === page
                            ? 'bg-accent border-accent text-white'
                            : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700'
                            }`}
                    >
                        {page}
                    </button>
                ))}

                <button
                    onClick={() => onPageChange(currentPage + 1)}
                    disabled={currentPage === totalPages}
                    className="p-1.5 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-slate-700"
                >
                    <ChevronRight className="w-4 h-4 text-gray-700 dark:text-gray-300" />
                </button>
                <button
                    onClick={() => onPageChange(totalPages)}
                    disabled={currentPage === totalPages}
                    className="p-1.5 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-slate-700"
                >
                    <ChevronsRight className="w-4 h-4 text-gray-700 dark:text-gray-300" />
                </button>
            </div>
        </div>
    );
}