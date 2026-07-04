import {
  Bell,
  BookOpenText,
  CalendarClock,
  ChevronDown,
  Check,
  CheckCircle2,
  ClipboardList,
  Clock3,
  FileWarning,
  Edit3,
  FileText,
  Info,
  Lightbulb,
  ListChecks,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings2,
  Sparkles,
  StickyNote,
  Trash2,
  Undo2,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { MessageBubble } from './MessageBubble';
import { Composer } from './Composer';
import { RecordCard } from '../RecordCard/RecordCard';
import { listAgentModels, sendAgentFastReplyStream, sendAgentMessage } from '../../services/agent';
import { createRecord, listRecords, saveRecord, updateRecord, type RecordWriteInput } from '../../services/records';
import type { AgentContextRecord, AgentIntent, AgentModelOption, ConversationMessage, FieldRiskLevel, IntentItem, IntentTrace, PendingState, RecordAction, RecordCandidate, RecordPreview, RecordStatus, RecordType, ReplyPreset, ReplyProfile, RiskField, SettingsPatch } from '../../types/agent';
import type { RecordItem } from '../../types/record';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'notice';
  content: string;
  createdAt: string;
  intent?: AgentIntent;
  pendingId?: string;
  preview?: RecordPreview;
}

interface PendingPreviewItem {
  id: string;
  preview: RecordPreview;
  created_at: string;
}

interface OpenContextItem {
  id: string;
  preview: RecordPreview;
  created_at: string;
  updated_at: string;
  last_user_message?: string;
  last_assistant_reply?: string;
}

type AppliedAction = 'created' | 'updated' | 'deleted' | 'restored' | 'none';

type RecordTab = 'all' | RecordType | 'pending' | 'trash';

interface RecordDraft {
  type: RecordType;
  title: string;
  content: string;
  datetime: string;
  need_reminder: boolean;
  status: RecordStatus;
}

const storageKey = 'vimo-web.records.v1';
const migrationKey = 'vimo-web.records-api-migrated.v1';
const settingsKey = 'vimo-web.agent-settings.v1';
const riskFeedbackKey = 'vimo-web.risk-feedback.v1';
const chatMessagesKey = 'vimo-web.chat-messages.v1';
const openContextsKey = 'vimo-web.open-contexts.v1';
const pendingPreviewsKey = 'vimo-web.pending-previews.v1';
const activePendingKey = 'vimo-web.active-pending-id.v1';
const fastReplyStartTimeoutMs = 600;
const previousDefaultModelKey = 'gpt_5_4_mini';
const maxClosedContexts = 30;

interface AgentSettings extends ReplyProfile {}

const defaultSettings: AgentSettings = {
  preset: 'INTJ',
  custom_style: '',
  nickname: '',
  model_key: '',
};

const presetOptions: Array<{ value: ReplyPreset; label: string; description: string }> = [
  { value: 'INTJ', label: 'INTJ', description: 'Patterns, long-range framing, high standards' },
  { value: 'ENFJ', label: 'ENFJ', description: 'Empathetic, responsive, people-aware' },
  { value: 'ISTP', label: 'ISTP', description: 'Workable solutions, efficient, practical' },
  { value: 'ENFP', label: 'ENFP', description: 'Imaginative, possibility-driven, supportive' },
  { value: 'custom', label: 'Custom', description: 'Use the custom style below' },
];

const typeLabel: Record<RecordType, string> = {
  todo: '待办',
  journal: '日记',
  memo: '备忘',
  idea: '想法',
  unknown: '确认',
};

const typeMeta = {
  todo: {
    label: '待办',
    icon: ClipboardList,
    tone: 'bg-[#14342a] text-[#7ee0a0]',
    tab: 'data-[active=true]:bg-[#14342a] data-[active=true]:text-[#7ee0a0]',
  },
  idea: {
    label: '想法',
    icon: Lightbulb,
    tone: 'bg-[#292242] text-[#c8b6ff]',
    tab: 'data-[active=true]:bg-[#292242] data-[active=true]:text-[#c8b6ff]',
  },
  memo: {
    label: '备忘',
    icon: StickyNote,
    tone: 'bg-[#3a202d] text-[#ff85a1]',
    tab: 'data-[active=true]:bg-[#3a202d] data-[active=true]:text-[#ff85a1]',
  },
  journal: {
    label: '日记',
    icon: BookOpenText,
    tone: 'bg-[#123040] text-[#8bd8ff]',
    tab: 'data-[active=true]:bg-[#123040] data-[active=true]:text-[#8bd8ff]',
  },
  unknown: {
    label: '确认',
    icon: Sparkles,
    tone: 'bg-[#70521f] text-[#f8f4ed]',
    tab: 'data-[active=true]:bg-[#70521f] data-[active=true]:text-[#f8f4ed]',
  },
} satisfies Record<RecordType, { label: string; icon: LucideIcon; tone: string; tab: string }>;

const recordTabs: Array<{ value: RecordTab; label: string; icon: LucideIcon }> = [
  { value: 'all', label: '全部', icon: ListChecks },
  { value: 'todo', label: '待办', icon: ClipboardList },
  { value: 'idea', label: '想法', icon: Lightbulb },
  { value: 'memo', label: '备忘', icon: StickyNote },
  { value: 'journal', label: '日记', icon: BookOpenText },
  { value: 'pending', label: '确认', icon: Sparkles },
  { value: 'trash', label: '回收', icon: Trash2 },
];

