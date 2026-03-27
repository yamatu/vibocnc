import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Format currency
export function formatCurrency(amount: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency,
  }).format(amount);
}

// Format date
export function formatDate(date: string | Date): string {
  const d = new Date(date);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

// Format date and time
export function formatDateTime(date: string | Date): string {
  const d = new Date(date);
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Generate slug from string
export function generateSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '') // Remove special characters
    .replace(/[\s_-]+/g, '-') // Replace spaces and underscores with hyphens
    .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
}

// Truncate text
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength).trim() + '...';
}

// Validate email
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// Validate phone number (basic)
export function isValidPhone(phone: string): boolean {
  const phoneRegex = /^[\+]?[1-9][\d]{0,15}$/;
  return phoneRegex.test(phone.replace(/[\s\-\(\)]/g, ''));
}

// Format file size
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Get image URL with fallback
export function getImageUrl(imagePath: string, fallback: string = '/images/placeholder.svg'): string {
  if (!imagePath) return fallback;
  
  // If it's a full URL that points to /uploads/*, normalize to a relative path.
  // This avoids broken internal hostnames like http://backend:8080 on SSR/refresh.
  if ((imagePath.startsWith('http://') || imagePath.startsWith('https://')) && imagePath.includes('/uploads/')) {
    try {
      const u = new URL(imagePath);
      if (u.pathname.startsWith('/uploads/')) return u.pathname;
    } catch {
      // fall through
    }
  }

  // If it's already a full URL (non-uploads), return as is
  if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
    return imagePath;
  }

  // If it starts with /uploads, always return the relative path.
  // - Dev: next.config rewrites /uploads/* -> backend
  // - Prod: reverse-proxy should forward /uploads/* -> backend
  if (imagePath.startsWith('/uploads')) {
    return imagePath;
  }

  // Legacy default-image path form can break for SKUs containing '/'.
  // Normalize to query form: /api/v1/public/products/default-image?sku=...
  if (imagePath.startsWith('/api/v1/public/products/default-image/')) {
    const tail = imagePath.replace('/api/v1/public/products/default-image/', '');
    try {
      const decoded = decodeURIComponent(tail);
      return `/api/v1/public/products/default-image?sku=${encodeURIComponent(decoded)}`;
    } catch {
      return `/api/v1/public/products/default-image?sku=${encodeURIComponent(tail)}`;
    }
  }
  
  // Otherwise, treat as relative path and ensure it starts with /
  if (imagePath.startsWith('/')) {
    return imagePath;
  }

  // Add leading slash for relative paths
  return `/images/products/${imagePath}`;
}

// Get product primary image URL from image_urls array
export function getProductImageUrl(imageUrls: string[] | any[] | any, fallback: string = '/images/placeholder.svg'): string {
  // Handle null, undefined, or non-array values
  if (!imageUrls) return fallback;

  // If it's not an array, try to handle single values
  if (!Array.isArray(imageUrls)) {
    if (typeof imageUrls === 'string') {
      const s = imageUrls.trim();
      // Attempt to parse JSON array string like '["url1","url2"]'
      if ((s.startsWith('[') && s.endsWith(']')) || (s.startsWith('[') && s.includes(']'))) {
        try {
          const parsed = JSON.parse(s);
          if (Array.isArray(parsed) && parsed.length > 0) {
            const first = parsed[0];
            if (typeof first === 'string') return getImageUrl(first, fallback);
            if (first && typeof first === 'object' && first.url) return getImageUrl(String(first.url || ''), fallback);
          }
        } catch {/* fall through */}
      }
      // Otherwise treat as direct URL
      return getImageUrl(s, fallback);
    }
    if (imageUrls && typeof imageUrls === 'object' && imageUrls.url) {
      return getImageUrl(String(imageUrls.url || ''), fallback);
    }
    return fallback;
  }

  // Now we know it's an array
  if (imageUrls.length === 0) return fallback;

  // If it's an array of strings (image_urls), normalize through getImageUrl
  if (typeof imageUrls[0] === 'string') {
    return getImageUrl(String(imageUrls[0] || ''), fallback);
  }

  // If it's an array of objects (ProductImage[]), find primary image first
  const primaryImage = imageUrls.find(img => img && img.is_primary);
  const imageToUse = primaryImage || imageUrls[0];

  if (!imageToUse) return fallback;

  // Normalize through getImageUrl
  return getImageUrl(String(imageToUse.url || ''), fallback);
}

