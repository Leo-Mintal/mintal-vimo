import { ChevronRight, Copy, Edit3, RotateCcw, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { AgentProgressEvent, ThinkingPayload } from '../../types/agent';

interface MessageBubbleProps {
  role: 'user' | 'assistant';
  content: string;
  fastContent?: string;
  slowContent?: string;
  progressEvents?: AgentProgressEvent[];
  compact?: boolean;
  beforeContent?: ReactNode;
  thinking?: ThinkingPayload | null;
  timestamp?: string;
  onCopy?: () => void;
  onOpenPending?: () => void;
  onRetry?: () => void;
}

export function MessageBubble({
  role,
  content,
  fastContent,
  slowContent,
  progressEvents,
  compact,
  beforeContent,
  thinking,
  timestamp,
  onCopy,
  onOpenPending,
  onRetry,
}: MessageBubbleProps) {
  const isUser = role === 'user';
  const fastReply = fastContent?.trim() ?? '';
  const slowReply = slowContent?.trim() ?? '';
  const shouldShowAssistantWorkflow =
    !isUser &&
    !compact &&
    (Boolean(progressEvents?.length) || Boolean(thinking?.fast?.trim()) || Boolean(fastReply) || Boolean(thinking?.slow?.trim()) || Boolean(slowReply));
  return (
    <div className={`group flex gap-1.5 ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex flex-col ${isUser ? 'max-w-[72%] items-end' : 'max-w-[min(78%,720px)] items-start'}`}>
        {!isUser && beforeContent ? <div className="mb-1 w-full">{beforeContent}</div> : null}
        {shouldShowAssistantWorkflow ? (
          <AssistantWorkflow
            fastReply={fastReply}
            fastThinking={thinking?.fast ?? ''}
            progressEvents={progressEvents ?? []}
            slowReply={slowReply}
            slowThinking={thinking?.slow ?? ''}
          />
        ) : (
          <div
            className={`whitespace-pre-wrap text-[13px] leading-5 transition ${
              isUser
                ? 'rounded-[16px] rounded-br-[6px] bg-[var(--text-strong)] px-3 py-1.5 text-[var(--app-bg)] shadow-sm'
                : compact
                  ? 'py-0.5 text-[var(--text-muted)]'
                  : 'py-0.5 text-[var(--text-strong)]'
            }`}
          >
            {content}
          </div>
        )}
        {onOpenPending && !isUser ? (
          <button
            className="mt-1 inline-flex items-center gap-1 rounded-[9px] border border-[var(--border-subtle)] bg-[var(--warning-soft)] px-2 py-1 text-[11px] font-bold text-[var(--warning)] shadow-sm transition hover:bg-[var(--surface-hover)] hover:text-[var(--text-strong)]"
            onClick={onOpenPending}
            type="button"
          >
            <Edit3 size={12} />
            <span>补全信息</span>
          </button>
        ) : null}
        {timestamp ? <div className="mt-0.5 text-[10px] font-medium leading-3 text-[var(--text-faint)]">{timestamp}</div> : null}
        {(onCopy || (onRetry && isUser)) && !compact ? (
          <div className="mt-0.5 flex gap-1 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
            {onRetry && isUser ? (
              <IconAction label="重试" onClick={onRetry}>
                <RotateCcw size={14} />
              </IconAction>
            ) : null}
            {onCopy ? (
              <IconAction label="复制" onClick={onCopy}>
                <Copy size={14} />
              </IconAction>
            ) : null}
          </div>
        ) : null}
      </div>
      {isUser ? <UserAvatar /> : null}
    </div>
  );
}

function AgentProgressTimeline({ events }: { events: AgentProgressEvent[] }) {
  const visibleEvents = collapseProgressEvents(events);
  if (!visibleEvents.length) {
    return null;
  }
  return (
    <div className="agent-progress-timeline">
      {visibleEvents.map((event) => (
        <div className="agent-progress-item" data-status={event.status} key={event.id || `${event.type}-${event.seq}`}>
          <span className="agent-progress-icon">{progressIcon(event.status)}</span>
          <span className="agent-progress-title">{event.title}</span>
          {event.detail ? <span className="agent-progress-detail">{event.detail}</span> : null}
        </div>
      ))}
    </div>
  );
}

function collapseProgressEvents(events: AgentProgressEvent[]) {
  const seen = new Map<string, AgentProgressEvent>();
  for (const event of events) {
    seen.set(event.type, event);
  }
  return Array.from(seen.values()).sort((a, b) => a.seq - b.seq).slice(-8);
}

function AssistantWorkflow({
  fastReply,
  fastThinking,
  progressEvents,
  slowReply,
  slowThinking,
}: {
  fastReply: string;
  fastThinking: string;
  progressEvents: AgentProgressEvent[];
  slowReply: string;
  slowThinking: string;
}) {
  const fastTiming = processTiming(progressEvents, 'fast');
  const slowTiming = processTiming(progressEvents, 'slow');
  const hasFastStage = Boolean(fastThinking.trim() || fastReply || fastTiming.started);
  const hasSlowStage = Boolean(slowThinking.trim() || slowReply || slowTiming.started);
  return (
    <div className="assistant-workflow">
      <div className="assistant-output">
        {hasFastStage ? (
          <AssistantProcessBlock completed={fastTiming.completed} end={fastTiming.end} reply={fastReply} start={fastTiming.start} thinking={fastThinking}>
            <AgentProgressTimeline events={stageProgressEvents(progressEvents, 'fast')} />
          </AssistantProcessBlock>
        ) : null}
        {hasSlowStage ? (
          <AssistantProcessBlock completed={slowTiming.completed} end={slowTiming.end} reply={slowReply} start={slowTiming.start} thinking={slowThinking}>
            <AgentProgressTimeline events={stageProgressEvents(progressEvents, 'slow')} />
          </AssistantProcessBlock>
        ) : null}
      </div>
    </div>
  );
}

function AssistantProcessBlock({
  children,
  completed,
  end,
  reply,
  start,
  thinking,
}: {
  children?: ReactNode;
  completed: boolean;
  end: number;
  reply: string;
  start: number;
  thinking: string;
}) {
  const [open, setOpen] = useState(!completed);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setOpen(!completed);
  }, [completed]);
  useEffect(() => {
    if (completed) {
      return;
    }
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [completed]);
  const hasBody = Boolean(thinking.trim() || children);
  const displayDuration = start
    ? formatDuration(Math.max(0, (completed ? end : now) - start))
    : completed
      ? formatDuration(0)
      : '';
  return (
    <section className="assistant-process-block" data-open={open}>
      <button
        aria-expanded={open}
        className="assistant-process-summary"
        disabled={!hasBody}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span>{completed ? '已处理' : '处理中'}</span>
        {displayDuration ? <span>{displayDuration}</span> : null}
        {hasBody ? <ChevronRight className="assistant-process-chevron" size={15} /> : null}
      </button>
      {hasBody && open ? (
        <div className="assistant-process-body">
          {children}
          {thinking.trim() ? <div className="assistant-process-thinking">{thinking}</div> : null}
        </div>
      ) : null}
      {reply ? <div className="assistant-process-reply">{reply}</div> : null}
    </section>
  );
}

