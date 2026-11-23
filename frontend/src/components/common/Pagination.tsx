'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronDoubleLeftIcon,
  ChevronDoubleRightIcon,
} from '@heroicons/react/24/outline';

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  getPageHref?: (page: number) => string;
  showFirstLast?: boolean;
  showPageNumbers?: boolean;
  maxVisiblePages?: number;
  showJump?: boolean;
  className?: string;
}

interface PageControlProps {
  href?: string;
  rel?: string;
  disabled?: boolean;
  isCurrent?: boolean;
  onClick: () => void;
  className: string;
  ariaLabel?: string;
  children: ReactNode;
}

function PageControl({
  href,
  rel,
  disabled,
  isCurrent,
  onClick,
  className,
  ariaLabel,
  children,
}: PageControlProps) {
  if (href && !disabled && !isCurrent) {
    return (
      <Link
        href={href}
        rel={rel}
        prefetch={false}
        className={className}
        aria-label={ariaLabel}
      >
        {children}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || isCurrent}
      className={className}
      aria-label={ariaLabel}
      aria-current={isCurrent ? 'page' : undefined}
    >
      {children}
    </button>
  );
}

export default function Pagination({
  currentPage,
  totalPages,
  onPageChange,
  getPageHref,
  showFirstLast = true,
  showPageNumbers = true,
  maxVisiblePages = 5,
  showJump = false,
  className = '',
}: PaginationProps) {
  const [jumpValue, setJumpValue] = useState(String(currentPage));

  useEffect(() => {
    setJumpValue(String(currentPage));
  }, [currentPage]);

  if (totalPages <= 1) return null;

  const getVisiblePages = () => {
    const pages: (number | string)[] = [];

    if (totalPages <= maxVisiblePages) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      let start = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
      const end = Math.min(totalPages, start + maxVisiblePages - 1);

      if (end - start + 1 < maxVisiblePages) {
        start = Math.max(1, end - maxVisiblePages + 1);
      }

      if (start > 1) {
        pages.push(1);
        if (start > 2) {
          pages.push('...');
        }
      }

      for (let i = start; i <= end; i++) {
        pages.push(i);
      }

      if (end < totalPages) {
        if (end < totalPages - 1) {
          pages.push('...');
        }
        pages.push(totalPages);
      }
    }

    return pages;
  };

  const visiblePages = getVisiblePages();

  const handlePageClick = (page: number | string) => {
    if (typeof page === 'number' && page !== currentPage && page >= 1 && page <= totalPages) {
      onPageChange(page);
    }
  };

  const canGoPrevious = currentPage > 1;
  const canGoNext = currentPage < totalPages;
  const prevPage = Math.max(1, currentPage - 1);
  const nextPage = Math.min(totalPages, currentPage + 1);

  return (
    <nav className={`flex items-center justify-between ${className}`} aria-label="Pagination">
      <div className="flex-1 flex justify-between sm:hidden">
        {/* Mobile pagination */}
        <PageControl
          href={canGoPrevious ? getPageHref?.(prevPage) : undefined}
          rel="prev"
          disabled={!canGoPrevious}
          onClick={() => handlePageClick(prevPage)}
          className="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Previous
        </PageControl>
        {showJump ? (
          <div className="relative inline-flex items-center gap-2 px-2 py-2 text-sm text-gray-700">
            <span className="text-xs text-gray-600">Page</span>
            <input
              inputMode="numeric"
              type="number"
              min={1}
              max={totalPages}
              value={jumpValue}
              onChange={(e) => setJumpValue(e.target.value)}
              className="w-16 rounded-md border border-gray-300 px-2 py-1 text-sm"
            />
            <span className="text-xs text-gray-600">/ {totalPages}</span>
            <button
              type="button"
              onClick={() => {
                const n = Number(jumpValue);
                if (Number.isFinite(n)) onPageChange(Math.min(totalPages, Math.max(1, n)));
              }}
              className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm"
            >
              Go
            </button>
          </div>
        ) : (
          <span className="relative inline-flex items-center px-4 py-2 text-sm text-gray-700">
            Page {currentPage} of {totalPages}
          </span>
        )}
        <PageControl
          href={canGoNext ? getPageHref?.(nextPage) : undefined}
          rel="next"
          disabled={!canGoNext}
          onClick={() => handlePageClick(nextPage)}
          className="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Next
        </PageControl>
      </div>

      <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-gray-700">
            Page <span className="font-medium">{currentPage}</span> of{' '}
            <span className="font-medium">{totalPages}</span>
          </p>
        </div>
        <div>
          <div className="flex items-center gap-3">
            {showJump ? (
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <span>Go to</span>
                <input
                  inputMode="numeric"
                  type="number"
                  min={1}
                  max={totalPages}
                  value={jumpValue}
                  onChange={(e) => setJumpValue(e.target.value)}
                  className="w-20 rounded-md border border-gray-300 px-2 py-1 text-sm"
                />
                <button
                  type="button"
                  onClick={() => {
                    const n = Number(jumpValue);
                    if (Number.isFinite(n)) onPageChange(Math.min(totalPages, Math.max(1, n)));
                  }}
                  className="rounded-md border border-gray-300 bg-white px-3 py-1 text-sm text-gray-700 hover:bg-gray-50"
                >
                  Go
                </button>
              </div>
            ) : null}

            <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px" aria-label="Pagination">
              {/* First page */}
              {showFirstLast && (
                <PageControl
                  href={currentPage > 1 ? getPageHref?.(1) : undefined}
                  disabled={currentPage === 1}
                  onClick={() => handlePageClick(1)}
                  className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  ariaLabel="First page"
                >
                  <ChevronDoubleLeftIcon className="h-5 w-5" />
                </PageControl>
              )}

              {/* Previous page */}
              <PageControl
                href={canGoPrevious ? getPageHref?.(prevPage) : undefined}
                rel="prev"
                disabled={!canGoPrevious}
                onClick={() => handlePageClick(prevPage)}
                className={`relative inline-flex items-center px-2 py-2 border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed ${
                  !showFirstLast ? 'rounded-l-md' : ''
                }`}
                ariaLabel="Previous page"
              >
                <ChevronLeftIcon className="h-5 w-5" />
              </PageControl>

              {/* Page numbers */}
              {showPageNumbers &&
                visiblePages.map((page, index) =>
                  typeof page === 'number' ? (
                    <PageControl
                      key={`page-${page}`}
                      href={page !== currentPage ? getPageHref?.(page) : undefined}
                      isCurrent={page === currentPage}
                      onClick={() => handlePageClick(page)}
                      className={`relative inline-flex items-center px-4 py-2 border text-sm font-medium ${
                        page === currentPage
                          ? 'z-10 bg-blue-50 border-blue-700 text-[var(--site-primary)]'
                          : 'border-gray-300 bg-white text-gray-500 hover:bg-gray-50'
                      }`}
                      ariaLabel={`Go to page ${page}`}
                    >
                      {page}
                    </PageControl>
                  ) : (
                    <span
                      key={`ellipsis-${index}`}
                      className="relative inline-flex items-center px-4 py-2 border border-gray-300 bg-white text-sm font-medium text-gray-700 cursor-default"
                      aria-hidden="true"
                    >
                      {page}
                    </span>
                  ),
                )}

              {/* Next page */}
              <PageControl
                href={canGoNext ? getPageHref?.(nextPage) : undefined}
                rel="next"
                disabled={!canGoNext}
                onClick={() => handlePageClick(nextPage)}
                className="relative inline-flex items-center px-2 py-2 border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                ariaLabel="Next page"
              >
                <ChevronRightIcon className="h-5 w-5" />
              </PageControl>

              {/* Last page */}
              {showFirstLast && (
                <PageControl
                  href={currentPage < totalPages ? getPageHref?.(totalPages) : undefined}
                  disabled={currentPage === totalPages}
                  onClick={() => handlePageClick(totalPages)}
                  className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  ariaLabel="Last page"
                >
                  <ChevronDoubleRightIcon className="h-5 w-5" />
                </PageControl>
              )}
            </nav>
          </div>
        </div>
      </div>
    </nav>
  );
}
