'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowPathIcon,
  BoltIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  PlusIcon,
  ServerStackIcon,
  SignalIcon,
  SparklesIcon,
  TrashIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';
import AdminLayout from '@/components/admin/AdminLayout';
import AIClassificationReviewPanel from '@/components/admin/AIClassificationReviewPanel';
import {
  AIAgentConnectionTestResult,
  AIAgentProfile,
  AIAgentProfileWrite,
  AIAgentService,
  AIAgentSettings,
  AIAgentToolProbeResult,
  notifyAIAgentConfigChanged,
} from '@/services/ai-agent.service';
import { useAdminI18n } from '@/lib/admin-i18n';

type GlobalFormState = {
  enabled: boolean;
  seo_job_concurrency: number;
  seo_candidate_limit: number;
  default_product_price: number;
  default_warranty_period: string;
  default_lead_time: string;
};

type ProfileFormState = {
  id: number | null;
  name: string;
  base_url: string;
  api_key: string;
  clear_api_key: boolean;
  reuse_active_api_key: boolean;
  model: string;
  api_mode: 'standard_chat' | 'reasoning_chat';
  reasoning_effort: string;
  timeout_seconds: number;
  has_api_key: boolean;
  is_active: boolean;
};

const blankGlobalForm: GlobalFormState = {
  enabled: false,
  seo_job_concurrency: 2,
  seo_candidate_limit: 30000,
  default_product_price: 0,
  default_warranty_period: '12 months',
  default_lead_time: '3-7 days',
};

const modelSuggestions = [
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-5',
  'gpt-4.1',
  'o3',
  'deepseek-chat',
  'deepseek-reasoner',
];

type ProviderPreset = {
  key: string;
  label: string;
  labelZh?: string;
  baseURL: string;
  models: string[];
  reasoningModels?: string[];
};

