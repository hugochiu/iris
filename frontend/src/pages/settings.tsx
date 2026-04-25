import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, ChevronDown, ChevronRight, X } from 'lucide-react';
import {
  api,
  type ModelMapping,
  type OpenRouterModel,
  type OpenRouterProvider,
  type ProviderRouting,
} from '@/lib/api';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

type Tier = keyof ModelMapping;
const TIERS: { tier: Tier; label: string; hint: string }[] = [
  { tier: 'opus', label: 'Opus', hint: '客户端请求里包含 "opus" 时路由到的模型' },
  { tier: 'sonnet', label: 'Sonnet', hint: '客户端请求里包含 "sonnet" 时路由到的模型' },
  { tier: 'haiku', label: 'Haiku', hint: '客户端请求里包含 "haiku" 时路由到的模型' },
];

const EMPTY: ModelMapping = { opus: '', sonnet: '', haiku: '' };

function formatCtx(n: number): string {
  if (n >= 1_000_000) {
    const v = n / 1_000_000;
    return (v >= 10 ? v.toFixed(0) : v.toFixed(1).replace(/\.0$/, '')) + 'M';
  }
  if (n >= 1_000) return Math.round(n / 1_000) + 'k';
  return String(n);
}

function formatPrice(n: number | undefined): string {
  if (n == null) return '—';
  if (n === 0) return '0';
  if (n >= 100) return n.toFixed(0);
  if (n >= 1) return n.toFixed(n < 10 ? 2 : 1).replace(/\.?0+$/, '');
  return n.toFixed(2).replace(/\.?0+$/, '') || n.toString();
}

export function SettingsPage() {
  const qc = useQueryClient();
  const mappingQ = useQuery({
    queryKey: ['settings', 'mapping'],
    queryFn: () => api.settings.getMapping(),
  });
  const modelsQ = useQuery({
    queryKey: ['settings', 'openrouter-models'],
    queryFn: () => api.settings.listOpenRouterModels(),
    staleTime: 10 * 60 * 1000,
  });

  const [draft, setDraft] = useState<ModelMapping>(EMPTY);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (mappingQ.data) setDraft(mappingQ.data);
  }, [mappingQ.data]);

  const mutation = useMutation({
    mutationFn: (m: ModelMapping) => api.settings.setMapping(m),
    onSuccess: (data) => {
      qc.setQueryData(['settings', 'mapping'], data);
      setDraft(data);
      setSavedAt(Date.now());
    },
  });

  const dirty = useMemo(() => {
    const base = mappingQ.data ?? EMPTY;
    return (['opus', 'sonnet', 'haiku'] as Tier[]).some((t) => draft[t] !== base[t]);
  }, [draft, mappingQ.data]);

  const allModels = modelsQ.data?.items ?? [];

  return (
    <div className="space-y-4 max-w-3xl">
      <Card>
        <CardHeader>
          <CardTitle>OpenRouter Model Mapping</CardTitle>
          <p className="text-xs text-muted mt-1">
            将 Claude Code 发来的 opus/sonnet/haiku 请求分别路由到指定的 OpenRouter 模型。留空则透传原始模型。
          </p>
        </CardHeader>
        <CardBody>
          <div className="space-y-4">
            {TIERS.map(({ tier, label, hint }) => (
              <ModelField
                key={tier}
                label={label}
                hint={hint}
                value={draft[tier]}
                onChange={(v) => setDraft((d) => ({ ...d, [tier]: v }))}
                models={allModels}
                loading={modelsQ.isLoading}
                error={modelsQ.error ? String(modelsQ.error) : null}
              />
            ))}
          </div>

          <div className="mt-6 flex items-center gap-3">
            <Button
              onClick={() => mutation.mutate(draft)}
              disabled={!dirty || mutation.isPending || mappingQ.isLoading}
            >
              {mutation.isPending ? 'Saving…' : 'Save'}
            </Button>
            {mutation.isError && (
              <span className="text-xs text-danger">
                保存失败：{String(mutation.error)}
              </span>
            )}
            {savedAt && !dirty && !mutation.isError && (
              <span className="text-xs text-success inline-flex items-center gap-1">
                <Check className="h-3 w-3" /> 已保存
              </span>
            )}
          </div>
        </CardBody>
      </Card>

      <ProviderRoutingCard />
    </div>
  );
}

