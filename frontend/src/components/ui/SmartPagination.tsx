'use client';

import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';
import type { ButtonHTMLAttributes } from 'react';

function PageControl({ href, disabled, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { href?: string }) {
  if (href && !disabled) {
    return <Link href={href} className={props.className} aria-current={props['aria-current']} prefetch={false}>{children}</Link>;
  }
  return <button {...props} type="button" disabled={disabled}>{children}</button>;
}

interface SmartPaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  showPageNumbers?: number; // Number of page numbers to show around current page
  getPageHref?: (page: number) => string;
}

export default function SmartPagination({ 
  currentPage, 
  totalPages, 
  onPageChange, 
  showPageNumbers = 5,
  getPageHref,
}: SmartPaginationProps) {
  if (totalPages <= 1) return null;

  // Calculate which page numbers to show
  const getVisiblePages = () => {
    const delta = Math.floor(showPageNumbers / 2);
    let start = Math.max(1, currentPage - delta);
    let end = Math.min(totalPages, currentPage + delta);

    // Adjust if we're near the beginning or end
    if (end - start + 1 < showPageNumbers) {
      if (start === 1) {
        end = Math.min(totalPages, start + showPageNumbers - 1);
      } else if (end === totalPages) {
        start = Math.max(1, end - showPageNumbers + 1);
      }
    }

    const pages = [];
    for (let i = start; i <= end; i++) {
      pages.push(i);
    }
    return pages;
  };

  const visiblePages = getVisiblePages();
  const showFirstPage = visiblePages[0] > 1;
  const showLastPage = visiblePages[visiblePages.length - 1] < totalPages;
  const showFirstEllipsis = visiblePages[0] > 2;
  const showLastEllipsis = visiblePages[visiblePages.length - 1] < totalPages - 1;

  return (
    <div className="site-toolbar flex items-center justify-between px-4 py-3 sm:px-6">
      {/* Mobile pagination info */}
      <div className="flex flex-1 justify-between sm:hidden">
        <PageControl
          href={getPageHref?.(Math.max(1, currentPage - 1))}
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          disabled={currentPage === 1}
          className="relative inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Previous
        </PageControl>
        <div className="flex items-center">
          <p className="text-sm text-gray-700">
            Page <span className="font-medium">{currentPage}</span> of{' '}
            <span className="font-medium">{totalPages}</span>
          </p>
        </div>
        <PageControl
          href={getPageHref?.(Math.min(totalPages, currentPage + 1))}
          onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage === totalPages}
          className="relative ml-3 inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Next
        </PageControl>
      </div>

      {/* Desktop pagination */}
      <div className="hidden sm:flex sm:flex-1 sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-gray-700">
            Page <span className="font-medium">{currentPage}</span> of{' '}
            <span className="font-medium">{totalPages}</span>
          </p>
        </div>
        <div>
          <nav className="isolate inline-flex -space-x-px rounded-md shadow-sm" aria-label="Pagination">
            {/* Previous button */}
            <PageControl
              href={getPageHref?.(Math.max(1, currentPage - 1))}
              onClick={() => onPageChange(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
              className="relative inline-flex items-center rounded-l-md px-2 py-2 text-gray-400 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-20 focus:outline-offset-0 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="sr-only">Previous</span>
              <ChevronLeftIcon className="h-5 w-5" aria-hidden="true" />
            </PageControl>

            {/* First page */}
            {showFirstPage && (
              <>
                <PageControl
                  href={getPageHref?.(1)}
                  onClick={() => onPageChange(1)}
                  className="relative inline-flex items-center px-4 py-2 text-sm font-semibold text-gray-900 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-20 focus:outline-offset-0"
                >
                  1
                </PageControl>
                {showFirstEllipsis && (
                  <span className="relative inline-flex items-center px-4 py-2 text-sm font-semibold text-gray-700 ring-1 ring-inset ring-gray-300 focus:outline-offset-0">
                    ...
                  </span>
                )}
              </>
            )}

            {/* Visible page numbers */}
            {visiblePages.map((page) => (
              <PageControl
                href={getPageHref?.(page)}
                aria-current={page === currentPage ? 'page' : undefined}
                key={page}
                onClick={() => onPageChange(page)}
                className={`relative inline-flex items-center px-4 py-2 text-sm font-semibold ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-20 focus:outline-offset-0 ${
                  page === currentPage
                    ? 'z-10 bg-[#0b3e75] text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0b3e75]'
                    : 'text-gray-900'
                }`}
              >
                {page}
              </PageControl>
            ))}

            {/* Last page */}
            {showLastPage && (
              <>
                {showLastEllipsis && (
                  <span className="relative inline-flex items-center px-4 py-2 text-sm font-semibold text-gray-700 ring-1 ring-inset ring-gray-300 focus:outline-offset-0">
                    ...
                  </span>
                )}
                <PageControl
                  href={getPageHref?.(totalPages)}
                  onClick={() => onPageChange(totalPages)}
                  className="relative inline-flex items-center px-4 py-2 text-sm font-semibold text-gray-900 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-20 focus:outline-offset-0"
                >
                  {totalPages}
                </PageControl>
              </>
            )}

            {/* Next button */}
            <PageControl
              href={getPageHref?.(Math.min(totalPages, currentPage + 1))}
              onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage === totalPages}
              className="relative inline-flex items-center rounded-r-md px-2 py-2 text-gray-400 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-20 focus:outline-offset-0 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="sr-only">Next</span>
              <ChevronRightIcon className="h-5 w-5" aria-hidden="true" />
            </PageControl>
          </nav>
        </div>
      </div>

      {/* Quick jump to page */}
      <div className="hidden lg:flex lg:items-center lg:space-x-2 lg:ml-4">
        <label htmlFor="page-jump" className="text-sm text-gray-700">
          Go to page:
        </label>
        <input
          id="page-jump"
          type="number"
          min="1"
          max={totalPages}
          className="site-input w-16 px-2 py-1 text-sm"
          onKeyPress={(e) => {
            if (e.key === 'Enter') {
              const page = parseInt((e.target as HTMLInputElement).value);
              if (page >= 1 && page <= totalPages) {
                onPageChange(page);
                (e.target as HTMLInputElement).value = '';
              }
            }
          }}
          placeholder={currentPage.toString()}
        />
      </div>
    </div>
  );
}
