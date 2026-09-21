'use client';

import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react';
import {
  ArrowPathIcon,
  ArrowsPointingInIcon,
  Bars3Icon,
  ChatBubbleLeftRightIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ClockIcon,
  CurrencyDollarIcon,
  ExclamationTriangleIcon,
  PaperAirplaneIcon,
  SparklesIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';
import {
  AIAgentAction,
  AI_AGENT_CONFIG_CHANGED_EVENT,
  AIAgentConversationSummary,
  AIAgentMessage,
  AIAgentReply,
  AIAgentService,
  AIAgentStatus,
  AIAgentStreamHandlers,
  AIAgentStreamStep,
} from '@/services/ai-agent.service';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAdminI18n } from '@/lib/admin-i18n';
import { useDraggableWidget } from '@/hooks/useDraggableWidget';
import AIPriceSyncPanel from '@/components/admin/AIPriceSyncPanel';

// Remembered per browser so the widget stays where the administrator parked it.
const AI_AGENT_POSITION_STORAGE_KEY = 'vibocnc.ai-assistant.position';

// The widget's open state and active conversation are remembered per browser
// tab so a route change (every page mounts its own AdminLayout copy) no longer
// collapses the panel or loses the chat, and a refresh can re-attach.
const AI_AGENT_SESSION_STORAGE_KEY = 'vibocnc.ai-assistant.session';

type StoredAssistantSession = { open: boolean; conversationId: number | null };

function readStoredAssistantSession(): StoredAssistantSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(AI_AGENT_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredAssistantSession>;
    return {
      open: Boolean(parsed.open),
      conversationId: typeof parsed.conversationId === 'number' && parsed.conversationId > 0 ? parsed.conversationId : null,
    };
  } catch {
    return null;
  }
}

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

// Streaming chat state for the in-flight run. It becomes the completed
// message's step timeline once the final proposal arrives.
type LiveAssistantState = {
  stage: string;
  steps: AIAgentStreamStep[];
  notes: string[];
  text: string;
};

const emptyLiveState = (): LiveAssistantState => ({ stage: 'thinking', steps: [], notes: [], text: '' });

function formatStepDuration(durationMs: number) {
  if (durationMs >= 1000) return `${(durationMs / 1000).toFixed(1)}s`;
  return `${durationMs}ms`;
}

function formatConversationTime(value: string | undefined) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function StepStatusIcon({ status }: { status: AIAgentStreamStep['status'] }) {
  if (status === 'ok') return <CheckCircleIcon className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" />;
  if (status === 'error') return <ExclamationTriangleIcon className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden="true" />;
  return <ArrowPathIcon className="h-3.5 w-3.5 shrink-0 animate-spin text-violet-500" aria-hidden="true" />;
}

// One line per tool execution with status and duration, mirroring the live
// agent run the backend reports through the streaming endpoint.
function AssistantSteps({ steps, zh }: { steps: AIAgentStreamStep[]; zh: boolean }) {
  if (steps.length === 0) return null;
  return (
    <ul className="mb-1.5 space-y-0.5 border-b border-slate-100 pb-1.5 text-[11px] leading-5" aria-label={zh ? '执行步骤' : 'Execution steps'}>
      {steps.map((step) => (
        <li key={step.id} className="flex items-center gap-1.5 text-slate-500">
          <StepStatusIcon status={step.status} />
          <span className={`shrink-0 font-medium ${step.status === 'error' ? 'text-amber-700' : 'text-slate-600'}`}>
            {toolLabels[step.tool]?.[zh ? 'zh' : 'en'] || step.tool}
          </span>
          {step.detail && <span className="truncate text-slate-400">{step.detail}</span>}
          {step.status === 'running' && <span className="shrink-0 text-violet-500">{zh ? '执行中…' : 'running…'}</span>}
          {step.status === 'ok' && <span className="shrink-0 text-slate-400">{formatStepDuration(step.duration_ms ?? 0)}</span>}
          {step.status === 'error' && step.error && <span className="truncate text-amber-600">{step.error}</span>}
        </li>
      ))}
    </ul>
  );
}