function ModelRow({
  m,
  selected,
  onSelect,
}: {
  m: OpenRouterModel;
  selected: boolean;
  onSelect: () => void;
}) {
  const hasPrice = m.promptCost != null || m.completionCost != null;
  const ctxLabel =
    m.context_length != null
      ? m.maxCompletionTokens != null
        ? `${formatCtx(m.context_length)}→${formatCtx(m.maxCompletionTokens)}`
        : formatCtx(m.context_length)
      : null;
  const ctxTitle =
    m.context_length != null && m.maxCompletionTokens != null
      ? `context: ${formatCtx(m.context_length)} · max output: ${formatCtx(m.maxCompletionTokens)}`
      : undefined;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full text-left px-3 py-2 hover:bg-panel transition-colors',
        selected && 'bg-panel',
      )}
    >
      <div className="flex items-baseline gap-3">
        <div className="flex items-baseline gap-2 min-w-0 flex-1">
          <span className="min-w-0 truncate text-xs text-fg">{m.name || m.id}</span>
          {m.modality && (
            <span className="shrink-0 text-[10px] text-muted">{m.modality.replace('->', '→')}</span>
          )}
        </div>
        {hasPrice && (
          <span
            className="shrink-0 text-xs text-fg tabular-nums"
            title={m.cacheReadCost != null ? `cache read: $${formatPrice(m.cacheReadCost)}/M` : undefined}
          >
            ${formatPrice(m.promptCost)}<span className="text-muted"> / </span>${formatPrice(m.completionCost)}
          </span>
        )}
      </div>
      <div className="mt-0.5 flex items-baseline gap-3">
        <span className="min-w-0 flex-1 font-mono text-[10px] text-muted truncate">{m.id}</span>
        {ctxLabel && (
          <span className="shrink-0 text-[10px] text-muted tabular-nums" title={ctxTitle}>
            {ctxLabel}
          </span>
        )}
      </div>
    </button>
  );
}

