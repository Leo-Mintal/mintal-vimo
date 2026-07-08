import {
  ArrowLeft,
  Bell,
  BookOpenText,
  CalendarCheck2,
  CalendarClock,
  ChevronDown,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Brain,
  FileWarning,
  Edit3,
  FileText,
  Info,
  Lightbulb,
  ListChecks,
  RefreshCw,
  Save,
  Search,
  Settings2,
  Sparkles,
  StickyNote,
  Trash2,
  Undo2,
  UserRound,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { MessageBubble } from './MessageBubble';
import { Composer } from './Composer';
import { RecordCard } from '../RecordCard/RecordCard';
import { listAgentModels, sendAgentMessageStream } from '../../services/agent';
import { createRecord, listRecords, saveRecord, updateRecord, type RecordWriteInput } from '../../services/records';
import type { AgentContextRecord, AgentIntent, AgentMessageResponse, AgentModelOption, AgentProgressEvent, AgentRecordExecutionEvent, ConversationMessage, CustomAgentModel, FieldRiskLevel, IntentItem, IntentTrace, PendingState, RecordAction, RecordCandidate, RecordPreview, RecordStatus, RecordType, ReplyPreset, ReplyProfile, RiskField, SettingsPatch, ThinkingPayload } from '../../types/agent';
import type { RecordItem } from '../../types/record';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'notice';
  content: string;
  fastContent?: string;
  slowContent?: string;
  createdAt: string;
  intent?: AgentIntent;
  pendingId?: string;
  preview?: RecordPreview;
  progressEvents?: AgentProgressEvent[];
  thinking?: ThinkingPayload | null;
  thinkingStartedAt?: number;
  thinkingFinishedAt?: number;
  thinkingOpen?: boolean;
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
type ShellView = 'chat' | 'settings';
type RecordScope = 'default' | 'scheduled';

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
const customModelsKey = 'vimo-web.custom-models.v1';
const riskFeedbackKey = 'vimo-web.risk-feedback.v1';
const chatMessagesKey = 'vimo-web.chat-messages.v1';
const openContextsKey = 'vimo-web.open-contexts.v1';
const pendingPreviewsKey = 'vimo-web.pending-previews.v1';
const activePendingKey = 'vimo-web.active-pending-id.v1';
const previousDefaultModelKey = 'gpt_5_4_mini';
const maxClosedContexts = 30;

interface AgentSettings extends ReplyProfile {
  thinking_enabled: boolean;
}

const defaultSettings: AgentSettings = {
  preset: 'INTJ',
  custom_style: '',
  nickname: '',
  model_key: '',
  thinking_enabled: false,
};

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
    tone: 'bg-[var(--success-soft)] text-[var(--success)]',
    tab: 'data-[active=true]:bg-[var(--success-soft)] data-[active=true]:text-[var(--success)]',
  },
  idea: {
    label: '想法',
    icon: Lightbulb,
    tone: 'bg-[#fff1b8] text-[#8a5a00] dark:bg-[#3d3213] dark:text-[#f5cd65]',
    tab: 'data-[active=true]:bg-[#fff1b8] data-[active=true]:text-[#8a5a00] dark:data-[active=true]:bg-[#3d3213] dark:data-[active=true]:text-[#f5cd65]',
  },
  memo: {
    label: '备忘',
    icon: StickyNote,
    tone: 'bg-[#eaf1ff] text-[#2f5f9f] dark:bg-[#1d2b40] dark:text-[#9fc3ff]',
    tab: 'data-[active=true]:bg-[#eaf1ff] data-[active=true]:text-[#2f5f9f] dark:data-[active=true]:bg-[#1d2b40] dark:data-[active=true]:text-[#9fc3ff]',
  },
  journal: {
    label: '日记',
    icon: BookOpenText,
    tone: 'bg-[#f3e8ff] text-[#7e3faa] dark:bg-[#30213d] dark:text-[#d8b4fe]',
    tab: 'data-[active=true]:bg-[#f3e8ff] data-[active=true]:text-[#7e3faa] dark:data-[active=true]:bg-[#30213d] dark:data-[active=true]:text-[#d8b4fe]',
  },
  unknown: {
    label: '确认',
    icon: Sparkles,
    tone: 'bg-[var(--warning-soft)] text-[var(--warning)]',
    tab: 'data-[active=true]:bg-[var(--warning-soft)] data-[active=true]:text-[var(--warning)]',
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
  const [customModels, setCustomModels] = useState<CustomAgentModel[]>(() => readCustomModels());
  const [riskFeedback, setRiskFeedback] = useState<RiskFeedbackState>(() => readRiskFeedback());
  const [modelOptions, setModelOptions] = useState<AgentModelOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [shellView, setShellView] = useState<ShellView>('chat');
  const [activeRecordTab, setActiveRecordTab] = useState<RecordTab>('all');
  const [recordQuery, setRecordQuery] = useState('');
  const [recordScope, setRecordScope] = useState<RecordScope>('default');
  const lastPromptRef = useRef<string>('');
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const messagesRef = useRef<Message[]>([]);
  const activeAbortRef = useRef<AbortController | null>(null);
  const generationTokenRef = useRef(0);

  const latestPending = pendingPreviews[0] ?? null;
  const latestOpenContext = openContexts[0] ?? null;
  const activePending = pendingPreviews.find((item) => item.id === activePendingId) ?? null;
  const scheduledCount = useMemo(() => records.filter(isScheduledTodo).length, [records]);

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
    const generationToken = generationTokenRef.current + 1;
    generationTokenRef.current = generationToken;
    const requestController = new AbortController();
    activeAbortRef.current?.abort();
    activeAbortRef.current = requestController;
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
      thinkingStartedAt: Date.now(),
    };
    mutateMessages((current) => [...current, userMessage, assistantMessage]);
    setLoading(true);
    setThinking(true);
    setError(null);

    let doneReceived = false;
    let shouldClearGenerationState = false;
    try {
      const pendingCount = pendingPreviews.length;
      const turnId = createId();
      const request = {
        turn_id: turnId,
        message: content,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
        model_key: selectedModelKey(settings),
        custom_model: customModelForRequest(settings, customModels),
        thinking: thinkingRequestForSettings(settings, modelOptions, customModels),
        open_contexts: buildOpenContextPayload(openContexts, pendingPreviews),
        closed_contexts: buildClosedContextPayload(records),
        recent_messages: recentMessages,
        reply_profile: replyProfileFromSettings(settings),
      };
      const thinkingRequested = Boolean(request.thinking?.enabled);
      let finalResponse: AgentMessageResponse | null = null;
      let finalPreview: RecordPreview | null = null;
      let serverRecordExecution: AgentRecordExecutionEvent | null = null;
      let fastTypingTask = Promise.resolve();
      let sequenceTask = Promise.resolve();
      let pendingFastReplyText = '';
      let fastDoneReceived = false;
      let slowThinkingReceived = false;
      let lastProgressSeq = 0;
      let pendingFastCompletedProgress: AgentProgressEvent | null = null;
      let pendingRunCompletedProgress: AgentProgressEvent | null = null;
      let fastCompletionFlushScheduled = false;
      const isCurrentGeneration = () => !requestController.signal.aborted && generationTokenRef.current === generationToken;
      const hasProgressType = (type: string) =>
        assistantHasProgressType(assistantId, type) ||
        pendingFastCompletedProgress?.type === type ||
        pendingRunCompletedProgress?.type === type;
      const fallbackProgressEvent = (type: string, title: string, payload?: Record<string, unknown>): AgentProgressEvent => {
        lastProgressSeq += 1;
        return {
          id: `${turnId}-client-${lastProgressSeq}-${type}`,
          turn_id: turnId,
          seq: lastProgressSeq,
          type,
          title,
          status: 'completed',
          payload,
          created_at: new Date().toISOString(),
        };
      };
      const flushFastCompletedProgress = () => {
        if (!pendingFastCompletedProgress || !isCurrentGeneration() || assistantHasProgressType(assistantId, pendingFastCompletedProgress.type)) {
          pendingFastCompletedProgress = null;
          return;
        }
        appendAssistantProgress(assistantId, pendingFastCompletedProgress);
        pendingFastCompletedProgress = null;
      };
      const scheduleFastCompletedFlush = () => {
        if (fastCompletionFlushScheduled) {
          return;
        }
        fastCompletionFlushScheduled = true;
        void fastTypingTask.finally(() => {
          fastCompletionFlushScheduled = false;
          flushFastCompletedProgress();
        });
      };
      const queueProgress = (event: AgentProgressEvent) => {
        if (event.type === 'fast_reply.completed') {
          pendingFastCompletedProgress = event;
          scheduleFastCompletedFlush();
          return;
        }
        if (event.type === 'run.completed') {
          pendingRunCompletedProgress = event;
          return;
        }
        appendAssistantProgress(assistantId, event);
      };
      const queueFallbackProgress = (type: string, title: string, payload?: Record<string, unknown>) => {
        if (hasProgressType(type)) {
          return;
        }
        queueProgress(fallbackProgressEvent(type, title, payload));
      };
      const flushRunCompletedProgress = () => {
        if (!pendingRunCompletedProgress || !isCurrentGeneration() || assistantHasProgressType(assistantId, pendingRunCompletedProgress.type)) {
          pendingRunCompletedProgress = null;
          return;
        }
        appendAssistantProgress(assistantId, pendingRunCompletedProgress);
        pendingRunCompletedProgress = null;
      };
      const flushFastReplyText = () => {
        const text = pendingFastReplyText;
        pendingFastReplyText = '';
        if (text) {
          sequenceTask = sequenceTask.then(async () => {
            await typeAssistantDelta(assistantId, 'fast', text, generationToken);
          });
        }
        fastTypingTask = sequenceTask;
      };
      const completeGenerationFromServerDone = async () => {
        if (pendingFastReplyText) {
          flushFastReplyText();
        }
        await sequenceTask;
        await fastTypingTask;
        if (requestController.signal.aborted || generationTokenRef.current !== generationToken) {
          return;
        }
        flushFastCompletedProgress();
        setThinking(false);
        if (finalResponse && finalPreview) {
          const finalContent = visibleFinalText(assistantId, finalResponse.message.content);
          await streamAssistantFinalText(assistantId, finalContent, generationToken);
          if (requestController.signal.aborted || generationTokenRef.current !== generationToken) {
            return;
          }
          const pendingId = await applyAgentPreview(finalPreview, latestOpenContext?.id ?? latestPending?.id ?? null, content, finalResponse.message.content, serverRecordExecution);
          updateAssistantMessage(assistantId, {
            intent: finalPreview.intent,
            pendingId,
            preview: finalPreview,
          });
          if (pendingCount > 0 && !shouldShowPreview(finalPreview)) {
            addNotice('上方还有待确认');
          }
        }
        await sequenceTask;
        if (requestController.signal.aborted || generationTokenRef.current !== generationToken) {
          return;
        }
        finishAssistantThinking(assistantId);
        flushRunCompletedProgress();
        doneReceived = true;
      };

      await sendAgentMessageStream(request, async (event) => {
        if (requestController.signal.aborted || generationTokenRef.current !== generationToken) {
          return;
        }
        if (event.type === 'progress') {
          lastProgressSeq = Math.max(lastProgressSeq, event.event.seq);
          queueProgress(event.event);
        }
        if (event.type === 'record_execution') {
          serverRecordExecution = event.event;
          applyServerRecordExecution(event.event);
        }
        if (event.type === 'fast_delta') {
          pendingFastReplyText += event.delta;
          if (fastDoneReceived) {
            flushFastReplyText();
          }
        }
        if (event.type === 'fast_done') {
          fastDoneReceived = true;
          flushFastReplyText();
          queueFallbackProgress('fast_reply.completed', '快路已完成', { route: event.route ?? 'continue_slow' });
        }
        if (event.type === 'fast_thinking' && thinkingRequested) {
          sequenceTask = sequenceTask.then(async () => {
            await streamAssistantThinkingPatch(assistantId, { fast: event.content }, generationToken);
          });
        }
        if (event.type === 'slow_thinking' && thinkingRequested) {
          slowThinkingReceived = Boolean(event.content.trim());
          sequenceTask = sequenceTask.then(async () => {
            await streamAssistantThinkingPatch(assistantId, { slow: event.content }, generationToken);
          });
        }
        if (event.type === 'final') {
          finalResponse = event.response;
          finalPreview = normalizePreview(event.response.record_preview);
          if (thinkingRequested) {
            const thinkingPatch = slowThinkingReceived ? { fast: event.response.thinking?.fast } : event.response.thinking;
            sequenceTask = sequenceTask.then(async () => {
              await streamAssistantThinkingPatch(assistantId, thinkingPatch ?? null, generationToken);
            });
          }
        }
        if (event.type === 'error') {
          throw new Error(event.message);
        }
        if (event.type === 'done') {
          queueFallbackProgress('run.completed', '本轮已完成');
          await completeGenerationFromServerDone();
        }
      }, requestController.signal);
      if (!doneReceived && !requestController.signal.aborted && generationTokenRef.current === generationToken) {
        throw new Error('生成未正常完成');
      }
    } catch (err) {
      if (isAbortError(err)) {
        return;
      }
      shouldClearGenerationState = true;
      mutateMessages((current) =>
        current
          .filter((message) => message.id !== assistantId || message.content.trim())
          .map((message) =>
            message.id === assistantId
              ? {
                  ...message,
                  thinking: null,
                  thinkingFinishedAt: undefined,
                  thinkingOpen: false,
                  thinkingStartedAt: undefined,
                }
              : message,
          ),
      );
      setError(err instanceof Error ? err.message : '请求失败');
    } finally {
      if (generationTokenRef.current === generationToken && (doneReceived || shouldClearGenerationState)) {
        activeAbortRef.current = null;
        setLoading(false);
        if (shouldClearGenerationState) {
          setThinking(false);
        }
      }
    }
  }

  function stopGeneration() {
    generationTokenRef.current += 1;
    activeAbortRef.current?.abort();
    activeAbortRef.current = null;
    setThinking(false);
    setLoading(false);
    setError(null);
  }

  function appendAssistantDelta(messageId: string, channel: 'fast' | 'slow', delta: string) {
    if (!delta) {
      return;
    }
    mutateMessages((current) =>
      current.map((message) => {
        if (message.id !== messageId) {
          return message;
        }
        const fastContent = message.fastContent ?? '';
        const slowContent = message.slowContent ?? '';
        const contentSeparator = channel === 'slow' && !slowContent.trim() && fastContent.trim() ? '\n\n' : '';
        return {
          ...message,
          content: message.content + contentSeparator + delta,
          ...(channel === 'fast'
            ? { fastContent: `${fastContent}${delta}` }
            : { slowContent: `${slowContent}${delta}` }),
        };
      }),
    );
  }

  function updateAssistantMessage(messageId: string, patch: Partial<Message>) {
    mutateMessages((current) => current.map((message) => (message.id === messageId ? { ...message, ...patch } : message)));
  }

  function appendAssistantProgress(messageId: string, event: AgentProgressEvent) {
    mutateMessages((current) =>
      current.map((message) => {
        if (message.id !== messageId) {
          return message;
        }
        const progressEvents = mergeProgressEvent(message.progressEvents ?? [], event);
        return {
          ...message,
          progressEvents,
        };
      }),
    );
  }

  function assistantHasProgressType(messageId: string, type: string) {
    const message = messagesRef.current.find((item) => item.id === messageId);
    return Boolean(message?.progressEvents?.some((event) => event.type === type));
  }

  function beginAssistantThinkingStream(messageId: string) {
    mutateMessages((current) =>
      current.map((message) => {
        if (message.id !== messageId) {
          return message;
        }
        return {
          ...message,
          thinkingOpen: true,
          thinkingStartedAt: message.thinkingStartedAt ?? Date.now(),
          thinking: message.thinking ?? {},
        };
      }),
    );
  }

  function appendAssistantThinkingDelta(messageId: string, channel: keyof ThinkingPayload, delta: string) {
    if (!delta) {
      return;
    }
    mutateMessages((current) =>
      current.map((message) => {
        if (message.id !== messageId) {
          return message;
        }
        const thinking = message.thinking ?? {};
        return {
          ...message,
          thinking: {
            ...thinking,
            [channel]: `${thinking[channel] ?? ''}${delta}`,
          },
        };
      }),
    );
  }

  function finishAssistantThinking(messageId: string) {
    mutateMessages((current) =>
      current.map((message) => (message.id === messageId && message.thinking ? { ...message, thinkingFinishedAt: Date.now() } : message)),
    );
  }

  async function streamAssistantFinalText(messageId: string, finalText: string, generationToken: number) {
    const text = finalText.trim();
    if (!text) {
      return;
    }
    const current = messageSlowContentById(messageId).trim();
    if (text === current.trim()) {
      return;
    }
    if (current.trim() && text.startsWith(current.trim())) {
      await typeAssistantDelta(messageId, 'slow', text.slice(current.trim().length), generationToken);
      return;
    }
    if (current.trim()) {
      await typeAssistantDelta(messageId, 'slow', `\n\n${text}`, generationToken);
      return;
    }
    await typeAssistantDelta(messageId, 'slow', text, generationToken);
  }

  function visibleFinalText(messageId: string, finalText: string) {
    const text = finalText.trim();
    if (!text) {
      return '';
    }
    const fast = messageFastContentById(messageId).trim();
    if (!fast) {
      return text;
    }
    if (text === fast) {
      return '';
    }
    if (text.startsWith(fast)) {
      return text.slice(fast.length).trimStart();
    }
    return text;
  }

  function messageFastContentById(messageId: string) {
    const message = messagesRef.current.find((item) => item.id === messageId);
    return message?.fastContent ?? '';
  }

  function messageSlowContentById(messageId: string) {
    const message = messagesRef.current.find((item) => item.id === messageId);
    return message?.slowContent ?? '';
  }

  function messageThinkingContentById(messageId: string, channel: keyof ThinkingPayload) {
    const message = messagesRef.current.find((item) => item.id === messageId);
    return message?.thinking?.[channel] ?? '';
  }

  async function streamAssistantThinkingPatch(messageId: string, patch: ThinkingPayload | null | undefined, generationToken: number) {
    await streamAssistantThinkingText(messageId, 'fast', patch?.fast, generationToken);
    await streamAssistantThinkingText(messageId, 'slow', patch?.slow, generationToken);
  }

  async function streamAssistantThinkingText(messageId: string, channel: keyof ThinkingPayload, rawText: string | undefined, generationToken: number) {
    const text = rawText?.trim();
    if (!text) {
      return;
    }
    const current = messageThinkingContentById(messageId, channel).trim();
    if (text === current) {
      return;
    }
    const delta = current && text.startsWith(current) ? text.slice(current.length) : current ? `\n\n${text}` : text;
    beginAssistantThinkingStream(messageId);
    for (const char of Array.from(delta)) {
      if (generationTokenRef.current !== generationToken || activeAbortRef.current?.signal.aborted) {
        return;
      }
      appendAssistantThinkingDelta(messageId, channel, char);
      await sleep(6);
    }
  }

  async function typeAssistantDelta(messageId: string, channel: 'fast' | 'slow', text: string, generationToken: number) {
    for (const char of Array.from(text)) {
      if (generationTokenRef.current !== generationToken || activeAbortRef.current?.signal.aborted) {
        return;
      }
      appendAssistantDelta(messageId, channel, char);
      await sleep(12);
    }
  }

  async function applyAgentPreview(
    preview: RecordPreview,
    activeContextPendingId: string | null,
    userContent: string,
    assistantContent: string,
    serverExecution?: AgentRecordExecutionEvent | null,
  ) {
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
    if (serverExecution?.status === 'completed' && serverExecution.action !== 'none') {
      if (taskId) {
        closeTaskContext(taskId);
      }
      addNotice(noticeForAppliedAction(serverExecution.action));
      await addNonAutoCandidates(previewWithTask, taskId, serverExecution);
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

  async function addNonAutoCandidates(preview: RecordPreview, taskId: string | null, serverExecution?: AgentRecordExecutionEvent | null) {
    const candidates = secondaryPreviewsFromCandidates(preview, taskId);
    if (!candidates.length) {
      return;
    }
    const pendingCandidates: PendingPreviewItem[] = [];
    const appliedActions: AppliedAction[] = [];
    for (const item of candidates) {
      if (serverExecution?.status === 'completed' && item.id === taskId) {
        continue;
      }
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

  function applyServerRecordExecution(event: AgentRecordExecutionEvent) {
    if (event.status !== 'completed' || event.action === 'none') {
      return;
    }
    const record = normalizeRecordFromUnknown(event.record);
    if (!record) {
      return;
    }
    if (event.action === 'created') {
      upsertLocalRecord(record);
      return;
    }
    updateLocalRecord(record);
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
      const targetIds = deleteTargetIds(preview);
      if (!targetIds.length) {
        return 'none';
      }
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
        return 'deleted';
      }
      if (pendingContextId && targetIds.includes(pendingContextId)) {
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
    const safePatch = sanitizeSettingsPatch(patch, modelOptions, customModels);
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
    setClearConfirmOpen(false);
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

  function selectModel(modelKey: string) {
    const next = normalizeAgentSettings({
      ...settings,
      model_key: modelKey,
      thinking_enabled: modelSupportsThinking(modelKey, modelOptions, customModels) ? settings.thinking_enabled : false,
    });
    setSettings(next);
    writeAgentSettings(next);
  }

  function toggleThinkingMode(enabled: boolean) {
    const next = normalizeAgentSettings({ ...settings, thinking_enabled: enabled });
    setSettings(next);
    writeAgentSettings(next);
  }

  function addCustomModel(model: CustomAgentModel) {
    const nextModels = [model, ...customModels.filter((item) => item.key !== model.key)];
    setCustomModels(nextModels);
    writeCustomModels(nextModels);
    selectModel(model.key);
    showToast('模型已保存');
  }

  function deleteCustomModel(modelKey: string) {
    const nextModels = customModels.filter((model) => model.key !== modelKey);
    setCustomModels(nextModels);
    writeCustomModels(nextModels);
    if (settings.model_key === modelKey) {
      const fallback = modelOptions.find((model) => model.default) ?? modelOptions[0] ?? nextModels[0];
      selectModel(fallback?.key ?? '');
    }
    showToast('模型已删除');
  }

  function updateProfileSettings(patch: Partial<Pick<AgentSettings, 'preset' | 'custom_style' | 'nickname'>>) {
    const next = normalizeAgentSettings({ ...settings, ...patch });
    setSettings(next);
    writeAgentSettings(next);
  }

  function openScheduledTasks() {
    setShellView('chat');
    setActiveRecordTab('todo');
    setRecordScope('scheduled');
    setRecordQuery('');
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
    <div className="app-surface vimo-workbench relative h-full min-h-0 overflow-hidden">
      <LeftSidebar
        activeView={shellView}
        onOpenSettings={() => setShellView('settings')}
        onOpenChat={() => setShellView('chat')}
        onOpenScheduled={openScheduledTasks}
        onQueryChange={(value) => {
          setRecordQuery(value);
          setRecordScope('default');
          if (value.trim()) {
            setActiveRecordTab('all');
          }
        }}
        query={recordQuery}
        scheduledCount={scheduledCount}
        settings={settings}
      />

      <main className="vimo-center-pane min-h-0 min-w-0">
        {shellView === 'settings' ? (
          <SettingsView
            customModels={customModels}
            modelOptions={modelOptions}
            onBack={() => setShellView('chat')}
            onSelectModel={selectModel}
            onUpdateProfile={updateProfileSettings}
            settings={settings}
          />
        ) : (
          <section className="chat-surface relative flex h-full min-h-[540px] min-w-0 flex-col overflow-hidden lg:min-h-0">
            {pendingPreviews.length ? (
              <PendingPreviewStrip
                items={pendingPreviews}
                onDiscard={handleDiscardPending}
                onOpen={setActivePendingId}
              />
            ) : null}

            {(messages.length || pendingPreviews.length || openContexts.length) ? (
              <div className="pointer-events-none absolute right-4 top-4 z-10 flex justify-end sm:right-6 sm:top-6">
                <button
                  aria-label="清空聊天"
                  className="pointer-events-auto grid h-8 w-8 place-items-center rounded-[11px] border border-[var(--border-subtle)] bg-[var(--surface-elevated)] text-[var(--text-muted)] shadow-sm backdrop-blur transition hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"
                  onClick={() => setClearConfirmOpen(true)}
                  title="清空聊天"
                  type="button"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ) : null}

            <div className="flex-1 overflow-y-auto px-2 py-5 sm:px-4 lg:px-6">
              <div className="mx-auto max-w-4xl space-y-4">
                {messages.map((message) => {
                  if (message.role === 'notice') {
                    return <NoticeMessage content={message.content} key={message.id} />;
                  }
                  if (message.role === 'assistant' && !assistantHasVisibleContent(message)) {
                    return null;
                  }
                  return (
                    <div className="space-y-2" key={message.id}>
                      <MessageBubble
                        beforeContent={message.role === 'assistant' && message.preview ? <IntentStackPanel preview={message.preview} onOpenPending={setActivePendingId} /> : undefined}
                        content={message.content}
                        fastContent={message.role === 'assistant' ? message.fastContent : undefined}
                        progressEvents={message.role === 'assistant' ? message.progressEvents : undefined}
                        slowContent={message.role === 'assistant' ? message.slowContent : undefined}
                        thinking={message.role === 'assistant' ? message.thinking : undefined}
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

            <Composer
              customModels={customModels}
              disabled={false}
              generating={loading}
              modelOptions={modelOptions}
              onAddCustomModel={addCustomModel}
              onDeleteCustomModel={deleteCustomModel}
              onSelectModel={selectModel}
              onSend={handleSend}
              onStop={stopGeneration}
              onToggleThinking={toggleThinkingMode}
              selectedModelKey={settings.model_key}
              thinkingEnabled={settings.thinking_enabled}
            />
          </section>
        )}
      </main>

      <RecordsPanel
        activeTab={activeRecordTab}
        onDelete={handleDeleteRecord}
        onQueryChange={setRecordQuery}
        onRestore={handleRestoreRecord}
        onScopeChange={setRecordScope}
        onTabChange={(tab) => {
          setActiveRecordTab(tab);
          setRecordScope('default');
        }}
        onUpdate={handleUpdateRecord}
        query={recordQuery}
        records={records}
        scope={recordScope}
      />

      {activePending ? (
        <PendingPreviewModal
          item={activePending}
          onClose={() => setActivePendingId(null)}
          onDiscard={handleDiscardPending}
          onSave={handleSavePending}
        />
      ) : null}
      {clearConfirmOpen ? (
        <ConfirmModal
          body="会清空当前聊天消息、待补全项和未收口上下文，本地记录不会被删除。"
          confirmLabel="清空"
          onCancel={() => setClearConfirmOpen(false)}
          onConfirm={clearChat}
          title="清空聊天？"
        />
      ) : null}
      {toast ? <Toast message={toast} /> : null}
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
    <div className="border-b border-[var(--border-subtle)] bg-[var(--surface-soft)] px-3.5 py-2">
      <div className="mx-auto max-w-4xl space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="flex shrink-0 items-center gap-1 text-[10px] font-bold text-[var(--text-muted)]">
            <Sparkles size={11} />
          待补全
            <span className="rounded-full bg-[var(--surface-elevated)] px-1.5 py-0.5 text-[9px] text-[var(--text-strong)]">{items.length}</span>
          </span>
          <button
            aria-label="丢弃最新待确认"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-[9px] text-[var(--text-faint)] transition hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"
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
              <div className="min-w-0 rounded-[12px] border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-1.5" key={group.key}>
                <div className="mb-1 flex items-center gap-1.5 px-1 text-[10px] font-bold text-[var(--text-muted)]">
                  <Icon size={11} />
                  <span>{group.label}</span>
                  <span className="text-[var(--text-faint)]">{group.items.length}</span>
                </div>
                <div className="flex min-w-0 gap-1 overflow-x-auto">
                  {group.items.map((item) => (
                    <div className="flex h-7 max-w-[230px] shrink-0 items-center rounded-[9px] border border-[var(--border-subtle)] bg-[var(--surface-soft)] text-[11px] font-semibold text-[var(--text)]" key={item.id}>
                      <button
                        className="flex min-w-0 flex-1 items-center gap-1.5 px-2 text-left transition hover:text-[var(--text-strong)]"
                        onClick={() => onOpen(item.id)}
                        title={pendingPreviewReason(item.preview)}
                        type="button"
                      >
                        <span className="truncate">{item.preview.title || fallbackTitle(item.preview.type, item.preview.content)}</span>
                        <span className="shrink-0 text-[var(--text-faint)]">{pendingPreviewShortLabel(item.preview)}</span>
                      </button>
                      <button
                        aria-label="删除上下文"
                        className="grid h-6 w-6 shrink-0 place-items-center rounded-[8px] text-[var(--text-faint)] transition hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"
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
      <div className="w-full max-w-[460px] text-[var(--text-strong)]">
        <div className="mb-2 flex items-center justify-between gap-2 rounded-[16px] border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-2 shadow-sm">
          <div className="min-w-0">
            <div className="text-sm font-bold">补全这条记录</div>
            <div className="truncate text-[11px] font-medium text-[var(--text-muted)]">{item.created_at}</div>
          </div>
          <button
            aria-label="关闭待确认"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] text-[var(--text-muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--danger)]"
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

function ConfirmModal({
  body,
  confirmLabel,
  onCancel,
  onConfirm,
  title,
}: {
  body: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
}) {
  return (
    <div className="modal-backdrop">
      <div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-modal-title">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[12px] bg-[var(--danger-soft)] text-[var(--danger)]">
            <Trash2 size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-[var(--text-strong)]" id="confirm-modal-title">{title}</div>
            <div className="mt-1 text-xs font-medium leading-5 text-[var(--text-muted)]">{body}</div>
          </div>
          <button aria-label="关闭" className="icon-button" onClick={onCancel} title="关闭" type="button">
            <X size={16} />
          </button>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button className="secondary-button" onClick={onCancel} type="button">
            取消
          </button>
          <button className="danger-button" onClick={onConfirm} type="button">
            <Trash2 size={14} />
            {confirmLabel}
          </button>
        </div>
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
    <div className="w-full max-w-full rounded-[9px] border border-[var(--border-subtle)] bg-[var(--surface-soft)] text-[var(--text-muted)]">
      <button
        aria-expanded={expanded}
        className="flex min-h-5 w-full items-center justify-between gap-2 rounded-[9px] px-1.5 py-0.5 text-left transition hover:bg-[var(--surface-hover)]"
        onClick={() => setExpanded((current) => !current)}
        type="button"
      >
        <span className="flex min-w-0 items-center gap-1 text-[10px] font-bold leading-3 text-[var(--text-muted)]">
          <Sparkles size={11} />
          <span className="shrink-0">意图栈</span>
          <span className="min-w-0 truncate font-semibold text-[var(--text-faint)]">{summary}</span>
        </span>
        <ChevronDown className={`shrink-0 text-[var(--text-faint)] transition ${expanded ? 'rotate-180' : ''}`} size={13} />
      </button>
      {expanded ? (
        <div className="border-t border-[var(--border-subtle)] p-2">
          {intents.length ? (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {intents.map((intent, index) => (
                <span
                  className={`inline-flex max-w-full items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold ${
                    index === 0 ? 'bg-[var(--success-soft)] text-[var(--success)]' : 'bg-[var(--surface-soft)] text-[var(--text-muted)]'
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
                    className="flex min-h-8 items-center justify-between gap-2 rounded-[10px] border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-2 py-1.5 text-left transition hover:border-[var(--accent)] hover:bg-[var(--surface-hover)]"
                    key={candidate.id ?? `${candidate.intent_id}-${index}`}
                    onClick={() => onOpenPending(pendingId)}
                    type="button"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[11px] font-bold text-[var(--text-strong)]">
                        {index === 0 ? '主候选' : '副候选'} · {typeLabel[candidate.type]} · {candidate.title || fallbackTitle(candidate.type, candidate.content)}
                      </span>
                      <span className="mt-0.5 block truncate text-[10px] font-semibold text-[var(--text-muted)]">{candidateDecisionLabel(candidate.execution_decision)}</span>
                    </span>
                    <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${candidate.primary ? 'bg-[var(--success-soft)] text-[var(--success)]' : 'bg-[var(--surface-soft)] text-[var(--text-muted)]'}`}>
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
                <span className="rounded-full border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--text-muted)]" key={item}>
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

function LeftSidebar({
  activeView,
  onOpenChat,
  onOpenScheduled,
  onOpenSettings,
  onQueryChange,
  query,
  scheduledCount,
  settings,
}: {
  activeView: ShellView;
  onOpenChat: () => void;
  onOpenScheduled: () => void;
  onOpenSettings: () => void;
  onQueryChange: (value: string) => void;
  query: string;
  scheduledCount: number;
  settings: AgentSettings;
}) {
  return (
    <aside className="vimo-left-sidebar">
      <div className="vimo-sidebar-top min-w-0 space-y-3">
        <button className="vimo-brand-button" onClick={onOpenChat} type="button">
          <span className="vimo-brand-mark">V</span>
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-semibold text-[var(--text-strong)]">Vimo</span>
            <span className="block truncate text-[11px] font-medium text-[var(--text-muted)]">Personal memory</span>
          </span>
        </button>

        <label className="vimo-sidebar-search">
          <Search size={15} className="shrink-0 text-[var(--text-faint)]" />
          <input
            aria-label="搜索记录"
            className="min-w-0 flex-1 border-0 bg-transparent text-[13px] font-medium text-[var(--text-strong)] outline-none placeholder:text-[var(--text-faint)]"
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="搜索"
            value={query}
          />
        </label>

        <button className="vimo-sidebar-action" onClick={onOpenScheduled} type="button">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-[var(--accent-soft)] text-[var(--accent)]">
            <CalendarCheck2 size={16} />
          </span>
          <span className="min-w-0 flex-1 text-left">
            <span className="block truncate text-[13px] font-semibold">定时任务</span>
            <span className="block truncate text-[11px] font-medium text-[var(--text-muted)]">{scheduledCount ? `${scheduledCount} 个待提醒` : '暂无待提醒'}</span>
          </span>
        </button>
      </div>

      <button className="vimo-profile-button" data-active={activeView === 'settings'} onClick={onOpenSettings} type="button">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--text-strong)] text-[var(--app-bg)]">
          <UserRound size={17} />
        </span>
        <span className="min-w-0 flex-1 text-left">
          <span className="block truncate text-[13px] font-semibold text-[var(--text-strong)]">{settings.nickname.trim() || '个人资料'}</span>
          <span className="block truncate text-[11px] font-medium text-[var(--text-muted)]">设置与偏好</span>
        </span>
        <Settings2 size={15} className="shrink-0 text-[var(--text-faint)]" />
      </button>
    </aside>
  );
}

function SettingsView({
  customModels,
  modelOptions,
  onBack,
  onSelectModel,
  onUpdateProfile,
  settings,
}: {
  customModels: CustomAgentModel[];
  modelOptions: AgentModelOption[];
  onBack: () => void;
  onSelectModel: (modelKey: string) => void;
  onUpdateProfile: (patch: Partial<Pick<AgentSettings, 'preset' | 'custom_style' | 'nickname'>>) => void;
  settings: AgentSettings;
}) {
  const allModels = useMemo(() => combineAgentModels(modelOptions, customModels), [customModels, modelOptions]);
  const selectedModel = allModels.find((model) => model.key === settings.model_key) ?? allModels.find((model) => model.default) ?? allModels[0];
  const presets: Array<{ value: ReplyPreset; label: string }> = [
    { value: 'INTJ', label: 'INTJ' },
    { value: 'ENFJ', label: 'ENFJ' },
    { value: 'ISTP', label: 'ISTP' },
    { value: 'ENFP', label: 'ENFP' },
    { value: 'custom', label: '自定义' },
  ];

  return (
    <section className="settings-view h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 py-5 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between gap-3">
          <button className="secondary-button" onClick={onBack} type="button">
            <ArrowLeft size={15} />
            返回
          </button>
          <div className="text-right">
            <div className="text-sm font-semibold text-[var(--text-strong)]">设置</div>
            <div className="text-xs font-medium text-[var(--text-muted)]">本地偏好</div>
          </div>
        </div>

        <div className="space-y-5">
          <section className="settings-section">
            <div className="settings-section-heading">
              <UserRound size={17} />
              <span>个人资料</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="称呼">
                <input
                  className="text-field"
                  onChange={(event) => onUpdateProfile({ nickname: event.target.value })}
                  placeholder="你希望 Vimo 怎么称呼你"
                  value={settings.nickname}
                />
              </Field>
              <Field label="回复风格">
                <select
                  className="text-field"
                  onChange={(event) => onUpdateProfile({ preset: event.target.value as ReplyPreset })}
                  value={settings.preset}
                >
                  {presets.map((preset) => (
                    <option key={preset.value} value={preset.value}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="自定义风格">
              <textarea
                className="min-h-24 w-full resize-none rounded-[12px] border border-[var(--border-subtle)] bg-[var(--surface-soft)] px-3 py-2 text-sm font-medium leading-6 text-[var(--text-strong)] outline-none placeholder:text-[var(--text-faint)]"
                onChange={(event) => onUpdateProfile({ custom_style: event.target.value })}
                placeholder="例如：更简洁、更温和、少用列表"
                value={settings.custom_style}
              />
            </Field>
          </section>

          <section className="settings-section">
            <div className="settings-section-heading">
              <ServerIcon />
              <span>模型</span>
            </div>
            <div className="grid gap-2">
              {allModels.length ? (
                allModels.map((model) => {
                  const selected = model.key === selectedModel?.key;
                  return (
                    <button className="settings-model-row" data-active={selected} key={model.key} onClick={() => onSelectModel(model.key)} type="button">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] bg-[var(--surface-soft)] text-[var(--text-muted)]">
                        <ServerIcon />
                      </span>
                      <span className="min-w-0 flex-1 text-left">
                        <span className="block truncate text-[13px] font-semibold text-[var(--text-strong)]">{model.label}</span>
                        <span className="block truncate text-[11px] font-medium text-[var(--text-muted)]">{model.description || model.model}</span>
                      </span>
                      {selected ? <CheckCircle2 size={16} className="shrink-0 text-[var(--accent)]" /> : null}
                    </button>
                  );
                })
              ) : (
                <div className="rounded-[12px] bg-[var(--surface-soft)] px-3 py-3 text-xs font-semibold text-[var(--text-muted)]">模型列表加载中</div>
              )}
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}

function ServerIcon() {
  return <Sparkles size={15} />;
}

function Field({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="block text-xs font-semibold text-[var(--text-muted)]">
      {label}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

function RecordsPanel({
  activeTab,
  records,
  query,
  scope,
  onDelete,
  onQueryChange,
  onRestore,
  onScopeChange,
  onTabChange,
  onUpdate,
}: {
  activeTab: RecordTab;
  records: RecordItem[];
  query: string;
  scope: RecordScope;
  onDelete: (id: string) => void;
  onQueryChange: (query: string) => void;
  onRestore: (id: string) => void;
  onScopeChange: (scope: RecordScope) => void;
  onTabChange: (tab: RecordTab) => void;
  onUpdate: (id: string, draft: RecordDraft) => void;
}) {
  const [formMode, setFormMode] = useState<'edit' | null>(null);
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
      const matchScope = scope === 'scheduled' ? isScheduledTodo(record) : true;
      const matchSearch =
        !searchText ||
        `${record.title} ${record.content} ${typeLabel[record.type]} ${record.datetime_iso ?? ''}`
          .toLowerCase()
          .includes(searchText);
      return matchTab && matchScope && matchSearch;
    });
  }, [activeTab, query, records, scope]);

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
    <aside className="records-panel relative flex min-h-[500px] min-w-0 flex-col overflow-hidden lg:min-h-0">
      <div className="border-b border-[var(--border-subtle)] px-3 py-3">
        <div className="mb-2 flex items-center gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-[var(--success-soft)] text-[var(--success)]">
              <ListChecks size={14} />
            </span>
            <div className="min-w-0">
              <div className="text-[13px] font-bold text-[var(--text-strong)]">记录</div>
              <div className="truncate text-[11px] font-medium text-[var(--text-muted)]">Records API · {records.length}</div>
            </div>
          </div>
        </div>

        <div className="record-tabs-strip mb-2 flex gap-1.5 overflow-x-auto pb-1">
          {recordTabs.map((tab) => (
            <RecordTabButton
              active={activeTab === tab.value}
              count={countByTab(records, tab.value)}
              icon={tab.icon}
              key={tab.value}
              label={tab.label}
              onClick={() => onTabChange(tab.value)}
              tab={tab.value}
            />
          ))}
        </div>

        {scope === 'scheduled' ? (
          <div className="mb-2 flex items-center justify-between gap-2 rounded-[10px] bg-[var(--accent-soft)] px-2.5 py-2 text-[11px] font-semibold text-[var(--accent)]">
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <CalendarCheck2 size={13} />
              <span className="truncate">定时任务</span>
            </span>
            <button className="rounded-[8px] px-1.5 py-0.5 text-[var(--accent)] transition hover:bg-[var(--surface-hover)]" onClick={() => onScopeChange('default')} type="button">
              全部
            </button>
          </div>
        ) : null}

        <label className="flex h-8 items-center gap-1.5 rounded-[10px] border border-[var(--border-subtle)] bg-[var(--surface-soft)] px-2.5 text-[var(--text-muted)] shadow-sm">
          <Search size={13} className="shrink-0 text-[var(--text-faint)]" />
          <input
            aria-label="搜索记录"
            className="min-w-0 flex-1 border-0 bg-transparent text-xs font-medium text-[var(--text-strong)] outline-none placeholder:text-[var(--text-faint)]"
            onChange={(event) => {
              onScopeChange('default');
              onQueryChange(event.target.value);
            }}
            placeholder="搜索"
            value={query}
          />
        </label>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        <div className="space-y-2">
          {visibleRecords.length ? (
            visibleRecords.map((record) => (
              <RecordPreviewRow
                activeTab={activeTab}
                key={record.id}
                onDelete={onDelete}
                onEdit={startEdit}
                onRestore={onRestore}
                onToggleDone={toggleDone}
                record={record}
              />
            ))
          ) : (
            <EmptyRecords />
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
      ? 'data-[active=true]:bg-[var(--surface-hover)] data-[active=true]:text-[var(--text-strong)]'
      : tab === 'pending'
        ? typeMeta.unknown.tab
        : tab === 'trash'
          ? 'data-[active=true]:bg-[var(--danger-soft)] data-[active=true]:text-[var(--danger)]'
          : typeMeta[tab].tab;
  return (
    <button
      className={`flex h-8 min-w-[82px] items-center justify-center gap-1 rounded-[10px] border border-[var(--border-subtle)] bg-[var(--surface-soft)] px-1.5 text-[11px] font-bold text-[var(--text-muted)] shadow-sm transition hover:-translate-y-0.5 hover:bg-[var(--surface-hover)] active:translate-y-0 ${activeTone}`}
      data-active={active}
      onClick={onClick}
      type="button"
    >
      <Icon size={13} className="shrink-0" />
      <span className="truncate">{label}</span>
      <span className="rounded-full bg-[var(--surface-elevated)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">{count}</span>
    </button>
  );
}

function RecordPreviewRow({
  activeTab,
  record,
  onDelete,
  onEdit,
  onRestore,
  onToggleDone,
}: {
  activeTab: RecordTab;
  record: RecordItem;
  onDelete: (id: string) => void;
  onEdit: (record: RecordItem) => void;
  onRestore: (id: string) => void;
  onToggleDone: (record: RecordItem) => void;
}) {
  if (record.status === 'discarded' || activeTab === 'trash' || activeTab === 'pending' || activeTab === 'all') {
    return <RecordRow onDelete={onDelete} onEdit={onEdit} onRestore={onRestore} onToggleDone={onToggleDone} record={record} />;
  }
  if (record.type === 'todo') {
    return <TodoRecordRow onDelete={onDelete} onEdit={onEdit} onToggleDone={onToggleDone} record={record} />;
  }
  if (record.type === 'idea') {
    return <IdeaRecordRow onDelete={onDelete} onEdit={onEdit} record={record} />;
  }
  if (record.type === 'memo') {
    return <MemoRecordRow onDelete={onDelete} onEdit={onEdit} record={record} />;
  }
  if (record.type === 'journal') {
    return <JournalRecordRow onDelete={onDelete} onEdit={onEdit} record={record} />;
  }
  return <RecordRow onDelete={onDelete} onEdit={onEdit} onRestore={onRestore} onToggleDone={onToggleDone} record={record} />;
}

function TodoRecordRow({
  record,
  onDelete,
  onEdit,
  onToggleDone,
}: {
  record: RecordItem;
  onDelete: (id: string) => void;
  onEdit: (record: RecordItem) => void;
  onToggleDone: (record: RecordItem) => void;
}) {
  const completed = record.status === 'completed';
  return (
    <article className={`record-preview-item todo-preview ${completed ? 'opacity-70' : ''}`}>
      <button
        aria-label={completed ? '恢复待办' : '完成待办'}
        className="record-check-button"
        data-active={completed}
        onClick={() => onToggleDone(record)}
        title={completed ? '恢复' : '完成'}
        type="button"
      >
        <CheckCircle2 size={15} />
      </button>
      <div className="min-w-0 flex-1">
        <div className={`text-[13px] font-semibold text-[var(--text-strong)] ${completed ? 'line-through' : ''}`}>{record.title || fallbackTitle(record.type, record.content)}</div>
        <p className="mt-1 line-clamp-2 text-[12px] font-medium leading-5 text-[var(--text-muted)]">{record.content}</p>
        <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-bold text-[var(--text-muted)]">
          {record.datetime_iso ? (
            <span className="record-mini-chip">
              <Clock3 size={10} />
              {record.datetime_iso}
            </span>
          ) : null}
          {record.need_reminder ? (
            <span className="record-mini-chip text-[var(--danger)]">
              <Bell size={10} />
              提醒
            </span>
          ) : null}
        </div>
      </div>
      <RecordInlineActions onDelete={() => onDelete(record.id)} onEdit={() => onEdit(record)} />
    </article>
  );
}

function IdeaRecordRow({
  record,
  onDelete,
  onEdit,
}: {
  record: RecordItem;
  onDelete: (id: string) => void;
  onEdit: (record: RecordItem) => void;
}) {
  return (
    <article className="record-preview-item idea-preview">
      <div className="flex min-w-0 items-start gap-2">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[11px] bg-[#fff1b8] text-[#8a5a00] dark:bg-[#3d3213] dark:text-[#f5cd65]">
          <Lightbulb size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-[var(--text-strong)]">{record.title || fallbackTitle(record.type, record.content)}</div>
          <p className="mt-2 line-clamp-4 text-[12px] font-medium leading-5 text-[var(--text)]">{record.content}</p>
          <div className="mt-2 text-[10px] font-bold text-[var(--text-faint)]">{formatDisplayTimestamp(record.updated_at)}</div>
        </div>
      </div>
      <RecordInlineActions onDelete={() => onDelete(record.id)} onEdit={() => onEdit(record)} />
    </article>
  );
}

function MemoRecordRow({
  record,
  onDelete,
  onEdit,
}: {
  record: RecordItem;
  onDelete: (id: string) => void;
  onEdit: (record: RecordItem) => void;
}) {
  return (
    <article className="record-preview-item memo-preview">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[12px] font-bold text-[var(--text-muted)]">
          <StickyNote size={14} />
          <span className="truncate">{record.title || fallbackTitle(record.type, record.content)}</span>
        </div>
        <p className="mt-2 whitespace-pre-wrap text-[12px] font-medium leading-5 text-[var(--text)]">{record.content}</p>
      </div>
      <RecordInlineActions onDelete={() => onDelete(record.id)} onEdit={() => onEdit(record)} />
    </article>
  );
}

function JournalRecordRow({
  record,
  onDelete,
  onEdit,
}: {
  record: RecordItem;
  onDelete: (id: string) => void;
  onEdit: (record: RecordItem) => void;
}) {
  return (
    <article className="record-preview-item journal-preview">
      <div className="min-w-0 flex-1">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold text-[var(--text-strong)]">{record.title || fallbackTitle(record.type, record.content)}</div>
            <div className="mt-0.5 text-[10px] font-bold text-[var(--text-faint)]">{record.datetime_iso || formatDisplayTimestamp(record.created_at)}</div>
          </div>
          <BookOpenText size={15} className="shrink-0 text-[var(--text-faint)]" />
        </div>
        <p className="line-clamp-5 text-[12px] font-medium leading-6 text-[var(--text)]">{record.content}</p>
      </div>
      <RecordInlineActions onDelete={() => onDelete(record.id)} onEdit={() => onEdit(record)} />
    </article>
  );
}

function RecordInlineActions({ onDelete, onEdit }: { onDelete: () => void; onEdit: () => void }) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <button
        aria-label="编辑记录"
        className="grid h-7 w-7 place-items-center rounded-[9px] text-[var(--text-muted)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
        onClick={onEdit}
        title="编辑"
        type="button"
      >
        <Edit3 size={13} />
      </button>
      <button
        aria-label="删除记录"
        className="grid h-7 w-7 place-items-center rounded-[9px] text-[var(--text-muted)] transition hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"
        onClick={onDelete}
        title="删除"
        type="button"
      >
        <Trash2 size={13} />
      </button>
    </div>
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
  mode: 'edit';
  onCancel: () => void;
  onChange: (draft: RecordDraft) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <form className="w-full max-w-[360px] rounded-[18px] border border-[var(--border)] bg-[var(--surface-elevated)] p-3 text-[var(--text-strong)] shadow-float" onSubmit={onSubmit}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-bold text-[var(--text-strong)]">
          <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-[var(--accent-soft)] text-[var(--accent)]">
            <Edit3 size={16} />
          </span>
          编辑
        </div>
        <button
          aria-label="关闭表单"
          className="grid h-8 w-8 place-items-center rounded-[10px] text-[var(--text-muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--danger)]"
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
          className="h-11 min-w-0 rounded-[12px] border border-[var(--border-subtle)] bg-[var(--surface-soft)] px-3 text-sm font-semibold text-[var(--text-strong)] outline-none"
          onChange={(event) => onChange({ ...draft, type: event.target.value as RecordType })}
          value={draft.type}
        >
          {Object.entries(typeLabel).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <label className="flex h-11 min-w-0 items-center gap-2 rounded-[12px] border border-[var(--border-subtle)] bg-[var(--surface-soft)] px-3 text-[var(--text-muted)]">
          <CalendarClock size={15} className="shrink-0 text-[var(--text-faint)]" />
          <input
            aria-label="时间"
            className="min-w-0 flex-1 border-0 bg-transparent text-sm font-semibold text-[var(--text-strong)] outline-none placeholder:text-[var(--text-faint)]"
            onChange={(event) => onChange({ ...draft, datetime: event.target.value })}
            placeholder="YYYY-MM-DD HH:mm:ss"
            value={draft.datetime}
          />
        </label>
      </div>

      <input
        aria-label="标题"
        className="mt-2 h-11 w-full rounded-[12px] border border-[var(--border-subtle)] bg-[var(--surface-soft)] px-3 text-sm font-semibold text-[var(--text-strong)] outline-none placeholder:text-[var(--text-faint)]"
        onChange={(event) => onChange({ ...draft, title: event.target.value })}
        placeholder="标题"
        value={draft.title}
      />

      <textarea
        aria-label="内容"
        className="mt-2 min-h-24 w-full resize-none rounded-[12px] border border-[var(--border-subtle)] bg-[var(--surface-soft)] px-3 py-2 text-sm font-medium leading-6 text-[var(--text-strong)] outline-none placeholder:text-[var(--text-faint)]"
        onChange={(event) => onChange({ ...draft, content: event.target.value })}
        placeholder="内容"
        value={draft.content}
      />

      <div className="mt-2 flex items-center justify-between gap-2">
        <label className="flex h-10 flex-1 items-center gap-2 rounded-[12px] bg-[var(--surface-soft)] px-3 text-xs font-bold text-[var(--text-muted)]">
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
          className="flex h-10 items-center gap-1.5 rounded-[12px] bg-[var(--text-strong)] px-3 text-xs font-bold text-[var(--app-bg)] shadow-sm transition hover:-translate-y-0.5 hover:bg-[var(--accent-strong)] active:translate-y-0 disabled:bg-[var(--surface-soft)] disabled:text-[var(--text-muted)] disabled:shadow-none"
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
    <article className={`rounded-[14px] border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-2.5 py-2.5 shadow-sm ${completed || discarded ? 'opacity-70' : ''}`}>
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-[11px] ${meta.tone}`}>
            <Icon size={13} />
          </span>
          <div className="min-w-0">
            <div className={`truncate text-xs font-bold text-[var(--text-strong)] ${completed ? 'line-through' : ''}`}>{record.title || fallbackTitle(record.type, record.content)}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] font-bold text-[var(--text-muted)]">
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
                completed ? 'bg-[var(--success-soft)] text-[var(--success)]' : 'text-[var(--text-muted)] hover:bg-[var(--success-soft)] hover:text-[var(--success)]'
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
              className="grid h-6 w-6 place-items-center rounded-[9px] text-[var(--text-muted)] transition hover:bg-[var(--success-soft)] hover:text-[var(--success)]"
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
                className="grid h-6 w-6 place-items-center rounded-[9px] text-[var(--text-muted)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
                onClick={() => onEdit(record)}
                title="编辑"
                type="button"
              >
                <Edit3 size={12} />
              </button>
              <button
                aria-label="删除记录"
                className="grid h-6 w-6 place-items-center rounded-[9px] text-[var(--text-muted)] transition hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"
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
      <p className="line-clamp-2 rounded-[10px] bg-[var(--surface-soft)] px-2 py-1.5 text-[11px] font-medium leading-4 text-[var(--text)]">{record.content}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] font-bold text-[var(--text-muted)]">
        <span className="inline-flex items-center gap-1">
          <FileText size={10} />
          {formatDisplayTimestamp(record.updated_at)}
        </span>
        {record.need_reminder ? (
          <span className="inline-flex items-center gap-1 text-[var(--danger)]">
            <Bell size={10} />
            提醒
          </span>
        ) : null}
        {discarded ? (
          <span className="inline-flex items-center gap-1 text-[var(--danger)]">
            <Trash2 size={10} />
            回收站
          </span>
        ) : null}
      </div>
    </article>
  );
}

function EmptyRecords() {
  return (
    <div className="rounded-[18px] border border-dashed border-[var(--border-subtle)] bg-[var(--surface-soft)] p-5 text-center">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-[16px] bg-[var(--success-soft)] text-[var(--success)]">
        <ListChecks size={20} />
      </div>
      <div className="mt-3 text-sm font-bold text-[var(--text-strong)]">暂无记录</div>
      <div className="mt-1 text-xs font-medium text-[var(--text-muted)]">和 Vimo 说一声，记录会自动生成。</div>
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
    <div className="flex items-center justify-between gap-2 rounded-[16px] border border-[var(--border-subtle)] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">
      <span className="min-w-0 truncate">{message}</span>
      <button aria-label="重试" className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-[var(--surface-soft)]" onClick={onRetry} type="button">
        <RefreshCw size={15} />
      </button>
    </div>
  );
}

function NoticeMessage({ content }: { content: string }) {
  return (
    <div className="flex items-center gap-3 py-1.5 text-[var(--text-muted)]" role="status" aria-live="polite">
      <div className="h-px flex-1 bg-[var(--border-subtle)]" />
      <div className="flex max-w-[72%] items-center gap-1.5 text-center text-[12px] font-semibold leading-5">
        <Info className="shrink-0 text-[var(--text-faint)]" size={14} />
        <span className="min-w-0 whitespace-normal break-words">{content}</span>
      </div>
      <div className="h-px flex-1 bg-[var(--border-subtle)]" />
    </div>
  );
}

function Toast({ message }: { message: string }) {
  return (
    <div className="pointer-events-none absolute left-1/2 top-5 z-30 -translate-x-1/2 rounded-full bg-[var(--surface-elevated)] px-4 py-2 text-sm font-semibold text-[var(--text-strong)] shadow-float backdrop-blur">
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

function isScheduledTodo(record: RecordItem) {
  return record.status !== 'discarded' && record.type === 'todo' && record.need_reminder;
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

export function previewPatch(preview: RecordPreview, record: RecordItem): Partial<RecordWriteInput> {
  const status = preview.status === 'ready' ? 'saved' : preview.status;
  const shouldKeepExistingDatetime = preview.datetime_text === null && preview.datetime_iso === null;
  return {
    type: preview.type,
    title: preview.title,
    content: preview.content,
    datetime_text: shouldKeepExistingDatetime ? record.datetime_text : preview.datetime_text,
    datetime_iso: shouldKeepExistingDatetime ? record.datetime_iso : preview.datetime_iso,
    need_reminder: preview.need_reminder,
    confidence: preview.confidence,
    status,
    missing_fields: normalizedMissingFields(preview),
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

export function openContextFromPreview(
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
      target_id: targetIdForTaskContext(preview, id),
      context_target_id: preview.context_target_id ?? id,
    },
    created_at: now,
    updated_at: now,
    last_user_message: userContent,
    last_assistant_reply: assistantContent,
  };
}

export function targetIdForTaskContext(preview: RecordPreview, taskId: string) {
  const action = preview.record_action ?? defaultRecordAction(preview);
  if (action === 'delete' && (preview.related_ids ?? []).length > 1) {
    return preview.target_id && preview.related_ids?.includes(preview.target_id) ? preview.target_id : null;
  }
  return preview.target_id ?? taskId;
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
    related_ids: mergedPreviewRelatedIds(current, next),
    target_id: mergedPreviewTargetId(current, next),
    context_target_id: next.context_target_id ?? next.target_id ?? current.context_target_id ?? current.target_id,
  };
}

export function mergedPreviewTargetId(current: RecordPreview, next: RecordPreview) {
  const action = next.record_action ?? current.record_action ?? defaultRecordAction(next);
  if (action === 'delete' && mergedPreviewRelatedIds(current, next).length > 1) {
    return next.target_id ?? current.target_id ?? null;
  }
  return next.target_id ?? next.context_target_id ?? current.target_id ?? current.context_target_id;
}

function mergedPreviewRelatedIds(current: RecordPreview, next: RecordPreview) {
  const action = next.record_action ?? current.record_action ?? defaultRecordAction(next);
  if (action === 'delete' && (current.related_ids ?? []).length > 1 && Array.isArray(next.related_ids) && next.related_ids.length === 0) {
    return current.related_ids ?? [];
  }
  if (Array.isArray(next.related_ids) && next.related_ids.length > 0) {
    return next.related_ids;
  }
  return next.related_ids ?? current.related_ids ?? [];
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

function assistantHasVisibleContent(message: Message) {
  return Boolean(
    message.content.trim() ||
      message.fastContent?.trim() ||
      message.slowContent?.trim() ||
      message.thinking?.fast?.trim() ||
      message.thinking?.slow?.trim() ||
      message.progressEvents?.length ||
      message.preview,
  );
}

function mergeProgressEvent(current: AgentProgressEvent[], event: AgentProgressEvent) {
  const key = event.id || `${event.turn_id}:${event.seq}:${event.type}`;
  const withoutSame = current.filter((item) => {
    const itemKey = item.id || `${item.turn_id}:${item.seq}:${item.type}`;
    return itemKey !== key;
  });
  return [...withoutSame, event].sort((a, b) => a.seq - b.seq).slice(-12);
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

function thinkingRequestForSettings(settings: AgentSettings, modelOptions: AgentModelOption[], customModels: CustomAgentModel[]) {
  const modelKey = selectedModelKey(settings);
  if (!settings.thinking_enabled || !modelKey || !modelSupportsThinking(modelKey, modelOptions, customModels)) {
    return undefined;
  }
  return { enabled: true };
}

function modelSupportsThinking(modelKey: string | undefined, modelOptions: AgentModelOption[], customModels: CustomAgentModel[]) {
  const key = modelKey?.trim();
  if (!key) {
    return false;
  }
  const builtIn = modelOptions.find((model) => model.key === key);
  if (builtIn) {
    return Boolean(builtIn.supports_thinking);
  }
  const custom = customModels.find((model) => model.key === key);
  return Boolean(custom?.supports_thinking);
}

function customModelForRequest(settings: AgentSettings, customModels: CustomAgentModel[]) {
  const key = selectedModelKey(settings);
  if (!key) {
    return undefined;
  }
  return customModels.find((model) => model.key === key);
}

function combineAgentModels(modelOptions: AgentModelOption[], customModels: CustomAgentModel[]): AgentModelOption[] {
  const custom = customModels.map((model) => ({
    key: model.key,
    label: model.label || model.model,
    description: model.description || model.api_url,
    model: model.model,
    default: false,
    supports_thinking: Boolean(model.supports_thinking),
  }));
  return [...modelOptions.map((model) => ({ ...model })), ...custom];
}

export function sanitizeSettingsPatch(patch: SettingsPatch, modelOptions: AgentModelOption[], customModels: CustomAgentModel[] = []): SettingsPatch | null {
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
    const allowedModelKeys = new Set([...modelOptions.map((model) => model.key), ...customModels.map((model) => model.key)]);
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

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
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
  const recordAction = recordActionForPendingMerge(pending, update);
  const merged: RecordPreview = {
    ...mergeOpenContextPreview(pending, update),
    status: 'ready',
    missing_fields: [],
    context_target_id: targetId,
    record_action: recordAction,
    intent: update.intent ?? pending.intent,
    related_ids: mergedPendingRelatedIds(pending, update, recordAction),
  };
  return {
    ...merged,
    target_id: targetIdForTaskContext(merged, targetId),
  };
}

function recordActionForPendingMerge(pending: RecordPreview, update: RecordPreview): RecordAction | undefined {
  if (pending.record_action === 'delete' && (update.intent === 'confirm_pending' || update.intent === 'update_pending')) {
    return 'delete';
  }
  return update.record_action ?? pending.record_action;
}

function mergedPendingRelatedIds(pending: RecordPreview, update: RecordPreview, action?: RecordAction) {
  if (action === 'delete' && (pending.related_ids ?? []).length > 1 && (!update.related_ids || update.related_ids.length === 0)) {
    return pending.related_ids;
  }
  return update.related_ids ?? pending.related_ids;
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
    target_id: targetIdForTaskContext(preview, taskId),
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
          return action === 'update' || action === 'delete';
        case 'hard_stop_need_reminder_change':
          return false;
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
    window.localStorage.setItem(chatMessagesKey, JSON.stringify(messages.slice(-80).map(messageForStorage)));
  } catch {
    // Chat history is local-only and best effort.
  }
}

function messageForStorage(message: Message): Message {
  if (message.role !== 'assistant') {
    return message;
  }
  const { thinking: _thinking, thinkingStartedAt: _thinkingStartedAt, thinkingFinishedAt: _thinkingFinishedAt, thinkingOpen: _thinkingOpen, ...rest } = message;
  return rest;
}

function normalizeStoredMessage(value: unknown): Message | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const item = value as Partial<Message>;
  if (typeof item.id !== 'string' || (item.role !== 'user' && item.role !== 'assistant' && item.role !== 'notice') || typeof item.content !== 'string') {
    return null;
  }
  const createdAt = typeof item.createdAt === 'string' ? formatDisplayTimestamp(item.createdAt) : formatLocalTimestamp();
  const fastContent = typeof item.fastContent === 'string' ? item.fastContent : undefined;
  const slowContent = typeof item.slowContent === 'string' ? item.slowContent : item.role === 'assistant' && !fastContent ? item.content : undefined;
  const progressEvents = normalizeProgressEvents(item.progressEvents);
  return {
    id: item.id,
    role: item.role,
    content: item.content,
    fastContent,
    slowContent,
    createdAt,
    intent: isAgentIntent(item.intent) ? item.intent : undefined,
    pendingId: typeof item.pendingId === 'string' ? item.pendingId : undefined,
    preview: item.preview ? normalizePreview(item.preview) : undefined,
    progressEvents,
    thinking: null,
    thinkingFinishedAt: undefined,
    thinkingOpen: false,
    thinkingStartedAt: undefined,
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

function normalizeRecordFromUnknown(value: unknown): RecordItem | null {
  return normalizeStoredRecord(value);
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
  const normalized: RecordPreview = {
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
  return normalizeReminderClosedPreview(normalized);
}

function normalizeReminderClosedPreview(preview: RecordPreview): RecordPreview {
  if (!isClosedReminderUpdatePreview(preview)) {
    return {
      ...preview,
      missing_fields: normalizedMissingFields(preview),
    };
  }
  const missing_fields = normalizedMissingFields(preview);
  const status = preview.status === 'need_confirmation' && missing_fields.length === 0 ? 'ready' : preview.status;
  return {
    ...preview,
    missing_fields,
    status,
  };
}

function isClosedReminderUpdatePreview(preview: Pick<RecordPreview, 'type' | 'record_action' | 'intent' | 'need_reminder' | 'missing_fields' | 'field_confidence' | 'field_risk' | 'intent_trace'>) {
  if (preview.need_reminder || preview.type !== 'todo') {
    return false;
  }
  const action = preview.record_action ?? defaultRecordAction(preview as RecordPreview);
  if (action !== 'update') {
    return false;
  }
  if (preview.field_risk?.need_reminder === 'high' || typeof preview.field_confidence?.need_reminder === 'number') {
    return true;
  }
  if (preview.missing_fields?.some((field) => field === 'need_reminder' || field === 'datetime')) {
    return true;
  }
  return Boolean(preview.intent_trace?.gate_reasons?.includes('hard_stop_need_reminder_change'));
}

function normalizedMissingFields(preview: Pick<RecordPreview, 'missing_fields' | 'need_reminder' | 'status'>) {
  const fields = Array.isArray(preview.missing_fields) ? preview.missing_fields.filter((field): field is string => typeof field === 'string') : [];
  if (preview.status === 'ready') {
    return [];
  }
  if (!preview.need_reminder) {
    return fields.filter((field) => field !== 'need_reminder' && field !== 'datetime');
  }
  return fields;
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

function readCustomModels(): CustomAgentModel[] {
  if (typeof window === 'undefined') {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(customModelsKey);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map(normalizeCustomModel).filter((model): model is CustomAgentModel => Boolean(model)).slice(0, 20);
  } catch {
    return [];
  }
}

function writeCustomModels(models: CustomAgentModel[]) {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(customModelsKey, JSON.stringify(models.slice(0, 20)));
  } catch {
    // Custom models are browser-local and best effort.
  }
}

function normalizeCustomModel(value: unknown): CustomAgentModel | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const source = value as Partial<Record<keyof CustomAgentModel, unknown>>;
  const key = typeof source.key === 'string' ? source.key.trim() : '';
  const model = typeof source.model === 'string' ? source.model.trim() : '';
  const apiURL = typeof source.api_url === 'string' ? source.api_url.trim() : '';
  if (!key || !model || !apiURL) {
    return null;
  }
  return {
    key,
    label: typeof source.label === 'string' && source.label.trim() ? source.label.trim() : model,
    description: typeof source.description === 'string' ? source.description.trim() : apiURL,
    api_url: apiURL,
    api_key: typeof source.api_key === 'string' ? source.api_key : '',
    model,
    timeout_seconds: typeof source.timeout_seconds === 'number' && source.timeout_seconds > 0 ? Math.floor(source.timeout_seconds) : 120,
    supports_thinking: Boolean(source.supports_thinking),
  };
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
    thinking_enabled: Boolean(value.thinking_enabled),
  };
}

function normalizeThinkingPayload(value: unknown): ThinkingPayload | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const source = value as Partial<Record<keyof ThinkingPayload, unknown>>;
  const fast = typeof source.fast === 'string' ? source.fast.trim() : '';
  const slow = typeof source.slow === 'string' ? source.slow.trim() : '';
  if (!fast && !slow) {
    return null;
  }
  return {
    ...(fast ? { fast } : {}),
    ...(slow ? { slow } : {}),
  };
}

function normalizeProgressEvents(value: unknown): AgentProgressEvent[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const events = value
    .map(normalizeProgressEvent)
    .filter((event): event is AgentProgressEvent => Boolean(event))
    .sort((a, b) => a.seq - b.seq)
    .slice(-12);
  return events.length ? events : undefined;
}

function normalizeProgressEvent(value: unknown): AgentProgressEvent | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const source = value as Partial<AgentProgressEvent>;
  const type = typeof source.type === 'string' ? source.type.trim() : '';
  const title = typeof source.title === 'string' ? source.title.trim() : '';
  if (!type || !title) {
    return null;
  }
  const seq = typeof source.seq === 'number' && Number.isFinite(source.seq) ? source.seq : 0;
  return {
    id: typeof source.id === 'string' ? source.id : `${type}-${seq}`,
    turn_id: typeof source.turn_id === 'string' ? source.turn_id : '',
    seq,
    type,
    title,
    detail: typeof source.detail === 'string' && source.detail.trim() ? source.detail.trim() : undefined,
    status: isProgressStatus(source.status) ? source.status : 'completed',
    payload: source.payload,
    created_at: typeof source.created_at === 'string' ? source.created_at : new Date().toISOString(),
  };
}

function isProgressStatus(value: unknown): value is AgentProgressEvent['status'] {
  return value === 'running' || value === 'completed' || value === 'warning' || value === 'failed';
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
  const candidate: RecordCandidate = {
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
  if (isClosedReminderCandidate(candidate)) {
    candidate.missing_fields = candidate.missing_fields.filter((field) => field !== 'need_reminder' && field !== 'datetime');
    if (candidate.status === 'need_confirmation' && candidate.missing_fields.length === 0) {
      candidate.status = 'ready';
    }
  }
  return candidate;
}

function isClosedReminderCandidate(candidate: RecordCandidate) {
  if (candidate.need_reminder || candidate.type !== 'todo' || candidate.record_action !== 'update') {
    return false;
  }
  return (
    candidate.field_risk?.need_reminder === 'high' ||
    typeof candidate.field_confidence?.need_reminder === 'number' ||
    candidate.missing_fields.some((field) => field === 'need_reminder' || field === 'datetime')
  );
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