// Answers are rendered as Markdown. react-markdown never injects raw HTML, so
// model output stays inert; the components map keeps the typography compact
// inside the chat bubble.
const markdownComponents: Components = {
  h1: ({ children }) => <h3 className="mb-1 mt-3 text-sm font-semibold first:mt-0">{children}</h3>,
  h2: ({ children }) => <h4 className="mb-1 mt-3 text-sm font-semibold first:mt-0">{children}</h4>,
  h3: ({ children }) => <h5 className="mb-1 mt-2 text-xs font-semibold first:mt-0">{children}</h5>,
  h4: ({ children }) => <h5 className="mb-1 mt-2 text-xs font-semibold first:mt-0">{children}</h5>,
  p: ({ children }) => <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-1.5 list-disc space-y-0.5 pl-5 first:mt-0 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="my-1.5 list-decimal space-y-0.5 pl-5 first:mt-0 last:mb-0">{children}</ol>,
  li: ({ children }) => <li className="leading-5">{children}</li>,
  code: ({ children }) => <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px] text-slate-800">{children}</code>,
  pre: ({ children }) => <pre className="my-2 overflow-x-auto rounded-md bg-slate-900 p-2 font-mono text-[11px] leading-4 text-slate-100">{children}</pre>,
  a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer" className="text-violet-700 underline">{children}</a>,
  table: ({ children }) => <div className="my-2 overflow-x-auto"><table className="w-full border-collapse text-[11px]">{children}</table></div>,
  th: ({ children }) => <th className="border border-slate-200 bg-slate-50 px-1.5 py-1 text-left font-semibold">{children}</th>,
  td: ({ children }) => <td className="border border-slate-200 px-1.5 py-1 align-top">{children}</td>,
  blockquote: ({ children }) => <blockquote className="my-1.5 border-l-2 border-slate-300 pl-2 text-slate-600">{children}</blockquote>,
  hr: () => <hr className="my-2 border-slate-200" />,
};

