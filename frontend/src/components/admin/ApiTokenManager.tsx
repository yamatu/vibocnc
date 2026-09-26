'use client';

import { apiClient } from '@/lib/api';
import type { APIResponse } from '@/types';
import {
  CheckCircleIcon,
  ClipboardDocumentIcon,
  ExclamationTriangleIcon,
  KeyIcon,
  PlusIcon,
  TrashIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';

interface IntegrationToken {
  id: number;
  name: string;
  token_prefix: string;
  role: string;
  scope: string;
  is_active: boolean;
  created_by_name?: string;
  last_used_at?: string | null;
  last_used_ip?: string;
  request_count: number;
  expires_at?: string | null;
  revoked_at?: string | null;
  created_at: string;
  is_expired: boolean;
}

interface CreatedToken {
  token: IntegrationToken;
  plain_token: string;
  usage_hint: string;
}

const ROLE_OPTIONS = [
  { value: 'editor', label: '编辑（可推送采集数据，不能改价）' },
  { value: 'admin', label: '管理员（全部权限）' },
  { value: 'viewer', label: '只读' },
];

const SCOPE_OPTIONS = [
  { value: '', label: '不限（按角色）' },
  { value: 'ebay_ingest', label: 'eBay 插件/爬虫上传（推荐）' },
  { value: 'market_ingest', label: '仅推送聚合市场报价（兼容旧配置）' },
];

/**
 * API token management.
 *
 * Tokens are for machine clients — the eBay crawler in particular — which cannot
 * hold a browser session. Two properties matter and are reflected in the UI:
 *
 *  1. The plaintext token is shown exactly once, right after creation. Only a
 *     hash is stored, so there is no "reveal" action; a lost token is replaced,
 *     not recovered.
 *  2. Tokens are scoped. A crawler/plugin token is an editor with the
 *     ebay_ingest scope, which lets it push quotes and listing drafts but not
 *     publish products or apply price changes.
 */
export default function ApiTokenManager() {
  const [tokens, setTokens] = useState<IntegrationToken[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [created, setCreated] = useState<CreatedToken | null>(null);
  const [copied, setCopied] = useState(false);

  const [name, setName] = useState('');
  const [role, setRole] = useState('editor');
  const [scope, setScope] = useState('ebay_ingest');
  const [expiresInDays, setExpiresInDays] = useState(0);
  const [isCreating, setIsCreating] = useState(false);

  const loadTokens = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await apiClient.get<APIResponse<IntegrationToken[]>>(
        '/admin/integration-tokens'
      );
      setTokens(response.data.data || []);
    } catch {
      toast.error('加载 API 令牌失败');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTokens();
  }, [loadTokens]);

  const createToken = async () => {
    if (name.trim().length < 2) {
      toast.error('请填写令牌名称（至少 2 个字符）');
      return;
    }
    try {
      setIsCreating(true);
      const response = await apiClient.post<APIResponse<CreatedToken>>(
        '/admin/integration-tokens',
        {
          name: name.trim(),
          role,
          scope,
          expires_in_days: expiresInDays,
        }
      );
      setCreated(response.data.data || null);
      setShowCreate(false);
      setName('');
      setRole('editor');
      setScope('ebay_ingest');
      setExpiresInDays(0);
      await loadTokens();
    } catch {
      toast.error('创建令牌失败');
    } finally {
      setIsCreating(false);
    }
  };

  const toggleToken = async (token: IntegrationToken) => {
    try {
      await apiClient.patch(`/admin/integration-tokens/${token.id}`, {
        is_active: !token.is_active,
      });
      toast.success(token.is_active ? '已停用' : '已启用');
      await loadTokens();
    } catch {
      toast.error('更新令牌失败');
    }
  };

  const revokeToken = async (token: IntegrationToken) => {
    if (!window.confirm(`确定撤销「${token.name}」？使用该令牌的爬虫将立即失效。`)) {
      return;
    }
    try {
      await apiClient.post(`/admin/integration-tokens/${token.id}/revoke`);
      toast.success('令牌已撤销');
      await loadTokens();
    } catch {
      toast.error('撤销失败');
    }
  };

  const deleteToken = async (token: IntegrationToken) => {
    if (!window.confirm(`永久删除「${token.name}」的记录？`)) {
      return;
    }
    try {
      await apiClient.delete(`/admin/integration-tokens/${token.id}`);
      toast.success('已删除');
      await loadTokens();
    } catch {
      toast.error('删除失败，请先撤销该令牌');
    }
  };

  const copyToken = async () => {
    if (!created) {
      return;
    }
    try {
      await navigator.clipboard.writeText(created.plain_token);
      setCopied(true);
      toast.success('令牌已复制');
    } catch {
      toast.error('复制失败，请手动选择文本复制');
    }
  };

  return (
    <div className="bg-white shadow rounded-lg p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium text-gray-900 flex items-center gap-2">
            <KeyIcon className="h-5 w-5 text-gray-500" />
            API 令牌
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            供爬虫等程序使用的长期凭证。令牌只在创建时显示一次，之后无法查看。
          </p>
        </div>
        <button
          onClick={() => setShowCreate((prev) => !prev)}
          className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          <PlusIcon className="h-4 w-4" />
          新建令牌
        </button>
      </div>

      {/* The plaintext token: shown once, with an explicit warning. */}
      {created && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <div className="flex items-start gap-2">
            <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
            <div className="flex-1">
              <p className="text-sm font-medium text-amber-900">
                请立即复制并妥善保存 — 关闭后无法再次查看
              </p>
              <div className="mt-2 flex items-center gap-2">
                <code className="flex-1 break-all rounded bg-white px-3 py-2 font-mono text-xs text-gray-800">
                  {created.plain_token}
                </code>
                <button
                  onClick={copyToken}
                  className="inline-flex items-center gap-1 rounded border border-amber-400 bg-white px-3 py-2 text-xs font-medium text-amber-900 hover:bg-amber-100"
                >
                  <ClipboardDocumentIcon className="h-4 w-4" />
                  {copied ? '已复制' : '复制'}
                </button>
              </div>
              <p className="mt-2 text-xs text-amber-800">
                填入爬虫的 <code className="font-mono">.env</code>：
                <br />
                <code className="font-mono">VIBOCNC_API_TOKEN={created.plain_token}</code>
              </p>
            </div>
            <button
              onClick={() => {
                setCreated(null);
                setCopied(false);
              }}
              className="text-amber-700 hover:text-amber-900"
              aria-label="关闭"
            >
              <XCircleIcon className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}

      {showCreate && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-gray-700">名称</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="eBay 爬虫"
                className="rounded border border-gray-300 px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-gray-700">权限</span>
              <select
                value={role}
                onChange={(event) => setRole(event.target.value)}
                className="rounded border border-gray-300 px-3 py-2"
              >
                {ROLE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-gray-700">用途范围</span>
              <select
                value={scope}
                onChange={(event) => setScope(event.target.value)}
                className="rounded border border-gray-300 px-3 py-2"
              >
                {SCOPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-gray-700">有效期（天，0 = 永久）</span>
              <input
                type="number"
                min={0}
                max={3650}
                value={expiresInDays}
                onChange={(event) => setExpiresInDays(Number(event.target.value) || 0)}
                className="rounded border border-gray-300 px-3 py-2"
              />
            </label>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              onClick={createToken}
              disabled={isCreating}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isCreating ? '创建中…' : '创建'}
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700"
            >
              取消
            </button>
          </div>
        </div>
      )}

      <div className="mt-4">
        {isLoading ? (
          <p className="py-6 text-center text-sm text-gray-500">加载中…</p>
        ) : tokens.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-500">
            还没有 API 令牌。爬虫需要令牌才能把数据推送到后台。
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-2">名称</th>
                  <th className="px-3 py-2">令牌前缀</th>
                  <th className="px-3 py-2">权限</th>
                  <th className="px-3 py-2">最近使用</th>
                  <th className="px-3 py-2 text-right">调用次数</th>
                  <th className="px-3 py-2">状态</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {tokens.map((token) => (
                  <tr key={token.id} className={token.revoked_at ? 'opacity-60' : ''}>
                    <td className="px-3 py-2">
                      <div className="font-medium text-gray-900">{token.name}</div>
                      {token.created_by_name && (
                        <div className="text-xs text-gray-500">由 {token.created_by_name} 创建</div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <code className="font-mono text-xs text-gray-600">
                        {token.token_prefix}…
                      </code>
                    </td>
                    <td className="px-3 py-2 text-gray-700">
                      {token.role}
                      {token.scope && (
                        <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                          {token.scope}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500">
                      {token.last_used_at ? formatTime(token.last_used_at) : '从未使用'}
                      {token.last_used_ip && (
                        <div className="text-gray-400">{token.last_used_ip}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-600">{token.request_count}</td>
                    <td className="px-3 py-2">
                      <TokenStatus token={token} />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-2">
                        {!token.revoked_at && (
                          <>
                            <button
                              onClick={() => toggleToken(token)}
                              className="text-xs text-blue-600 hover:underline"
                            >
                              {token.is_active ? '停用' : '启用'}
                            </button>
                            <button
                              onClick={() => revokeToken(token)}
                              className="text-xs text-red-600 hover:underline"
                            >
                              撤销
                            </button>
                          </>
                        )}
                        {token.revoked_at && (
                          <button
                            onClick={() => deleteToken(token)}
                            className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-red-600"
                          >
                            <TrashIcon className="h-3.5 w-3.5" />
                            删除
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function TokenStatus({ token }: { token: IntegrationToken }) {
  if (token.revoked_at) {
    return (
      <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
        已撤销
      </span>
    );
  }
  if (token.is_expired) {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
        已过期
      </span>
    );
  }
  if (!token.is_active) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800">
        <XCircleIcon className="h-3 w-3" />
        已停用
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800">
      <CheckCircleIcon className="h-3 w-3" />
      生效中
    </span>
  );
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
