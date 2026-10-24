import React from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

export interface TablePaginationProps {
  currentPage: number;
  totalItems: number;
  pageSize?: number;
  onPageChange: (newPage: number) => void;
  itemName?: string;
  className?: string;
}

export const TablePagination: React.FC<TablePaginationProps> = ({
  currentPage,
  totalItems,
  pageSize = 10,
  onPageChange,
  itemName = 'records',
  className = ''
}) => {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safeCurrentPage = Math.min(Math.max(1, currentPage), totalPages);

  const startRecord = totalItems === 0 ? 0 : (safeCurrentPage - 1) * pageSize + 1;
  const endRecord = Math.min(safeCurrentPage * pageSize, totalItems);

  // Generate page numbers to display with smart windowing
  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
    const maxVisible = 5;

    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      if (safeCurrentPage <= 3) {
        pages.push(1, 2, 3, 4, '...', totalPages);
      } else if (safeCurrentPage >= totalPages - 2) {
        pages.push(1, '...', totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
      } else {
        pages.push(1, '...', safeCurrentPage - 1, safeCurrentPage, safeCurrentPage + 1, '...', totalPages);
      }
    }
    return pages;
  };

  const handlePageSelect = (page: number) => {
    if (page >= 1 && page <= totalPages && page !== safeCurrentPage) {
      onPageChange(page);
    }
  };

  return (
    <div
      className={`px-4 py-3 bg-slate-950/90 border-t border-slate-800/80 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs select-none ${className}`}
    >
      {/* Entries Counter Information */}
      <div className="flex items-center gap-2 text-slate-400">
        <span>
          Showing{' '}
          <strong className="text-white font-mono font-bold">{startRecord}</strong>
          {' '}to{' '}
          <strong className="text-white font-mono font-bold">{endRecord}</strong>
          {' '}of{' '}
          <strong className="text-sky-400 font-mono font-bold">{totalItems}</strong>
          {' '}{itemName}
        </span>
        <span className="hidden sm:inline-block text-slate-600">•</span>
        <span className="hidden sm:inline-block text-slate-400">
          Page <strong className="text-white font-mono font-bold">{safeCurrentPage}</strong> of{' '}
          <strong className="text-white font-mono font-bold">{totalPages}</strong>
        </span>
      </div>

      {/* Pagination Controls */}
      <div className="flex items-center space-x-1.5 shrink-0">
        {/* First Page */}
        <button
          type="button"
          onClick={() => handlePageSelect(1)}
          disabled={safeCurrentPage <= 1}
          title="First Page"
          className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-white disabled:opacity-30 disabled:hover:bg-slate-900 disabled:hover:text-slate-300 disabled:cursor-not-allowed transition cursor-pointer"
        >
          <ChevronsLeft className="h-4 w-4" />
        </button>

        {/* Previous Page */}
        <button
          type="button"
          onClick={() => handlePageSelect(safeCurrentPage - 1)}
          disabled={safeCurrentPage <= 1}
          title="Previous Page"
          className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-white disabled:opacity-30 disabled:hover:bg-slate-900 disabled:hover:text-slate-300 disabled:cursor-not-allowed transition flex items-center gap-1 cursor-pointer font-medium"
        >
          <ChevronLeft className="h-4 w-4" />
          <span className="hidden sm:inline text-[11px]">Prev</span>
        </button>

        {/* Numbered Page Buttons */}
        <div className="flex items-center space-x-1">
          {getPageNumbers().map((p, idx) => {
            if (p === '...') {
              return (
                <span key={`dots-${idx}`} className="px-2 py-1 text-slate-500 font-bold select-none">
                  •••
                </span>
              );
            }

            const pageNum = Number(p);
            const isActive = pageNum === safeCurrentPage;

            return (
              <button
                key={`page-btn-${pageNum}`}
                type="button"
                onClick={() => handlePageSelect(pageNum)}
                className={`min-w-[28px] h-7 px-2 rounded-lg text-[11px] font-mono font-bold transition cursor-pointer flex items-center justify-center ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-sm border border-blue-500 ring-2 ring-blue-500/30'
                    : 'bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                {pageNum}
              </button>
            );
          })}
        </div>

        {/* Next Page */}
        <button
          type="button"
          onClick={() => handlePageSelect(safeCurrentPage + 1)}
          disabled={safeCurrentPage >= totalPages}
          title="Next Page"
          className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-white disabled:opacity-30 disabled:hover:bg-slate-900 disabled:hover:text-slate-300 disabled:cursor-not-allowed transition flex items-center gap-1 cursor-pointer font-medium"
        >
          <span className="hidden sm:inline text-[11px]">Next</span>
          <ChevronRight className="h-4 w-4" />
        </button>

        {/* Last Page */}
        <button
          type="button"
          onClick={() => handlePageSelect(totalPages)}
          disabled={safeCurrentPage >= totalPages}
          title="Last Page"
          className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-white disabled:opacity-30 disabled:hover:bg-slate-900 disabled:hover:text-slate-300 disabled:cursor-not-allowed transition cursor-pointer"
        >
          <ChevronsRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};

export default TablePagination;
