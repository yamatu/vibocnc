'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';

export type AdminLocale = 'en' | 'zh';

type AdminFallback =
  | string
  | {
      en?: string;
      zh?: string;
    };

type AdminI18nContextValue = {
  locale: AdminLocale;
  setLocale: (l: AdminLocale) => void;
  t: (key: string, fallback?: AdminFallback, vars?: Record<string, string | number>) => string;
};

const AdminI18nContext = createContext<AdminI18nContextValue | null>(null);

const STORAGE_KEY = 'fanuc_admin_locale';
const COOKIE_KEY = 'fanuc_admin_locale';

const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

function getCookieValue(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const parts = document.cookie.split(';').map((p) => p.trim());
  for (const p of parts) {
    if (p.startsWith(name + '=')) return decodeURIComponent(p.slice(name.length + 1));
  }
  return null;
}

function persistLocale(l: AdminLocale) {
  // Persist synchronously so switching language + immediate navigation still keeps the choice.
  try {
    localStorage.setItem(STORAGE_KEY, l);
  } catch {
    // ignore
  }
  try {
    const maxAge = 60 * 60 * 24 * 365; // 1 year
    document.cookie = `${COOKIE_KEY}=${encodeURIComponent(l)}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
  } catch {
    // ignore
  }
}

function readSavedLocale(): AdminLocale | null {
  // Prefer localStorage, fallback to cookie.
  try {
    const v = localStorage.getItem(STORAGE_KEY) as AdminLocale | null;
    if (v === 'en' || v === 'zh') return v;
  } catch {
    // ignore
  }
  const c = getCookieValue(COOKIE_KEY) as AdminLocale | null;
  if (c === 'en' || c === 'zh') return c;
  return null;
}

const DICT: Record<AdminLocale, Record<string, string>> = {
  en: {
    'nav.dashboard': 'Dashboard',
    'nav.products': 'Products',
    'nav.categories': 'Categories',
    'nav.orders': 'Orders',
    'nav.customers': 'Customers',
    'nav.tickets': 'Support Tickets',
    'nav.coupons': 'Coupon Management',
    'nav.users': 'All Users',
    'nav.contacts': 'Contact Messages',
    'nav.email': 'Email',
    'nav.media': 'Media Library',
    'nav.shipping': 'Shipping',
    'nav.backup': 'Backup & Restore',
    'nav.cache': 'Cache Settings',
    'nav.paypal': 'PayPal',
    'nav.indexnow': 'IndexNow / Bing',
    'nav.homepage': 'Homepage Content',
    'action.signOut': 'Sign out',
    'action.language': 'Language',
    'common.save': 'Save',
    'common.cancel': 'Cancel',
    'common.close': 'Close',
    'common.edit': 'Edit',
    'common.delete': 'Delete',
    'common.loading': 'Loading...',
    'common.search': 'Search',
    'common.preview': 'Preview',
    'common.clear': 'Clear',
    'common.back': 'Back',
    'common.create': 'Create',
    'common.update': 'Update',
    'common.creating': 'Creating...',
    'common.updating': 'Updating...',
    'common.saving': 'Saving...',
    'common.retry': 'Retry',
    'common.yes': 'Yes',
    'common.no': 'No',
    'common.page': 'Page {page} / {pages}',
    'admin.panel': 'Admin Panel',

    'backup.subtitle': 'Download backups as ZIP files, and restore by uploading a ZIP.',
    'backup.warningTitle': 'Warning',
    'backup.warningBody': 'Restore will overwrite data. Please backup first and proceed carefully.',
    'backup.noFile': 'No file selected',
    'backup.downloadFailed': 'Download failed',
    'backup.restoreFailed': 'Restore failed',
    'backup.restoreNow': 'Restore Now',
    'backup.downloadDb': 'Download DB Backup',
    'backup.restoreDb': 'Restore DB Backup',
    'backup.confirmDb': 'I understand this will overwrite the database',
    'backup.dbRestoreOk': 'Database restored successfully',
    'backup.db.title': 'Database',
    'backup.db.desc': 'Backup/restore MySQL data (ZIP contains db.sql).',
    'backup.downloadMedia': 'Download Media Backup',
    'backup.restoreMedia': 'Restore Media Backup',
    'backup.confirmMedia': 'I understand this will overwrite the media library',
    'backup.mediaRestoreOk': 'Media library restored successfully',
    'backup.media.title': 'Media Library',
     'backup.media.desc': 'Backup/restore uploaded files (ZIP of uploads directory).',

     'cache.title': 'Cache Settings',
     'cache.subtitle': 'Configure Cloudflare purge (Email + Global API Key + Zone ID) and refresh cache manually or automatically.',
     'cache.settings': 'Cloudflare Settings',
     'cache.reload': 'Reload',
     'cache.email': 'Email',
     'cache.zone': 'Zone ID',
     'cache.apiKey': 'Global API Key',
     'cache.apiKeySet': 'already set',
     'cache.apiKeyNotSet': 'not set',
     'cache.apiKeyHint': 'Leave blank to keep existing key',
     'cache.enabled': 'Enable Cloudflare purge',
     'cache.autoOnMutation': 'Auto purge on admin changes',
     'cache.autoClearRedisOnMutation': 'Auto clear Redis on admin changes',
     'cache.purgeEverythingDefault': 'Default: purge everything',
     'cache.interval': 'Auto purge interval (minutes)',
     'cache.intervalHint': '0 = disabled. Scheduler checks every minute.',
     'cache.lastPurge': 'Last purge',
     'cache.never': 'Never',
     'cache.saved': 'Saved',
     'cache.loadFailed': 'Failed to load cache settings',
     'cache.saveFailed': 'Failed to save',
     'cache.test': 'Test Cloudflare',
     'cache.testOk': 'Cloudflare credentials OK',
     'cache.testFailed': 'Test failed',
     'cache.saveBeforeTest': 'Please save settings before testing.',
     'cache.siteUrlHint': 'Tip: set backend env SITE_URL so targeted URL purges match your real domain.',
     'cache.manual': 'Manual Refresh',
     'cache.clearRedisOnly': 'Only clear Redis (no Cloudflare)',
     'cache.clearRedis': 'Clear Redis (origin) cache',
     'cache.purgeEverythingNow': 'Purge everything (edge)',
     'cache.customUrls': 'Custom URLs to purge (one per line)',
     'cache.customUrlsHint': 'Leave empty to purge a safe default set: /, /products.',
     'cache.purgeNow': 'Purge Now',
     'cache.purged': 'Purge requested',
     'cache.purgeFailed': 'Purge failed',
     'cache.statusDisabled': 'Disabled',
     'cache.statusIncomplete': 'Incomplete',
     'cache.statusReady': 'Ready',

     'hotlink.title': 'Hotlink Protection',
     'hotlink.enabled': 'Enable hotlink protection for /uploads',
     'hotlink.allowSameHost': 'Allow same host',
     'hotlink.allowEmpty': 'Allow empty Referer/Origin',
     'hotlink.allowedHosts': 'Allowed hosts (comma-separated)',
     'hotlink.hint': 'Tip: include your main domain and any CDN/custom domains that should embed images.',
     'hotlink.saved': 'Saved',
     'hotlink.saveFailed': 'Failed to save',


    'categories.title': 'Categories',
    'categories.subtitle': 'Manage product categories, images and sort order',
    'categories.add': 'Add Category',
    'categories.edit': 'Edit',
    'categories.delete': 'Delete',
    'categories.search': 'Search Categories',
    'categories.status': 'Status',
    'categories.all': 'All',
    'categories.active': 'Active',
    'categories.inactive': 'Inactive',
    'categories.sort.normalize': 'Normalize Sort',
    'categories.image.choose': 'Choose',
    'categories.image.clear': 'Clear',
    'categories.products': 'Products',
    'categories.created': 'Created',
    'categories.empty.title': 'No categories found',
    'categories.empty.filtered': 'Try adjusting your search or filter criteria.',
    'categories.empty.fresh': 'Get started by creating your first category.',
    'categories.stats.title': 'Category Statistics',
    'categories.stats.total': 'Total Categories',
    'categories.stats.active': 'Active Categories',
    'categories.stats.totalProducts': 'Total Products',
    'categories.stats.avgProducts': 'Avg Products/Category',
    'categories.confirm.delete': 'Are you sure you want to delete \"{name}\"? This action cannot be undone.',
    'categories.toast.created': 'Category created successfully!',
    'categories.toast.updated': 'Category updated successfully!',
    'categories.toast.deleted': 'Category deleted successfully!',
    'categories.toast.createFailed': 'Failed to create category',
    'categories.toast.updateFailed': 'Failed to update category',
    'categories.toast.deleteFailed': 'Failed to delete category',
    'categories.toast.nameRequired': 'Category name is required',
    'categories.drawer.createTitle': 'Create Category',
    'categories.drawer.editTitle': 'Edit Category',
    'categories.drawer.hint': 'Edit in this panel; list will refresh after saving.',
    'categories.field.name': 'Category Name',
    'categories.field.description': 'Description',
    'categories.field.image': 'Category Image',
    'categories.field.sortOrder': 'Sort Order',
    'categories.field.sortHint': 'Smaller numbers appear first.',
    'categories.field.isActive': 'Active',

    'media.picker.search': 'Search by filename / hash / title...',
    'media.picker.selected': 'Selected: {count}',
    'media.picker.loading': 'Loading...',
    'media.picker.empty': 'No images found',
    'media.picker.total': 'Total: {total}',
    'media.picker.prev': 'Prev',
    'media.picker.next': 'Next',
    'media.picker.cancel': 'Cancel',
    'media.picker.useSelected': 'Use Selected',
    'media.picker.upload': 'Upload',
    'media.picker.uploadNow': 'Upload Now',
    'media.picker.uploading': 'Uploading...',
    'media.picker.uploadFailed': 'Failed to upload',
    'media.picker.onlyImages': 'Please select image files',
    'media.picker.dropHint': 'Drag & drop images here',
    'media.picker.dropSub': 'Or click Upload to choose multiple files',
    'media.picker.clearUpload': 'Clear',
    'media.picker.folder': 'Folder (optional)',
    'media.picker.tags': 'Tags (optional, comma-separated)',
    'media.picker.filesReady': '{count} file(s) ready to upload',
    'media.picker.uploadResultOk': 'Uploaded {ok} (duplicates {dup})',
    'media.picker.uploadResultErrors': 'Uploaded {ok}, duplicates {dup}, errors {err}',

    'seo.preview.title': 'Google Preview',
    'seo.preview.note': 'For reference only; actual display depends on search engines.',
    'seo.preview.titleLen': 'Title length',
    'seo.preview.descLen': 'Description length',
    'seo.preview.reco': 'Recommended {min}-{max}',
    'seo.preview.chars': '{count} chars',

    'sitemap.title': 'Sitemap Management',
    'sitemap.refresh': 'Refresh Stats',
    'sitemap.refreshing': 'Refreshing...',
    'sitemap.stats.totalProducts': 'Total Products',
    'sitemap.stats.productSitemaps': 'Product Sitemaps',
    'sitemap.stats.perSitemap': 'Per Sitemap',
    'sitemap.stats.lastUpdated': 'Last Updated',
    'sitemap.urls.title': 'Sitemap URLs',
    'indexnow.title': 'IndexNow / Bing Submission',
    'indexnow.saved': 'Saved',
    'indexnow.saveFailed': 'Failed to save',
    'sitemap.urls.subtitle': 'All available sitemap files for your website',
    'sitemap.view': 'View',
    'sitemap.copy': 'Copy URL',
    'sitemap.instructions.title': 'SEO Instructions',
    'sitemap.instructions.1': 'Submit sitemap-index.xml to Google Search Console',
    'sitemap.instructions.2': 'Sitemaps are automatically updated every 30 minutes',
    'sitemap.instructions.3': 'Each product sitemap contains up to 100 products',
    'sitemap.instructions.4': 'New products are automatically included in sitemaps',

    'products.toast.bulkUpdated': 'Products updated successfully',
    'products.toast.bulkFailed': 'Bulk update failed',
    'products.toast.created': 'Product created successfully!',
    'products.toast.createFailed': 'Failed to create product',
    'products.toast.updated': 'Product updated successfully!',
    'products.toast.updateFailed': 'Failed to update product',
    'products.toast.deleted': 'Product deleted successfully!',
    'products.toast.deleteFailed': 'Failed to delete product',
    'products.toast.selectOne': 'Select at least one product',
    'products.toast.imageUrlInvalid': 'Please enter a valid image URL',
    'products.toast.urlInvalid': 'Please enter a valid URL',
    'products.toast.imageAdded': 'Image added successfully!',
    'products.toast.categoryInvalid': 'Please select a valid category',
    'products.toast.addedFromLibrary': 'Added from media library',
    'products.toast.batchUrlsRequired': 'Please enter URLs to import',
    'products.toast.noValidUrls': 'No valid URLs found',
    'products.toast.invalidUrlsFound': 'Found {count} invalid URLs. Please check and try again.',
    'products.confirm.delete': 'Are you sure you want to delete \"{name}\"? This action cannot be undone.',
    'shipping.title': 'Shipping Templates',
    'shipping.subtitle': 'Configure multi-country shipping by weight (<21kg fixed fee + >=21kg per-kg brackets).',
    'shipping.downloadTemplate': 'Download XLSX Template',
    'shipping.chooseXlsx': 'Choose XLSX',
    'shipping.replaceRules': 'Replace existing rules',
    'shipping.import': 'Import',
    'shipping.deleteAll': 'Delete All',
    'shipping.deleteSelected': 'Delete Selected',
    'shipping.search': 'Search',
    'shipping.select': 'Select',
    'shipping.country': 'Country',
    'shipping.currency': 'Currency',
    'shipping.weightBrackets': 'Weight Brackets',
    'shipping.quoteSurcharges': 'Quote Surcharges',
    'shipping.loading': 'Loading...',
    'shipping.empty': 'No templates',
    'shipping.confirmDeleteAll': 'Delete ALL shipping templates? This cannot be undone.',
    'shipping.confirmDeleteSelected': 'Delete templates for: {codes} ?',
    'shipping.toast.templateDownloaded': 'Template downloaded',
    'shipping.toast.imported': 'Imported countries: {countries} (created {created}, updated {updated})',
    'shipping.toast.deleted': 'Deleted {deleted} country template(s)',
    'shipping.toast.selectOne': 'Select at least one country',

    'shipping.calc.title': 'Shipping (By Weight)',
    'shipping.calc.subtitle': 'Preview shipping fee from configured templates.',
    'shipping.calc.country': 'Country',
    'shipping.calc.weight': 'Weight (kg)',
    'shipping.calc.shippingFee': 'Shipping Fee',
    'shipping.calc.ratePerKg': 'Rate / kg',
    'shipping.calc.baseQuote': 'Base quote',
    'shipping.calc.additionalFee': 'Additional fee',
    'shipping.calc.billingWeight': 'Billing weight',
    'shipping.calc.roundUpHint': '(round up < 21kg)',
    'shipping.calc.priceWithShipping': 'Price + shipping',
    'shipping.calc.autoApply': 'Auto apply to price',
    'shipping.calc.setPrice': 'Set Price = Base + Shipping',
    'shipping.calc.helperNote': 'Admin helper: uses current price as base and avoids double-adding.',
  },
  zh: {
    'nav.dashboard': '仪表盘',
    'nav.products': '产品管理',
    'nav.categories': '分类管理',
    'nav.orders': '订单管理',
    'nav.customers': '客户管理',
    'nav.tickets': '支持工单',
    'nav.coupons': '优惠券管理',
    'nav.users': '全部用户',
    'nav.contacts': '联系消息',
    'nav.email': '邮件',
    'nav.media': '图库',
    'nav.shipping': '运费模板',
    'nav.backup': '备份与恢复',
    'nav.cache': '缓存设置',
    'nav.paypal': 'PayPal',
    'nav.indexnow': 'IndexNow / Bing',
    'nav.homepage': '首页内容',
    'action.signOut': '退出登录',
    'action.language': '语言',
    'common.save': '保存',
    'common.cancel': '取消',
    'common.close': '关闭',
    'common.edit': '编辑',
    'common.delete': '删除',
    'common.loading': '加载中...',
    'common.search': '搜索',
    'common.preview': '预览',
    'common.clear': '清空',
    'common.back': '返回',
    'common.create': '创建',
    'common.update': '更新',
    'common.creating': '创建中...',
    'common.updating': '更新中...',
    'common.saving': '保存中...',
    'common.retry': '重试',
    'common.yes': '是',
    'common.no': '否',
    'common.page': '第 {page} 页 / 共 {pages} 页',
    'admin.panel': '管理后台',

    'backup.subtitle': '下载 ZIP 备份文件；上传 ZIP 可执行恢复。',
    'backup.warningTitle': '注意',
    'backup.warningBody': '恢复会覆盖数据。请先备份并谨慎操作。',
    'backup.noFile': '未选择文件',
    'backup.downloadFailed': '下载失败',
    'backup.restoreFailed': '恢复失败',
    'backup.restoreNow': '立即恢复',
    'backup.downloadDb': '下载数据库备份',
    'backup.restoreDb': '恢复数据库备份',
    'backup.confirmDb': '我已了解：这会覆盖数据库内容',
    'backup.dbRestoreOk': '数据库恢复成功',
    'backup.db.title': '数据库',
    'backup.db.desc': '备份/恢复 MySQL 数据（ZIP 内包含 db.sql）。',
    'backup.downloadMedia': '下载图库备份',
    'backup.restoreMedia': '恢复图库备份',
    'backup.confirmMedia': '我已了解：这会覆盖图库文件',
    'backup.mediaRestoreOk': '图库恢复成功',
    'backup.media.title': '图库',
    'backup.media.desc': '备份/恢复上传文件（打包 uploads 目录）。',

    'cache.title': '缓存设置',
    'cache.subtitle': '配置 Cloudflare 刷新（邮箱 + Global API Key + Zone ID），并支持后台手动/自动刷新。',
    'cache.settings': 'Cloudflare 配置',
    'cache.reload': '刷新',
    'cache.email': '邮箱',
    'cache.zone': 'Zone ID',
    'cache.apiKey': 'Global API Key',
    'cache.apiKeySet': '已设置',
    'cache.apiKeyNotSet': '未设置',
    'cache.apiKeyHint': '留空则保持原 Key 不变',
    'cache.enabled': '启用 Cloudflare 刷新',
    'cache.autoOnMutation': '后台修改时自动刷新 Cloudflare',
    'cache.autoClearRedisOnMutation': '后台修改时自动清理 Redis 缓存',
    'cache.purgeEverythingDefault': '默认：全站刷新',
    'cache.interval': '定时自动刷新（分钟）',
    'cache.intervalHint': '0 = 关闭。后台每分钟检查一次。',
    'cache.lastPurge': '上次刷新',
    'cache.never': '从未',
    'cache.saved': '保存成功',
    'cache.loadFailed': '加载缓存配置失败',
    'cache.saveFailed': '保存失败',
    'cache.test': '测试 Cloudflare',
    'cache.testOk': 'Cloudflare 凭证正常',
    'cache.testFailed': '测试失败',
    'cache.saveBeforeTest': '请先保存配置再测试。',
    'cache.siteUrlHint': '提示：建议后端设置 SITE_URL，这样按 URL 刷新会匹配你的真实域名。',
    'cache.manual': '手动刷新',
    'cache.clearRedisOnly': '仅清理 Redis（不请求 Cloudflare）',
    'cache.clearRedis': '清理 Redis（源站）缓存',
    'cache.purgeEverythingNow': '全站刷新（CDN）',
    'cache.customUrls': '自定义要刷新的 URL（每行一个）',
    'cache.customUrlsHint': '留空会刷新默认集合：/、/products。',
    'cache.purgeNow': '立即刷新',
    'cache.purged': '已提交刷新请求',
    'cache.purgeFailed': '刷新失败',
    'cache.statusDisabled': '未启用',
    'cache.statusIncomplete': '配置不完整',
    'cache.statusReady': '可用',

    'hotlink.title': '防盗链',
    'hotlink.enabled': '启用 /uploads 防盗链',
    'hotlink.allowSameHost': '允许本站域名',
    'hotlink.allowEmpty': '允许空 Referer/Origin',
    'hotlink.allowedHosts': '允许的域名（逗号分隔）',
    'hotlink.hint': '提示：把你的主域名、CDN 域名、以及任何需要引用图片的域名都加进去。',
    'hotlink.saved': '保存成功',
    'hotlink.saveFailed': '保存失败',
    'categories.title': '分类管理',
    'categories.subtitle': '管理产品分类、图片与排序',
    'categories.add': '新增分类',
    'categories.edit': '编辑',
    'categories.delete': '删除',
    'categories.search': '搜索分类',
    'categories.status': '状态',
    'categories.all': '全部',
    'categories.active': '启用',
    'categories.inactive': '停用',
    'categories.sort.normalize': '重置排序(变小)',
    'categories.image.choose': '从图库选择',
    'categories.image.clear': '清空',
    'categories.products': '产品数',
    'categories.created': '创建时间',
    'categories.empty.title': '没有找到分类',
    'categories.empty.filtered': '请尝试调整搜索或筛选条件。',
    'categories.empty.fresh': '从创建第一个分类开始吧。',
    'categories.stats.title': '分类统计',
    'categories.stats.total': '分类总数',
    'categories.stats.active': '启用分类',
    'categories.stats.totalProducts': '产品总数',
    'categories.stats.avgProducts': '平均产品/分类',
    'categories.confirm.delete': '确定要删除“{name}”吗？此操作不可撤销。',
    'categories.toast.created': '分类创建成功！',
    'categories.toast.updated': '分类更新成功！',
    'categories.toast.deleted': '分类删除成功！',
    'categories.toast.createFailed': '创建分类失败',
    'categories.toast.updateFailed': '更新分类失败',
    'categories.toast.deleteFailed': '删除分类失败',
    'categories.toast.nameRequired': '分类名称不能为空',
    'categories.drawer.createTitle': '新增分类',
    'categories.drawer.editTitle': '编辑分类',
    'categories.drawer.hint': '在右侧面板编辑，保存后列表会自动刷新。',
    'categories.field.name': '分类名称',
    'categories.field.description': '描述',
    'categories.field.image': '分类图片',
    'categories.field.sortOrder': '排序',
    'categories.field.sortHint': '数字越小越靠前。',
    'categories.field.isActive': '启用',

    'media.picker.search': '按文件名 / 哈希 / 标题搜索...',
    'media.picker.selected': '已选择：{count}',
    'media.picker.loading': '加载中...',
    'media.picker.empty': '没有图片',
    'media.picker.total': '总计：{total}',
    'media.picker.prev': '上一页',
    'media.picker.next': '下一页',
    'media.picker.cancel': '取消',
    'media.picker.useSelected': '使用所选',
    'media.picker.upload': '上传',
    'media.picker.uploadNow': '立即上传',
    'media.picker.uploading': '上传中...',
    'media.picker.uploadFailed': '上传失败',
    'media.picker.onlyImages': '请选择图片文件',
    'media.picker.dropHint': '拖拽图片到这里上传',
    'media.picker.dropSub': '或点击“上传”选择多个文件',
    'media.picker.clearUpload': '清空',
    'media.picker.folder': '文件夹（可选）',
    'media.picker.tags': '标签（可选，逗号分隔）',
    'media.picker.filesReady': '已选择 {count} 个文件，待上传',
    'media.picker.uploadResultOk': '上传 {ok} 个（重复 {dup}）',
    'media.picker.uploadResultErrors': '上传 {ok} 个，重复 {dup}，失败 {err}',

    'seo.preview.title': 'Google 预览',
    'seo.preview.note': '仅供参考，实际展示以搜索引擎为准',
    'seo.preview.titleLen': '标题长度',
    'seo.preview.descLen': '描述长度',
    'seo.preview.reco': '建议 {min}-{max}',
    'seo.preview.chars': '{count} 字符',

    'sitemap.title': '站点地图管理',
    'sitemap.refresh': '刷新统计',
    'sitemap.refreshing': '刷新中...',
    'sitemap.stats.totalProducts': '产品总数',
    'sitemap.stats.productSitemaps': '产品 Sitemap 数',
    'sitemap.stats.perSitemap': '每个 Sitemap',
    'sitemap.stats.lastUpdated': '最近刷新',
    'sitemap.urls.title': 'Sitemap 地址',
    'sitemap.urls.subtitle': '站点可用的 sitemap 列表',
    'sitemap.view': '查看',
    'sitemap.copy': '复制链接',
    'sitemap.instructions.title': 'SEO 提示',
    'sitemap.instructions.1': '把 sitemap-index.xml 提交到 Google Search Console',
    'sitemap.instructions.2': 'Sitemap 默认每 30 分钟更新一次',
    'sitemap.instructions.3': '每个产品 sitemap 最多包含 100 个产品',
    'sitemap.instructions.4': '新增产品会自动进入 sitemap',

    'products.toast.bulkUpdated': '批量更新成功',
    'products.toast.bulkFailed': '批量更新失败',
    'products.toast.created': '产品创建成功！',
    'products.toast.createFailed': '创建产品失败',
    'products.toast.updated': '产品更新成功！',
    'products.toast.updateFailed': '更新产品失败',
    'products.toast.deleted': '产品删除成功！',
    'products.toast.deleteFailed': '删除产品失败',
    'products.toast.selectOne': '请至少选择一个产品',
    'products.toast.imageUrlInvalid': '请输入有效的图片链接',
    'products.toast.urlInvalid': '请输入有效的 URL',
    'products.toast.imageAdded': '图片添加成功！',
    'products.toast.categoryInvalid': '请选择有效的分类',
    'products.toast.addedFromLibrary': '已从图库添加',
    'products.toast.batchUrlsRequired': '请输入要批量导入的链接',
    'products.toast.noValidUrls': '没有找到有效的链接',
    'products.toast.invalidUrlsFound': '发现 {count} 个无效链接，请检查后重试。',
    'products.confirm.delete': '确定要删除“{name}”吗？此操作不可撤销。',
    'shipping.title': '运费模板',
    'shipping.subtitle': '支持多国家运费配置：<21kg 按整数公斤直接取值；>=21kg 按区间每公斤价格计算。',
    'shipping.downloadTemplate': '下载 XLSX 模板',
    'shipping.chooseXlsx': '选择 XLSX',
    'shipping.replaceRules': '覆盖旧规则（同国家）',
    'shipping.import': '导入',
    'shipping.deleteAll': '删除全部',
    'shipping.deleteSelected': '删除已选',
    'shipping.search': '搜索',
    'shipping.select': '选择',
    'shipping.country': '国家',
    'shipping.currency': '币种',
    'shipping.weightBrackets': '重量规则数',
    'shipping.quoteSurcharges': '附加费规则数',
    'shipping.loading': '加载中...',
    'shipping.empty': '暂无模板',
    'shipping.confirmDeleteAll': '确定删除全部运费模板吗？此操作不可撤销。',
    'shipping.confirmDeleteSelected': '确定删除这些国家的模板吗：{codes}？',
    'shipping.toast.templateDownloaded': '模板已下载',
    'shipping.toast.imported': '已导入国家：{countries}（新增 {created}，更新 {updated}）',
    'shipping.toast.deleted': '已删除 {deleted} 个国家模板',
    'shipping.toast.selectOne': '请至少选择一个国家',

    'shipping.calc.title': '运费预览（按重量）',
    'shipping.calc.subtitle': '根据已配置模板预览运费，并可自动加到标价。',
    'shipping.calc.country': '国家',
    'shipping.calc.weight': '重量(kg)',
    'shipping.calc.shippingFee': '运费',
    'shipping.calc.ratePerKg': '每公斤价格',
    'shipping.calc.baseQuote': '基础运费',
    'shipping.calc.additionalFee': '附加费',
    'shipping.calc.billingWeight': '计费重量',
    'shipping.calc.roundUpHint': '（<21kg 向上取整）',
    'shipping.calc.priceWithShipping': '标价 + 运费',
    'shipping.calc.autoApply': '自动加到标价',
    'shipping.calc.setPrice': '设置：标价 = 原价 + 运费',
    'shipping.calc.helperNote': '后台助手：以当前标价为基准，避免重复叠加。',

	'admin.login.title': '后台登录',
	'admin.login.subtitle': '登录后进入管理后台',
	'admin.login.username': '用户名',
	'admin.login.password': '密码',
	'admin.login.usernameRequired': '请输入用户名',
	'admin.login.usernameMin': '用户名至少 3 个字符',
	'admin.login.passwordRequired': '请输入密码',
	'admin.login.passwordMin': '密码至少 6 个字符',
	'admin.login.usernamePlaceholder': '请输入用户名',
	'admin.login.passwordPlaceholder': '请输入密码',
	'admin.login.remember': '记住我',
	'admin.login.forgot': '忘记密码？',
	'admin.login.signingIn': '登录中...',
	'admin.login.signIn': '登录',
	'admin.login.failed': '登录失败，请重试。',
	'admin.login.footer': '© 2024 FANUC Sales. 保留所有权利。',
  },
};

export function AdminI18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocale] = useState<AdminLocale>('zh');

  useIsoLayoutEffect(() => {
    const saved = readSavedLocale();
    if (saved) setLocale(saved);
  }, []);

  const setLocalePersist = useCallback((l: AdminLocale) => {
    setLocale(l);
    persistLocale(l);
  }, []);

  const value = useMemo<AdminI18nContextValue>(() => {
    const t = (key: string, fallback?: AdminFallback, vars?: Record<string, string | number>) => {
      const fallbackStr =
        typeof fallback === 'string'
          ? fallback
          : locale === 'zh'
            ? (fallback?.zh ?? fallback?.en)
            : (fallback?.en ?? fallback?.zh);

      // For zh admin UX, prefer provided fallback (usually zh) over English.
      const base = locale === 'en'
        ? (DICT.en[key] || fallbackStr || key)
        : (DICT[locale][key] || fallbackStr || DICT.en[key] || key);
      if (!vars) return base;
      return base.replace(/\{(\w+)\}/g, (_, k) => (vars[k] === undefined ? `{${k}}` : String(vars[k])));
    };
    return { locale, setLocale: setLocalePersist, t };
  }, [locale, setLocalePersist]);

  return <AdminI18nContext.Provider value={value}>{children}</AdminI18nContext.Provider>;
}

export function useAdminI18n(): AdminI18nContextValue {
  const ctx = useContext(AdminI18nContext);
  if (!ctx) throw new Error('useAdminI18n must be used within AdminI18nProvider');
  return ctx;
}
