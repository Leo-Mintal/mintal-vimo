import {
  Brain,
  Check,
  ChevronDown,
  KeyRound,
  Pencil,
  Plus,
  SendHorizontal,
  Server,
  Square,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { AgentModelOption, CustomAgentModel } from '../../types/agent';

interface ComposerProps {
  disabled?: boolean;
  generating?: boolean;
  modelOptions: AgentModelOption[];
  customModels: CustomAgentModel[];
  selectedModelKey?: string;
  thinkingEnabled?: boolean;
  onAddCustomModel: (model: CustomAgentModel) => void;
  onDeleteCustomModel: (key: string) => void;
  onSelectModel: (modelKey: string) => void;
  onToggleThinking: (enabled: boolean) => void;
  onSend: (message: string) => void;
  onStop: () => void;
}

interface CustomModelDraft {
  label: string;
  api_url: string;
  api_key: string;
  model: string;
  supports_thinking: boolean;
}

const emptyDraft: CustomModelDraft = {
  label: '',
  api_url: '',
  api_key: '',
  model: '',
  supports_thinking: false,
};

export function Composer({
  disabled,
  generating,
  modelOptions,
  customModels,
  selectedModelKey,
  thinkingEnabled,
  onAddCustomModel,
  onDeleteCustomModel,
  onSelectModel,
  onToggleThinking,
  onSend,
  onStop,
}: ComposerProps) {
  const [value, setValue] = useState('');
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [customModalOpen, setCustomModalOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const allModels = useMemo(() => combineModels(modelOptions, customModels), [customModels, modelOptions]);
  const selectedModel = allModels.find((model) => model.key === selectedModelKey) ?? allModels.find((model) => model.default) ?? allModels[0];
  const canThink = Boolean(selectedModel?.supports_thinking);

  useEffect(() => {
    if (selectedModel && !canThink && thinkingEnabled) {
      onToggleThinking(false);
    }
  }, [canThink, onToggleThinking, selectedModel, thinkingEnabled]);

  useEffect(() => {
    function closeMenu(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setModelMenuOpen(false);
      }
    }
    window.addEventListener('mousedown', closeMenu);
    return () => window.removeEventListener('mousedown', closeMenu);
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    const message = value.trim();
    if (!message || disabled || generating) {
      return;
    }
    onSend(message);
    setValue('');
  }

  return (
    <>
      <form
        className="bg-transparent px-4 pb-[calc(env(safe-area-inset-bottom)+18px)] pt-3 sm:px-6"
        onSubmit={submit}
      >
        <div className="composer-shell mx-auto max-w-4xl">
          <textarea
            ref={inputRef}
            className="max-h-36 min-h-[74px] w-full resize-none border-0 bg-transparent px-4 pt-3 text-[15px] font-medium leading-6 text-[var(--text-strong)] outline-none placeholder:font-medium placeholder:text-[var(--text-muted)]"
            disabled={disabled}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submit(event);
              }
            }}
            placeholder="Write a message..."
            rows={3}
            value={value}
          />
          <div className="flex items-center justify-between gap-3 px-2.5 pb-2.5">
            <div className="relative min-w-0" ref={menuRef}>
              <button
                aria-expanded={modelMenuOpen}
                aria-label="选择模型"
                className="model-chip"
                disabled={disabled && !generating}
                onClick={() => setModelMenuOpen((current) => !current)}
                title="选择模型"
                type="button"
              >
                <Server size={14} />
                <span className="max-w-[160px] truncate">{selectedModel?.label ?? '选择模型'}</span>
                <ChevronDown className={`transition ${modelMenuOpen ? 'rotate-180' : ''}`} size={14} />
              </button>
              {modelMenuOpen ? (
                <ModelMenu
                  customModels={customModels}
                  models={allModels}
                  onAddCustom={() => {
                    setModelMenuOpen(false);
                    setCustomModalOpen(true);
                  }}
                  onDeleteCustomModel={onDeleteCustomModel}
                  onSelect={(modelKey) => {
                    onSelectModel(modelKey);
                    setModelMenuOpen(false);
                    inputRef.current?.focus();
                  }}
                  selectedModelKey={selectedModel?.key}
                />
              ) : null}
            </div>

            <div className="flex items-center gap-2">
              {canThink ? (
                <button
                  aria-pressed={Boolean(thinkingEnabled)}
                  className="thinking-toggle"
                  data-active={Boolean(thinkingEnabled)}
                  disabled={disabled && !generating}
                  onClick={() => onToggleThinking(!thinkingEnabled)}
                  title={thinkingEnabled ? '关闭思考模式' : '开启思考模式'}
                  type="button"
                >
                  <Brain size={14} />
                  <span>思考</span>
                </button>
              ) : null}

            {generating ? (
              <button
                aria-label="停止生成"
                className="send-button is-stopping"
                onClick={onStop}
                title="停止生成"
                type="button"
              >
                <Square size={15} fill="currentColor" />
              </button>
            ) : (
              <button
                aria-label="发送"
                className="send-button"
                disabled={disabled || !value.trim()}
                title="发送"
                type="submit"
              >
                <SendHorizontal size={16} />
              </button>
            )}
            </div>
          </div>
        </div>
      </form>
      {customModalOpen ? (
        <CustomModelModal
          onClose={() => setCustomModalOpen(false)}
          onSave={(model) => {
            onAddCustomModel(model);
            setCustomModalOpen(false);
            inputRef.current?.focus();
          }}
        />
      ) : null}
    </>
  );
}