function processTiming(events: AgentProgressEvent[], stage: 'fast' | 'slow') {
  const runCompletedAt = progressTime(findProgressEvent(events, 'run.completed'));
  const slowStartedAt = progressTime(findProgressEvent(events, 'analyze.started'));
  const start =
    progressTime(findProgressEvent(events, stage === 'fast' ? 'fast_reply.started' : 'analyze.started')) ||
    (stage === 'fast' ? progressTime(findProgressEvent(events, 'run.started')) : 0);
  const end =
    progressTime(findProgressEvent(events, stage === 'fast' ? 'fast_reply.completed' : 'run.completed')) ||
    (stage === 'fast' && runCompletedAt && !slowStartedAt ? runCompletedAt : 0);
  const started = Boolean(start);
  const completed = Boolean(end);
  return {
    completed,
    end,
    start,
    started,
  };
}

function findProgressEvent(events: AgentProgressEvent[], type: string) {
  return events.find((event) => event.type === type) ?? null;
}

function progressTime(event: AgentProgressEvent | null) {
  if (!event?.created_at) {
    return 0;
  }
  const time = new Date(event.created_at).getTime();
  return Number.isFinite(time) ? time : 0;
}

function formatDuration(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${remainingSeconds}s`;
}

function stageProgressEvents(events: AgentProgressEvent[], stage: 'fast' | 'slow') {
  const hiddenTypes = new Set(['fast_reply.completed', 'run.completed']);
  const fastTypes = new Set(['run.started', 'fast_reply.started', 'fast_reply.completed']);
  return events
    .filter((event) => (stage === 'fast' ? fastTypes.has(event.type) : !fastTypes.has(event.type)))
    .filter((event) => !hiddenTypes.has(event.type));
}

function progressIcon(status: AgentProgressEvent['status']) {
  return <span className="agent-progress-dot" data-status={status} />;
}

function UserAvatar() {
  return (
    <div className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-[10px] bg-[var(--accent-soft)] text-[var(--accent)]">
      <UserRound size={12} />
    </div>
  );
}

function IconAction({ children, label, onClick }: { children: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      aria-label={label}
      className="grid h-6 w-6 place-items-center rounded-[9px] border border-[var(--border-subtle)] bg-[var(--surface-soft)] text-[var(--text-muted)] shadow-sm transition hover:-translate-y-0.5 hover:text-[var(--accent)] active:translate-y-0"
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}