function MarkdownBlock({ content }: { content: string }) {
  return (
    <div className="ai-markdown break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

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
  const [hydrated, setHydrated] = useState(false);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState<AIAgentConversationSummary[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [mode, setMode] = useState<'assistant' | 'prices'>('assistant');
  const [status, setStatus] = useState<AIAgentStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [messages, setMessages] = useState<AIAgentMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [applyingKey, setApplyingKey] = useState<string | null>(null);
  const [appliedKeys, setAppliedKeys] = useState<string[]>([]);
  const [live, setLive] = useState<LiveAssistantState | null>(null);
  const liveRef = useRef<LiveAssistantState | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const drag = useDraggableWidget(AI_AGENT_POSITION_STORAGE_KEY);
  const abortRef = useRef<AbortController | null>(null);
  const sendingRef = useRef(false);
  const lastLoadedConversationRef = useRef<number | null>(null);

  // Streaming state mirrors the in-flight run so it can become the completed
  // message (including its step timeline) once the final proposal arrives.
  const updateLive = (mutate: (current: LiveAssistantState) => LiveAssistantState) => {
    if (!liveRef.current) return;
    liveRef.current = mutate(liveRef.current);
    setLive(liveRef.current);
  };

  // Rebuilds the handler set for a streamed run; shared by first sends and by
  // re-attaches after a refresh.
  const streamHandlers = (): AIAgentStreamHandlers => ({
    onStage: (stage) => updateLive((current) => ({ ...current, stage })),
    onStepStart: (step) => updateLive((current) => ({ ...current, steps: [...current.steps, { ...step, status: 'running' as const }] })),
    onStepEnd: (step) => updateLive((current) => ({
      ...current,
      steps: current.steps.map((item) => (item.id === step.id ? { ...item, status: step.status, duration_ms: step.duration_ms, error: step.error } : item)),
    })),
    onNote: (noteText) => updateLive((current) => ({ ...current, notes: [...current.notes, noteText] })),
    onDelta: (deltaText) => updateLive((current) => ({ ...current, text: current.text + deltaText })),
  });

  const messageFromReply = (reply: AIAgentReply, steps: AIAgentStreamStep[]): AIAgentMessage => ({
    role: 'assistant',
    content: reply.reply,
    suggestions: reply.suggestions || [],
    toolCalls: reply.tool_calls || [],
    steps,
  });

  const resumeConversation = async (id: number) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setSending(true);
    liveRef.current = emptyLiveState();
    setLive(liveRef.current);
    try {
      const reply = await AIAgentService.resumeStream(id, 0, streamHandlers(), controller.signal);
      if (reply) {
        setMessages((previous) => [...previous, messageFromReply(reply, liveRef.current?.steps || [])]);
      } else {
        // The run finished while reconnecting; reload the stored messages.
        const data = await AIAgentService.conversation(id);
        setMessages(data.messages.map((item) => ({ role: item.role, content: item.content, suggestions: item.suggestions || [], toolCalls: item.tool_calls || [], steps: item.steps || [] })));
      }
    } catch (error: unknown) {
      if (!controller.signal.aborted) {
        toast.error(errorMessage(error) || (zh ? 'AI 回答恢复失败，请重试' : 'Could not resume the AI answer'));
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        liveRef.current = null;
        setLive(null);
        setSending(false);
      }
    }
  };

  const loadConversation = async (id: number) => {
    try {
      const data = await AIAgentService.conversation(id);
      setMessages(data.messages.map((item) => ({ role: item.role, content: item.content, suggestions: item.suggestions || [], toolCalls: item.tool_calls || [], steps: item.steps || [] })));
      setAppliedKeys([]);
      if (data.status === 'generating') {
        await resumeConversation(id);
      }
    } catch (error: unknown) {
      // The conversation disappeared (deleted in another tab); drop the pointer.
      lastLoadedConversationRef.current = null;
      setConversationId(null);
      toast.error(errorMessage(error) || (zh ? '无法读取历史会话' : 'Could not load the conversation'));
    }
  };

  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      setHistoryItems(await AIAgentService.conversations());
    } catch (error: unknown) {
      toast.error(errorMessage(error) || (zh ? '无法读取历史会话' : 'Could not load chat history'));
    } finally {
      setHistoryLoading(false);
    }
  };

  const toggleHistory = () => {
    const next = !historyOpen;
    setHistoryOpen(next);
    if (next) {
      setHistoryItems(null);
      void loadHistory();
    }
  };

  const selectConversation = (id: number) => {
    if (sending) return;
    setHistoryOpen(false);
    if (id === conversationId) return;
    setMessages([]);
    setAppliedKeys([]);
    setConversationId(id);
  };

  const removeConversation = async (id: number) => {
    if (sending) return;
    if (typeof window !== 'undefined' && !window.confirm(zh ? '删除这个会话？此操作不可撤销。' : 'Delete this conversation? This cannot be undone.')) return;
    try {
      await AIAgentService.deleteConversation(id);
      setHistoryItems((previous) => (previous ? previous.filter((item) => item.id !== id) : previous));
      if (id === conversationId) {
        lastLoadedConversationRef.current = null;
        setMessages([]);
        setConversationId(null);
      }
    } catch (error: unknown) {
      toast.error(errorMessage(error) || (zh ? '删除会话失败' : 'Could not delete the conversation'));
    }
  };

  // Session state survives route changes: every admin page mounts its own
  // AdminLayout copy, so the widget restores its open flag and conversation
  // from per-tab storage instead of collapsing.
  useEffect(() => {
    const stored = readStoredAssistantSession();
    if (stored) {
      setOpen(stored.open);
      setConversationId(stored.conversationId);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.sessionStorage.setItem(AI_AGENT_SESSION_STORAGE_KEY, JSON.stringify({ open, conversationId }));
    } catch {
      // Storage disabled (private mode); the widget still works within a page.
    }
  }, [hydrated, open, conversationId]);

  useEffect(() => {
    sendingRef.current = sending;
  }, [sending]);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  useEffect(() => {
    if (!hydrated || conversationId === null) {
      if (conversationId === null) lastLoadedConversationRef.current = null;
      return;
    }
    if (lastLoadedConversationRef.current === conversationId) return;
    if (sendingRef.current) return;
    lastLoadedConversationRef.current = conversationId;
    void loadConversation(conversationId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, conversationId]);

  // Opening the panel replaces the compact launcher with a much larger surface,
  // so the stored spot has to be re-anchored and re-checked against the viewport.
  // Switching tabs resizes the panel too, so it gets the same treatment.
  useEffect(() => {
    drag.reclamp();
  }, [open, mode, drag.reclamp]);

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
  }, [messages, sending, open, live]);

  const send = async (event?: FormEvent, suggested?: string) => {
    event?.preventDefault();
    const text = (suggested || input).trim();
    if (!text || sending || !status?.configured) return;
    const userMessage: AIAgentMessage = { role: 'user', content: text };
    setMessages((previous) => [...previous, userMessage]);
    setInput('');
    setSending(true);
    setHistoryOpen(false);
    liveRef.current = emptyLiveState();
    setLive(liveRef.current);

    const finalize = (reply: AIAgentReply) => {
      const steps = liveRef.current?.steps || [];
      setMessages((previous) => [...previous, messageFromReply(reply, steps)]);
    };

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const requestedConversation = conversationId;

    try {
      let reply: AIAgentReply;
      try {
        reply = await AIAgentService.chatStream(text, {
          conversationId: requestedConversation,
          signal: controller.signal,
          handlers: {
            ...streamHandlers(),
            onHello: (info) => {
              if (Number.isFinite(info.conversation_id) && info.conversation_id > 0) {
                setConversationId(info.conversation_id);
              }
            },
          },
        });
      } catch (streamError) {
        // A stream that failed before anything was shown (older backend,
        // proxy hiccup) silently falls back to the classic chat endpoint;
        // once output is on screen the error is surfaced instead of
        // discarding a run the administrator is watching.
        const partial = liveRef.current;
        const hadOutput = Boolean(partial && (partial.text || partial.steps.length > 0 || partial.notes.length > 0));
        if (hadOutput) throw streamError;
        reply = await AIAgentService.chat(text, { conversationId: requestedConversation, history: messages });
      }
      if (reply.conversation_id) setConversationId(reply.conversation_id);
      finalize(reply);
    } catch (error: unknown) {
      if (controller.signal.aborted) return;
      const detail = errorMessage(error);
      toast.error(detail || (zh ? 'AI 暂时无法生成建议' : 'AI could not generate a proposal'));
      setMessages((previous) => previous.filter((item) => item !== userMessage));
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        liveRef.current = null;
        setLive(null);
        setSending(false);
      }
    }
  };

  // Enter sends and Shift+Enter inserts a newline; both keys are ignored while
  // an IME composition is being committed (Chinese input).
  const handleInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    event.preventDefault();
    void send();
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
    abortRef.current?.abort();
    setMessages([]);
    setAppliedKeys([]);
    setInput('');
    setHistoryOpen(false);
    lastLoadedConversationRef.current = null;
    setConversationId(null);
    liveRef.current = null;
    setLive(null);
  };

  // The launcher starts life bottom-right; `position` is null until it has been
  // measured on the client, and the class fallback covers that first paint.
  const positioned = drag.position !== null;

  return (
    <div
      ref={drag.containerRef}
      // No transition on left/top: a drag must track the cursor exactly, and an
      // animated clamp would leave the panel hanging outside the viewport for the
      // duration of the animation.
      className={`fixed z-[70] print:hidden ${positioned ? '' : 'bottom-4 right-4'} ${drag.isDragging ? 'select-none' : ''}`}
      style={positioned ? { left: drag.position?.x, top: drag.position?.y } : undefined}
    >
      {open && (
        <section
          className="flex h-[min(720px,calc(100vh-2.5rem))] w-[min(560px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-violet-200 bg-white shadow-2xl"
          aria-label={zh ? 'AI 商品优化助手' : 'AI catalog optimization assistant'}
        >
          <header
            {...drag.handleProps()}
            onDoubleClick={drag.resetPosition}
            title={zh ? '拖动可移动窗口；双击归位' : 'Drag to move; double-click to reset'}
            className={`flex touch-none cursor-move items-center justify-between bg-gradient-to-r from-violet-700 to-indigo-700 px-4 py-3 text-white select-none ${
              drag.isDragging ? 'cursor-grabbing' : ''
            }`}
          >
            <div className="flex items-center gap-2">
              {/*
                Both the visual affordance for dragging and the keyboard handle:
                arrow keys (with Shift for a bigger step) nudge the window, Home
                sends it back to the bottom-right corner.
              */}
              <button
                type="button"
                {...drag.handleProps()}
                onKeyDown={drag.onHandleKeyDown}
                className={`-ml-1 shrink-0 cursor-grab rounded p-1 text-violet-200 hover:bg-white/15 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${
                  drag.isDragging ? 'cursor-grabbing' : ''
                }`}
                title={zh ? '按住拖动窗口；方向键微调，Home 键归位' : 'Press and drag to move; arrow keys to nudge, Home to reset'}
                aria-label={zh ? '移动 AI 助手窗口' : 'Move the AI assistant window'}
              >
                <Bars3Icon className="h-4 w-4" aria-hidden="true" />
              </button>
              <SparklesIcon className="h-5 w-5" />
              <div>
                <h2 className="text-sm font-semibold">{zh ? 'AI 商品优化助手' : 'AI Catalog Assistant'}</h2>
                <p className="text-[11px] text-violet-100">{status?.configured ? `${status.provider || 'OpenAI compatible'} · ${status.model}` : (zh ? '分类、SEO 与多语言优化' : 'Categories, SEO and localization')}</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {mode === 'assistant' && <button type="button" onClick={toggleHistory} className={`rounded p-1.5 hover:bg-white/15 ${historyOpen ? 'bg-white/15' : ''}`} title={zh ? '历史会话' : 'Chat history'} aria-label={zh ? '历史会话' : 'Chat history'}><ClockIcon className="h-4 w-4" /></button>}
              {mode === 'assistant' && <button type="button" onClick={reset} className="rounded p-1.5 hover:bg-white/15" title={zh ? '新对话' : 'New conversation'} aria-label={zh ? '新对话' : 'New conversation'}><ArrowPathIcon className="h-4 w-4" /></button>}
              <button type="button" onClick={drag.resetPosition} className="rounded p-1.5 hover:bg-white/15" title={zh ? '窗口归位到右下角' : 'Reset window position'} aria-label={zh ? '窗口归位到右下角' : 'Reset window position'}><ArrowsPointingInIcon className="h-4 w-4" /></button>
              <button type="button" onClick={() => { drag.captureAnchor(); setOpen(false); }} className="rounded p-1.5 hover:bg-white/15" aria-label={zh ? '关闭' : 'Close'}><XMarkIcon className="h-5 w-5" /></button>
            </div>
          </header>

          <div className="grid grid-cols-2 border-b border-gray-200 bg-white p-1" role="tablist" aria-label={zh ? '优化模式' : 'Optimization mode'}>
            <button type="button" role="tab" aria-selected={mode === 'assistant'} onClick={() => setMode('assistant')} className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold ${mode === 'assistant' ? 'bg-violet-100 text-violet-800' : 'text-gray-600 hover:bg-gray-50'}`}><ChatBubbleLeftRightIcon className="h-4 w-4" />{zh ? '目录与 SEO' : 'Catalog & SEO'}</button>
            <button type="button" role="tab" aria-selected={mode === 'prices'} onClick={() => setMode('prices')} className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold ${mode === 'prices' ? 'bg-emerald-100 text-emerald-800' : 'text-gray-600 hover:bg-gray-50'}`}><CurrencyDollarIcon className="h-4 w-4" />{zh ? '价格同步' : 'Price sync'}</button>
          </div>

          {mode === 'assistant' && historyOpen && (
            <div className="max-h-56 overflow-y-auto border-b border-gray-200 bg-white p-2" aria-label={zh ? '历史会话' : 'Chat history'}>
              {historyLoading && <p className="px-2 py-3 text-center text-xs text-gray-500">{zh ? '正在加载历史会话…' : 'Loading chat history…'}</p>}
              {!historyLoading && historyItems && historyItems.length === 0 && (
                <p className="px-2 py-3 text-center text-xs text-gray-500">{zh ? '暂无历史会话' : 'No conversations yet'}</p>
              )}
              {!historyLoading && historyItems && historyItems.map((item) => (
                <div key={item.id} className={`flex items-center gap-1 rounded-md px-1 ${item.id === conversationId ? 'bg-violet-50' : 'hover:bg-gray-50'}`}>
                  <button type="button" onClick={() => selectConversation(item.id)} className="min-w-0 flex-1 px-1.5 py-2 text-left">
                    <span className="block truncate text-xs font-medium text-gray-800">{item.title || (zh ? '未命名会话' : 'Untitled conversation')}</span>
                    <span className="mt-0.5 block text-[10px] text-gray-400">{formatConversationTime(item.updated_at)}{item.status === 'generating' ? ` · ${zh ? '生成中…' : 'generating…'}` : ''}</span>
                  </button>
                  <button type="button" onClick={() => removeConversation(item.id)} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-500" aria-label={zh ? '删除会话' : 'Delete conversation'}><TrashIcon className="h-3.5 w-3.5" /></button>
                </div>
              ))}
            </div>
          )}
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
                {message.role === 'user' ? (
                  <div className="rounded-xl bg-violet-600 px-3 py-2 text-sm leading-6 whitespace-pre-wrap text-white">{message.content}</div>
                ) : (
                  <div className="rounded-xl border border-gray-100 bg-white px-3 py-2 text-sm leading-6 text-gray-800 shadow-sm">
                    {message.steps && message.steps.length > 0 && <AssistantSteps steps={message.steps} zh={zh} />}
                    <MarkdownBlock content={message.content} />
                  </div>
                )}
                {message.role === 'assistant' && !(message.steps && message.steps.length > 0) && message.toolCalls && message.toolCalls.length > 0 && (
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
            {sending && live && (
              <div className="mr-3">
                <div className="rounded-xl border border-violet-100 bg-white px-3 py-2 text-sm shadow-sm">
                  <AssistantSteps steps={live.steps} zh={zh} />
                  {live.notes.length > 0 && (
                    <div className="mb-1.5 space-y-0.5 border-b border-slate-100 pb-1.5 text-xs leading-5 text-slate-400">
                      {live.notes.map((note, noteIndex) => <p key={noteIndex} className="whitespace-pre-wrap">{note}</p>)}
                    </div>
                  )}
                  {live.text ? (
                    <div className="text-gray-800">
                      <MarkdownBlock content={live.text} />
                      <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-violet-500 align-[-2px]" aria-hidden="true" />
                    </div>
                  ) : (
                    live.steps.length === 0 && live.notes.length === 0 && (
                      <p className="text-xs text-gray-400">{live.stage === 'answering' ? (zh ? '正在生成回答…' : 'Writing the answer…') : (zh ? '正在思考并检索目录…' : 'Thinking and checking the catalogue…')}</p>
                    )
                  )}
                </div>
              </div>
            )}
            {sending && !live && <div className="mr-8 rounded-xl border border-gray-100 bg-white px-3 py-2 text-sm text-gray-500 shadow-sm">{zh ? '正在检索目录并分析分类和 SEO…' : 'Checking the catalogue, then analyzing categories and SEO…'}</div>}
            <div ref={bottomRef} />
          </div>

          <form onSubmit={send} className="border-t border-gray-200 bg-white p-3">
            <div className="flex items-end gap-2 rounded-xl border border-gray-300 bg-white p-1.5 focus-within:border-violet-500 focus-within:ring-2 focus-within:ring-violet-100">
              <textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={handleInputKeyDown} disabled={!status?.configured || sending} rows={2} maxLength={4000} aria-label={zh ? 'AI 优化指令' : 'AI optimization instruction'} placeholder={zh ? '直接输入型号，例如 A06B-xxxx' : 'Enter a model, for example A06B-xxxx'} className="min-h-[42px] flex-1 resize-none border-0 bg-transparent px-2 py-1 text-sm outline-none placeholder:text-gray-400 disabled:cursor-not-allowed" />
              <button type="submit" disabled={!input.trim() || !status?.configured || sending} className="rounded-lg bg-violet-600 p-2 text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-gray-300" aria-label={zh ? '发送' : 'Send'}><PaperAirplaneIcon className="h-4 w-4" /></button>
            </div>
            <p className="mt-1.5 text-[11px] text-gray-400">{status?.product_creation_ready ? (zh ? `产品草稿默认售价 ${status.default_product_price} USD；确认后创建但不发布。` : `Product draft default: ${status.default_product_price} USD; created only after confirmation and kept unpublished.`) : (zh ? '尚未设置默认售价；AI 可分析，但不会创建产品。' : 'No default price is configured; AI can analyze but cannot create products.')}</p>
            <p className="mt-0.5 text-[11px] text-gray-400">{zh ? 'Enter 发送，Shift+Enter 换行' : 'Enter to send, Shift+Enter for a new line'}</p>
          </form>
          </>}
        </section>
      )}
      {/*
        The launcher is hidden while the panel is open: the panel already has a
        close button, and a second floating control next to it only covers more
        of the page. When idle it is a small, semi-transparent circle rather than a
        full pill, so it stops sitting on top of the table behind it, and the
        label appears on hover instead of occupying space permanently.
      */}
      {!open && (
        <button
          type="button"
          /*
            Three ways in, because no single event covers every input device:
            - pointerup: mouse and touch taps (a touch tap may never produce a click)
            - click: Enter/Space on the focused button, which sends no pointer events
            - shouldSuppressClick: a mouse drag ends with a click on this same
              button, which must not be mistaken for a tap
            Opening twice is harmless, so the overlap is left in place.
          */
          {...drag.handleProps({
            onTap: () => {
              drag.captureAnchor();
              setOpen(true);
            },
          })}
          onKeyDown={drag.onHandleKeyDown}
          onClick={() => {
            if (drag.shouldSuppressClick()) return;
            drag.captureAnchor();
            setOpen(true);
          }}
          className={`group relative flex h-12 w-12 touch-none items-center justify-center rounded-full bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-xl transition hover:scale-105 hover:from-violet-700 hover:to-indigo-700 focus:outline-none focus-visible:ring-4 focus-visible:ring-violet-200 ${
            drag.isDragging ? 'cursor-grabbing opacity-100' : 'cursor-grab opacity-70 hover:opacity-100 focus-visible:opacity-100'
          }`}
          aria-haspopup="dialog"
          aria-label={zh ? '打开 AI 商品优化助手（可拖动）' : 'Open AI catalog assistant (draggable)'}
        >
          <SparklesIcon className="h-5 w-5 transition-transform group-hover:rotate-12" />
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute right-full top-1/2 mr-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-slate-900/90 px-2 py-1 text-xs font-medium text-white ${
              drag.isDragging ? 'opacity-0' : 'opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100'
            }`}
          >
            {zh ? 'AI 优化 · 可拖动' : 'AI Optimize · draggable'}
          </span>
        </button>
      )}
    </div>
  );
}