function combineModels(modelOptions: AgentModelOption[], customModels: CustomAgentModel[]): AgentModelOption[] {
  const builtIns = modelOptions.map((model) => ({ ...model }));
  const custom = customModels.map((model) => ({
    key: model.key,
    label: model.label || model.model,
    description: model.description || model.api_url,
    model: model.model,
    default: false,
    supports_thinking: Boolean(model.supports_thinking),
  }));
  return [...builtIns, ...custom];
}

function ModelMenu({
  customModels,
  models,
  selectedModelKey,
  onAddCustom,
  onDeleteCustomModel,
  onSelect,
}: {
  customModels: CustomAgentModel[];
  models: AgentModelOption[];
  selectedModelKey?: string;
  onAddCustom: () => void;
  onDeleteCustomModel: (key: string) => void;
  onSelect: (modelKey: string) => void;
}) {
  const customKeys = new Set(customModels.map((model) => model.key));
  return (
    <div className="model-menu">
      <div className="max-h-72 overflow-y-auto p-1.5">
        {models.length ? (
          models.map((model) => {
            const isSelected = model.key === selectedModelKey;
            const isCustom = customKeys.has(model.key);
            return (
              <ModelMenuItem
                icon={isCustom ? KeyRound : Server}
                isCustom={isCustom}
                key={model.key}
                model={model}
                onDelete={isCustom ? () => onDeleteCustomModel(model.key) : undefined}
                onSelect={() => onSelect(model.key)}
                selected={isSelected}
              />
            );
          })
        ) : (
          <div className="px-3 py-3 text-xs font-semibold text-[var(--text-muted)]">模型列表加载中</div>
        )}
      </div>
      <div className="border-t border-[var(--border-subtle)] p-1.5">
        <button className="model-menu-action" onClick={onAddCustom} type="button">
          <Plus size={15} />
          自定义
        </button>
      </div>
    </div>
  );
}

function ModelMenuItem({
  icon: Icon,
  isCustom,
  model,
  onDelete,
  onSelect,
  selected,
}: {
  icon: LucideIcon;
  isCustom: boolean;
  model: AgentModelOption;
  onDelete?: () => void;
  onSelect: () => void;
  selected: boolean;
}) {
  return (
    <div className="group/model flex items-center gap-1 rounded-[10px]">
      <button className="model-menu-item" onClick={onSelect} type="button">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[9px] bg-[var(--surface-soft)] text-[var(--text-muted)]">
          <Icon size={14} />
        </span>
        <span className="min-w-0 flex-1 text-left">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[13px] font-semibold text-[var(--text-strong)]">{model.label}</span>
            {isCustom ? <span className="rounded-full bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--accent)]">Local</span> : null}
            {model.supports_thinking ? <Brain className="shrink-0 text-[var(--accent)]" size={12} /> : null}
          </span>
          <span className="mt-0.5 block truncate text-[11px] font-medium text-[var(--text-muted)]">{model.description || model.model}</span>
        </span>
        {selected ? <Check className="shrink-0 text-[var(--accent)]" size={16} /> : null}
      </button>
      {onDelete ? (
        <button
          aria-label={`删除 ${model.label}`}
          className="mr-1 grid h-8 w-8 shrink-0 place-items-center rounded-[9px] text-[var(--text-faint)] opacity-100 transition hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] sm:opacity-0 sm:group-hover/model:opacity-100"
          onClick={onDelete}
          title="删除自定义模型"
          type="button"
        >
          <Trash2 size={14} />
        </button>
      ) : null}
    </div>
  );
}

