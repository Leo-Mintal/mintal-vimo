import { Brain, Copy, Edit3, RotateCcw, UserRound } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ThinkingPayload } from '../../types/agent';

interface MessageBubbleProps {
  role: 'user' | 'assistant';
  content: string;
  compact?: boolean;
  beforeContent?: ReactNode;
  thinking?: ThinkingPayload | null;
  timestamp?: string;
  onCopy?: () => void;
  onOpenPending?: () => void;
  onRetry?: () => void;
}

export function MessageBubble({ role, content, compact, beforeContent, thinking, timestamp, onCopy, onOpenPending, onRetry }: MessageBubbleProps) {
  const isUser = role === 'user';
  return (
    <div className={`group flex gap-1.5 ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex flex-col ${isUser ? 'max-w-[72%] items-end' : 'max-w-[min(78%,720px)] items-start'}`}>
        {!isUser && beforeContent ? <div className="mb-1 w-full">{beforeContent}</div> : null}
        {!isUser && thinking ? <ThinkingPanel thinking={thinking} /> : null}
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

function ThinkingPanel({ thinking }: { thinking: ThinkingPayload }) {
  const parts = [
    thinking.fast?.trim() ? { key: 'fast', label: '快路思考', content: thinking.fast.trim() } : null,
    thinking.slow?.trim() ? { key: 'slow', label: '慢路思考', content: thinking.slow.trim() } : null,
  ].filter((item): item is { key: string; label: string; content: string } => Boolean(item));
  if (!parts.length) {
    return null;
  }
  return (
    <details className="thinking-panel mb-2" open>
      <summary>
        <Brain size={13} />
        <span>思考过程</span>
      </summary>
      <div className="grid gap-2 px-3 pb-3 pt-1">
        {parts.map((part) => (
          <div key={part.key}>
            <div className="mb-1 text-[10px] font-bold uppercase tracking-normal text-[var(--text-faint)]">{part.label}</div>
            <div className="whitespace-pre-wrap text-[12px] font-medium leading-5 text-[var(--text-muted)]">{part.content}</div>
          </div>
        ))}
      </div>
    </details>
  );
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
