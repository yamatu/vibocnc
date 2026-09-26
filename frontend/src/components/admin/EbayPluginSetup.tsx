'use client';

import { useAuth } from '@/hooks/useAuth';
import { apiClient } from '@/lib/api';
import type { APIResponse } from '@/types';
import {
  CheckCircleIcon,
  ClipboardDocumentIcon,
  KeyIcon,
  PuzzlePieceIcon,
} from '@heroicons/react/24/outline';
import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';

interface CreatedCrawlerToken {
  token: {
    id: number;
    name: string;
    token_prefix: string;
    role: string;
    scope: string;
  };
  plain_token: string;
  usage_hint: string;
}

/**
 * One-click browser-extension setup on the eBay page itself.
 *
 * The generic token manager remains under Users for auditing/revocation, but an
 * operator should not have to understand roles and scopes to connect the eBay
 * extension. This component creates the least-privilege combination in one
 * click: editor + ebay_ingest + no expiry. The plaintext is shown once.
 */
export default function EbayPluginSetup() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [created, setCreated] = useState<CreatedCrawlerToken | null>(null);
  const [creating, setCreating] = useState(false);
  const [copiedField, setCopiedField] = useState<'url' | 'token' | 'config' | null>(null);
  const [storefrontUrl, setStorefrontUrl] = useState('');

  // Populate after hydration so the server and first client render agree.
  useEffect(() => {
    setStorefrontUrl(window.location.origin);
  }, []);

  const createToken = async () => {
    try {
      setCreating(true);
      const stamp = new Date().toLocaleDateString('zh-CN').replaceAll('/', '-');
      const response = await apiClient.post<APIResponse<CreatedCrawlerToken>>(
        '/admin/integration-tokens',
        {
          name: `eBay 浏览器插件 ${stamp}`,
          role: 'editor',
          scope: 'ebay_ingest',
          expires_in_days: 0,
        }
      );
      if (!response.data.data?.plain_token) {
        throw new Error('API did not return the one-time token');
      }
      setCreated(response.data.data);
      toast.success('插件令牌已创建');
    } catch {
      toast.error('创建令牌失败；只有管理员可以创建插件令牌');
    } finally {
      setCreating(false);
    }
  };

  const copy = async (field: 'url' | 'token' | 'config', value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      window.setTimeout(() => setCopiedField(null), 2000);
      toast.success('已复制');
    } catch {
      toast.error('复制失败，请手动选择复制');
    }
  };

  const configText = created
    ? `网站后台地址: ${storefrontUrl}\nAPI Token: ${created.plain_token}`
    : '';

  return (
    <section className="rounded-lg border border-blue-200 bg-blue-50/60 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <div className="flex items-center gap-2">
            <PuzzlePieceIcon className="h-5 w-5 text-blue-700" />
            <h2 className="text-lg font-medium text-gray-900">连接 eBay 浏览器插件</h2>
          </div>
          <p className="mt-1 text-sm text-gray-600">
            一键创建只能上传 eBay 数据的专用令牌。把下面的网站地址和令牌填入插件后，
            即可测试连接并把已锁定商品直接上传到后台审查队列。
          </p>
        </div>
        {!created && (
          <button
            onClick={createToken}
            disabled={!isAdmin || creating}
            title={!isAdmin ? '只有管理员可以创建 API 令牌' : undefined}
            className="inline-flex items-center gap-2 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <KeyIcon className="h-4 w-4" />
            {creating ? '创建中…' : '自动创建插件令牌'}
          </button>
        )}
      </div>

      {!isAdmin && !created && (
        <p className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          当前账号不是管理员。请让管理员在此页面创建令牌；日常上传仍可由编辑账号操作。
        </p>
      )}

      {created && (
        <div className="mt-4 space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p className="font-medium text-amber-900">
            请现在复制：令牌关闭页面后无法再次显示
          </p>
          <CopyRow
            label="网站后台地址"
            value={storefrontUrl}
            copied={copiedField === 'url'}
            onCopy={() => copy('url', storefrontUrl)}
          />
          <CopyRow
            label="API Token"
            value={created.plain_token}
            secret
            copied={copiedField === 'token'}
            onCopy={() => copy('token', created.plain_token)}
          />
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              onClick={() => copy('config', configText)}
              className="inline-flex items-center gap-1 rounded border border-amber-400 bg-white px-3 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100"
            >
              {copiedField === 'config' ? (
                <CheckCircleIcon className="h-4 w-4" />
              ) : (
                <ClipboardDocumentIcon className="h-4 w-4" />
              )}
              一次复制两项
            </button>
            <button
              onClick={() => setCreated(null)}
              className="rounded px-3 py-2 text-sm text-gray-600 hover:bg-amber-100"
            >
              我已保存，关闭
            </button>
          </div>
          <p className="text-xs text-amber-800">
            权限：editor + ebay_ingest。可上传市场报价和商品草稿；不能发布产品、删除数据或应用价格。
          </p>
        </div>
      )}
    </section>
  );
}

function CopyRow({
  label,
  value,
  secret = false,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  secret?: boolean;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-gray-600">{label}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded border border-amber-200 bg-white px-3 py-2 font-mono text-xs text-gray-800">
          {secret ? value : value || '正在读取地址…'}
        </code>
        <button
          onClick={onCopy}
          disabled={!value}
          className="inline-flex flex-none items-center gap-1 rounded border border-amber-300 bg-white px-3 py-2 text-xs text-amber-900 disabled:opacity-50"
        >
          {copied ? <CheckCircleIcon className="h-4 w-4" /> : <ClipboardDocumentIcon className="h-4 w-4" />}
          {copied ? '已复制' : '复制'}
        </button>
      </div>
    </div>
  );
}