function CustomModelModal({ onClose, onSave }: { onClose: () => void; onSave: (model: CustomAgentModel) => void }) {
  const [draft, setDraft] = useState<CustomModelDraft>(emptyDraft);
  const [error, setError] = useState('');

  function submit(event: FormEvent) {
    event.preventDefault();
    const modelName = draft.model.trim();
    const apiURL = draft.api_url.trim();
    if (!modelName || !apiURL) {
      setError('API URL 和模型名称必填');
      return;
    }
    try {
      const parsed = new URL(apiURL);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        setError('API URL 需要以 http 或 https 开头');
        return;
      }
    } catch {
      setError('API URL 格式不正确');
      return;
    }
    const label = draft.label.trim() || modelName;
    onSave({
      key: `custom_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      label,
      description: apiURL,
      api_url: apiURL,
      api_key: draft.api_key.trim(),
      model: modelName,
      timeout_seconds: 120,
      supports_thinking: draft.supports_thinking,
    });
  }

  return (
    <div className="modal-backdrop">
      <form className="custom-model-modal" onSubmit={submit}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="text-base font-semibold text-[var(--text-strong)]">自定义模型</div>
            <div className="mt-1 text-xs font-medium text-[var(--text-muted)]">OpenAI-compatible API，会保存在本地缓存。</div>
          </div>
          <button aria-label="关闭" className="icon-button" onClick={onClose} title="关闭" type="button">
            <X size={16} />
          </button>
        </div>
        <div className="grid gap-3">
          <Field label="显示名称">
            <input
              className="text-field"
              onChange={(event) => setDraft({ ...draft, label: event.target.value })}
              placeholder="My model"
              value={draft.label}
            />
          </Field>
          <Field label="API URL">
            <input
              className="text-field"
              onChange={(event) => setDraft({ ...draft, api_url: event.target.value })}
              placeholder="https://api.example.com/v1"
              value={draft.api_url}
            />
          </Field>
          <Field label="API Key">
            <input
              className="text-field"
              onChange={(event) => setDraft({ ...draft, api_key: event.target.value })}
              placeholder="sk-..."
              type="password"
              value={draft.api_key}
            />
          </Field>
          <Field label="模型名称">
            <input
              className="text-field"
              onChange={(event) => setDraft({ ...draft, model: event.target.value })}
              placeholder="gpt-4.1-mini"
              value={draft.model}
            />
          </Field>
          <label className="flex min-h-11 items-center gap-3 rounded-[12px] border border-[var(--border-subtle)] bg-[var(--surface-soft)] px-3 text-xs font-semibold text-[var(--text)]">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[9px] bg-[var(--accent-soft)] text-[var(--accent)]">
              <Brain size={14} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[var(--text-strong)]">支持思考模式</span>
              <span className="mt-0.5 block text-[11px] font-medium text-[var(--text-muted)]">开启后发送时会请求并展示 provider 返回的 reasoning。</span>
            </span>
            <input
              checked={draft.supports_thinking}
              className="h-4 w-4 shrink-0 accent-leaf"
              onChange={(event) => setDraft({ ...draft, supports_thinking: event.target.checked })}
              type="checkbox"
            />
          </label>
        </div>
        {error ? <div className="mt-3 rounded-[10px] bg-[var(--danger-soft)] px-3 py-2 text-xs font-semibold text-[var(--danger)]">{error}</div> : null}
        <div className="mt-4 flex justify-end gap-2">
          <button className="secondary-button" onClick={onClose} type="button">
            取消
          </button>
          <button className="primary-button" type="submit">
            <Pencil size={15} />
            保存
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="block text-xs font-semibold text-[var(--text-muted)]">
      {label}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}