function ModelField({
  label,
  hint,
  value,
  onChange,
  models,
  loading,
  error,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  models: OpenRouterModel[];
  loading: boolean;
  error: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [activeProvider, setActiveProvider] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const searchQuery = value.trim().toLowerCase();
  const isSearching = useMemo(() => {
    if (!searchQuery) return false;
    return !models.some((m) => m.id.toLowerCase() === searchQuery);
  }, [searchQuery, models]);

  const filtered = useMemo(() => {
    if (!isSearching) return models;
    return models
      .filter((m) => m.id.toLowerCase().includes(searchQuery) || m.name?.toLowerCase().includes(searchQuery))
      .slice(0, 300);
  }, [isSearching, searchQuery, models]);

  const groupedAll = useMemo(() => {
    const map = new Map<string, OpenRouterModel[]>();
    for (const m of models) {
      const provider = m.id.split('/')[0] || 'other';
      const bucket = map.get(provider);
      if (bucket) bucket.push(m);
      else map.set(provider, [m]);
    }
    return Array.from(map.entries());
  }, [models]);

  useEffect(() => {
    if (!open) return;
    const currentProvider = value.includes('/') ? value.split('/')[0] : null;
    if (currentProvider && models.some((m) => m.id.startsWith(`${currentProvider}/`))) {
      setActiveProvider(currentProvider);
    } else {
      setActiveProvider(null);
    }
  }, [open]);

  useEffect(() => {
    if (panelRef.current) panelRef.current.scrollTop = 0;
  }, [activeProvider, isSearching]);

  const activeItems = useMemo(() => {
    if (activeProvider == null) return [] as OpenRouterModel[];
    return models.filter((m) => m.id.startsWith(`${activeProvider}/`));
  }, [activeProvider, models]);

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <label className="text-sm font-medium text-fg">{label}</label>
        <span className="text-xs text-muted">{hint}</span>
      </div>
      <div ref={wrapRef} className="relative">
        <div className="flex">
          <input
            type="text"
            value={value}
            onChange={(e) => { onChange(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            placeholder="leave blank to pass through original model"
            className="flex-1 h-9 px-3 text-sm font-mono border border-border rounded-l-md bg-white focus:outline-none focus:ring-2 focus:ring-accent/40"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="h-9 px-2 border border-l-0 border-border rounded-r-md bg-white hover:bg-panel text-muted"
            aria-label="Show model list"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>
        {open && (
          <div ref={panelRef} className="absolute z-20 mt-1 w-full max-h-72 overflow-auto scroll-thin rounded-md border border-border bg-white shadow-lg">
            {loading && (
              <div className="px-3 py-6 text-center text-xs text-muted">Loading models…</div>
            )}
            {!loading && error && (
              <div className="px-3 py-6 text-center text-xs text-danger">加载失败：{error}</div>
            )}
            {!loading && !error && isSearching && filtered.length === 0 && (
              <div className="px-3 py-6 text-center text-xs text-muted">无匹配模型</div>
            )}

            {!loading && !error && isSearching && filtered.map((m) => (
              <ModelRow key={m.id} m={m} selected={m.id === value} onSelect={() => { onChange(m.id); setOpen(false); }} />
            ))}

            {!loading && !error && !isSearching && activeProvider === null && groupedAll.map(([provider, items]) => {
              const selected = value.startsWith(`${provider}/`);
              return (
                <button
                  key={provider}
                  type="button"
                  onClick={() => setActiveProvider(provider)}
                  className={cn(
                    'w-full text-left px-3 py-2 hover:bg-panel transition-colors flex items-center gap-2',
                    selected && 'bg-panel',
                  )}
                >
                  <span className="text-sm text-fg flex-1 min-w-0 truncate">{provider}</span>
                  <span className="text-xs text-muted tabular-nums">{items.length}</span>
                  <ChevronRight className="h-3.5 w-3.5 text-muted shrink-0" />
                </button>
              );
            })}

            {!loading && !error && !isSearching && activeProvider !== null && (
              <>
                <button
                  type="button"
                  onClick={() => setActiveProvider(null)}
                  className="sticky top-0 z-10 w-full px-3 py-1.5 bg-panel/95 backdrop-blur-sm flex items-center gap-2 border-b border-border text-xs font-medium text-fg hover:bg-panel"
                >
                  <ArrowLeft className="h-3.5 w-3.5 text-muted" />
                  <span className="uppercase tracking-wide flex-1 text-left">{activeProvider}</span>
                  <span className="text-muted tabular-nums">{activeItems.length}</span>
                </button>
                {activeItems.map((m) => (
                  <ModelRow key={m.id} m={m} selected={m.id === value} onSelect={() => { onChange(m.id); setOpen(false); }} />
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const EMPTY_ROUTING: ProviderRouting = { only: [], allowFallbacks: true };

function ProviderRoutingCard() {
  const qc = useQueryClient();
  const routingQ = useQuery({
    queryKey: ['settings', 'provider-routing'],
    queryFn: () => api.settings.getProviderRouting(),
  });
  const providersQ = useQuery({
    queryKey: ['settings', 'openrouter-providers'],
    queryFn: () => api.settings.listOpenRouterProviders(),
    staleTime: 10 * 60 * 1000,
  });

  const [draft, setDraft] = useState<ProviderRouting>(EMPTY_ROUTING);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (routingQ.data) setDraft(routingQ.data);
  }, [routingQ.data]);

  const mutation = useMutation({
    mutationFn: (r: ProviderRouting) => api.settings.setProviderRouting(r),
    onSuccess: (data) => {
      qc.setQueryData(['settings', 'provider-routing'], data);
      setDraft(data);
      setSavedAt(Date.now());
    },
  });

  const dirty = useMemo(() => {
    const base = routingQ.data ?? EMPTY_ROUTING;
    if (draft.allowFallbacks !== base.allowFallbacks) return true;
    if (draft.only.length !== base.only.length) return true;
    return draft.only.some((s, i) => s !== base.only[i]);
  }, [draft, routingQ.data]);

  const providers = providersQ.data?.items ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>OpenRouter Provider Routing</CardTitle>
        <p className="text-xs text-muted mt-1">
          限制 OpenRouter 可以路由到的上游 provider。留空表示不限制。
        </p>
      </CardHeader>
      <CardBody>
        <div className="space-y-4">
          <div>
            <div className="flex items-baseline justify-between mb-1.5">
              <label className="text-sm font-medium text-fg">Providers (whitelist)</label>
              <span className="text-xs text-muted">只允许路由到选中的 provider</span>
            </div>
            <ProviderMultiSelect
              selected={draft.only}
              onChange={(only) => setDraft((d) => ({ ...d, only }))}
              providers={providers}
              loading={providersQ.isLoading}
              error={providersQ.error ? String(providersQ.error) : null}
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-fg cursor-pointer select-none">
            <input
              type="checkbox"
              checked={draft.allowFallbacks}
              onChange={(e) => setDraft((d) => ({ ...d, allowFallbacks: e.target.checked }))}
              className="h-4 w-4 accent-accent cursor-pointer"
            />
            Allow fallbacks to other providers if all selected fail
          </label>
        </div>

        <div className="mt-6 flex items-center gap-3">
          <Button
            onClick={() => mutation.mutate(draft)}
            disabled={!dirty || mutation.isPending || routingQ.isLoading}
          >
            {mutation.isPending ? 'Saving…' : 'Save'}
          </Button>
          {mutation.isError && (
            <span className="text-xs text-danger">保存失败：{String(mutation.error)}</span>
          )}
          {savedAt && !dirty && !mutation.isError && (
            <span className="text-xs text-success inline-flex items-center gap-1">
              <Check className="h-3 w-3" /> 已保存
            </span>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

function ProviderMultiSelect({
  selected,
  onChange,
  providers,
  loading,
  error,
}: {
  selected: string[];
  onChange: (next: string[]) => void;
  providers: OpenRouterProvider[];
  loading: boolean;
  error: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const nameBySlug = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of providers) m.set(p.slug, p.name || p.slug);
    return m;
  }, [providers]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const src = q
      ? providers.filter(
          (p) => p.slug.toLowerCase().includes(q) || p.name.toLowerCase().includes(q),
        )
      : providers;
    return src.slice(0, 200);
  }, [filter, providers]);

  function toggle(slug: string) {
    if (selectedSet.has(slug)) onChange(selected.filter((s) => s !== slug));
    else onChange([...selected, slug]);
  }

  function remove(slug: string) {
    onChange(selected.filter((s) => s !== slug));
  }

  return (
    <div ref={wrapRef} className="relative">
      <div
        className="flex flex-wrap items-center gap-1 min-h-9 px-1.5 py-1 border border-border rounded-md bg-white focus-within:ring-2 focus-within:ring-accent/40"
        onClick={() => setOpen(true)}
      >
        {selected.map((slug) => (
          <Badge key={slug} tone="neutral" className="gap-1 pr-1">
            <span className="font-mono">{slug}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                remove(slug);
              }}
              className="hover:text-danger"
              aria-label={`Remove ${slug}`}
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        <input
          type="text"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={selected.length === 0 ? 'Empty = any provider allowed' : 'filter…'}
          className="flex-1 min-w-[120px] h-7 px-1 text-sm font-mono bg-transparent focus:outline-none"
          spellCheck={false}
        />
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((o) => !o);
          }}
          className="h-7 px-1 text-muted hover:text-fg"
          aria-label="Toggle provider list"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>
      {open && (
        <div className="absolute z-20 mt-1 w-full max-h-72 overflow-auto scroll-thin rounded-md border border-border bg-white shadow-lg">
          {loading && (
            <div className="px-3 py-6 text-center text-xs text-muted">Loading providers…</div>
          )}
          {!loading && error && (
            <div className="px-3 py-6 text-center text-xs text-danger">加载失败：{error}</div>
          )}
          {!loading && !error && filtered.length === 0 && (
            <div className="px-3 py-6 text-center text-xs text-muted">无匹配 provider</div>
          )}
          {!loading && !error && filtered.map((p) => {
            const isSelected = selectedSet.has(p.slug);
            return (
              <button
                key={p.slug}
                type="button"
                onClick={() => toggle(p.slug)}
                className={cn(
                  'w-full text-left px-3 py-1.5 hover:bg-panel flex items-center gap-2',
                  isSelected && 'bg-panel',
                )}
              >
                <span className="w-3 shrink-0 text-accent">
                  {isSelected ? <Check className="h-3 w-3" /> : null}
                </span>
                <span className="text-xs text-fg truncate flex-1">{p.name || p.slug}</span>
                <span className="font-mono text-[10px] text-muted truncate shrink-0">{p.slug}</span>
              </button>
            );
          })}
        </div>
      )}
      {selected.length > 0 && selected.some((s) => !nameBySlug.has(s)) && !loading && (
        <p className="mt-1 text-[11px] text-warning">
          有已选项不在当前 provider 列表里（可能已重命名或下线）
        </p>
      )}
    </div>
  );
}
