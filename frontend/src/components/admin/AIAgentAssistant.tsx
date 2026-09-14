'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import {
  ArrowPathIcon,
  ChatBubbleLeftRightIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  CurrencyDollarIcon,
  ExclamationTriangleIcon,
  PaperAirplaneIcon,
  SparklesIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';
import {
  AIAgentAction,
  AI_AGENT_CONFIG_CHANGED_EVENT,
  AIAgentMessage,
  AIAgentService,
  AIAgentStatus,
} from '@/services/ai-agent.service';
import { useAdminI18n } from '@/lib/admin-i18n';
import AIPriceSyncPanel from '@/components/admin/AIPriceSyncPanel';

const SUGGESTED_PROMPTS = [
  'A06B-XXXX（如果不存在，创建未发布产品草稿；只能使用现有品牌和产品类型分类）',
  '检查 SKU A06B-XXXX 的分类是否正确，并给出 SEO 优化建议',
  '为 FANUC 伺服驱动分类生成中文、德语 SEO 内容',
  '检查现有分类；没有能确认品牌和产品类型的分类时请标记待人工审核',
];

const actionLabels: Record<string, { zh: string; en: string }> = {
  create_category: { zh: '分类待人工审核', en: 'Category needs review' },
  create_product: { zh: '新建产品草稿', en: 'New product draft' },
  update_product: { zh: '商品分类 / SEO 优化', en: 'Product category / SEO update' },
  update_product_price: { zh: '商品售价修改', en: 'Product sale price update' },
  upsert_product_translation: { zh: '商品多语言 SEO', en: 'Product multilingual SEO' },
  upsert_category_translation: { zh: '分类多语言 SEO', en: 'Category multilingual SEO' },
};

// Mirrors the read-only tools the Go backend exposes to the assistant. The
// trace is shown so an administrator can see which catalogue data an answer was
// actually based on instead of trusting an unattributed claim.
const toolLabels: Record<string, { zh: string; en: string }> = {
  search_products: { zh: '检索商品', en: 'Searched products' },
  get_product: { zh: '读取商品', en: 'Read product' },
  list_categories: { zh: '读取分类', en: 'Listed categories' },
  count_products: { zh: '统计商品', en: 'Counted products' },
  seo_gap_report: { zh: 'SEO 缺口统计', en: 'SEO gap report' },
};

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '—';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function errorMessage(error: unknown) {
  if (typeof error === 'object' && error !== null) {
    const candidate = error as { message?: unknown; response?: { data?: { error?: unknown; message?: unknown } } };
    const dataMessage = candidate.response?.data?.error || candidate.response?.data?.message;
    if (typeof dataMessage === 'string' && dataMessage) return dataMessage;
    if (typeof candidate.message === 'string' && candidate.message) return candidate.message;
  }
  return '';
}

function actionSummary(action: AIAgentAction, zh: boolean) {
  const d = action.data || {};
  switch (action.type) {
    case 'create_category':
      return zh
        ? `无法自动确认现有分类「${displayValue(d.name)}」，请由管理员在分类管理页维护后再审核产品`
        : `No verified existing category for “${displayValue(d.name)}”; an administrator must maintain the taxonomy before review`;
    case 'create_product':
      return zh
        ? `创建未发布产品「${displayValue(d.name || d.model)}」；售价 ${displayValue(d.default_price)} USD，质保 ${displayValue(d.warranty_period)}，交期 ${displayValue(d.lead_time)}`
        : `Create unpublished product “${displayValue(d.name || d.model)}”; price ${displayValue(d.default_price)} USD, warranty ${displayValue(d.warranty_period)}, lead time ${displayValue(d.lead_time)}`;
    case 'update_product':
      return zh
        ? `商品 #${displayValue(d.product_id)}：建议归入「${displayValue(d.category_name || d.category_id || d.category_client_key)}」并优化 SEO`
        : `Product #${displayValue(d.product_id)}: move to “${displayValue(d.category_name || d.category_id || d.category_client_key)}” and optimize SEO`;
    case 'update_product_price':
      return zh
        ? `商品 #${displayValue(d.product_id)}：型号「${displayValue(d.matching_model)}」售价 ${displayValue(d.current_price)} → ${displayValue(d.sale_price)}${d.currency ? ` ${displayValue(d.currency)}` : ''}`
        : `Product #${displayValue(d.product_id)}: model “${displayValue(d.matching_model)}” sale price ${displayValue(d.current_price)} → ${displayValue(d.sale_price)}${d.currency ? ` ${displayValue(d.currency)}` : ''}`;
    case 'upsert_product_translation':
      return zh
        ? `商品 #${displayValue(d.product_id)} · ${displayValue(d.language_code)} SEO`
        : `Product #${displayValue(d.product_id)} · ${displayValue(d.language_code)} SEO`;
    case 'upsert_category_translation':
      return zh
        ? `分类 #${displayValue(d.category_id)} · ${displayValue(d.language_code)} SEO`
        : `Category #${displayValue(d.category_id)} · ${displayValue(d.language_code)} SEO`;
    default:
      return action.title;
  }
}