export function ChatAgent() {
  const [messages, setMessages] = useState<Message[]>(() => readStoredMessages());
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [pendingPreviews, setPendingPreviews] = useState<PendingPreviewItem[]>(() => readStoredPendingPreviews());
  const [openContexts, setOpenContexts] = useState<OpenContextItem[]>(() => readStoredOpenContexts());
  const [activePendingId, setActivePendingId] = useState<string | null>(() => readStoredActivePendingId());
  const [settings, setSettings] = useState<AgentSettings>(() => readAgentSettings());
  const [riskFeedback, setRiskFeedback] = useState<RiskFeedbackState>(() => readRiskFeedback());
  const [modelOptions, setModelOptions] = useState<AgentModelOption[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const lastPromptRef = useRef<string>('');
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const messagesRef = useRef<Message[]>([]);

  const activeRecords = useMemo(() => records.filter((record) => record.status !== 'discarded'), [records]);
  const savedCount = activeRecords.length;
  const todoCount = useMemo(() => activeRecords.filter((record) => record.type === 'todo' && record.status !== 'completed').length, [activeRecords]);
  const completedCount = useMemo(() => activeRecords.filter((record) => record.status === 'completed').length, [activeRecords]);
  const latestPending = pendingPreviews[0] ?? null;
  const latestOpenContext = openContexts[0] ?? null;
  const activePending = pendingPreviews.find((item) => item.id === activePendingId) ?? null;

  useEffect(() => {
    void loadRecords();
    void loadAgentModels();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading, thinking]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    writeStoredMessages(messages);
  }, [messages]);

  useEffect(() => {
    writeStoredOpenContexts(openContexts);
  }, [openContexts]);

  useEffect(() => {
    writeStoredPendingPreviews(pendingPreviews);
  }, [pendingPreviews]);

  useEffect(() => {
    writeStoredActivePendingId(activePendingId);
  }, [activePendingId]);

  useEffect(() => {
    if (!activePendingId) {
      return;
    }
    if (!pendingPreviews.some((item) => item.id === activePendingId)) {
      setActivePendingId(null);
    }
  }, [activePendingId, pendingPreviews]);

  useEffect(() => {
    if (!toast) {
      return;
    }
    const timer = window.setTimeout(() => setToast(null), 1800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function loadRecords(options: { silent?: boolean } = {}) {
    try {
      const response = await listRecords();
      const normalized = response.records.map(normalizeStoredRecord).filter((record): record is RecordItem => Boolean(record));
      const shouldMigrate = normalized.length === 0 && !hasMigratedStoredRecords();
      if (shouldMigrate) {
        const imported = await migrateStoredRecords();
        if (imported.length > 0) {
          setRecords(imported);
          writeStoredRecords(imported);
          markStoredRecordsMigrated();
          if (!options.silent) {
            showToast('已导入本地记录');
          }
          return imported;
        }
      }
      setRecords(normalized);
      writeStoredRecords(normalized);
      markStoredRecordsMigrated();
      if (!options.silent) {
        showToast('已刷新');
      }
      return normalized;
    } catch (err) {
      const fallback = readStoredRecords();
      setRecords(fallback);
      if (!options.silent) {
        showToast(err instanceof Error ? `记录服务不可用：${err.message}` : '记录服务不可用');
      }
      return fallback;
    }
  }

  function upsertLocalRecord(record: RecordItem) {
    setRecords((current) => {
      const exists = current.some((item) => item.id === record.id);
      const next = exists ? current.map((item) => (item.id === record.id ? record : item)) : [record, ...current];
      writeStoredRecords(next);
      return next;
    });
  }

  function updateLocalRecord(record: RecordItem) {
    setRecords((current) => {
      const next = current.map((item) => (item.id === record.id ? record : item));
      writeStoredRecords(next);
      return next;
    });
  }

  async function reloadRecords() {
    await loadRecords();
  }

  async function loadAgentModels() {
    try {
      const response = await listAgentModels();
      setModelOptions(response.models);
      const defaultModel = response.models.find((model) => model.default) ?? response.models[0];
      if (defaultModel) {
        setSettings((current) => {
          const shouldUseBackendDefault = !current.model_key || (current.model_key === previousDefaultModelKey && defaultModel.key !== previousDefaultModelKey);
          if (!shouldUseBackendDefault) {
            return current;
          }
          const next = { ...current, model_key: defaultModel.key };
          writeAgentSettings(next);
          return next;
        });
      }
    } catch {
      setModelOptions([]);
    }
  }

  function commitSettings(next: AgentSettings) {
    setSettings(next);
    writeAgentSettings(next);
    showToast('偏好已更新');
  }

  function mutateMessages(updater: (current: Message[]) => Message[]) {
    const next = updater(messagesRef.current);
    messagesRef.current = next;
    setMessages(next);
  }

  function addNotice(content: string) {
    const text = content.trim();
    if (!text) {
      return;
    }
    const notice: Message = {
      id: createId(),
      role: 'notice',
      content: text,
      createdAt: formatLocalTimestamp(),
    };
    mutateMessages((current) => [...current, notice]);
  }

  function showToast(content: string) {
    const text = content.trim();
    if (text) {
      setToast(text);
    }
  }

  async function handleSend(content: string) {
    lastPromptRef.current = content;
    const recentMessages = recentConversationMessages(messagesRef.current);
    const userMessage: Message = {
      id: createId(),
      role: 'user',
      content,
      createdAt: formatLocalTimestamp(),
    };
    const assistantId = createId();
    const assistantMessage: Message = {
      id: assistantId,
      role: 'assistant',
      content: '',
      createdAt: formatLocalTimestamp(),
    };
    mutateMessages((current) => [...current, userMessage, assistantMessage]);
    setLoading(true);
    setThinking(true);
    setError(null);

    try {
      const pendingCount = pendingPreviews.length;
      const turnId = createId();
      const request = {
        turn_id: turnId,
        message: content,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
        model_key: selectedModelKey(settings),
        open_contexts: buildOpenContextPayload(openContexts, pendingPreviews),
        closed_contexts: buildClosedContextPayload(records),
        recent_messages: recentMessages,
        reply_profile: replyProfileFromSettings(settings),
      };
      let fastReplyText = '';
      let fastReplyState: 'started' | 'partial' | 'done' | 'failed' = 'started';
      const fastReplyResult: { route: 'continue_slow' | 'chat_only' } = { route: 'continue_slow' };
      let fastReplyHadError = false;
      let acceptingFastDeltas = true;
      let fastTypingTask = Promise.resolve();
      let resolveFastStart: (() => void) | undefined;
      let resolveFastFinished: (() => void) | undefined;
      const fastStarted = new Promise<void>((resolve) => {
        resolveFastStart = resolve;
      });
      const fastFinished = new Promise<void>((resolve) => {
        resolveFastFinished = resolve;
      });
      const fastTask = sendAgentFastReplyStream(request, async (event) => {
        if (event.type === 'fast_delta') {
          fastReplyText += event.delta;
          fastReplyState = 'partial';
          resolveFastStart?.();
          resolveFastStart = undefined;
          if (acceptingFastDeltas) {
            const delta = event.delta;
            fastTypingTask = fastTypingTask.then(async () => {
              await typeAssistantDelta(assistantId, delta);
            });
          }
        }
        if (event.type === 'fast_done' || event.type === 'fast_error') {
          if (event.type === 'fast_error') {
            fastReplyHadError = true;
            fastReplyState = fastReplyText.trim() ? 'partial' : 'failed';
          } else if (!fastReplyHadError) {
            fastReplyResult.route = event.route ?? 'continue_slow';
            fastReplyState = fastReplyText.trim() ? 'done' : 'started';
          }
          resolveFastStart?.();
          resolveFastStart = undefined;
          resolveFastFinished?.();
          resolveFastFinished = undefined;
        }
      }).catch(() => {
        fastReplyHadError = true;
        fastReplyState = fastReplyText.trim() ? 'partial' : 'failed';
        resolveFastStart?.();
        resolveFastStart = undefined;
        resolveFastFinished?.();
        resolveFastFinished = undefined;
        // Fast reply is best effort. Slow path still owns the actual work and error UI.
      });
      await Promise.race([fastStarted, sleep(fastReplyStartTimeoutMs)]);
      resolveFastStart?.();
      resolveFastStart = undefined;
      const fastContextText = fastReplyText.trim();
      const slowController = new AbortController();
      const slowRequest = {
        ...request,
        fast_reply_context: {
          turn_id: turnId,
          state: fastReplyState,
          content: fastContextText,
        },
      };
      const slowTask = sendAgentMessage(slowRequest, slowController.signal)
        .then((response) => ({ response, error: null }))
        .catch((error: unknown) => ({ response: null, error }));
      await fastFinished;
      const isChatOnly = fastReplyResult.route === 'chat_only' && !fastReplyHadError;
      if (isChatOnly) {
        slowController.abort();
        void slowTask;
        acceptingFastDeltas = false;
        setThinking(false);
        await fastTypingTask;
        await fastTask;
        return;
      }
      const slowOutcome = await slowTask;
      if (slowOutcome.error) {
        throw slowOutcome.error;
      }
      const response = slowOutcome.response;
      if (!response) {
        throw new Error('慢路请求失败');
      }
      const responsePreview = normalizePreview(response.record_preview);
      acceptingFastDeltas = false;
      await fastTypingTask;
      setThinking(false);
      await streamAssistantFinalText(assistantId, response.message.content);
      const pendingId = await applyAgentPreview(responsePreview, latestOpenContext?.id ?? latestPending?.id ?? null, content, response.message.content);
      updateAssistantMessage(assistantId, {
        intent: responsePreview.intent,
        pendingId,
        preview: responsePreview,
      });
      if (pendingCount > 0 && !shouldShowPreview(responsePreview)) {
        addNotice('上方还有待确认');
      }
      await fastTask;
    } catch (err) {
      mutateMessages((current) => current.filter((message) => message.id !== assistantId || message.content.trim()));
      setError(err instanceof Error ? err.message : '请求失败');
    } finally {
      setThinking(false);
      setLoading(false);
    }
  }

  function appendAssistantDelta(messageId: string, delta: string) {
    if (!delta) {
      return;
    }
    mutateMessages((current) => current.map((message) => (message.id === messageId ? { ...message, content: message.content + delta } : message)));
  }

  function updateAssistantMessage(messageId: string, patch: Partial<Message>) {
    mutateMessages((current) => current.map((message) => (message.id === messageId ? { ...message, ...patch } : message)));
  }

  async function streamAssistantFinalText(messageId: string, finalText: string) {
    const text = finalText.trim();
    if (!text) {
      return;
    }
    const current = messageContentById(messageId);
    if (text === current.trim()) {
      return;
    }
    if (current.trim() && text.startsWith(current.trim())) {
      await typeAssistantDelta(messageId, text.slice(current.trim().length));
      return;
    }
    if (current.trim()) {
      await typeAssistantDelta(messageId, `\n\n${text}`);
      return;
    }
    await typeAssistantDelta(messageId, text);
  }

  function messageContentById(messageId: string) {
    const message = messagesRef.current.find((item) => item.id === messageId);
    return message?.content ?? '';
  }

  async function typeAssistantDelta(messageId: string, text: string) {
    for (const char of Array.from(text)) {
      appendAssistantDelta(messageId, char);
      await sleep(12);
    }
  }

  async function applyAgentPreview(preview: RecordPreview, activeContextPendingId: string | null, userContent: string, assistantContent: string) {
    const taskId = taskIdForPreview(preview, activeContextPendingId) ?? (shouldOpenTaskContext(preview) ? createId() : null);
    const previewWithTask = taskId ? previewWithTaskId(preview, taskId) : preview;
    syncOpenContext(previewWithTask, taskId, userContent, assistantContent);
    const confirmedPending = confirmedPendingPreview(previewWithTask, taskId, pendingPreviews);
    if (confirmedPending) {
      const applied = await applyConfirmedPendingPreview(confirmedPending);
      addNotice(noticeForAppliedAction(applied));
      await addNonAutoCandidates(previewWithTask, taskId);
      return undefined;
    }
    if (previewWithTask.intent === 'config_update') {
      applySettingsPatch(previewWithTask.settings_patch);
      addNotice('偏好已更新');
      return undefined;
    }
    if (!shouldShowPreview(previewWithTask)) {
      return undefined;
    }
    if (shouldAutoSavePreview(previewWithTask, records, taskId, riskFeedback)) {
      const applied = await applyRecordAction(previewWithTask, taskId);
      if (applied !== 'none' && taskId) {
        closeTaskContext(taskId);
      }
      addNotice(noticeForAppliedAction(applied));
      await addNonAutoCandidates(previewWithTask, taskId);
      return undefined;
    }
    await addNonAutoCandidates(previewWithTask, taskId);
    const pendingItem: PendingPreviewItem = {
      id: taskId ?? createId(),
      preview: previewWithTask,
      created_at: formatLocalTimestamp(),
    };
    setPendingPreviews((current) => {
      const rest = current.filter((item) => item.id !== pendingItem.id);
      return [pendingItem, ...rest];
    });
    return pendingItem.id;
  }

  async function applyConfirmedPendingPreview(preview: RecordPreview): Promise<AppliedAction> {
    const action = preview.record_action ?? defaultRecordAction(preview);
    if (action === 'delete') {
      const targetIds = deleteTargetIds(preview);
      let appliedCount = 0;
      for (const targetId of targetIds) {
        const target = records.find((record) => record.id === targetId && record.status !== 'discarded');
        if (!target) {
          continue;
        }
        const deleted = await updateRecord(target.id, softDeletePatch(target));
        updateLocalRecord(normalizeRecordItem(deleted));
        appliedCount += 1;
      }
      if (appliedCount > 0) {
        closeTaskContext(preview.context_target_id ?? preview.target_id);
        return 'deleted';
      }
    }
    const applied = await applyRecordAction(preview, preview.context_target_id ?? preview.target_id);
    if (applied !== 'none') {
      closeTaskContext(preview.context_target_id ?? preview.target_id);
    }
    return applied;
  }

  async function addNonAutoCandidates(preview: RecordPreview, taskId: string | null) {
    const candidates = secondaryPreviewsFromCandidates(preview, taskId);
    if (!candidates.length) {
      return;
    }
    const pendingCandidates: PendingPreviewItem[] = [];
    const appliedActions: AppliedAction[] = [];
    for (const item of candidates) {
      if (shouldAutoSavePreview(item.preview, records, item.id, riskFeedback)) {
        const applied = await applyRecordAction(item.preview, item.id);
        if (applied !== 'none') {
          appliedActions.push(applied);
          continue;
        }
      }
      pendingCandidates.push(item);
    }
    if (appliedActions.length) {
      addNotice(appliedActions.length === 1 ? noticeForAppliedAction(appliedActions[0]) : `已处理 ${appliedActions.length} 项`);
    }
    if (!pendingCandidates.length) {
      return;
    }
    setPendingPreviews((current) => {
      const next = [...current];
      for (const item of pendingCandidates) {
        const existingIndex = next.findIndex((currentItem) => currentItem.id === item.id);
        if (existingIndex >= 0) {
          next[existingIndex] = item;
        } else {
          next.unshift(item);
        }
      }
      return next;
    });
  }

  async function handleSavePending(pendingId: string, preview: RecordPreview) {
    const previous = pendingPreviews.find((item) => item.id === pendingId)?.preview;
    const applied = await applyRecordAction(preview, pendingId);
    if (applied !== 'none') {
      if (previous) {
        rememberRiskFeedback(previous, preview);
      }
      closeTaskContext(pendingId);
    }
    addNotice(noticeForAppliedAction(applied));
  }

  function rememberRiskFeedback(previous: RecordPreview, next: RecordPreview) {
    setRiskFeedback((current) => {
      const updated = updateRiskFeedback(current, previous, next);
      writeRiskFeedback(updated);
      return updated;
    });
  }

  async function applyRecordAction(preview: RecordPreview, pendingContextId?: string | null): Promise<AppliedAction> {
    const action = preview.record_action ?? defaultRecordAction(preview);
    if (action === 'none') {
      return 'none';
    }
    if (action === 'delete') {
      const targetId = preview.target_id ?? preview.related_ids?.[0] ?? null;
      if (!targetId) {
        return 'none';
      }
      const target = records.find((record) => record.id === targetId);
      if (target) {
        const deleted = await updateRecord(target.id, softDeletePatch(target));
        updateLocalRecord(normalizeRecordItem(deleted));
        return 'deleted';
      }
      if (targetId === pendingContextId) {
        return 'deleted';
      }
      return 'none';
    }
    if (action === 'update') {
      if (preview.target_id) {
        const target = records.find((record) => record.id === preview.target_id);
        if (target) {
          const updated = await updateRecord(target.id, previewPatch(preview, target));
          updateLocalRecord(normalizeRecordItem(updated));
          return target.status === 'discarded' ? 'restored' : 'updated';
        }
        if (preview.target_id === pendingContextId && isPendingDraftContinuation(preview)) {
          const created = await saveRecord(preview, pendingContextId);
          upsertLocalRecord(normalizeRecordItem(created));
          return 'created';
        }
      }
      if (!preview.target_id && pendingContextId && isPendingDraftContinuation(preview)) {
        const created = await saveRecord(preview, pendingContextId);
        upsertLocalRecord(normalizeRecordItem(created));
        return 'created';
      }
      return 'none';
    }
    const created = await saveRecord(preview, pendingContextId ?? undefined);
    upsertLocalRecord(normalizeRecordItem(created));
    return 'created';
  }

  function syncOpenContext(preview: RecordPreview, activeContextId: string | null, userContent: string, assistantContent: string) {
    const now = formatLocalTimestamp();
    const explicitTarget = preview.context_target_id ?? preview.target_id ?? activeContextId ?? null;
    const action = preview.context_action ?? inferContextAction(preview);
    if (action === 'none') {
      return;
    }
    if (action === 'close') {
      closeOpenContext(explicitTarget);
      return;
    }
    if (action === 'update') {
      if (explicitTarget) {
        setOpenContexts((current) => {
          const exists = current.some((item) => item.id === explicitTarget);
          if (!exists) {
            return [openContextFromPreview(preview, explicitTarget, now, userContent, assistantContent), ...current];
          }
          return current.map((item) =>
            item.id === explicitTarget
              ? {
                  ...item,
                  preview: mergeOpenContextPreview(item.preview, preview),
                  updated_at: now,
                  last_user_message: userContent,
                  last_assistant_reply: assistantContent,
                }
              : item,
          );
        });
      }
      return;
    }
    if (action === 'open') {
      const id = explicitTarget ?? createId();
      setOpenContexts((current) => [openContextFromPreview(preview, id, now, userContent, assistantContent), ...current.filter((item) => item.id !== id)]);
    }
  }

  function closeOpenContext(id?: string | null) {
    if (!id) {
      return;
    }
    setOpenContexts((current) => current.filter((item) => item.id !== id));
  }

  function closeTaskContext(id?: string | null) {
    if (!id) {
      return;
    }
    setPendingPreviews((current) => current.filter((item) => item.id !== id));
    setActivePendingId((current) => (current === id ? null : current));
    closeOpenContext(id);
  }

  function applySettingsPatch(patch?: SettingsPatch | null) {
    if (!patch) {
      return;
    }
    const safePatch = sanitizeSettingsPatch(patch, modelOptions);
    if (!safePatch) {
      addNotice('偏好未更新');
      return;
    }
    setSettings((current) => {
      const next = normalizeAgentSettings({
        ...current,
        ...safePatch,
      });
      writeAgentSettings(next);
      return next;
    });
  }

  async function handleCreateRecord(draft: RecordDraft) {
    const record = await createRecord(recordInputFromDraft(draft));
    upsertLocalRecord(normalizeRecordItem(record));
    showToast('已新增');
  }

  async function handleUpdateRecord(id: string, draft: RecordDraft) {
    const record = await updateRecord(id, recordPatchFromDraft(draft));
    updateLocalRecord(normalizeRecordItem(record));
    showToast('已更新');
  }

  function handleDiscardPending(pendingId: string) {
    setPendingPreviews((current) => current.filter((item) => item.id !== pendingId));
    setActivePendingId((current) => (current === pendingId ? null : current));
    closeOpenContext(pendingId);
    showToast('已丢弃');
  }

  function clearChat() {
    mutateMessages(() => []);
    setPendingPreviews([]);
    setOpenContexts([]);
    setActivePendingId(null);
    setError(null);
    setThinking(false);
    showToast('已清空');
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      showToast('已复制');
    } catch {
      showToast('复制失败');
    }
  }

  function retry(message: string) {
    if (!message || loading) {
      return;
    }
    handleSend(message);
  }

  async function handleDeleteRecord(id: string) {
    const target = records.find((record) => record.id === id);
    if (!target) {
      return;
    }
    const record = await updateRecord(id, softDeletePatch(target));
    updateLocalRecord(normalizeRecordItem(record));
    showToast('已移入回收站');
  }

  async function handleRestoreRecord(id: string) {
    const target = records.find((record) => record.id === id);
    if (!target) {
      return;
    }
    const record = await updateRecord(id, restorePatch(target));
    updateLocalRecord(normalizeRecordItem(record));
    showToast('已恢复');
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[linear-gradient(155deg,#120f18_0%,#171321_34%,#102024_68%,#1b1426_100%)]">
      <header className="relative z-10 border-b border-[#353044] bg-[#111018]/95 px-4 py-2.5 text-[#f8f4ed] backdrop-blur-xl">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-[16px] bg-gradient-to-br from-[#b85d70] via-[#70521f] to-[#14342a] text-[#f8f4ed] shadow-pop">
              <Sparkles size={16} />
            </div>
            <div>
              <div className="text-base font-semibold leading-5 tracking-normal">Vimo</div>
              <div className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-[#d8c8b8]/70">
                <span className="h-1.5 w-1.5 rounded-full bg-leaf shadow-[0_0_0_3px_rgba(126,224,160,0.22)]" />
                {loading ? 'thinking' : 'ready'}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <TopIcon label="AI 回复设置" onClick={() => setSettingsOpen(true)}>
              <Settings2 size={15} />
            </TopIcon>
            <TopIcon label="刷新记录" onClick={() => void reloadRecords()}>
              <RefreshCw size={15} />
            </TopIcon>
            <TopIcon label="清空聊天" onClick={clearChat}>
              <Trash2 size={15} />
            </TopIcon>
          </div>
        </div>
      </header>

      <main className="grid min-h-0 flex-1 gap-3 overflow-y-auto p-3 lg:grid-cols-[minmax(0,1fr)_360px] lg:overflow-hidden">
        <section className="flex min-h-[540px] min-w-0 flex-col overflow-hidden rounded-[18px] border border-[#353044] bg-[#0f1018] text-[#f8f4ed] shadow-sm backdrop-blur lg:min-h-0">
          <div className="border-b border-[#353044] bg-[#181522] px-3.5 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-[13px] font-bold text-[#f8f4ed]">Chat Agent</div>
                <div className="mt-0.5 text-[11px] font-medium text-[#d8c8b8]/70">
                  {openContexts.length ? `有 ${openContexts.length} 个未收口上下文。` : '像聊天一样说，我会结合上下文判断。'}
                </div>
              </div>
              <StatusStrip completedCount={completedCount} savedCount={savedCount} todoCount={todoCount} />
            </div>
          </div>

          {pendingPreviews.length ? (
            <PendingPreviewStrip
              items={pendingPreviews}
              onDiscard={handleDiscardPending}
              onOpen={setActivePendingId}
            />
          ) : null}

          <div className="flex-1 overflow-y-auto bg-[#0f1018] px-3.5 py-3">
            <div className="mx-auto max-w-3xl space-y-3">
              {messages.map((message) => {
                if (message.role === 'notice') {
                  return <NoticeMessage content={message.content} key={message.id} />;
                }
                if (message.role === 'assistant' && !message.content.trim() && !message.preview) {
                  return null;
                }
                return (
                  <div className="space-y-2" key={message.id}>
                    <MessageBubble
                      beforeContent={message.role === 'assistant' && message.preview ? <IntentStackPanel preview={message.preview} onOpenPending={setActivePendingId} /> : undefined}
                      content={message.content}
                      onCopy={() => copyText(message.content)}
                      onOpenPending={message.pendingId ? () => setActivePendingId(message.pendingId ?? null) : undefined}
                      onRetry={message.role === 'user' ? () => retry(message.content) : undefined}
                      role={message.role}
                      timestamp={message.createdAt}
                    />
                  </div>
                );
              })}
              {thinking ? <ThinkingBubble /> : null}
              {error ? <ErrorPill message={error} onRetry={() => retry(lastPromptRef.current)} /> : null}
              <div ref={bottomRef} />
            </div>
          </div>

          <Composer disabled={loading} onSend={handleSend} />
        </section>

        <RecordsPanel
          onCreate={handleCreateRecord}
          onDelete={handleDeleteRecord}
          onRestore={handleRestoreRecord}
          onUpdate={handleUpdateRecord}
          records={records}
        />
      </main>

      {settingsOpen ? (
        <AgentSettingsPanel
          onChange={commitSettings}
          onClose={() => setSettingsOpen(false)}
          modelOptions={modelOptions}
          settings={settings}
        />
      ) : null}
      {activePending ? (
        <PendingPreviewModal
          item={activePending}
          onClose={() => setActivePendingId(null)}
          onDiscard={handleDiscardPending}
          onSave={handleSavePending}
        />
      ) : null}
      {toast ? <Toast message={toast} /> : null}
    </div>
  );
}

function TopIcon({ children, label, onClick }: { children: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      aria-label={label}
      className="relative grid h-8 w-8 place-items-center rounded-[12px] border border-[#3a3548] bg-[#242032] text-[#d8c8b8] shadow-sm backdrop-blur transition hover:-translate-y-0.5 hover:bg-[#302a3d] hover:text-[#ff85a1] active:translate-y-0"
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}

function StatusStrip({
  completedCount,
  savedCount,
  todoCount,
}: {
  completedCount: number;
  savedCount: number;
  todoCount: number;
}) {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      <MiniStat icon={<CheckCircle2 size={13} />} label="记录" tone="bg-[#123040] text-[#8bd8ff]" value={String(savedCount)} />
      <MiniStat icon={<ClipboardList size={13} />} label="待办" tone="bg-[#14342a] text-[#7ee0a0]" value={String(todoCount)} />
      <MiniStat icon={<Check size={13} />} label="完成" tone="bg-[#292242] text-[#c8b6ff]" value={String(completedCount)} />
    </div>
  );
}

function MiniStat({ icon, label, tone, value }: { icon: ReactNode; label: string; tone: string; value: string }) {
  return (
    <div className="flex h-8 min-w-[72px] items-center gap-1.5 rounded-[12px] border border-[#3a3548] bg-[#242032] px-2 text-[11px] font-bold text-[#d8c8b8] shadow-sm backdrop-blur">
      <span className={`grid h-5 w-5 place-items-center rounded-full ${tone}`}>{icon}</span>
      <span className="min-w-0">
        <span className="block truncate text-[9px] leading-3 text-[#d8c8b8]/75">{label}</span>
        <span className="block truncate leading-3 text-[#f8f4ed]">{value}</span>
      </span>
    </div>
  );
}

function PendingPreviewStrip({
  items,
  onDiscard,
  onOpen,
}: {
  items: PendingPreviewItem[];
  onDiscard: (pendingId: string) => void;
  onOpen: (pendingId: string) => void;
}) {
  const groups = pendingPreviewGroups(items);
  return (
    <div className="border-b border-[#353044] bg-[#10131b] px-3.5 py-2">
      <div className="mx-auto max-w-3xl space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="flex shrink-0 items-center gap-1 text-[10px] font-bold text-[#d8c8b8]/65">
            <Sparkles size={11} />
          待补全
            <span className="rounded-full bg-[#242032] px-1.5 py-0.5 text-[9px] text-[#f8f4ed]">{items.length}</span>
          </span>
          <button
            aria-label="丢弃最新待确认"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-[10px] text-[#d8c8b8]/45 transition hover:bg-[#3b1728] hover:text-[#ff85a1]"
            onClick={() => onDiscard(items[0].id)}
            title="丢弃最新"
            type="button"
          >
            <X size={13} />
          </button>
        </div>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {groups.map((group) => {
            const Icon = group.icon;
            return (
              <div className="min-w-0 rounded-[12px] border border-[#353044] bg-[#181522] p-1.5" key={group.key}>
                <div className="mb-1 flex items-center gap-1.5 px-1 text-[10px] font-bold text-[#d8c8b8]/65">
                  <Icon size={11} />
                  <span>{group.label}</span>
                  <span className="text-[#d8c8b8]/40">{group.items.length}</span>
                </div>
                <div className="flex min-w-0 gap-1 overflow-x-auto">
                  {group.items.map((item) => (
                    <div className="flex h-7 max-w-[230px] shrink-0 items-center rounded-[9px] border border-[#3a3548] bg-[#111018] text-[11px] font-semibold text-[#d8c8b8]" key={item.id}>
                      <button
                        className="flex min-w-0 flex-1 items-center gap-1.5 px-2 text-left transition hover:text-[#f8f4ed]"
                        onClick={() => onOpen(item.id)}
                        title={pendingPreviewReason(item.preview)}
                        type="button"
                      >
                        <span className="truncate">{item.preview.title || fallbackTitle(item.preview.type, item.preview.content)}</span>
                        <span className="shrink-0 text-[#d8c8b8]/50">{pendingPreviewShortLabel(item.preview)}</span>
                      </button>
                      <button
                        aria-label="删除上下文"
                        className="grid h-6 w-6 shrink-0 place-items-center rounded-[8px] text-[#d8c8b8]/45 transition hover:bg-[#3b1728] hover:text-[#ff85a1]"
                        onClick={() => onDiscard(item.id)}
                        title="删除上下文"
                        type="button"
                      >
                        <X size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

type PendingPreviewGroupKey = 'waiting' | 'hard_stop' | 'ready' | 'draft';

function pendingPreviewGroups(items: PendingPreviewItem[]) {
  const meta: Record<PendingPreviewGroupKey, { label: string; icon: LucideIcon; items: PendingPreviewItem[] }> = {
    waiting: { label: '等你补信息', icon: Clock3, items: [] },
    hard_stop: { label: '高风险确认', icon: FileWarning, items: [] },
    ready: { label: '可确认执行', icon: CheckCircle2, items: [] },
    draft: { label: '草稿候选', icon: FileText, items: [] },
  };
  for (const item of items) {
    meta[pendingPreviewGroupKey(item.preview)].items.push(item);
  }
  return (Object.entries(meta) as Array<[PendingPreviewGroupKey, (typeof meta)[PendingPreviewGroupKey]]>)
    .filter(([, group]) => group.items.length > 0)
    .map(([key, group]) => ({ key, ...group }));
}

function pendingPreviewGroupKey(preview: RecordPreview): PendingPreviewGroupKey {
  const gates = preview.intent_trace?.gate_reasons ?? [];
  if (gates.some((reason) => reason.startsWith('hard_stop_'))) {
    return 'hard_stop';
  }
  if ((preview.missing_fields ?? []).length > 0 || preview.pending_state === 'waiting_field' || preview.context_state === 'waiting_field') {
    return 'waiting';
  }
  if (preview.pending_state === 'ready_to_execute' || preview.context_state === 'ready_to_execute') {
    return 'ready';
  }
  return 'draft';
}

function pendingPreviewShortLabel(preview: RecordPreview) {
  switch (pendingPreviewGroupKey(preview)) {
    case 'waiting':
      return '补';
    case 'hard_stop':
      return '确认';
    case 'ready':
      return '执行';
    default:
      return '草稿';
  }
}

function pendingPreviewReason(preview: RecordPreview) {
  const gates = preview.intent_trace?.gate_reasons ?? [];
  if (gates.length) {
    return gates.join(' / ');
  }
  if (preview.missing_fields?.length) {
    return `缺少 ${preview.missing_fields.join(' / ')}`;
  }
  return candidateDecisionLabel(preview.record_candidates?.[0]?.execution_decision);
}

function PendingPreviewModal({
  item,
  onClose,
  onDiscard,
  onSave,
}: {
  item: PendingPreviewItem;
  onClose: () => void;
  onDiscard: (pendingId: string) => void;
  onSave: (pendingId: string, preview: RecordPreview) => Promise<void>;
}) {
  return (
    <div className="absolute inset-0 z-40 flex items-start justify-center bg-black/50 px-4 py-5 backdrop-blur-sm">
      <div className="w-full max-w-[460px] text-[#f8f4ed]">
        <div className="mb-2 flex items-center justify-between gap-2 rounded-[16px] border border-[#353044] bg-[#111018]/95 px-3 py-2 shadow-sm">
          <div className="min-w-0">
            <div className="text-sm font-bold">补全这条记录</div>
            <div className="truncate text-[11px] font-medium text-[#d8c8b8]/65">{item.created_at}</div>
          </div>
          <button
            aria-label="关闭待确认"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-[12px] text-[#d8c8b8]/70 transition hover:bg-[#302a3d] hover:text-[#ff85a1]"
            onClick={onClose}
            title="关闭"
            type="button"
          >
            <X size={15} />
          </button>
        </div>
        <RecordCard
          onDiscard={() => {
            onDiscard(item.id);
            onClose();
          }}
          onSave={async (preview) => {
            await onSave(item.id, preview);
            onClose();
          }}
          preview={item.preview}
        />
      </div>
    </div>
  );
}

function IntentStackPanel({ preview, onOpenPending }: { preview: RecordPreview; onOpenPending: (pendingId: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const intents = intentItemsForPreview(preview);
  const candidates = preview.record_candidates ?? [];
  const traceItems = traceItemsForPreview(preview);
  if (!intents.length && candidates.length <= 1 && !traceItems.length) {
    return null;
  }
  const summary = intentStackSummary(intents, candidates, traceItems);
  return (
    <div className="w-full max-w-full rounded-[9px] border border-[#353044] bg-[#111018] text-[#d8c8b8]">
      <button
        aria-expanded={expanded}
        className="flex min-h-5 w-full items-center justify-between gap-2 rounded-[9px] px-1.5 py-0.5 text-left transition hover:bg-[#181522]"
        onClick={() => setExpanded((current) => !current)}
        type="button"
      >
        <span className="flex min-w-0 items-center gap-1 text-[10px] font-bold leading-3 text-[#d8c8b8]/72">
          <Sparkles size={11} />
          <span className="shrink-0">意图栈</span>
          <span className="min-w-0 truncate font-semibold text-[#d8c8b8]/50">{summary}</span>
        </span>
        <ChevronDown className={`shrink-0 text-[#d8c8b8]/55 transition ${expanded ? 'rotate-180' : ''}`} size={13} />
      </button>
      {expanded ? (
        <div className="border-t border-[#353044] p-2">
          {intents.length ? (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {intents.map((intent, index) => (
                <span
                  className={`inline-flex max-w-full items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold ${
                    index === 0 ? 'bg-[#14342a] text-[#7ee0a0]' : 'bg-[#242032] text-[#d8c8b8]'
                  }`}
                  key={intent.id ?? `${intent.intent}-${index}`}
                  title={intent.evidence?.join(' / ') ?? ''}
                >
                  <span>{index === 0 ? '主' : '副'}</span>
                  <span className="truncate">{intentLabel(intent)}</span>
                  {typeof intent.confidence === 'number' ? <span>{Math.round(intent.confidence * 100)}%</span> : null}
                </span>
              ))}
            </div>
          ) : null}
          {candidates.length > 1 ? (
            <div className="grid gap-1.5">
              {candidates.map((candidate, index) => {
                const pendingId = candidatePendingId(preview, candidate, index);
                return (
                  <button
                    className="flex min-h-8 items-center justify-between gap-2 rounded-[10px] border border-[#353044] bg-[#181522] px-2 py-1.5 text-left transition hover:border-[#70521f] hover:bg-[#242032]"
                    key={candidate.id ?? `${candidate.intent_id}-${index}`}
                    onClick={() => onOpenPending(pendingId)}
                    type="button"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[11px] font-bold text-[#f8f4ed]">
                        {index === 0 ? '主候选' : '副候选'} · {typeLabel[candidate.type]} · {candidate.title || fallbackTitle(candidate.type, candidate.content)}
                      </span>
                      <span className="mt-0.5 block truncate text-[10px] font-semibold text-[#d8c8b8]/60">{candidateDecisionLabel(candidate.execution_decision)}</span>
                    </span>
                    <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${candidate.primary ? 'bg-[#14342a] text-[#7ee0a0]' : 'bg-[#242032] text-[#d8c8b8]'}`}>
                      {Math.round((candidate.confidence || 0) * 100)}%
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
          {traceItems.length ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {traceItems.map((item) => (
                <span className="rounded-full border border-[#353044] bg-[#181522] px-1.5 py-0.5 text-[10px] font-semibold text-[#d8c8b8]/65" key={item}>
                  {item}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function intentStackSummary(intents: IntentItem[], candidates: RecordCandidate[], traceItems: string[]) {
  const parts: string[] = [];
  if (intents.length) {
    parts.push(`${intents.length} 个意图`);
  }
  if (candidates.length > 1) {
    parts.push(`${candidates.length} 个候选`);
  }
  if (traceItems.length) {
    parts.push(`${traceItems.length} 条 trace`);
  }
  return parts.join(' · ');
}

function intentItemsForPreview(preview: RecordPreview): IntentItem[] {
  const items: IntentItem[] = [];
  if (preview.primary_intent) {
    items.push(preview.primary_intent);
  }
  for (const item of preview.secondary_intents ?? []) {
    items.push(item);
  }
  if (!items.length && preview.intent) {
    items.push({
      id: 'intent_legacy',
      intent: preview.intent,
      category: preview.intent,
      record_type: preview.type,
      confidence: preview.confidence,
      risk: preview.field_risk?.datetime === 'high' || preview.field_risk?.need_reminder === 'high' || preview.field_risk?.target === 'high' ? 'high' : 'low',
    });
  }
  return items;
}

function intentLabel(intent: IntentItem) {
  const category = intent.category || intent.intent || 'unknown';
  const type = intent.record_type && intent.record_type !== 'unknown' ? `/${typeLabel[intent.record_type]}` : '';
  return `${category}${type}`;
}

function candidateDecisionLabel(decision?: RecordCandidate['execution_decision']) {
  switch (decision) {
    case 'auto_execute':
      return '可自动执行';
    case 'pending':
      return '待确认';
    case 'ask_clarify':
      return '需补充';
    case 'no_op':
      return '只回复';
    default:
      return '候选预览';
  }
}

function traceItemsForPreview(preview: RecordPreview) {
  const trace = preview.intent_trace;
  if (!trace) {
    return [];
  }
  const items = [
    trace.state_transition ? `state:${trace.state_transition}` : '',
    trace.continuation_reason ? `ctx:${trace.continuation_reason}` : '',
    ...(trace.risk_reasons ?? []).map((item) => `risk:${item}`),
    ...(trace.gate_reasons ?? []).map((item) => `gate:${item}`),
    ...(trace.discarded_alternatives ?? []).map((item) => `skip:${item}`),
  ];
  return items.filter(Boolean).slice(0, 8);
}

function AgentSettingsPanel({
  modelOptions,
  settings,
  onChange,
  onClose,
}: {
  modelOptions: AgentModelOption[];
  settings: AgentSettings;
  onChange: (settings: AgentSettings) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(settings);
  const selectedModel = modelOptions.find((model) => model.key === draft.model_key) ?? modelOptions.find((model) => model.default) ?? modelOptions[0];
  const selectedPreset = presetOptions.find((option) => option.value === draft.preset) ?? presetOptions[0];

  function submit(event: FormEvent) {
    event.preventDefault();
    onChange({
      preset: draft.preset,
      custom_style: draft.custom_style.trim(),
      nickname: draft.nickname.trim(),
      model_key: draft.model_key,
    });
    onClose();
  }

  return (
    <div className="absolute inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/50 px-3 py-3 backdrop-blur-sm sm:px-4">
      <form
        className="max-h-[calc(100dvh-24px)] w-full max-w-lg overflow-y-auto rounded-[20px] border border-[#353044] bg-[#111018]/95 p-3 text-[#f8f4ed] shadow-float sm:p-3.5"
        onSubmit={submit}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="text-[15px] font-bold leading-5">AI 回复设置</div>
            <div className="mt-0.5 text-[11px] font-semibold leading-4 text-[#d8c8b8]/70">模型生成回复，这里只设置风格和称呼。</div>
          </div>
          <button
            aria-label="关闭设置"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-[12px] border border-[#353044] bg-[#242032] text-[#d8c8b8] transition hover:bg-[#302a3d] hover:text-[#ff85a1]"
            onClick={onClose}
            title="关闭"
            type="button"
          >
            <X size={15} />
          </button>
        </div>

        <div className="mb-3 rounded-[16px] border border-[#353044] bg-[#181522] p-2.5">
          <label className="block text-[11px] font-bold text-[#d8c8b8]/75" htmlFor="agent-model-select">
            模型
          </label>
          {modelOptions.length ? (
            <>
              <div className="relative mt-1.5">
                <select
                  className="h-9 w-full appearance-none rounded-[12px] border border-[#3a3548] bg-[#242032] px-2.5 pr-8 text-xs font-bold text-[#f8f4ed] outline-none transition hover:bg-[#302a3d] focus:border-[#8bd8ff] focus:bg-[#181522]"
                  id="agent-model-select"
                  onChange={(event) => setDraft({ ...draft, model_key: event.target.value })}
                  value={selectedModel?.key ?? ''}
                >
                  {modelOptions.map((model) => (
                    <option key={model.key} value={model.key}>
                      {model.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[#d8c8b8]/65" size={14} />
              </div>
              {selectedModel ? (
                <div className="mt-2 rounded-[12px] border border-[#353044] bg-[#111018] px-2.5 py-1.5">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[11px] font-bold text-[#f8f4ed]">{selectedModel.label}</span>
                    <span className="rounded-full bg-[#123040] px-1.5 py-0.5 text-[10px] font-bold leading-3 text-[#8bd8ff]">
                      {selectedModel.default ? '默认' : '已选'}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[11px] font-semibold leading-4 text-[#d8c8b8]/68">{selectedModel.description || selectedModel.model}</p>
                </div>
              ) : null}
            </>
          ) : (
            <div className="mt-1.5 rounded-[12px] border border-[#353044] bg-[#242032] px-2.5 py-2 text-[11px] font-semibold text-[#d8c8b8]/75">
              模型列表加载失败，请确认后端服务已启动。
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
          {presetOptions.map((option) => (
            <button
              className={`h-9 rounded-[12px] border px-2 text-center text-xs font-bold transition hover:-translate-y-px ${
                draft.preset === option.value
                  ? 'border-[#b85d70] bg-[#70521f]/75 text-[#f8f4ed] shadow-sm'
                  : 'border-[#353044] bg-[#242032] text-[#d8c8b8] hover:bg-[#302a3d]'
              }`}
              key={option.value}
              onClick={() => setDraft({ ...draft, preset: option.value })}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 rounded-[12px] border border-[#353044] bg-[#181522] px-2.5 py-1.5 text-[11px] font-semibold leading-4 text-[#d8c8b8]/70">
          {selectedPreset.description}
        </p>

        <div className="mt-3 grid gap-2 sm:grid-cols-[150px_minmax(0,1fr)]">
          <label className="block text-[11px] font-bold text-[#d8c8b8]/75">
            称呼
            <input
              className="mt-1 h-9 w-full rounded-[12px] border border-[#3a3548] bg-[#181522] px-2.5 text-xs font-semibold text-[#f8f4ed] outline-none placeholder:text-[#d8c8b8]/55 focus:border-[#8bd8ff]"
              onChange={(event) => setDraft({ ...draft, nickname: event.target.value })}
              placeholder="比如：阿明"
              value={draft.nickname}
            />
          </label>
          <label className="block text-[11px] font-bold text-[#d8c8b8]/75">
            自定义风格
            <input
              className="mt-1 h-9 w-full rounded-[12px] border border-[#3a3548] bg-[#181522] px-2.5 text-xs font-semibold text-[#f8f4ed] outline-none placeholder:text-[#d8c8b8]/55 focus:border-[#8bd8ff]"
              onChange={(event) => setDraft({ ...draft, custom_style: event.target.value, preset: 'custom' })}
              placeholder="比如：calm, strategic, brief"
              value={draft.custom_style}
            />
          </label>
        </div>

        <div className="mt-3 flex justify-end gap-1.5">
          <button
            className="h-9 rounded-[12px] border border-[#353044] bg-[#242032] px-3 text-xs font-bold text-[#d8c8b8] transition hover:bg-[#302a3d] hover:text-[#ff85a1]"
            onClick={onClose}
            type="button"
          >
            取消
          </button>
          <button
            className="h-9 rounded-[12px] bg-[#70521f] px-3 text-xs font-bold text-[#f8f4ed] shadow-sm transition hover:-translate-y-px hover:bg-[#3a202d]"
            type="submit"
          >
            保存偏好
          </button>
        </div>
      </form>
    </div>
  );
}

function RecordsPanel({
  records,
  onCreate,
  onDelete,
  onRestore,
  onUpdate,
}: {
  records: RecordItem[];
  onCreate: (draft: RecordDraft) => void;
  onDelete: (id: string) => void;
  onRestore: (id: string) => void;
  onUpdate: (id: string, draft: RecordDraft) => void;
}) {
  const [activeTab, setActiveTab] = useState<RecordTab>('all');
  const [query, setQuery] = useState('');
  const [formMode, setFormMode] = useState<'create' | 'edit' | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<RecordDraft>(() => createEmptyDraft());

  const visibleRecords = useMemo(() => {
    const searchText = query.trim().toLowerCase();
    return records.filter((record) => {
      const inTrash = record.status === 'discarded';
      const matchTab =
        activeTab === 'all'
          ? !inTrash
          : activeTab === 'trash'
            ? inTrash
            : activeTab === 'pending'
              ? !inTrash && record.status === 'need_confirmation'
              : !inTrash && record.type === activeTab;
      const matchSearch =
        !searchText ||
        `${record.title} ${record.content} ${typeLabel[record.type]} ${record.datetime_iso ?? ''}`
          .toLowerCase()
          .includes(searchText);
      return matchTab && matchSearch;
    });
  }, [activeTab, query, records]);

  function startCreate() {
    const initialType = activeTab === 'all' || activeTab === 'pending' || activeTab === 'trash' ? 'todo' : activeTab;
    setDraft(createEmptyDraft(initialType));
    setEditingId(null);
    setFormMode('create');
  }

  function startEdit(record: RecordItem) {
    setDraft(draftFromRecord(record));
    setEditingId(record.id);
    setFormMode('edit');
  }

  function submitDraft(event: FormEvent) {
    event.preventDefault();
    if (!draft.content.trim()) {
      return;
    }
    if (formMode === 'edit' && editingId) {
      onUpdate(editingId, draft);
    } else {
      onCreate(draft);
    }
    setFormMode(null);
    setEditingId(null);
    setDraft(createEmptyDraft(activeTab === 'all' || activeTab === 'pending' || activeTab === 'trash' ? 'todo' : activeTab));
  }

  function toggleDone(record: RecordItem) {
    onUpdate(record.id, {
      ...draftFromRecord(record),
      status: record.status === 'completed' ? 'saved' : 'completed',
    });
  }

  return (
    <aside className="relative flex min-h-[500px] min-w-0 flex-col overflow-hidden rounded-[18px] border border-[#353044] bg-[#0f1018] text-[#f8f4ed] shadow-sm backdrop-blur lg:min-h-0">
      <div className="border-b border-[#353044] bg-[#181522] px-3 py-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[12px] bg-[#14342a] text-[#7ee0a0]">
              <ListChecks size={14} />
            </span>
            <div className="min-w-0">
              <div className="text-[13px] font-bold text-[#f8f4ed]">记录</div>
              <div className="truncate text-[11px] font-medium text-[#d8c8b8]/70">Records API · {records.length}</div>
            </div>
          </div>
          <button
            aria-label="新增记录"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-[12px] bg-[#70521f] text-[#f8f4ed] shadow-pop transition hover:-translate-y-0.5 hover:bg-[#3a202d] active:translate-y-0"
            onClick={startCreate}
            title="新增"
            type="button"
          >
            <Plus size={14} />
          </button>
        </div>

        <div className="mb-2 grid grid-cols-3 gap-1.5">
          {recordTabs.map((tab) => (
            <RecordTabButton
              active={activeTab === tab.value}
              count={countByTab(records, tab.value)}
              icon={tab.icon}
              key={tab.value}
              label={tab.label}
              onClick={() => setActiveTab(tab.value)}
              tab={tab.value}
            />
          ))}
        </div>

        <label className="flex h-8 items-center gap-1.5 rounded-[12px] border border-[#3a3548] bg-[#242032] px-2.5 text-[#d8c8b8] shadow-sm">
          <Search size={13} className="shrink-0 text-[#d8c8b8]/60" />
          <input
            aria-label="搜索记录"
            className="min-w-0 flex-1 border-0 bg-transparent text-xs font-medium text-[#f8f4ed] outline-none placeholder:text-[#d8c8b8]/55"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索"
            value={query}
          />
        </label>
      </div>

      <div className="flex-1 overflow-y-auto bg-[#0f1018] p-3">
        <div className="space-y-2">
          {visibleRecords.length ? (
            visibleRecords.map((record) => (
              <RecordRow
                key={record.id}
                onDelete={onDelete}
                onEdit={startEdit}
                onRestore={onRestore}
                onToggleDone={toggleDone}
                record={record}
              />
            ))
          ) : (
            <EmptyRecords onCreate={startCreate} />
          )}
        </div>
      </div>

      {formMode ? (
        <div className="absolute inset-0 z-20 flex items-start justify-center bg-black/45 p-3 backdrop-blur-sm">
          <RecordForm
            draft={draft}
            mode={formMode}
            onCancel={() => {
              setFormMode(null);
              setEditingId(null);
            }}
            onChange={setDraft}
            onSubmit={submitDraft}
          />
        </div>
      ) : null}
    </aside>
  );
}

function RecordTabButton({
  active,
  count,
  icon: Icon,
  label,
  onClick,
  tab,
}: {
  active: boolean;
  count: number;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  tab: RecordTab;
}) {
  const activeTone =
    tab === 'all'
      ? 'data-[active=true]:bg-[#302a3d] data-[active=true]:text-[#f8f4ed]'
      : tab === 'pending'
        ? typeMeta.unknown.tab
        : tab === 'trash'
          ? 'data-[active=true]:bg-[#3b1728] data-[active=true]:text-[#ff85a1]'
          : typeMeta[tab].tab;
  return (
    <button
      className={`flex h-8 min-w-0 items-center justify-center gap-1 rounded-[12px] border border-[#3a3548] bg-[#242032] px-1.5 text-[11px] font-bold text-[#d8c8b8]/70 shadow-sm transition hover:-translate-y-0.5 hover:bg-[#302a3d] active:translate-y-0 ${activeTone}`}
      data-active={active}
      onClick={onClick}
      type="button"
    >
      <Icon size={13} className="shrink-0" />
      <span className="truncate">{label}</span>
      <span className="rounded-full bg-[#111018] px-1.5 py-0.5 text-[10px] text-[#d8c8b8]/70">{count}</span>
    </button>
  );
}

function RecordForm({
  draft,
  mode,
  onCancel,
  onChange,
  onSubmit,
}: {
  draft: RecordDraft;
  mode: 'create' | 'edit';
  onCancel: () => void;
  onChange: (draft: RecordDraft) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <form className="w-full max-w-[360px] rounded-[24px] border border-[#353044] bg-[#111018]/95 p-3 text-[#f8f4ed] shadow-float" onSubmit={onSubmit}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-bold text-[#f8f4ed]">
          <span className="grid h-8 w-8 place-items-center rounded-[14px] bg-[#3a202d] text-[#ff85a1]">
            {mode === 'create' ? <Plus size={16} /> : <Edit3 size={16} />}
          </span>
          {mode === 'create' ? '新增' : '编辑'}
        </div>
        <button
          aria-label="关闭表单"
          className="grid h-8 w-8 place-items-center rounded-[14px] text-[#d8c8b8]/70 transition hover:bg-[#302a3d] hover:text-[#ff85a1]"
          onClick={onCancel}
          title="关闭"
          type="button"
        >
          <X size={16} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <select
          aria-label="记录类型"
          className="h-11 min-w-0 rounded-[18px] border border-[#3a3548] bg-[#181522] px-3 text-sm font-semibold text-[#f8f4ed] outline-none"
          onChange={(event) => onChange({ ...draft, type: event.target.value as RecordType })}
          value={draft.type}
        >
          {Object.entries(typeLabel).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <label className="flex h-11 min-w-0 items-center gap-2 rounded-[18px] border border-[#3a3548] bg-[#181522] px-3 text-[#d8c8b8]">
          <CalendarClock size={15} className="shrink-0 text-[#d8c8b8]/60" />
          <input
            aria-label="时间"
            className="min-w-0 flex-1 border-0 bg-transparent text-sm font-semibold text-[#f8f4ed] outline-none placeholder:text-[#d8c8b8]/55"
            onChange={(event) => onChange({ ...draft, datetime: event.target.value })}
            placeholder="YYYY-MM-DD HH:mm:ss"
            value={draft.datetime}
          />
        </label>
      </div>

      <input
        aria-label="标题"
        className="mt-2 h-11 w-full rounded-[18px] border border-[#3a3548] bg-[#181522] px-3 text-sm font-semibold text-[#f8f4ed] outline-none placeholder:text-[#d8c8b8]/55"
        onChange={(event) => onChange({ ...draft, title: event.target.value })}
        placeholder="标题"
        value={draft.title}
      />

      <textarea
        aria-label="内容"
        className="mt-2 min-h-24 w-full resize-none rounded-[18px] border border-[#3a3548] bg-[#181522] px-3 py-2 text-sm font-medium leading-6 text-[#f8f4ed] outline-none placeholder:text-[#d8c8b8]/55"
        onChange={(event) => onChange({ ...draft, content: event.target.value })}
        placeholder="内容"
        value={draft.content}
      />

      <div className="mt-2 flex items-center justify-between gap-2">
        <label className="flex h-10 flex-1 items-center gap-2 rounded-[17px] bg-[#181522] px-3 text-xs font-bold text-[#d8c8b8]">
          <Bell size={15} />
          <span>提醒</span>
          <input
            checked={draft.need_reminder}
            className="ml-auto h-4 w-4 accent-leaf"
            onChange={(event) => onChange({ ...draft, need_reminder: event.target.checked })}
            type="checkbox"
          />
        </label>
        <button
          aria-label="保存记录"
          className="flex h-10 items-center gap-1.5 rounded-[17px] bg-[#70521f] px-3 text-xs font-bold text-[#f8f4ed] shadow-pop transition hover:-translate-y-0.5 hover:bg-[#3a202d] active:translate-y-0 disabled:bg-[#2b2735] disabled:text-[#d8c8b8]/70 disabled:shadow-none"
          disabled={!draft.content.trim()}
          type="submit"
        >
          <Save size={15} />
          保存
        </button>
      </div>
    </form>
  );
}

function RecordRow({
  record,
  onDelete,
  onEdit,
  onRestore,
  onToggleDone,
}: {
  record: RecordItem;
  onDelete: (id: string) => void;
  onEdit: (record: RecordItem) => void;
  onRestore: (id: string) => void;
  onToggleDone: (record: RecordItem) => void;
}) {
  const meta = typeMeta[record.type];
  const Icon = meta.icon;
  const completed = record.status === 'completed';
  const discarded = record.status === 'discarded';

  return (
    <article className={`rounded-[16px] border border-[#353044] bg-[#181522] px-2.5 py-2.5 shadow-sm ${completed || discarded ? 'opacity-70' : ''}`}>
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-[11px] ${meta.tone}`}>
            <Icon size={13} />
          </span>
          <div className="min-w-0">
            <div className={`truncate text-xs font-bold text-[#f8f4ed] ${completed ? 'line-through' : ''}`}>{record.title || fallbackTitle(record.type, record.content)}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] font-bold text-[#d8c8b8]/65">
              <span>{typeLabel[record.type]}</span>
              {record.datetime_iso ? (
                <>
                  <span>·</span>
                  <span className="inline-flex min-w-0 items-center gap-1">
                    <Clock3 size={10} />
                    <span className="truncate">{record.datetime_iso}</span>
                  </span>
                </>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {record.type === 'todo' && !discarded ? (
            <button
              aria-label={completed ? '恢复待办' : '完成待办'}
              className={`grid h-6 w-6 place-items-center rounded-[10px] transition ${
                completed ? 'bg-[#14342a] text-[#7ee0a0]' : 'text-[#d8c8b8]/70 hover:bg-[#14342a] hover:text-[#7ee0a0]'
              }`}
              onClick={() => onToggleDone(record)}
              title={completed ? '恢复' : '完成'}
              type="button"
            >
              <CheckCircle2 size={12} />
            </button>
          ) : null}
          {discarded ? (
            <button
              aria-label="恢复记录"
              className="grid h-6 w-6 place-items-center rounded-[10px] text-[#d8c8b8]/70 transition hover:bg-[#14342a] hover:text-[#7ee0a0]"
              onClick={() => onRestore(record.id)}
              title="恢复"
              type="button"
            >
              <Undo2 size={12} />
            </button>
          ) : (
            <>
              <button
                aria-label="编辑记录"
                className="grid h-6 w-6 place-items-center rounded-[10px] text-[#d8c8b8]/70 transition hover:bg-[#292242] hover:text-[#c8b6ff]"
                onClick={() => onEdit(record)}
                title="编辑"
                type="button"
              >
                <Edit3 size={12} />
              </button>
              <button
                aria-label="删除记录"
                className="grid h-6 w-6 place-items-center rounded-[10px] text-[#d8c8b8]/70 transition hover:bg-[#3b1728] hover:text-[#ff85a1]"
                onClick={() => onDelete(record.id)}
                title="删除"
                type="button"
              >
                <Trash2 size={12} />
              </button>
            </>
          )}
        </div>
      </div>
      <p className="line-clamp-2 rounded-[12px] bg-[#111018] px-2 py-1.5 text-[11px] font-medium leading-4 text-[#d8c8b8]">{record.content}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] font-bold text-[#d8c8b8]/65">
        <span className="inline-flex items-center gap-1">
          <FileText size={10} />
          {formatDisplayTimestamp(record.updated_at)}
        </span>
        {record.need_reminder ? (
          <span className="inline-flex items-center gap-1 text-[#ff85a1]">
            <Bell size={10} />
            提醒
          </span>
        ) : null}
        {discarded ? (
          <span className="inline-flex items-center gap-1 text-[#ff85a1]">
            <Trash2 size={10} />
            回收站
          </span>
        ) : null}
      </div>
    </article>
  );
}

function EmptyRecords({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="rounded-[24px] border border-dashed border-[#353044] bg-[#181522] p-5 text-center">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-[20px] bg-[#14342a] text-[#7ee0a0]">
        <ListChecks size={20} />
      </div>
      <div className="mt-3 text-sm font-bold text-[#f8f4ed]">暂无记录</div>
      <button
        className="mx-auto mt-3 flex h-10 items-center gap-1.5 rounded-[17px] bg-[#242032] px-3 text-xs font-bold text-[#d8c8b8] shadow-sm transition hover:-translate-y-0.5 hover:text-[#ff85a1] active:translate-y-0"
        onClick={onCreate}
        type="button"
      >
        <Plus size={15} />
        新增
      </button>
    </div>
  );
}

function ThinkingBubble() {
  return (
    <div className="flex justify-start">
      <div className="vimo-thinking-sign" role="status" aria-live="polite">
        正在思考
      </div>
    </div>
  );
}

function ErrorPill({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-[20px] border border-berry/20 bg-berry-soft px-3 py-2 text-sm text-berry">
      <span className="min-w-0 truncate">{message}</span>
      <button aria-label="重试" className="grid h-8 w-8 shrink-0 place-items-center rounded-[15px] bg-[#242032]" onClick={onRetry} type="button">
        <RefreshCw size={15} />
      </button>
    </div>
  );
}

function NoticeMessage({ content }: { content: string }) {
  return (
    <div className="flex items-center gap-3 py-1.5 text-[#d8c8b8]/54" role="status" aria-live="polite">
      <div className="h-px flex-1 bg-[#353044]/72" />
      <div className="flex max-w-[72%] items-center gap-1.5 text-center text-[12px] font-semibold leading-5">
        <Info className="shrink-0 text-[#d8c8b8]/48" size={14} />
        <span className="min-w-0 whitespace-normal break-words">{content}</span>
      </div>
      <div className="h-px flex-1 bg-[#353044]/72" />
    </div>
  );
}

function Toast({ message }: { message: string }) {
  return (
    <div className="pointer-events-none absolute left-1/2 top-5 z-30 -translate-x-1/2 rounded-full bg-[#242032]/90 px-4 py-2 text-sm font-semibold text-[#f8f4ed] shadow-float backdrop-blur">
      {message}
    </div>
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function countByTab(records: RecordItem[], tab: RecordTab) {
  if (tab === 'all') {
    return records.filter((record) => record.status !== 'discarded').length;
  }
  if (tab === 'pending') {
    return records.filter((record) => record.status !== 'discarded' && record.status === 'need_confirmation').length;
  }
  if (tab === 'trash') {
    return records.filter((record) => record.status === 'discarded').length;
  }
  return records.filter((record) => record.status !== 'discarded' && record.type === tab).length;
}

function createEmptyDraft(type: RecordType = 'todo'): RecordDraft {
  return {
    type,
    title: '',
    content: '',
    datetime: '',
    need_reminder: false,
    status: 'saved',
  };
}

function draftFromRecord(record: RecordItem): RecordDraft {
  return {
    type: record.type,
    title: record.title,
    content: record.content,
    datetime: record.datetime_iso ?? record.datetime_text ?? '',
    need_reminder: record.need_reminder,
    status: record.status,
  };
}

function recordInputFromDraft(draft: RecordDraft): RecordWriteInput {
  const datetime = normalizeText(draft.datetime);
  return {
    type: draft.type,
    title: normalizeText(draft.title) ?? fallbackTitle(draft.type, draft.content),
    content: draft.content.trim(),
    datetime_text: null,
    datetime_iso: datetime,
    need_reminder: draft.need_reminder,
    confidence: 1,
    status: draft.status,
    missing_fields: [],
    deleted_at: draft.status === 'discarded' ? formatLocalTimestamp() : null,
    previous_status: draft.status === 'discarded' ? 'saved' : null,
  };
}

function recordPatchFromDraft(draft: RecordDraft): Partial<RecordWriteInput> {
  const datetime = normalizeText(draft.datetime);
  return {
    type: draft.type,
    title: normalizeText(draft.title) ?? fallbackTitle(draft.type, draft.content),
    content: draft.content.trim(),
    datetime_text: null,
    datetime_iso: datetime,
    need_reminder: draft.need_reminder,
    confidence: 1,
    status: draft.status,
    missing_fields: [],
    deleted_at: draft.status === 'discarded' ? formatLocalTimestamp() : '',
    previous_status: draft.status === 'discarded' ? 'saved' : '',
  };
}

function previewPatch(preview: RecordPreview, record: RecordItem): Partial<RecordWriteInput> {
  const status = preview.status === 'ready' ? 'saved' : preview.status;
  return {
    type: preview.type,
    title: preview.title,
    content: preview.content,
    datetime_text: preview.datetime_text,
    datetime_iso: preview.datetime_iso,
    need_reminder: preview.need_reminder,
    confidence: preview.confidence,
    status,
    missing_fields: preview.status === 'ready' ? [] : preview.missing_fields,
    deleted_at: status === 'discarded' ? record.deleted_at ?? formatLocalTimestamp() : '',
    previous_status: status === 'discarded' ? record.previous_status ?? 'saved' : '',
  };
}

function softDeletePatch(record: RecordItem): Partial<RecordWriteInput> {
  return {
    status: 'discarded' as RecordStatus,
    deleted_at: record.deleted_at ?? formatLocalTimestamp(),
    previous_status: record.status === 'discarded' ? record.previous_status ?? 'saved' : record.status,
  };
}

function restorePatch(record: RecordItem): Partial<RecordWriteInput> {
  const status = record.previous_status && record.previous_status !== 'discarded' ? record.previous_status : 'saved';
  return {
    status,
    deleted_at: '',
    previous_status: '',
  };
}

function normalizeRecordItem(record: RecordItem): RecordItem {
  return {
    ...record,
    type: isRecordType(record.type) ? record.type : 'unknown',
    status: isRecordStatus(record.status) ? record.status : 'saved',
    missing_fields: Array.isArray(record.missing_fields) ? record.missing_fields : [],
    reply: typeof record.reply === 'string' ? record.reply : '',
    datetime_text: typeof record.datetime_text === 'string' ? record.datetime_text : null,
    datetime_iso: typeof record.datetime_iso === 'string' ? record.datetime_iso : null,
    created_at: formatDisplayTimestamp(record.created_at),
    updated_at: formatDisplayTimestamp(record.updated_at),
    deleted_at: typeof record.deleted_at === 'string' ? formatDisplayTimestamp(record.deleted_at) : null,
    previous_status: isRecordStatus(record.previous_status) ? record.previous_status : null,
  };
}

function inferContextAction(preview: RecordPreview): 'open' | 'update' | 'close' | 'none' {
  if (preview.intent === 'answer_query' || preview.intent === 'joke_response' || preview.intent === 'config_update') {
    return 'none';
  }
  if (preview.intent === 'update_pending' || preview.intent === 'confirm_pending') {
    return 'update';
  }
  if (preview.intent === 'clarify' || preview.status === 'need_confirmation' || (preview.missing_fields ?? []).length > 0) {
    return preview.context_target_id || preview.target_id ? 'update' : 'open';
  }
  return 'none';
}

function openContextFromPreview(
  preview: RecordPreview,
  id: string,
  now: string,
  userContent: string,
  assistantContent: string,
): OpenContextItem {
  return {
    id,
    preview: {
      ...preview,
      target_id: preview.target_id ?? id,
      context_target_id: preview.context_target_id ?? id,
    },
    created_at: now,
    updated_at: now,
    last_user_message: userContent,
    last_assistant_reply: assistantContent,
  };
}

export function mergeOpenContextPreview(current: RecordPreview, next: RecordPreview): RecordPreview {
  return {
    ...current,
    ...next,
    type: next.type !== 'unknown' ? next.type : current.type,
    title: next.title?.trim() ? next.title : current.title,
    content: next.content?.trim() ? next.content : current.content,
    datetime_text: next.datetime_text ?? current.datetime_text,
    datetime_iso: next.datetime_iso ?? current.datetime_iso,
    missing_fields: next.missing_fields ?? current.missing_fields,
    field_confidence: next.field_confidence ?? current.field_confidence,
    field_risk: next.field_risk ?? current.field_risk,
    pending_state: next.pending_state ?? current.pending_state,
    context_state: next.context_state ?? next.pending_state ?? current.context_state ?? current.pending_state,
    primary_intent: next.primary_intent ?? current.primary_intent,
    secondary_intents: next.secondary_intents ?? current.secondary_intents,
    record_candidates: next.record_candidates ?? current.record_candidates,
    execution_plan: next.execution_plan ?? current.execution_plan,
    reply_strategy: next.reply_strategy ?? current.reply_strategy,
    intent_trace: next.intent_trace ?? current.intent_trace,
    related_ids: next.related_ids ?? current.related_ids,
    target_id: next.target_id ?? next.context_target_id ?? current.target_id ?? current.context_target_id,
    context_target_id: next.context_target_id ?? next.target_id ?? current.context_target_id ?? current.target_id,
  };
}

function secondaryPreviewsFromCandidates(preview: RecordPreview, activeTaskId: string | null): PendingPreviewItem[] {
  const candidates = preview.record_candidates ?? [];
  if (candidates.length <= 1) {
    return [];
  }
  const createdAt = formatLocalTimestamp();
  return candidates
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate, index }) => index > 0 && candidate.should_preview !== false && candidate.execution_decision !== 'no_op')
    .map(({ candidate, index }) => {
      const id = candidatePendingId(preview, candidate, index, activeTaskId);
      return {
        id,
        preview: previewFromCandidate(preview, candidate, id),
        created_at: createdAt,
      };
    });
}

function previewFromCandidate(source: RecordPreview, candidate: RecordCandidate, id: string): RecordPreview {
  const recordAction = candidate.record_action ?? source.record_action;
  return {
    ...source,
    type: candidate.type,
    title: candidate.title,
    content: candidate.content,
    datetime_text: candidate.datetime_text,
    datetime_iso: candidate.datetime_iso,
    need_reminder: candidate.need_reminder,
    confidence: candidate.confidence,
    field_confidence: candidate.field_confidence ?? source.field_confidence,
    field_risk: candidate.field_risk ?? source.field_risk,
    status: candidate.status,
    missing_fields: candidate.missing_fields,
    intent: intentForCandidate(source, candidate),
    record_action: recordAction,
    target_id: targetIdForCandidate(candidate, recordAction),
    related_ids: candidate.related_ids ?? [],
    context_action: candidate.execution_decision === 'pending' || candidate.execution_decision === 'ask_clarify' ? 'open' : 'none',
    context_target_id: id,
    should_preview: true,
    record_candidates: [candidate],
  };
}

function targetIdForCandidate(candidate: RecordCandidate, action?: RecordAction) {
  if (candidate.target_id) {
    return candidate.target_id;
  }
  if ((action === 'update' || action === 'delete') && candidate.related_ids?.length === 1) {
    return candidate.related_ids[0];
  }
  return null;
}

function intentForCandidate(source: RecordPreview, candidate: RecordCandidate): AgentIntent | undefined {
  const intent = [...(source.secondary_intents ?? []), source.primary_intent].find((item) => item?.id === candidate.intent_id)?.intent;
  return intent ?? source.intent;
}

function candidatePendingId(preview: RecordPreview, candidate: RecordCandidate, index: number, activeTaskId?: string | null) {
  const base = candidate.id?.trim() || `${candidate.intent_id || 'candidate'}_${index + 1}`;
  return activeTaskId && index === 0 ? activeTaskId : `cand_${base}`;
}

function buildOpenContextPayload(openContexts: OpenContextItem[], pendingPreviews: PendingPreviewItem[]): AgentContextRecord[] {
  const contexts = openContexts.map(contextRecordFromOpenContext);
  const seen = new Set(contexts.map((context) => context.id).filter(Boolean));
  for (const item of pendingPreviews) {
    if (seen.has(item.id)) {
      continue;
    }
    contexts.push(contextRecordFromPendingPreview(item));
    seen.add(item.id);
  }
  return contexts;
}

export function buildClosedContextPayload(records: RecordItem[]): AgentContextRecord[] {
  return [...records]
    .sort((left, right) => timestampValue(right.updated_at || right.created_at) - timestampValue(left.updated_at || left.created_at))
    .slice(0, maxClosedContexts)
    .map(contextRecordFromRecord);
}

function recentConversationMessages(messages: Message[]): ConversationMessage[] {
  return messages
    .filter((message): message is Message & { role: 'user' | 'assistant' } => message.role !== 'notice' && Boolean(message.content.trim()))
    .slice(-6)
    .map((message) => ({
      role: message.role,
      content: message.content.trim(),
      created_at: message.createdAt,
    }));
}

function contextRecordFromPendingPreview(item: PendingPreviewItem): AgentContextRecord {
  return {
    ...contextRecordFromPreview(item.preview, item.id),
    layer: 'open',
    context_kind: item.preview.record_action === 'delete' ? 'pending_delete' : 'pending_record',
    created_at: item.created_at,
    updated_at: item.created_at,
  };
}

function contextRecordFromPreview(preview: RecordPreview, id?: string): AgentContextRecord {
  return {
    id,
    layer: 'open',
    context_kind: 'record',
    type: preview.type,
    title: preview.title,
    content: preview.content,
    datetime_text: preview.datetime_text,
    datetime_iso: preview.datetime_iso,
    need_reminder: preview.need_reminder,
    status: preview.status,
    intent: preview.intent,
    record_action: preview.record_action,
    target_id: preview.target_id ?? null,
    related_ids: preview.related_ids ?? [],
    field_confidence: preview.field_confidence,
    field_risk: preview.field_risk,
    record_candidates: preview.record_candidates,
    execution_plan: preview.execution_plan,
    pending_state: preview.pending_state,
    context_state: preview.context_state ?? preview.pending_state,
    missing_fields: preview.missing_fields,
    deleted_at: null,
  };
}

function contextRecordFromOpenContext(item: OpenContextItem): AgentContextRecord {
  return {
    ...contextRecordFromPreview(item.preview, item.id),
    layer: 'open',
    context_kind: item.preview.intent === 'clarify' ? 'clarification' : 'record',
    created_at: item.created_at,
    updated_at: item.updated_at,
    last_user_message: item.last_user_message ?? null,
    last_assistant_reply: item.last_assistant_reply ?? null,
  };
}

function contextRecordFromRecord(record: RecordItem): AgentContextRecord {
  return {
    id: record.id,
    layer: 'closed',
    context_kind: 'record',
    type: record.type,
    title: record.title,
    content: record.content,
    datetime_text: record.datetime_text,
    datetime_iso: record.datetime_iso,
    need_reminder: record.need_reminder,
    status: record.status,
    pending_state: record.pending_state,
    context_state: record.context_state,
    missing_fields: record.missing_fields,
    deleted_at: record.deleted_at ?? null,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

function replyProfileFromSettings(settings: AgentSettings): ReplyProfile {
  return {
    preset: settings.preset,
    custom_style: settings.custom_style,
    nickname: settings.nickname,
  };
}

export function sanitizeSettingsPatch(patch: SettingsPatch, modelOptions: AgentModelOption[]): SettingsPatch | null {
  const next: SettingsPatch = {};
  if (patch.preset !== undefined) {
    next.preset = patch.preset;
  }
  if (patch.custom_style !== undefined) {
    next.custom_style = patch.custom_style;
  }
  if (patch.nickname !== undefined) {
    next.nickname = patch.nickname;
  }
  if (patch.model_key !== undefined) {
    const modelKey = patch.model_key.trim();
    const allowedModelKeys = new Set(modelOptions.map((model) => model.key));
    if (!modelKey || !allowedModelKeys.has(modelKey)) {
      return Object.keys(next).length > 0 ? next : null;
    }
    next.model_key = modelKey;
  }
  return Object.keys(next).length > 0 ? next : null;
}

function selectedModelKey(settings: AgentSettings) {
  const modelKey = settings.model_key?.trim();
  return modelKey || undefined;
}

function shouldShowPreview(preview: RecordPreview) {
  return preview.should_preview !== false && preview.intent !== 'answer_query' && preview.intent !== 'joke_response' && preview.intent !== 'config_update';
}

function taskIdForPreview(preview: RecordPreview, activeContextPendingId: string | null) {
  return preview.context_target_id ?? preview.target_id ?? activeContextPendingId ?? null;
}

function confirmedPendingPreview(preview: RecordPreview, taskId: string | null, pendingPreviews: PendingPreviewItem[] = []): RecordPreview | null {
  if (preview.intent !== 'confirm_pending' && preview.intent !== 'update_pending') {
    return null;
  }
  const targetId = preview.context_target_id ?? preview.target_id ?? taskId;
  if (!targetId) {
    return null;
  }
  const pending = pendingPreviews.find((item) => item.id === targetId);
  if (!pending) {
    return null;
  }
  const action = pending.preview.record_action ?? defaultRecordAction(pending.preview);
  if (action === 'none') {
    return null;
  }
  if (preview.status === 'need_confirmation' && (preview.missing_fields ?? []).length > 0) {
    return null;
  }
  return mergePendingPreview(pending.preview, preview, targetId);
}

export function mergePendingPreview(pending: RecordPreview, update: RecordPreview, targetId: string): RecordPreview {
  return {
    ...mergeOpenContextPreview(pending, update),
    status: 'ready',
    missing_fields: [],
    context_target_id: targetId,
    target_id: update.target_id ?? pending.target_id ?? targetId,
    record_action: update.record_action ?? pending.record_action,
    intent: update.intent ?? pending.intent,
  };
}

function shouldOpenTaskContext(preview: RecordPreview) {
  return shouldShowPreview(preview) && inferContextAction(preview) !== 'none';
}

function previewWithTaskId(preview: RecordPreview, taskId: string): RecordPreview {
  if (preview.record_action === 'create' || preview.intent === 'new_record' || preview.intent === 'clarify' || preview.intent === 'duplicate_check' || preview.intent === 'similar_check') {
    return {
      ...preview,
      context_target_id: preview.context_target_id ?? taskId,
    };
  }
  return {
    ...preview,
    target_id: preview.target_id ?? taskId,
    context_target_id: preview.context_target_id ?? taskId,
  };
}

export function shouldAutoSavePreview(preview: RecordPreview, records: RecordItem[], activeContextPendingId: string | null, feedback: RiskFeedbackState) {
  if (!shouldShowPreview(preview)) {
    return false;
  }
  const action = preview.record_action ?? defaultRecordAction(preview);
  if (action === 'delete') {
    return canAutoDeletePreview(preview, records, activeContextPendingId);
  }
  if (preview.status !== 'ready' || (preview.missing_fields ?? []).length > 0) {
    return false;
  }
  if (hasBlockingHardStopGate(preview)) {
    return false;
  }
  if (preview.need_reminder && !preview.datetime_iso) {
    return false;
  }
  if (!passesRiskMatrix(preview, feedback)) {
    return false;
  }
  if (action === 'update') {
    if (!preview.target_id) {
      return Boolean(activeContextPendingId && isPendingDraftContinuation(preview));
    }
    return records.some((record) => record.id === preview.target_id) || preview.target_id === activeContextPendingId;
  }
  return action === 'create';
}

function canAutoDeletePreview(preview: RecordPreview, records: RecordItem[], activeContextPendingId: string | null) {
  const targetId = preview.target_id ?? preview.related_ids?.[0] ?? null;
  if (!targetId) {
    return false;
  }
  if ((preview.related_ids ?? []).length > 1) {
    return false;
  }
  const gateReasons = preview.intent_trace?.gate_reasons ?? [];
  if (gateReasons.some((reason) => reason === 'hard_stop_target_not_unique' || reason === 'target_not_unique' || reason === 'target_missing')) {
    return false;
  }
  const targetConfidence = preview.field_confidence?.target ?? preview.confidence;
  if (typeof targetConfidence === 'number' && targetConfidence < highRiskThreshold(emptyRiskFeedback, 'target')) {
    return false;
  }
  return records.some((record) => record.id === targetId && record.status !== 'discarded') || targetId === activeContextPendingId;
}

function deleteTargetIds(preview: RecordPreview) {
  const ids = [preview.target_id, ...(preview.related_ids ?? [])].filter((id): id is string => Boolean(id));
  return Array.from(new Set(ids));
}

function hasHardStopGate(preview: RecordPreview) {
  return Boolean(preview.intent_trace?.gate_reasons?.some((reason) => reason.startsWith('hard_stop_')));
}

function hasBlockingHardStopGate(preview: RecordPreview) {
  const action = preview.record_action ?? defaultRecordAction(preview);
  return Boolean(
    preview.intent_trace?.gate_reasons?.some((reason) => {
      switch (reason) {
        case 'hard_stop_target_not_unique':
        case 'hard_stop_need_reminder_change':
          return action === 'update' || action === 'delete';
        case 'hard_stop_ambiguous_reminder_time':
          return preview.need_reminder && !preview.datetime_iso;
        case 'hard_stop_sensitive_memory':
          return preview.type === 'journal' || preview.type === 'unknown';
        case 'hard_stop_delete':
          return action === 'delete';
        default:
          return reason.startsWith('hard_stop_');
      }
    }),
  );
}

function isPendingDraftContinuation(preview: RecordPreview) {
  return preview.intent === 'update_pending' || preview.intent === 'confirm_pending';
}

function isActivePendingAction(preview: RecordPreview, activeContextPendingId: string | null) {
  if (!activeContextPendingId) {
    return false;
  }
  return preview.target_id === activeContextPendingId || isPendingDraftContinuation(preview);
}

function defaultRecordAction(preview: RecordPreview): RecordAction {
  switch (preview.intent) {
    case 'answer_query':
    case 'joke_response':
    case 'config_update':
      return 'none';
    case 'update_record':
    case 'update_pending':
    case 'confirm_pending':
      return 'update';
    case 'delete_record':
      return 'delete';
    default:
      return 'create';
  }
}

function noticeForAppliedAction(action: AppliedAction) {
  switch (action) {
    case 'created':
      return '已保存';
    case 'updated':
      return '已更新';
    case 'deleted':
      return '已移入回收站';
    case 'restored':
      return '已从回收站恢复';
    default:
      return '未找到可执行目标';
  }
}

type RiskFeedbackField = Exclude<RiskField, 'title'>;

interface RiskFeedbackState {
  accepted: Partial<Record<RiskFeedbackField, number>>;
  changed: Partial<Record<RiskFeedbackField, number>>;
}

const emptyRiskFeedback: RiskFeedbackState = {
  accepted: {},
  changed: {},
};

const highRiskFields: RiskFeedbackField[] = ['datetime', 'need_reminder', 'target', 'content'];
const lowRiskFields: RiskFeedbackField[] = ['type'];

export function passesRiskMatrix(preview: RecordPreview, feedback: RiskFeedbackState) {
  const fallback = preview.confidence;
  if (fallback < 0.65) {
    return false;
  }
  for (const field of lowRiskFields) {
    const confidence = fieldConfidence(preview, field, fallback);
    if (confidence < 0.45) {
      return false;
    }
  }
  for (const field of highRiskFields) {
    if (!fieldApplies(preview, field)) {
      continue;
    }
    const confidence = fieldConfidence(preview, field, fallback);
    const risk = fieldRisk(preview, field);
    const threshold = risk === 'high' ? highRiskThreshold(feedback, field) : 0.65;
    if (confidence < threshold) {
      return false;
    }
  }
  return true;
}

function fieldConfidence(preview: RecordPreview, field: RiskField, fallback: number) {
  const value = preview.field_confidence?.[field];
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback;
  }
  return Math.min(1, Math.max(0, value));
}

function fieldRisk(preview: RecordPreview, field: RiskField): FieldRiskLevel {
  const explicit = preview.field_risk?.[field];
  if (explicit === 'low' || explicit === 'high') {
    return explicit;
  }
  return field === 'datetime' || field === 'need_reminder' || field === 'target' ? 'high' : 'low';
}

function fieldApplies(preview: RecordPreview, field: RiskFeedbackField) {
  if (field === 'datetime') {
    return preview.need_reminder || Boolean(preview.datetime_iso || preview.datetime_text) || preview.missing_fields?.includes('datetime');
  }
  if (field === 'need_reminder') {
    return preview.type === 'todo' || preview.need_reminder;
  }
  if (field === 'target') {
    const action = preview.record_action ?? defaultRecordAction(preview);
    return action === 'update' || action === 'delete';
  }
  return Boolean(preview.content.trim());
}

function highRiskThreshold(feedback: RiskFeedbackState, field: RiskFeedbackField) {
  const accepted = feedback.accepted[field] ?? 0;
  const changed = feedback.changed[field] ?? 0;
  const total = accepted + changed;
  if (total < 5) {
    return 0.85;
  }
  const changeRate = changed / total;
  if (changeRate >= 0.35) {
    return 0.92;
  }
  if (changeRate <= 0.1 && accepted >= 8) {
    return 0.78;
  }
  return 0.85;
}

function updateRiskFeedback(current: RiskFeedbackState, previous: RecordPreview, next: RecordPreview): RiskFeedbackState {
  const updated: RiskFeedbackState = {
    accepted: { ...current.accepted },
    changed: { ...current.changed },
  };
  for (const field of highRiskFields) {
    if (!fieldApplies(previous, field)) {
      continue;
    }
    const bucket = didFieldChange(previous, next, field) ? updated.changed : updated.accepted;
    bucket[field] = (bucket[field] ?? 0) + 1;
  }
  return updated;
}

function didFieldChange(previous: RecordPreview, next: RecordPreview, field: RiskFeedbackField) {
  switch (field) {
    case 'datetime':
      return previous.datetime_iso !== next.datetime_iso || previous.datetime_text !== next.datetime_text;
    case 'need_reminder':
      return previous.need_reminder !== next.need_reminder;
    case 'target':
      return previous.target_id !== next.target_id;
    case 'content':
      return previous.content.trim() !== next.content.trim();
    case 'type':
      return previous.type !== next.type;
    default:
      return false;
  }
}

async function migrateStoredRecords() {
  const stored = readStoredRecords();
  const imported: RecordItem[] = [];
  for (const record of stored) {
    try {
      const created = await createRecord({
        type: record.type,
        title: record.title,
        content: record.content,
        datetime_text: record.datetime_text,
        datetime_iso: record.datetime_iso,
        need_reminder: record.need_reminder,
        confidence: record.confidence,
        status: record.status,
        missing_fields: record.missing_fields,
        deleted_at: record.deleted_at ?? null,
        previous_status: record.previous_status ?? null,
      });
      imported.push(normalizeRecordItem(created));
    } catch {
      // Keep importing the remaining records; localStorage remains as fallback.
    }
  }
  return imported;
}

function hasMigratedStoredRecords() {
  if (typeof window === 'undefined') {
    return true;
  }
  return window.localStorage.getItem(migrationKey) === 'true';
}

function markStoredRecordsMigrated() {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(migrationKey, 'true');
}

function readStoredRecords(): RecordItem[] {
  if (typeof window === 'undefined') {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    const records = parsed.map(normalizeStoredRecord).filter((record): record is RecordItem => Boolean(record));
    const retained = records.filter(shouldRetainStoredRecord);
    if (retained.length !== records.length) {
      writeStoredRecords(retained);
    }
    return retained;
  } catch {
    return [];
  }
}

function writeStoredRecords(records: RecordItem[]) {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(records));
  } catch {
    // Local storage is best effort for the current MVP.
  }
}

function readStoredMessages(): Message[] {
  if (typeof window === 'undefined') {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(chatMessagesKey);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map(normalizeStoredMessage).filter((message): message is Message => Boolean(message));
  } catch {
    return [];
  }
}

function writeStoredMessages(messages: Message[]) {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(chatMessagesKey, JSON.stringify(messages.slice(-80)));
  } catch {
    // Chat history is local-only and best effort.
  }
}

function normalizeStoredMessage(value: unknown): Message | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const item = value as Partial<Message>;
  if (typeof item.id !== 'string' || (item.role !== 'user' && item.role !== 'assistant' && item.role !== 'notice') || typeof item.content !== 'string') {
    return null;
  }
  return {
    id: item.id,
    role: item.role,
    content: item.content,
    createdAt: typeof item.createdAt === 'string' ? formatDisplayTimestamp(item.createdAt) : formatLocalTimestamp(),
    intent: isAgentIntent(item.intent) ? item.intent : undefined,
    pendingId: typeof item.pendingId === 'string' ? item.pendingId : undefined,
    preview: item.preview ? normalizePreview(item.preview) : undefined,
  };
}

function readStoredOpenContexts(): OpenContextItem[] {
  if (typeof window === 'undefined') {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(openContextsKey);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map(normalizeStoredOpenContext).filter((context): context is OpenContextItem => Boolean(context));
  } catch {
    return [];
  }
}

function writeStoredOpenContexts(contexts: OpenContextItem[]) {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(openContextsKey, JSON.stringify(contexts.slice(0, 30)));
  } catch {
    // Open contexts are local-only and best effort.
  }
}

function normalizeStoredOpenContext(value: unknown): OpenContextItem | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const item = value as Partial<OpenContextItem>;
  const preview = normalizeStoredPreview(item.preview);
  if (typeof item.id !== 'string' || !preview) {
    return null;
  }
  return {
    id: item.id,
    preview,
    created_at: typeof item.created_at === 'string' ? formatDisplayTimestamp(item.created_at) : formatLocalTimestamp(),
    updated_at: typeof item.updated_at === 'string' ? formatDisplayTimestamp(item.updated_at) : formatLocalTimestamp(),
    last_user_message: typeof item.last_user_message === 'string' ? item.last_user_message : undefined,
    last_assistant_reply: typeof item.last_assistant_reply === 'string' ? item.last_assistant_reply : undefined,
  };
}

function readStoredPendingPreviews(): PendingPreviewItem[] {
  if (typeof window === 'undefined') {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(pendingPreviewsKey);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map(normalizeStoredPendingPreview).filter((item): item is PendingPreviewItem => Boolean(item));
  } catch {
    return [];
  }
}

function writeStoredPendingPreviews(items: PendingPreviewItem[]) {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(pendingPreviewsKey, JSON.stringify(items.slice(0, 50)));
  } catch {
    // Pending previews are local-only and best effort.
  }
}

function normalizeStoredPendingPreview(value: unknown): PendingPreviewItem | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const item = value as Partial<PendingPreviewItem>;
  const preview = normalizeStoredPreview(item.preview);
  if (typeof item.id !== 'string' || !preview) {
    return null;
  }
  return {
    id: item.id,
    preview,
    created_at: typeof item.created_at === 'string' ? formatDisplayTimestamp(item.created_at) : formatLocalTimestamp(),
  };
}

function readStoredActivePendingId() {
  if (typeof window === 'undefined') {
    return null;
  }
  const value = window.localStorage.getItem(activePendingKey);
  return value?.trim() || null;
}

function writeStoredActivePendingId(value: string | null) {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    if (value) {
      window.localStorage.setItem(activePendingKey, value);
    } else {
      window.localStorage.removeItem(activePendingKey);
    }
  } catch {
    // Active pending selection is local-only and best effort.
  }
}

function normalizeStoredRecord(value: unknown): RecordItem | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const item = value as Partial<RecordItem>;
  if (typeof item.id !== 'string' || typeof item.content !== 'string') {
    return null;
  }
  return {
    id: item.id,
    type: isRecordType(item.type) ? item.type : 'unknown',
    title: typeof item.title === 'string' ? item.title : fallbackTitle('unknown', item.content),
    content: item.content,
    datetime_text: typeof item.datetime_text === 'string' ? item.datetime_text : null,
    datetime_iso: typeof item.datetime_iso === 'string' ? item.datetime_iso : null,
    need_reminder: Boolean(item.need_reminder),
    confidence: typeof item.confidence === 'number' ? item.confidence : 1,
    field_confidence: normalizeFieldConfidence(item.field_confidence),
    field_risk: normalizeFieldRisk(item.field_risk),
    pending_state: normalizePendingState(item.pending_state),
    context_state: normalizePendingState(item.context_state),
    primary_intent: normalizeIntentItem(item.primary_intent),
    secondary_intents: normalizeIntentItems(item.secondary_intents),
    record_candidates: normalizeRecordCandidates(item.record_candidates),
    execution_plan: Array.isArray(item.execution_plan) ? item.execution_plan : [],
    reply_strategy: item.reply_strategy && typeof item.reply_strategy === 'object' ? item.reply_strategy : null,
    intent_trace: normalizeIntentTrace(item.intent_trace),
    status: isRecordStatus(item.status) ? item.status : 'saved',
    missing_fields: Array.isArray(item.missing_fields) ? item.missing_fields.filter((field): field is string => typeof field === 'string') : [],
    reply: typeof item.reply === 'string' ? item.reply : '',
    intent: item.intent,
    record_action: isRecordAction(item.record_action) ? item.record_action : undefined,
    target_id: typeof item.target_id === 'string' ? item.target_id : null,
    related_ids: Array.isArray(item.related_ids) ? item.related_ids.filter((id): id is string => typeof id === 'string') : [],
    created_at: typeof item.created_at === 'string' ? formatDisplayTimestamp(item.created_at) : formatLocalTimestamp(),
    updated_at: typeof item.updated_at === 'string' ? formatDisplayTimestamp(item.updated_at) : formatLocalTimestamp(),
    deleted_at: typeof item.deleted_at === 'string' ? formatDisplayTimestamp(item.deleted_at) : null,
    previous_status: isRecordStatus(item.previous_status) ? item.previous_status : null,
  };
}

function normalizeStoredPreview(value: unknown): RecordPreview | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const preview = value as Partial<RecordPreview>;
  if (typeof preview.content !== 'string') {
    return null;
  }
  return normalizePreview(preview);
}

export function normalizePreview(preview: Partial<RecordPreview>): RecordPreview {
  const recordCandidates = normalizeRecordCandidates(preview.record_candidates);
  const primaryCandidate = primaryRecordCandidate(recordCandidates);
  const fieldConfidence = normalizeFieldConfidence(preview.field_confidence) ?? primaryCandidate?.field_confidence ?? null;
  const fieldRisk = normalizeFieldRisk(preview.field_risk) ?? primaryCandidate?.field_risk ?? null;
  return {
    ...preview,
    type: isRecordType(preview.type) && preview.type !== 'unknown' ? preview.type : primaryCandidate?.type ?? 'unknown',
    title: typeof preview.title === 'string' && preview.title.trim() ? preview.title : primaryCandidate?.title ?? fallbackTitle('unknown', preview.content ?? ''),
    content: typeof preview.content === 'string' && preview.content.trim() ? preview.content : primaryCandidate?.content ?? '',
    datetime_text: typeof preview.datetime_text === 'string' ? preview.datetime_text : primaryCandidate?.datetime_text ?? null,
    datetime_iso: typeof preview.datetime_iso === 'string' ? preview.datetime_iso : primaryCandidate?.datetime_iso ?? null,
    need_reminder: Boolean(preview.need_reminder || primaryCandidate?.need_reminder),
    confidence: typeof preview.confidence === 'number' ? Math.min(1, Math.max(0, preview.confidence)) : primaryCandidate?.confidence ?? 1,
    status: isRecordStatus(preview.status) ? preview.status : primaryCandidate?.status ?? 'need_confirmation',
    missing_fields: Array.isArray(preview.missing_fields) ? preview.missing_fields : primaryCandidate?.missing_fields ?? [],
    reply: typeof preview.reply === 'string' ? preview.reply : '',
    intent: isAgentIntent(preview.intent) ? preview.intent : undefined,
    record_action: isRecordAction(preview.record_action) ? preview.record_action : primaryCandidate?.record_action,
    target_id: typeof preview.target_id === 'string' ? preview.target_id : primaryCandidate?.target_id ?? null,
    related_ids: Array.isArray(preview.related_ids) ? preview.related_ids : primaryCandidate?.related_ids ?? [],
    context_action: isContextAction(preview.context_action) ? preview.context_action : undefined,
    context_target_id: typeof preview.context_target_id === 'string' ? preview.context_target_id : null,
    should_preview: preview.should_preview !== false,
    settings_patch: preview.settings_patch && typeof preview.settings_patch === 'object' ? preview.settings_patch : null,
    field_confidence: fieldConfidence,
    field_risk: fieldRisk,
    pending_state: normalizePendingState(preview.pending_state),
    context_state: normalizePendingState(preview.context_state),
    primary_intent: normalizeIntentItem(preview.primary_intent),
    secondary_intents: normalizeIntentItems(preview.secondary_intents),
    record_candidates: recordCandidates,
    execution_plan: Array.isArray(preview.execution_plan) ? preview.execution_plan : [],
    reply_strategy: preview.reply_strategy && typeof preview.reply_strategy === 'object' ? preview.reply_strategy : null,
    intent_trace: normalizeIntentTrace(preview.intent_trace),
  };
}

function primaryRecordCandidate(candidates: RecordCandidate[]) {
  return candidates.find((candidate) => candidate.primary) ?? candidates[0] ?? null;
}

function shouldRetainStoredRecord(record: RecordItem) {
  if (record.status !== 'discarded') {
    return true;
  }
  if (!record.deleted_at) {
    return true;
  }
  return isSameLocalDate(record.deleted_at, new Date());
}

function readAgentSettings(): AgentSettings {
  if (typeof window === 'undefined') {
    return defaultSettings;
  }
  try {
    const raw = window.localStorage.getItem(settingsKey);
    if (!raw) {
      return defaultSettings;
    }
    const parsed = JSON.parse(raw) as Partial<AgentSettings>;
    return normalizeAgentSettings(parsed);
  } catch {
    return defaultSettings;
  }
}

function writeAgentSettings(settings: AgentSettings) {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(settingsKey, JSON.stringify(settings));
  } catch {
    // Reply settings are local-only and best effort.
  }
}

function readRiskFeedback(): RiskFeedbackState {
  if (typeof window === 'undefined') {
    return emptyRiskFeedback;
  }
  try {
    const raw = window.localStorage.getItem(riskFeedbackKey);
    if (!raw) {
      return emptyRiskFeedback;
    }
    const parsed = JSON.parse(raw) as Partial<RiskFeedbackState>;
    return normalizeRiskFeedback(parsed);
  } catch {
    return emptyRiskFeedback;
  }
}

function writeRiskFeedback(feedback: RiskFeedbackState) {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(riskFeedbackKey, JSON.stringify(feedback));
  } catch {
    // Feedback only tunes local confirmation thresholds.
  }
}

function normalizeRiskFeedback(value: Partial<RiskFeedbackState>): RiskFeedbackState {
  return {
    accepted: normalizeRiskFeedbackCounts(value.accepted),
    changed: normalizeRiskFeedbackCounts(value.changed),
  };
}

function normalizeRiskFeedbackCounts(value: unknown): Partial<Record<RiskFeedbackField, number>> {
  if (!value || typeof value !== 'object') {
    return {};
  }
  const source = value as Partial<Record<RiskFeedbackField, unknown>>;
  const result: Partial<Record<RiskFeedbackField, number>> = {};
  for (const field of highRiskFields) {
    const count = source[field];
    if (typeof count === 'number' && Number.isFinite(count) && count > 0) {
      result[field] = Math.floor(count);
    }
  }
  return result;
}

function normalizeAgentSettings(value: Partial<AgentSettings>): AgentSettings {
  const preset = normalizeReplyPreset(value.preset);
  return {
    preset,
    custom_style: typeof value.custom_style === 'string' ? value.custom_style : '',
    nickname: typeof value.nickname === 'string' ? value.nickname : '',
    model_key: typeof value.model_key === 'string' && value.model_key.trim() ? value.model_key : defaultSettings.model_key,
  };
}

function timestampValue(value?: string | null) {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value.replace(' ', 'T'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function isRecordType(value: unknown): value is RecordType {
  return value === 'todo' || value === 'journal' || value === 'memo' || value === 'idea' || value === 'unknown';
}

function isRecordStatus(value: unknown): value is RecordStatus {
  return value === 'ready' || value === 'need_confirmation' || value === 'saved' || value === 'discarded' || value === 'completed';
}

function isRecordAction(value: unknown): value is RecordAction {
  return value === 'create' || value === 'update' || value === 'delete' || value === 'none';
}

function isPendingState(value: unknown): value is PendingState {
  return value === 'open' || value === 'waiting_field' || value === 'ready_to_execute' || value === 'executed' || value === 'dismissed' || value === 'none';
}

function normalizePendingState(value: unknown): PendingState | '' {
  return isPendingState(value) ? value : '';
}

function isContextAction(value: unknown): value is NonNullable<RecordPreview['context_action']> {
  return value === 'open' || value === 'update' || value === 'close' || value === 'none';
}

function isReplyPreset(value: unknown): value is ReplyPreset {
  return value === 'INTJ' || value === 'ENFJ' || value === 'ISTP' || value === 'ENFP' || value === 'custom';
}

function normalizeReplyPreset(value: unknown): ReplyPreset {
  if (isReplyPreset(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const upperValue = value.toUpperCase();
    if (isReplyPreset(upperValue)) {
      return upperValue;
    }
  }
  if (value === 'neutral_professional') {
    return 'INTJ';
  }
  if (value === 'brief') {
    return 'ISTP';
  }
  if (value === 'coach') {
    return 'ENFJ';
  }
  if (value === 'practical_warm') {
    return 'ENFJ';
  }
  if (value === 'lively') {
    return 'ENFP';
  }
  if (value === 'bullet_points' || value === 'plainspoken' || value === 'executive_summary') {
    return 'ISTP';
  }
  return defaultSettings.preset;
}

function normalizeFieldConfidence(value: unknown): RecordPreview['field_confidence'] {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const source = value as Partial<Record<RiskField, unknown>>;
  const fields: RiskField[] = ['type', 'title', 'content', 'datetime', 'need_reminder', 'target'];
  const result: Partial<Record<RiskField, number>> = {};
  for (const field of fields) {
    const score = source[field];
    if (typeof score === 'number' && Number.isFinite(score)) {
      result[field] = Math.min(1, Math.max(0, score));
    }
  }
  return Object.keys(result).length ? result : null;
}

function normalizeFieldRisk(value: unknown): RecordPreview['field_risk'] {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const source = value as Partial<Record<RiskField, unknown>>;
  const fields: RiskField[] = ['type', 'title', 'content', 'datetime', 'need_reminder', 'target'];
  const result: Partial<Record<RiskField, FieldRiskLevel>> = {};
  for (const field of fields) {
    const risk = source[field];
    if (risk === 'low' || risk === 'high') {
      result[field] = risk;
    }
  }
  return Object.keys(result).length ? result : null;
}

function normalizeIntentItem(value: unknown): IntentItem | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const item = value as Partial<IntentItem>;
  return {
    id: typeof item.id === 'string' ? item.id : undefined,
    intent: isAgentIntent(item.intent) ? item.intent : undefined,
    category: typeof item.category === 'string' ? item.category : undefined,
    action: typeof item.action === 'string' ? item.action : undefined,
    record_type: isRecordType(item.record_type) ? item.record_type : undefined,
    confidence: typeof item.confidence === 'number' ? Math.min(1, Math.max(0, item.confidence)) : undefined,
    risk: item.risk === 'low' || item.risk === 'high' ? item.risk : undefined,
    evidence: Array.isArray(item.evidence) ? item.evidence.filter((text): text is string => typeof text === 'string') : [],
    target_id: typeof item.target_id === 'string' ? item.target_id : null,
  };
}

function normalizeIntentItems(value: unknown): IntentItem[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(normalizeIntentItem).filter((item): item is IntentItem => Boolean(item));
}

function normalizeRecordCandidates(value: unknown): RecordCandidate[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(normalizeRecordCandidate).filter((candidate): candidate is RecordCandidate => Boolean(candidate));
}

function normalizeIntentTrace(value: unknown): IntentTrace | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const item = value as Partial<IntentTrace>;
  const trace: IntentTrace = {
    matched_context_id: typeof item.matched_context_id === 'string' ? item.matched_context_id : null,
    continuation_reason: typeof item.continuation_reason === 'string' ? item.continuation_reason : '',
    risk_reasons: normalizeTraceList(item.risk_reasons),
    discarded_alternatives: normalizeTraceList(item.discarded_alternatives),
    gate_reasons: normalizeTraceList(item.gate_reasons),
    state_transition: typeof item.state_transition === 'string' ? item.state_transition : '',
  };
  return trace.matched_context_id ||
    trace.continuation_reason ||
    trace.risk_reasons?.length ||
    trace.discarded_alternatives?.length ||
    trace.gate_reasons?.length ||
    trace.state_transition
    ? trace
    : null;
}

function normalizeTraceList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

function normalizeRecordCandidate(value: unknown): RecordCandidate | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const item = value as Partial<RecordCandidate>;
  if (typeof item.content !== 'string') {
    return null;
  }
  return {
    id: typeof item.id === 'string' ? item.id : undefined,
    intent_id: typeof item.intent_id === 'string' ? item.intent_id : undefined,
    type: isRecordType(item.type) ? item.type : 'unknown',
    title: typeof item.title === 'string' ? item.title : fallbackTitle('unknown', item.content),
    content: item.content,
    datetime_text: typeof item.datetime_text === 'string' ? item.datetime_text : null,
    datetime_iso: typeof item.datetime_iso === 'string' ? item.datetime_iso : null,
    need_reminder: Boolean(item.need_reminder),
    confidence: typeof item.confidence === 'number' ? Math.min(1, Math.max(0, item.confidence)) : 1,
    field_confidence: normalizeFieldConfidence(item.field_confidence),
    field_risk: normalizeFieldRisk(item.field_risk),
    status: isRecordStatus(item.status) ? item.status : 'need_confirmation',
    missing_fields: Array.isArray(item.missing_fields) ? item.missing_fields.filter((field): field is string => typeof field === 'string') : [],
    record_action: isRecordAction(item.record_action) ? item.record_action : undefined,
    target_id: typeof item.target_id === 'string' ? item.target_id : null,
    related_ids: Array.isArray(item.related_ids) ? item.related_ids.filter((id): id is string => typeof id === 'string') : [],
    execution_decision: isExecutionDecision(item.execution_decision) ? item.execution_decision : '',
    should_preview: item.should_preview !== false,
    primary: Boolean(item.primary),
  };
}

function isAgentIntent(value: unknown): value is AgentIntent {
  return (
    value === 'new_record' ||
    value === 'update_record' ||
    value === 'delete_record' ||
    value === 'update_pending' ||
    value === 'confirm_pending' ||
    value === 'duplicate_check' ||
    value === 'similar_check' ||
    value === 'clarify' ||
    value === 'answer_query' ||
    value === 'joke_response' ||
    value === 'config_update'
  );
}

function isExecutionDecision(value: unknown): value is NonNullable<RecordCandidate['execution_decision']> {
  return value === 'auto_execute' || value === 'preview' || value === 'pending' || value === 'ask_clarify' || value === 'no_op';
}

function normalizeText(value: string) {
  const text = value.trim();
  return text ? text : null;
}

function isSameLocalDate(value: string, date: Date) {
  const parsed = new Date(value.replace(' ', 'T'));
  if (Number.isNaN(parsed.getTime())) {
    return true;
  }
  return parsed.getFullYear() === date.getFullYear() && parsed.getMonth() === date.getMonth() && parsed.getDate() === date.getDate();
}

function fallbackTitle(type: RecordType, content: string) {
  const text = content.trim();
  return text ? text.slice(0, 18) : `${typeLabel[type]}记录`;
}

function createId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatLocalTimestamp(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatDisplayTimestamp(value: string) {
  const text = value.trim();
  if (!text) {
    return '';
  }
  const parsed = new Date(text.includes('T') ? text : text.replace(' ', 'T'));
  if (Number.isNaN(parsed.getTime())) {
    return text;
  }
  return formatLocalTimestamp(parsed);
}