// Every preset is an OpenAI-compatible chat endpoint; selecting one only
// pre-fills the form — administrators can still type any URL or model.
const providerPresets: ProviderPreset[] = [
  { key: 'openai', label: 'OpenAI', baseURL: 'https://api.openai.com/v1', models: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5', 'gpt-4.1'], reasoningModels: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5', 'o3'] },
  { key: 'deepseek', label: 'DeepSeek', baseURL: 'https://api.deepseek.com/v1', models: ['deepseek-chat'], reasoningModels: ['deepseek-reasoner'] },
  { key: 'moonshot', label: 'Kimi', labelZh: 'Kimi 月之暗面', baseURL: 'https://api.moonshot.cn/v1', models: ['kimi-k2-0905-preview', 'moonshot-v1-32k'] },
  { key: 'qwen', label: 'Qwen', labelZh: '通义千问', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen-max', 'qwen-plus', 'qwen-turbo'] },
  { key: 'zhipu', label: 'GLM', labelZh: '智谱 GLM', baseURL: 'https://open.bigmodel.cn/api/paas/v4', models: ['glm-4.6', 'glm-4.5-air'] },
  { key: 'xai', label: 'Grok (xAI)', baseURL: 'https://api.x.ai/v1', models: ['grok-4', 'grok-3-mini'] },
  { key: 'gemini', label: 'Gemini', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai', models: ['gemini-2.5-pro', 'gemini-2.5-flash'] },
  { key: 'openrouter', label: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1', models: ['openrouter/auto'] },
  { key: 'ollama', label: 'Ollama', labelZh: 'Ollama 本地', baseURL: 'http://127.0.0.1:11434/v1', models: ['qwen3:14b', 'llama3.3'] },
];

function presetForBaseURL(baseURL: string): ProviderPreset | undefined {
  const host = providerHost(baseURL);
  return providerPresets.find((preset) => providerHost(preset.baseURL) === host);
}

const reasoningSuggestions = ['', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

function errorMessage(error: unknown) {
  if (typeof error === 'object' && error !== null) {
    const item = error as { message?: unknown; response?: { data?: { error?: unknown; message?: unknown } } };
    const server = item.response?.data?.error || item.response?.data?.message;
    if (typeof server === 'string' && server) return server;
    if (typeof item.message === 'string' && item.message) return item.message;
  }
  return '';
}

function globalFormFromSettings(settings: AIAgentSettings): GlobalFormState {
  return {
    enabled: settings.enabled,
    seo_job_concurrency: settings.seo_job_concurrency || 2,
    seo_candidate_limit: settings.seo_candidate_limit || 30000,
    default_product_price: settings.default_product_price || 0,
    default_warranty_period: settings.default_warranty_period || '12 months',
    default_lead_time: settings.default_lead_time || '3-7 days',
  };
}

function profileFormFromProfile(profile: AIAgentProfile): ProfileFormState {
  return {
    id: profile.id,
    name: profile.name,
    base_url: profile.base_url,
    api_key: '',
    clear_api_key: false,
    reuse_active_api_key: false,
    model: profile.model,
    api_mode: profile.api_mode || 'standard_chat',
    reasoning_effort: profile.reasoning_effort || '',
    timeout_seconds: profile.timeout_seconds || 75,
    has_api_key: profile.has_api_key,
    is_active: profile.is_active,
  };
}

function newProfileForm(source?: AIAgentProfile): ProfileFormState {
  return {
    id: null,
    name: '',
    base_url: source?.base_url || 'https://api.openai.com/v1',
    api_key: '',
    clear_api_key: false,
    reuse_active_api_key: false,
    model: source?.model || '',
    api_mode: source?.api_mode || 'standard_chat',
    reasoning_effort: source?.reasoning_effort || '',
    timeout_seconds: source?.timeout_seconds || 75,
    has_api_key: false,
    is_active: false,
  };
}

function profileFingerprint(profile: ProfileFormState | null) {
  if (!profile) return '';
  return JSON.stringify({
    id: profile.id,
    name: profile.name,
    base_url: profile.base_url,
    api_key: profile.api_key,
    clear_api_key: profile.clear_api_key,
    reuse_active_api_key: profile.reuse_active_api_key,
    model: profile.model,
    api_mode: profile.api_mode,
    reasoning_effort: profile.reasoning_effort,
    timeout_seconds: profile.timeout_seconds,
  });
}

function providerHost(baseURL: string) {
  try {
    return new URL(baseURL).hostname;
  } catch {
    return baseURL;
  }
}

export default function AIAssistantSettingsPage() {
  const { locale, t } = useAdminI18n();
  const zh = locale === 'zh';
  const initialZh = useRef(zh);
  const [settings, setSettings] = useState<AIAgentSettings | null>(null);
  const [profiles, setProfiles] = useState<AIAgentProfile[]>([]);
  const [globalForm, setGlobalForm] = useState<GlobalFormState>(blankGlobalForm);
  const [profileForm, setProfileForm] = useState<ProfileFormState | null>(null);
  const [savedProfileFingerprint, setSavedProfileFingerprint] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingGlobal, setSavingGlobal] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [activatingProfile, setActivatingProfile] = useState(false);
  const [deletingProfileID, setDeletingProfileID] = useState<number | null>(null);
  const [testingConnection, setTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<AIAgentConnectionTestResult | null>(null);
  const [probingTools, setProbingTools] = useState(false);
  const [toolProbeResult, setToolProbeResult] = useState<AIAgentToolProbeResult | null>(null);

  const profileDirty = useMemo(
    () => profileFingerprint(profileForm) !== savedProfileFingerprint,
    [profileForm, savedProfileFingerprint],
  );

  const activePreset = useMemo(
    () => (profileForm ? presetForBaseURL(profileForm.base_url) : undefined),
    [profileForm],
  );

  const currentModelSuggestions = useMemo(() => {
    if (!activePreset) return modelSuggestions;
    const presetModels = [...activePreset.models, ...(activePreset.reasoningModels || [])];
    return Array.from(new Set([...presetModels, ...modelSuggestions]));
  }, [activePreset]);

  // A stale test verdict must never look like it covers edited settings.
  const providerFingerprint = profileForm
    ? `${profileForm.base_url}|${profileForm.model}|${profileForm.api_mode}|${profileForm.reasoning_effort}|${profileForm.api_key}`
    : '';
  useEffect(() => {
    setTestResult(null);
  }, [providerFingerprint]);

  useEffect(() => {
    Promise.all([AIAgentService.getSettings(), AIAgentService.listProfiles()])
      .then(([loadedSettings, loadedProfiles]) => {
        setSettings(loadedSettings);
        setGlobalForm(globalFormFromSettings(loadedSettings));
        setProfiles(loadedProfiles);
        const selected = loadedProfiles.find((profile) => profile.is_active) || loadedProfiles[0];
        const nextForm = selected ? profileFormFromProfile(selected) : newProfileForm();
        setProfileForm(nextForm);
        setSavedProfileFingerprint(profileFingerprint(nextForm));
      })
      .catch((error: unknown) => toast.error(
        errorMessage(error) || (initialZh.current ? '无法读取 AI 配置' : 'Could not load AI settings'),
      ))
      .finally(() => setLoading(false));
  }, []);

  const replaceSelectedProfile = (profile: AIAgentProfile) => {
    const nextForm = profileFormFromProfile(profile);
    setProfileForm(nextForm);
    setSavedProfileFingerprint(profileFingerprint(nextForm));
  };

  const selectProfile = (profile: AIAgentProfile) => {
    if (profileForm?.id === profile.id) return;
    if (profileDirty && !window.confirm(zh ? '放弃尚未保存的 AI 配置修改？' : 'Discard unsaved AI profile changes?')) return;
    replaceSelectedProfile(profile);
  };

  const startNewProfile = () => {
    if (profileDirty && !window.confirm(zh ? '放弃尚未保存的 AI 配置修改？' : 'Discard unsaved AI profile changes?')) return;
    const source = profiles.find((profile) => profile.is_active);
    const nextForm = newProfileForm(source);
    setProfileForm(nextForm);
    setSavedProfileFingerprint(profileFingerprint(nextForm));
  };

  const reloadProfiles = async (selectedID?: number) => {
    const [loadedSettings, loadedProfiles] = await Promise.all([
      AIAgentService.getSettings(),
      AIAgentService.listProfiles(),
    ]);
    setSettings(loadedSettings);
    setProfiles(loadedProfiles);
    const selected = loadedProfiles.find((profile) => profile.id === selectedID)
      || loadedProfiles.find((profile) => profile.is_active)
      || loadedProfiles[0];
    if (selected) replaceSelectedProfile(selected);
    return { loadedSettings, loadedProfiles };
  };

  const applyPreset = (preset: ProviderPreset) => {
    setProfileForm((current) => {
      if (!current) return current;
      const presetModels = [...preset.models, ...(preset.reasoningModels || [])];
      const otherPresetModels = providerPresets
        .filter((item) => item.key !== preset.key)
        .flatMap((item) => [...item.models, ...(item.reasoningModels || [])]);
      const keepModel = current.model.trim() !== ''
        && (presetModels.includes(current.model) || !otherPresetModels.includes(current.model));
      const defaultModel = current.api_mode === 'reasoning_chat' && preset.reasoningModels?.length
        ? preset.reasoningModels[0]
        : preset.models[0];
      return {
        ...current,
        base_url: preset.baseURL,
        model: keepModel ? current.model : defaultModel,
      };
    });
  };

  const testConnection = async () => {
    if (!profileForm) return;
    const typedKey = profileForm.api_key.trim();
    const reuseActiveID = profileForm.id === null && profileForm.reuse_active_api_key
      ? settings?.active_profile_id
      : undefined;
    const profileID = typedKey ? undefined : (profileForm.id ?? reuseActiveID ?? undefined);
    if (!typedKey && !profileID) {
      toast.error(zh ? '请先输入 API Key 再测试' : 'Enter an API key before testing');
      return;
    }
    setTestingConnection(true);
    setTestResult(null);
    try {
      const result = await AIAgentService.testConnection({
        profile_id: profileID,
        base_url: profileForm.base_url.trim(),
        api_key: typedKey || undefined,
        model: profileForm.model.trim(),
        api_mode: profileForm.api_mode,
        reasoning_effort: profileForm.reasoning_effort.trim(),
        timeout_seconds: Number(profileForm.timeout_seconds) || 75,
      });
      setTestResult(result);
      if (result.ok) {
        toast.success(zh ? `连接成功（${result.latency_ms}ms）` : `Connected in ${result.latency_ms}ms`);
      } else {
        toast.error(zh ? '连接失败，请检查配置' : 'Connection failed — check the settings');
      }
    } catch (error: unknown) {
      toast.error(errorMessage(error) || (zh ? '无法测试 AI 连接' : 'Could not test the AI connection'));
    } finally {
      setTestingConnection(false);
    }
  };

  // Asks the provider to call one read-only tool. The result tells the
  // administrator up front whether the agent loop can inspect the catalogue,
  // instead of discovering it when the first real question fails.
  const probeToolCalling = async () => {
    if (!profileForm) return;
    const typedKey = profileForm.api_key.trim();
    const reuseActiveID = profileForm.id === null && profileForm.reuse_active_api_key
      ? settings?.active_profile_id
      : undefined;
    const profileID = typedKey ? undefined : (profileForm.id ?? reuseActiveID ?? undefined);
    if (!typedKey && !profileID) {
      toast.error(zh ? '请先输入 API Key 再检测' : 'Enter an API key before probing');
      return;
    }
    setProbingTools(true);
    setToolProbeResult(null);
    try {
      const result = await AIAgentService.testToolCalling({
        profile_id: profileID,
        base_url: profileForm.base_url.trim(),
        api_key: typedKey || undefined,
        model: profileForm.model.trim(),
        api_mode: profileForm.api_mode,
        reasoning_effort: profileForm.reasoning_effort.trim(),
        timeout_seconds: Number(profileForm.timeout_seconds) || 75,
      });
      setToolProbeResult(result);
      if (result.ok) {
        toast.success(zh ? '支持工具调用，助手会实时查询商品库' : 'Tool calling works — the assistant can query the catalogue');
      } else if (result.tools_supported) {
        toast(zh ? '接口接受 tools，但模型没有主动调用' : 'The provider accepted tools but the model answered in text');
      } else if (!result.agent_tools_enabled) {
        toast(zh ? '当前部署已关闭工具调用' : 'Tool calling is disabled for this deployment');
      } else {
        toast(zh ? '该接口不支持 tools，会自动降级' : 'This provider rejects tools and will be downgraded automatically');
      }
    } catch (error: unknown) {
      toast.error(errorMessage(error) || (zh ? '无法检测工具调用' : 'Could not probe tool calling support'));
    } finally {
      setProbingTools(false);
    }
  };

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    if (!profileForm) return;
    setSavingProfile(true);
    try {
      const payload: AIAgentProfileWrite = {
        name: profileForm.name.trim(),
        base_url: profileForm.base_url.trim(),
        api_key: profileForm.api_key.trim() || undefined,
        clear_api_key: profileForm.clear_api_key,
        reuse_active_api_key: profileForm.id === null && profileForm.reuse_active_api_key,
        model: profileForm.model.trim(),
        api_mode: profileForm.api_mode,
        reasoning_effort: profileForm.reasoning_effort.trim(),
        timeout_seconds: Number(profileForm.timeout_seconds),
      };
      const saved = profileForm.id === null
        ? await AIAgentService.createProfile(payload)
        : await AIAgentService.updateProfile(profileForm.id, payload);
      await reloadProfiles(saved.id);
      notifyAIAgentConfigChanged();
      toast.success(zh ? 'AI 配置已保存' : 'AI profile saved');
    } catch (error: unknown) {
      toast.error(errorMessage(error) || (zh ? '保存 AI 配置失败' : 'Could not save AI profile'));
    } finally {
      setSavingProfile(false);
    }
  };

  const activateProfile = async () => {
    if (!profileForm?.id) return;
    if (profileDirty) {
      toast.error(zh ? '请先保存当前修改' : 'Save the current changes first');
      return;
    }
    if (!profileForm.has_api_key) {
      toast.error(zh ? '请先为该 AI 保存 API Key' : 'Save an API key for this AI first');
      return;
    }
    setActivatingProfile(true);
    try {
      await AIAgentService.activateProfile(profileForm.id);
      await reloadProfiles(profileForm.id);
      notifyAIAgentConfigChanged();
      toast.success(zh ? `已切换到 ${profileForm.name}` : `Switched to ${profileForm.name}`);
    } catch (error: unknown) {
      toast.error(errorMessage(error) || (zh ? '切换 AI 失败' : 'Could not switch AI profile'));
    } finally {
      setActivatingProfile(false);
    }
  };

  const deleteProfile = async (profile: AIAgentProfile) => {
    if (profile.is_active) return;
    if (!window.confirm(zh ? `删除 AI 配置“${profile.name}”？` : `Delete AI profile “${profile.name}”?`)) return;
    setDeletingProfileID(profile.id);
    try {
      await AIAgentService.deleteProfile(profile.id);
      const remaining = profiles.filter((item) => item.id !== profile.id);
      setProfiles(remaining);
      const active = remaining.find((item) => item.is_active) || remaining[0];
      if (profileForm?.id === profile.id && active) replaceSelectedProfile(active);
      toast.success(zh ? 'AI 配置已删除' : 'AI profile deleted');
    } catch (error: unknown) {
      toast.error(errorMessage(error) || (zh ? '删除 AI 配置失败' : 'Could not delete AI profile'));
    } finally {
      setDeletingProfileID(null);
    }
  };

  const saveGlobalSettings = async (event: FormEvent) => {
    event.preventDefault();
    setSavingGlobal(true);
    try {
      const saved = await AIAgentService.updateSettings({
        enabled: globalForm.enabled,
        seo_job_concurrency: Number(globalForm.seo_job_concurrency),
        seo_candidate_limit: Number(globalForm.seo_candidate_limit),
        default_product_price: Number(globalForm.default_product_price),
        default_warranty_period: globalForm.default_warranty_period,
        default_lead_time: globalForm.default_lead_time,
      });
      setSettings(saved);
      setGlobalForm(globalFormFromSettings(saved));
      notifyAIAgentConfigChanged();
      toast.success(zh ? 'AI 全局设置已保存' : 'Global AI settings saved');
    } catch (error: unknown) {
      toast.error(errorMessage(error) || (zh ? '保存全局设置失败' : 'Could not save global AI settings'));
    } finally {
      setSavingGlobal(false);
    }
  };

  return (
    <AdminLayout>
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="rounded-lg border border-gray-200 bg-white px-6 py-5 shadow-sm">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
              <SparklesIcon className="h-6 w-6" />
            </span>
            <div>
              <h1 className="text-2xl font-bold text-gray-950">{t('nav.aiAssistant', zh ? 'AI 助手' : 'AI Assistant')}</h1>
              <p className="mt-1 text-sm text-gray-600">
                {zh ? '管理 OpenAI-compatible AI 配置、模型和推理强度。' : 'Manage OpenAI-compatible providers, models, and reasoning effort.'}
              </p>
            </div>
          </div>
        </header>

        {loading || !profileForm ? (
          <div className="rounded-lg border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
            {zh ? '正在加载配置…' : 'Loading settings…'}
          </div>
        ) : (
          <>
            <section className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
              <aside className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
                  <div>
                    <h2 className="font-semibold text-gray-950">{zh ? '已保存的 AI' : 'Saved AIs'}</h2>
                    <p className="mt-0.5 text-xs text-gray-500">{profiles.length}/20</p>
                  </div>
                  <button
                    type="button"
                    onClick={startNewProfile}
                    disabled={profiles.length >= 20}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-violet-700 transition hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label={zh ? '新增 AI 配置' : 'Add AI profile'}
                    title={zh ? '新增 AI 配置' : 'Add AI profile'}
                  >
                    <PlusIcon className="h-5 w-5" />
                  </button>
                </div>
                <div className="divide-y divide-gray-100">
                  {profiles.map((profile) => (
                    <div key={profile.id} className={`flex items-stretch ${profileForm.id === profile.id ? 'bg-violet-50' : 'bg-white'}`}>
                      <button type="button" onClick={() => selectProfile(profile)} className="min-w-0 flex-1 px-4 py-3 text-left">
                        <span className="flex items-center gap-2">
                          <strong className="truncate text-sm text-gray-950">{profile.name}</strong>
                          {profile.is_active && <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-emerald-700">{zh ? '使用中' : 'Active'}</span>}
                        </span>
                        <span className="mt-1 block truncate text-xs text-gray-600">{profile.model}</span>
                        <span className="mt-0.5 block truncate text-[11px] text-gray-400">{providerHost(profile.base_url)}</span>
                      </button>
                      {!profile.is_active && (
                        <button
                          type="button"
                          onClick={() => deleteProfile(profile)}
                          disabled={deletingProfileID === profile.id}
                          className="flex w-10 items-center justify-center text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                          aria-label={zh ? `删除 ${profile.name}` : `Delete ${profile.name}`}
                          title={zh ? '删除配置' : 'Delete profile'}
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  ))}
                  {profiles.length === 0 && <p className="px-4 py-6 text-center text-sm text-gray-500">{zh ? '暂无配置' : 'No profiles yet'}</p>}
                </div>
              </aside>

              <form onSubmit={saveProfile} className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
                <div className="flex flex-col gap-3 border-b border-gray-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="font-semibold text-gray-950">{profileForm.id ? profileForm.name : (zh ? '新增 AI 配置' : 'New AI profile')}</h2>
                    <p className="mt-1 text-xs text-gray-500">
                      {profileForm.is_active ? (zh ? '当前请求正在使用此配置' : 'Current requests use this profile') : (zh ? '已保存后可切换使用' : 'Save this profile before activating it')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {profileForm.has_api_key ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700"><CheckCircleIcon className="h-4 w-4" />{zh ? 'Key 已保存' : 'Key saved'}</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700"><ExclamationTriangleIcon className="h-4 w-4" />{zh ? '缺少 Key' : 'No key'}</span>
                    )}
                  </div>
                </div>

                <div className="grid gap-4 p-5 md:grid-cols-2">
                  <div className="md:col-span-2">
                    <span className="text-sm font-medium text-gray-700">{zh ? 'AI 服务商（点击快速填入）' : 'Provider (click to prefill)'}</span>
                    <div className="mt-1.5 flex flex-wrap gap-2">
                      {providerPresets.map((preset) => {
                        const selected = activePreset?.key === preset.key;
                        return (
                          <button
                            key={preset.key}
                            type="button"
                            onClick={() => applyPreset(preset)}
                            aria-pressed={selected}
                            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${selected ? 'border-violet-500 bg-violet-600 text-white shadow-sm' : 'border-gray-300 bg-white text-gray-700 hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700'}`}
                            title={preset.baseURL}
                          >
                            {zh && preset.labelZh ? preset.labelZh : preset.label}
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-1.5 text-xs text-gray-500">
                      {zh ? '任何 OpenAI 兼容接口都可以接入；也可以直接手动填写 Base URL 和模型。' : 'Any OpenAI-compatible endpoint works; you can also type a base URL and model manually.'}
                    </p>
                  </div>
                  <label className="block text-sm font-medium text-gray-700">
                    {zh ? '配置名称' : 'Profile name'}
                    <input required maxLength={80} value={profileForm.name} onChange={(event) => setProfileForm((current) => current ? { ...current, name: event.target.value } : current)} placeholder={zh ? '例如：OpenAI 主模型' : 'e.g. OpenAI primary'} className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 font-normal outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100" />
                  </label>
                  <label className="block text-sm font-medium text-gray-700">
                    {zh ? '模型名称（可自由输入）' : 'Model name (free text)'}
                    <input required maxLength={120} list="ai-model-suggestions" spellCheck={false} value={profileForm.model} onChange={(event) => setProfileForm((current) => current ? { ...current, model: event.target.value } : current)} placeholder="provider/model-name" className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono font-normal outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100" />
                    <datalist id="ai-model-suggestions">{currentModelSuggestions.map((model) => <option key={model} value={model} />)}</datalist>
                  </label>
                  <label className="block text-sm font-medium text-gray-700 md:col-span-2">
                    API Base URL
                    <input required maxLength={500} type="url" value={profileForm.base_url} onChange={(event) => setProfileForm((current) => current ? { ...current, base_url: event.target.value } : current)} placeholder="https://api.openai.com/v1" className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm font-normal outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100" />
                  </label>
                  <label className="block text-sm font-medium text-gray-700">
                    {zh ? '推理强度（模型智商，可自由输入）' : 'Reasoning effort (free text)'}
                    <input maxLength={32} list="ai-reasoning-suggestions" spellCheck={false} value={profileForm.reasoning_effort} onChange={(event) => setProfileForm((current) => current ? { ...current, reasoning_effort: event.target.value } : current)} placeholder={zh ? '留空则不发送参数' : 'Blank omits the parameter'} className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono font-normal outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100" />
                    <datalist id="ai-reasoning-suggestions">{reasoningSuggestions.map((effort) => <option key={effort || 'compatibility'} value={effort}>{effort || (zh ? '兼容模式' : 'Compatibility')}</option>)}</datalist>
                  </label>
                  <fieldset className="block md:col-span-2">
                    <legend className="text-sm font-medium text-gray-700">{zh ? '请求兼容模式' : 'Request compatibility'}</legend>
                    <div className="mt-1.5 inline-flex w-full rounded-lg border border-gray-300 bg-gray-50 p-1 sm:w-auto">
                      {([
                        ['standard_chat', zh ? '标准聊天模型' : 'Standard chat'],
                        ['reasoning_chat', zh ? '推理模型' : 'Reasoning model'],
                      ] as const).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          aria-pressed={profileForm.api_mode === value}
                          onClick={() => setProfileForm((current) => current ? { ...current, api_mode: value } : current)}
                          className={`min-h-9 flex-1 rounded-md px-4 py-2 text-sm font-semibold transition-colors sm:flex-none ${profileForm.api_mode === value ? 'bg-white text-violet-700 shadow-sm' : 'text-gray-600 hover:text-gray-950'}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                  <label className="block text-sm font-medium text-gray-700">
                    {zh ? '请求超时（秒）' : 'Request timeout (seconds)'}
                    <input required min="15" max="180" type="number" value={profileForm.timeout_seconds} onChange={(event) => setProfileForm((current) => current ? { ...current, timeout_seconds: Number(event.target.value) } : current)} className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 font-normal outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100" />
                  </label>
                  <label className="block text-sm font-medium text-gray-700 md:col-span-2">
                    API Key
                    <input type="password" maxLength={4096} value={profileForm.api_key} onChange={(event) => setProfileForm((current) => current ? { ...current, api_key: event.target.value, clear_api_key: false, reuse_active_api_key: false } : current)} placeholder={profileForm.has_api_key ? (zh ? '留空保留当前 Key' : 'Leave blank to keep the saved key') : 'sk-...'} autoComplete="new-password" className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 font-normal outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100" />
                  </label>
                  {profileForm.id === null && settings?.has_api_key && (
                    <label className="inline-flex items-center gap-2 text-sm text-gray-700 md:col-span-2">
                      <input type="checkbox" checked={profileForm.reuse_active_api_key} onChange={(event) => setProfileForm((current) => current ? { ...current, reuse_active_api_key: event.target.checked, api_key: event.target.checked ? '' : current.api_key } : current)} className="rounded border-gray-300 text-violet-600 focus:ring-violet-500" />
                      {zh ? '沿用当前 AI 已保存的 API Key' : 'Reuse the active AI API key'}
                    </label>
                  )}
                  {profileForm.id !== null && profileForm.has_api_key && (
                    <label className="inline-flex items-center gap-2 text-sm text-red-700 md:col-span-2">
                      <input type="checkbox" checked={profileForm.clear_api_key} onChange={(event) => setProfileForm((current) => current ? { ...current, clear_api_key: event.target.checked, api_key: '' } : current)} className="rounded border-gray-300 text-red-600 focus:ring-red-500" />
                      {zh ? '删除此配置保存的 API Key' : 'Remove the saved API key from this profile'}
                    </label>
                  )}
                </div>

                <div className="border-t border-gray-200 bg-gray-50 px-5 py-4">
                  {testResult && (
                    <div className={`mb-3 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${testResult.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`}>
                      {testResult.ok ? <CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircleIcon className="mt-0.5 h-4 w-4 shrink-0" />}
                      <span className="min-w-0 break-words">
                        {testResult.ok
                          ? (zh
                            ? `连接成功：${testResult.model} · ${testResult.latency_ms}ms · ${testResult.provider}`
                            : `Connected: ${testResult.model} · ${testResult.latency_ms}ms · ${testResult.provider}`)
                          : (zh ? `连接失败：${testResult.error}` : `Failed: ${testResult.error}`)}
                      </span>
                    </div>
                  )}
                  {toolProbeResult && (
                    <div className={`mb-3 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${toolProbeResult.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : toolProbeResult.tools_supported ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-gray-200 bg-gray-50 text-gray-700'}`}>
                      {toolProbeResult.ok ? <CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0" /> : <InformationCircleIcon className="mt-0.5 h-4 w-4 shrink-0" />}
                      <span className="min-w-0 break-words">
                        {toolProbeResult.ok
                          ? (zh
                            ? `工具调用正常：${toolProbeResult.tools_called?.join(', ') || '—'} · ${toolProbeResult.latency_ms}ms`
                            : `Tool calling works: ${toolProbeResult.tools_called?.join(', ') || '—'} · ${toolProbeResult.latency_ms}ms`)
                          : (zh ? (toolProbeResult.error || toolProbeResult.hint) : (toolProbeResult.error || toolProbeResult.hint))}
                        {!toolProbeResult.ok && toolProbeResult.hint && toolProbeResult.error && (
                          <span className="mt-1 block text-xs opacity-80">{toolProbeResult.hint}</span>
                        )}
                      </span>
                    </div>
                  )}
                  <div className="flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      onClick={probeToolCalling}
                      disabled={probingTools || !profileForm.base_url.trim() || !profileForm.model.trim() || (!profileForm.api_key.trim() && !profileForm.has_api_key && !(profileForm.id === null && profileForm.reuse_active_api_key))}
                      className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                      title={zh ? '发送一条带 tools 的请求，检测该接口是否支持工具调用（助手会实时查库）' : 'Sends one request carrying tools to check whether the provider supports tool calling'}
                    >
                      {probingTools ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <SparklesIcon className="h-4 w-4" />}
                      {zh ? '检测工具调用' : 'Test tool calling'}
                    </button>
                    <button
                      type="button"
                      onClick={testConnection}
                      disabled={testingConnection || !profileForm.base_url.trim() || !profileForm.model.trim() || (!profileForm.api_key.trim() && !profileForm.has_api_key && !(profileForm.id === null && profileForm.reuse_active_api_key))}
                      className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                      title={zh ? '发送一条极小的测试请求验证 Key、模型和网络连通性' : 'Sends one tiny request to verify the key, model, and connectivity'}
                    >
                      {testingConnection ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <SignalIcon className="h-4 w-4" />}
                      {zh ? '测试连接' : 'Test connection'}
                    </button>
                    {profileForm.id !== null && !profileForm.is_active && (
                      <button type="button" onClick={activateProfile} disabled={activatingProfile || profileDirty || !profileForm.has_api_key} className="inline-flex items-center gap-2 rounded-lg border border-violet-300 bg-white px-4 py-2 text-sm font-semibold text-violet-700 hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-50">
                        {activatingProfile ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <BoltIcon className="h-4 w-4" />}
                        {zh ? '切换使用' : 'Activate'}
                      </button>
                    )}
                    <button disabled={savingProfile || !profileDirty} type="submit" className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50">
                      {savingProfile ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <ServerStackIcon className="h-4 w-4" />}
                      {profileForm.id ? (zh ? '保存配置' : 'Save profile') : (zh ? '保存新 AI' : 'Save new AI')}
                    </button>
                  </div>
                </div>
              </form>
            </section>

            <form onSubmit={saveGlobalSettings} className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
              <div className="flex flex-col gap-4 border-b border-gray-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="font-semibold text-gray-950">{zh ? 'AI 全局设置' : 'Global AI settings'}</h2>
                  <p className="mt-1 text-xs text-gray-500">{zh ? `当前使用：${settings?.active_profile_name || profiles.find((profile) => profile.is_active)?.name || '—'}` : `Active: ${settings?.active_profile_name || profiles.find((profile) => profile.is_active)?.name || '—'}`}</p>
                </div>
                <label className="inline-flex cursor-pointer items-center gap-3">
                  <span className="text-sm font-medium text-gray-700">{globalForm.enabled ? (zh ? '已启用' : 'Enabled') : (zh ? '已关闭' : 'Disabled')}</span>
                  <input type="checkbox" checked={globalForm.enabled} onChange={(event) => setGlobalForm((current) => ({ ...current, enabled: event.target.checked }))} className="h-5 w-5 rounded border-gray-300 text-violet-600 focus:ring-violet-500" />
                </label>
              </div>

              <div className="grid gap-4 p-5 md:grid-cols-3">
                <label className="block text-sm font-medium text-gray-700">
                  {zh ? '默认售价（USD）' : 'Default price (USD)'}
                  <input min="0" max="99999999.99" step="0.01" type="number" value={globalForm.default_product_price} onChange={(event) => setGlobalForm((current) => ({ ...current, default_product_price: Number(event.target.value) }))} className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 font-normal outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100" />
                </label>
                <label className="block text-sm font-medium text-gray-700">
                  {zh ? '默认质保' : 'Default warranty'}
                  <input required maxLength={50} value={globalForm.default_warranty_period} onChange={(event) => setGlobalForm((current) => ({ ...current, default_warranty_period: event.target.value }))} className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 font-normal outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100" />
                </label>
                <label className="block text-sm font-medium text-gray-700">
                  {zh ? '默认交期' : 'Default lead time'}
                  <input required maxLength={50} value={globalForm.default_lead_time} onChange={(event) => setGlobalForm((current) => ({ ...current, default_lead_time: event.target.value }))} className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 font-normal outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100" />
                </label>
              </div>

              <div className="grid gap-4 border-t border-gray-200 px-5 py-5 md:grid-cols-2">
                <label className="block text-sm font-medium text-gray-700">
                  {zh ? '每个 SEO 任务并行请求数' : 'Parallel SEO requests per job'}
                  <input min="1" max="50" type="number" value={globalForm.seo_job_concurrency} onChange={(event) => setGlobalForm((current) => ({ ...current, seo_job_concurrency: Number(event.target.value) }))} className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 font-normal outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100" />
                </label>
                <label className="block text-sm font-medium text-gray-700">
                  {zh ? '自动候选上限' : 'Automatic candidate limit'}
                  <input min="1" max="30000" type="number" value={globalForm.seo_candidate_limit} onChange={(event) => setGlobalForm((current) => ({ ...current, seo_candidate_limit: Number(event.target.value) }))} className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 font-normal outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100" />
                </label>
              </div>

              <div className="flex flex-col gap-3 border-t border-gray-200 bg-gray-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <span className="inline-flex items-start gap-2 text-xs leading-5 text-gray-600"><InformationCircleIcon className="mt-0.5 h-4 w-4 shrink-0" />{zh ? '默认售价为 0 时，AI 不会创建无依据价格的产品草稿。' : 'A zero default price prevents AI from creating product drafts with unsupported prices.'}</span>
                <button disabled={savingGlobal} type="submit" className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50">
                  {savingGlobal ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <ServerStackIcon className="h-4 w-4" />}
                  {zh ? '保存全局设置' : 'Save global settings'}
                </button>
              </div>
            </form>

            <AIClassificationReviewPanel />
          </>
        )}
      </div>
    </AdminLayout>
  );
}