// Default image for products without images (watermarked with SKU when backend is configured)
export function getDefaultProductImageWithSku(sku?: string, fallback: string = '/images/placeholder.svg'): string {
  const s = String(sku || '').trim();
  if (!s) return fallback;
  const safeSku = s.replace(/[\\/]+/g, '-').replace(/\s+/g, '-');
  return `/api/v1/public/products/default-image/${encodeURIComponent(safeSku)}?sku=${encodeURIComponent(s)}`;
}

// Get specific product image URL by index
export function getProductImageUrlByIndex(imageUrls: string[] | any[] | any, index: number, fallback: string = '/images/placeholder.svg'): string {
  // Handle null, undefined, or non-array values
  if (!imageUrls) return fallback;

  // If it's not an array, handle single values
  if (!Array.isArray(imageUrls)) {
    if (index === 0) {
      if (typeof imageUrls === 'string') {
        const s = imageUrls.trim();
        if ((s.startsWith('[') && s.endsWith(']')) || (s.startsWith('[') && s.includes(']'))) {
          try {
            const parsed = JSON.parse(s);
            if (Array.isArray(parsed) && parsed.length > 0) {
              const first = parsed[0];
              if (typeof first === 'string') return getImageUrl(first, fallback);
              if (first && typeof first === 'object' && first.url) return getImageUrl(String(first.url || ''), fallback);
            }
          } catch {/* ignore */}
        }
        return getImageUrl(s, fallback);
      }
      if (imageUrls && typeof imageUrls === 'object' && imageUrls.url) {
        return getImageUrl(String(imageUrls.url || ''), fallback);
      }
    }
    return fallback;
  }

  // Now we know it's an array
  if (imageUrls.length === 0 || index < 0 || index >= imageUrls.length) return fallback;

  const image = imageUrls[index];
  if (!image) return fallback;

  // If it's a string (from image_urls array), return it directly
  if (typeof image === 'string') {
    return getImageUrl(image, fallback);
  }

  // If it's an object (ProductImage), return the url property
  return getImageUrl(String(image.url || ''), fallback);
}

// Debounce function
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout;
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

// Deep clone object
export function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') return obj;
  if (obj instanceof Date) return new Date(obj.getTime()) as any;
  if (obj instanceof Array) return obj.map(item => deepClone(item)) as any;
  if (typeof obj === 'object') {
    const clonedObj = {} as any;
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        clonedObj[key] = deepClone(obj[key]);
      }
    }
    return clonedObj;
  }
  return obj;
}

// Calculate pagination info
export function calculatePagination(page: number, pageSize: number, total: number) {
  const totalPages = Math.ceil(total / pageSize);
  const hasNextPage = page < totalPages;
  const hasPrevPage = page > 1;
  const startIndex = (page - 1) * pageSize + 1;
  const endIndex = Math.min(page * pageSize, total);

  return {
    totalPages,
    hasNextPage,
    hasPrevPage,
    startIndex,
    endIndex,
  };
}

// Generate random ID
export function generateId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

// Parse JSON safely
export function safeJsonParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

// Get initials from name
export function getInitials(name: string): string {
  return name
    .split(' ')
    .map(word => word.charAt(0))
    .join('')
    .toUpperCase()
    .substring(0, 2);
}

// Check if string is empty or whitespace
export function isEmpty(str: string | null | undefined): boolean {
  return !str || str.trim().length === 0;
}

// Capitalize first letter
export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

// Convert string to title case
export function toTitleCase(str: string): string {
  return str.replace(/\w\S*/g, (txt) => 
    txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
  );
}

// Remove HTML tags from string
export function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}

// Convert a SKU to a URL-safe single-path segment (avoid '/')
export function toProductPathId(sku: string): string {
  if (!sku) return '';
  return sku.replace(/[\\/]+/g, '-').replace(/\s+/g, '-');
}

// Get file extension
export function getFileExtension(filename: string): string {
  return filename.slice((filename.lastIndexOf('.') - 1 >>> 0) + 2);
}

// Check if file type is allowed
export function isAllowedFileType(file: File, allowedTypes: string[]): boolean {
  return allowedTypes.includes(file.type);
}

// Convert bytes to human readable format
export function bytesToSize(bytes: number): string {
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  if (bytes === 0) return '0 Byte';
  const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)).toString());
  return Math.round((bytes / Math.pow(1024, i)) * 100) / 100 + ' ' + sizes[i];
}