function ProposalCard({ action, onApply, applying, applied, requiresBatch }: {
  action: AIAgentAction;
  onApply: () => void;
  applying: boolean;
  applied: boolean;
  requiresBatch: boolean;
}) {
  const { locale } = useAdminI18n();
  const [expanded, setExpanded] = useState(false);
  const zh = locale === 'zh';
  const label = actionLabels[action.type]?.[zh ? 'zh' : 'en'] || action.title;
  const blockedCategoryProposal = action.type === 'create_category';
  const entries = Object.entries(action.data || {}).filter(([key]) => key !== 'client_key' && key !== 'category_client_key');

  return (
    <article className="rounded-lg border border-violet-200 bg-violet-50/60 p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-violet-950">{label}</p>
          <p className="mt-0.5 text-xs leading-5 text-violet-800">{action.title || actionSummary(action, zh)}</p>
        </div>
        {applied ? (
          <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-emerald-700">
            <CheckCircleIcon className="h-4 w-4" /> {zh ? '已应用' : 'Applied'}
          </span>
        ) : blockedCategoryProposal ? (
          <span className="shrink-0 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-800">
            {zh ? '仅供人工审核' : 'Review only'}
          </span>
        ) : requiresBatch ? (
          <span className="shrink-0 rounded-md border border-violet-200 bg-white px-2 py-1 text-[10px] font-medium text-violet-700">
            {zh ? '随整组应用' : 'Apply as group'}
          </span>
        ) : (
          <button
            type="button"
            disabled={applying}
            onClick={onApply}
            className="shrink-0 rounded-md bg-violet-600 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {applying ? (zh ? '应用中...' : 'Applying...') : (zh ? '应用' : 'Apply')}
          </button>
        )}
      </div>
      <p className="mt-2 text-xs text-gray-700">{actionSummary(action, zh)}</p>
      {entries.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-violet-700 hover:text-violet-900"
          >
            {expanded ? (zh ? '收起优化详情' : 'Hide optimized fields') : (zh ? '查看优化详情' : 'View optimized fields')}
            <ChevronDownIcon className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
          {expanded && (
            <dl className="mt-2 space-y-1.5 border-t border-violet-200 pt-2">
              {entries.map(([key, value]) => (
                <div key={key} className="grid grid-cols-[105px_minmax(0,1fr)] gap-2">
                  <dt className="break-words text-[11px] font-medium text-gray-500">{key}</dt>
                  <dd className="break-words whitespace-pre-wrap text-[11px] leading-4 text-gray-800">{displayValue(value)}</dd>
                </div>
              ))}
            </dl>
          )}
        </>
      )}
    </article>
  );
}

export default function AIAgentAssistant() {
  const { locale } = useAdminI18n();
  const zh = locale === 'zh';
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'assistant' | 'prices'>('assistant');
  const [status, setStatus] = useState<AIAgentStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [messages, setMessages] = useState<AIAgentMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [applyingKey, setApplyingKey] = useState<string | null>(null);
  const [appliedKeys, setAppliedKeys] = useState<string[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || status) return;
    setStatusLoading(true);
    AIAgentService.status()
      .then(setStatus)
      .catch((error: unknown) => toast.error(errorMessage(error) || (zh ? '无法读取 AI 设置' : 'Could not load AI settings')))
      .finally(() => setStatusLoading(false));
  }, [open, status, zh]);

  useEffect(() => {
    const refreshStatus = () => setStatus(null);
    window.addEventListener(AI_AGENT_CONFIG_CHANGED_EVENT, refreshStatus);
    return () => window.removeEventListener(AI_AGENT_CONFIG_CHANGED_EVENT, refreshStatus);
  }, []);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, sending, open]);

  const send = async (event?: FormEvent, suggested?: string) => {
    event?.preventDefault();
    const text = (suggested || input).trim();
    if (!text || sending || !status?.configured) return;
    const userMessage: AIAgentMessage = { role: 'user', content: text };
    const history = [...messages, userMessage];
    setMessages(history);
    setInput('');
    setSending(true);
    try {
      const reply = await AIAgentService.chat(text, messages);
      setMessages((previous) => [...previous, { role: 'assistant', content: reply.reply, suggestions: reply.suggestions || [], toolCalls: reply.tool_calls || [] }]);
    } catch (error: unknown) {
      const detail = errorMessage(error);
      toast.error(detail || (zh ? 'AI 暂时无法生成建议' : 'AI could not generate a proposal'));
      setMessages((previous) => previous.filter((item) => item !== userMessage));
    } finally {
      setSending(false);
    }
  };

  const apply = async (action: AIAgentAction, key: string) => {
    setApplyingKey(key);
    try {
      await AIAgentService.apply([action]);
      setAppliedKeys((previous) => [...previous, key]);
      toast.success(zh ? '建议已应用，网站缓存将自动刷新。' : 'Suggestion applied. Public cache will refresh automatically.');
    } catch (error: unknown) {
      const detail = errorMessage(error);
      toast.error(detail || (zh ? '应用建议失败' : 'Could not apply suggestion'));
    } finally {
      setApplyingKey(null);
    }
  };

  const applyGroup = async (actions: AIAgentAction[], messageIndex: number) => {
    const applicable = actions.filter((action) => action.type !== 'create_category');
    const unapplied = applicable.filter((action) => {
      const actionIndex = actions.indexOf(action);
      return !appliedKeys.includes(`${messageIndex}-${actionIndex}`);
    });
    if (unapplied.length === 0) return;
    const batchKey = `all-${messageIndex}`;
    setApplyingKey(batchKey);
    try {
      // Category proposals are review-only. The server rejects them and the
      // taxonomy is maintained by administrators, so omit them from a batch
      // apply instead of letting one stale proposal roll back valid actions.
      await AIAgentService.apply(unapplied);
      setAppliedKeys((previous) => [
        ...previous,
        ...unapplied
          .map((action) => `${messageIndex}-${actions.indexOf(action)}`)
          .filter((key) => !previous.includes(key)),
      ]);
      const reviewCount = actions.length - applicable.length;
      const suffix = reviewCount > 0 ? (zh ? `，${reviewCount} 条分类建议需人工审核` : `; ${reviewCount} category proposal(s) require review`) : '';
      toast.success(zh ? `已应用 ${unapplied.length} 条建议${suffix}，网站缓存将自动刷新。` : `${unapplied.length} suggestions applied${suffix}. Public cache will refresh automatically.`);
    } catch (error: unknown) {
      toast.error(errorMessage(error) || (zh ? '应用建议失败' : 'Could not apply suggestions'));
    } finally {
      setApplyingKey(null);
    }
  };

  const reset = () => {
    setMessages([]);
    setAppliedKeys([]);
    setInput('');
  };

  return (
    <div className="fixed bottom-5 right-5 z-[70] print:hidden">
      {open && (
        <section className="mb-3 flex h-[min(700px,calc(100vh-7.5rem))] w-[calc(100vw-2.5rem)] max-w-[520px] flex-col overflow-hidden rounded-2xl border border-violet-200 bg-white shadow-2xl" aria-label={zh ? 'AI 商品优化助手' : 'AI catalog optimization assistant'}>
          <header className="flex items-center justify-between bg-gradient-to-r from-violet-700 to-indigo-700 px-4 py-3 text-white">
            <div className="flex items-center gap-2">
              <SparklesIcon className="h-5 w-5" />
              <div>
                <h2 className="text-sm font-semibold">{zh ? 'AI 商品优化助手' : 'AI Catalog Assistant'}</h2>
                <p className="text-[11px] text-violet-100">{status?.configured ? `${status.provider || 'OpenAI compatible'} · ${status.model}` : (zh ? '分类、SEO 与多语言优化' : 'Categories, SEO and localization')}</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {mode === 'assistant' && <button type="button" onClick={reset} className="rounded p-1.5 hover:bg-white/15" title={zh ? '新对话' : 'New conversation'} aria-label={zh ? '新对话' : 'New conversation'}><ArrowPathIcon className="h-4 w-4" /></button>}
              <button type="button" onClick={() => setOpen(false)} className="rounded p-1.5 hover:bg-white/15" aria-label={zh ? '关闭' : 'Close'}><XMarkIcon className="h-5 w-5" /></button>
            </div>
          </header>

          <div className="grid grid-cols-2 border-b border-gray-200 bg-white p-1" role="tablist" aria-label={zh ? '优化模式' : 'Optimization mode'}>
            <button type="button" role="tab" aria-selected={mode === 'assistant'} onClick={() => setMode('assistant')} className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold ${mode === 'assistant' ? 'bg-violet-100 text-violet-800' : 'text-gray-600 hover:bg-gray-50'}`}><ChatBubbleLeftRightIcon className="h-4 w-4" />{zh ? '目录与 SEO' : 'Catalog & SEO'}</button>
            <button type="button" role="tab" aria-selected={mode === 'prices'} onClick={() => setMode('prices')} className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold ${mode === 'prices' ? 'bg-emerald-100 text-emerald-800' : 'text-gray-600 hover:bg-gray-50'}`}><CurrencyDollarIcon className="h-4 w-4" />{zh ? '价格同步' : 'Price sync'}</button>
          </div>

          {mode === 'prices' ? <AIPriceSyncPanel zh={zh} /> : <>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-slate-50 p-3" role="tabpanel">
            {statusLoading && <p className="pt-6 text-center text-sm text-gray-500">{zh ? '正在检查 AI 配置…' : 'Checking AI configuration…'}</p>}
            {!statusLoading && status && !status.configured && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <div className="flex gap-2"><ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" /><div><p className="font-semibold">{zh ? 'AI 尚未配置' : 'AI is not configured'}</p><p className="mt-1 text-xs leading-5">{zh ? '请让管理员进入“AI 助手”页面，保存 API Key、模型与推理强度后启用。密钥只会加密保存于数据库，不会暴露到浏览器。' : 'An administrator must open AI Assistant, save the API key, model, and reasoning effort, then enable it. The key is encrypted in the database and never reaches the browser.'}</p></div></div>
              </div>
            )}
            {!statusLoading && status?.configured && messages.length === 0 && (
              <div className="space-y-3 py-2">
                <div className="rounded-xl bg-white p-3 text-sm leading-6 text-gray-700 shadow-sm ring-1 ring-gray-100">
                  {zh ? '直接输入一个型号即可分析。型号不存在时，只有品牌、型号、产品类型及现有叶子分类都能确认，才会生成未发布产品草稿；售价、质保与交期只采用后台保存的默认值。' : 'Enter a model directly. If it does not exist, an unpublished draft is proposed only when the brand, model, product type, and an existing leaf category are all verified; price, warranty, and lead time use only saved admin defaults.'}
                </div>
                <div className="flex flex-wrap gap-2">
                  {SUGGESTED_PROMPTS.map((prompt) => <button key={prompt} type="button" onClick={() => send(undefined, prompt)} className="rounded-lg border border-violet-200 bg-white px-2.5 py-1.5 text-left text-xs leading-4 text-violet-700 hover:bg-violet-50">{prompt}</button>)}
                </div>
              </div>
            )}
            {messages.map((message, messageIndex) => (
              <div key={`${message.role}-${messageIndex}`} className={message.role === 'user' ? 'ml-8' : 'mr-3'}>
                <div className={`rounded-xl px-3 py-2 text-sm leading-6 ${message.role === 'user' ? 'bg-violet-600 text-white' : 'border border-gray-100 bg-white text-gray-800 shadow-sm'}`}>{message.content}</div>
                {message.role === 'assistant' && message.toolCalls && message.toolCalls.length > 0 && (
                  <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label={zh ? '本次回答查询的目录数据' : 'Catalogue lookups behind this answer'}>
                    {message.toolCalls.map((call, callIndex) => (
                      <li
                        key={`${call.tool}-${callIndex}`}
                        className={`inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] leading-4 ${call.error ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-slate-200 bg-slate-50 text-slate-600'}`}
                        title={call.error || `${call.tool} ${call.detail}`.trim()}
                      >
                        <span className="font-medium">{toolLabels[call.tool]?.[zh ? 'zh' : 'en'] || call.tool}</span>
                        {call.detail && <span className="truncate text-slate-500">{call.detail}</span>}
                        {call.error && <span className="truncate">{zh ? '（无结果）' : '(no result)'}</span>}
                      </li>
                    ))}
                  </ul>
                )}
                {message.suggestions && message.suggestions.length > 0 && <div className="mt-2 space-y-2">
                  {message.suggestions.length > 1 && message.suggestions.some((action, actionIndex) => action.type !== 'create_category' && !appliedKeys.includes(`${messageIndex}-${actionIndex}`)) && (
                    <button
                      type="button"
                      onClick={() => applyGroup(message.suggestions || [], messageIndex)}
                      disabled={applyingKey === `all-${messageIndex}` || applyingKey !== null}
                      className="w-full rounded-lg border border-violet-300 bg-white px-3 py-2 text-xs font-semibold text-violet-700 hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {applyingKey === `all-${messageIndex}` ? (zh ? '正在应用全部建议…' : 'Applying all suggestions…') : (zh ? '确认并应用本轮全部建议' : 'Review and apply all suggestions')}
                    </button>
                  )}
                  {message.suggestions.map((action, actionIndex) => {
                    const key = `${messageIndex}-${actionIndex}`;
                    const requiresBatch = Boolean(action.data?.parent_client_key || action.data?.category_client_key);
                    return <ProposalCard key={key} action={action} applying={applyingKey === key || applyingKey === `all-${messageIndex}`} applied={appliedKeys.includes(key)} requiresBatch={requiresBatch} onApply={() => apply(action, key)} />;
                  })}
                </div>}
              </div>
            ))}
            {sending && <div className="mr-8 rounded-xl border border-gray-100 bg-white px-3 py-2 text-sm text-gray-500 shadow-sm">{zh ? '正在检索目录并分析分类和 SEO…' : 'Checking the catalogue, then analyzing categories and SEO…'}</div>}
            <div ref={bottomRef} />
          </div>

          <form onSubmit={send} className="border-t border-gray-200 bg-white p-3">
            <div className="flex items-end gap-2 rounded-xl border border-gray-300 bg-white p-1.5 focus-within:border-violet-500 focus-within:ring-2 focus-within:ring-violet-100">
              <textarea value={input} onChange={(event) => setInput(event.target.value)} disabled={!status?.configured || sending} rows={2} maxLength={4000} aria-label={zh ? 'AI 优化指令' : 'AI optimization instruction'} placeholder={zh ? '直接输入型号，例如 A06B-xxxx' : 'Enter a model, for example A06B-xxxx'} className="min-h-[42px] flex-1 resize-none border-0 bg-transparent px-2 py-1 text-sm outline-none placeholder:text-gray-400 disabled:cursor-not-allowed" />
              <button type="submit" disabled={!input.trim() || !status?.configured || sending} className="rounded-lg bg-violet-600 p-2 text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-gray-300" aria-label={zh ? '发送' : 'Send'}><PaperAirplaneIcon className="h-4 w-4" /></button>
            </div>
            <p className="mt-1.5 text-[11px] text-gray-400">{status?.product_creation_ready ? (zh ? `产品草稿默认售价 ${status.default_product_price} USD；确认后创建但不发布。` : `Product draft default: ${status.default_product_price} USD; created only after confirmation and kept unpublished.`) : (zh ? '尚未设置默认售价；AI 可分析，但不会创建产品。' : 'No default price is configured; AI can analyze but cannot create products.')}</p>
          </form>
          </>}
        </section>
      )}
      <button type="button" onClick={() => setOpen((current) => !current)} className="group flex h-14 items-center gap-2 rounded-full bg-gradient-to-r from-violet-600 to-indigo-600 px-4 text-sm font-semibold text-white shadow-xl transition hover:scale-[1.02] hover:from-violet-700 hover:to-indigo-700 focus:outline-none focus:ring-4 focus:ring-violet-200" aria-expanded={open} aria-label={zh ? '打开 AI 商品优化助手' : 'Open AI catalog assistant'}>
        <SparklesIcon className="h-5 w-5 transition-transform group-hover:rotate-12" />
        <span>{zh ? 'AI 优化' : 'AI Optimize'}</span>
      </button>
    </div>
  );
}
