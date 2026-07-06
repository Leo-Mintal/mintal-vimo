import { Copy, Edit3, RotateCcw, UserRound } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ThinkingPayload } from '../../types/agent';

interface MessageBubbleProps {
  role: 'user' | 'assistant';
  content: string;
  fastContent?: string;
  slowContent?: string;
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
  const shouldShowAssistantFlow = !isUser && !compact && (Boolean(thinking?.fast?.trim()) || Boolean(fastReply) || Boolean(thinking?.slow?.trim()) || Boolean(slowReply));
  return (
    <div className={`group flex gap-1.5 ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex flex-col ${isUser ? 'max-w-[72%] items-end' : 'max-w-[min(78%,720px)] items-start'}`}>
        {!isUser && beforeContent ? <div className="mb-1 w-full">{beforeContent}</div> : null}
        {shouldShowAssistantFlow ? (
          <AssistantFlow
            fastReply={fastReply}
            fastThinking={thinking?.fast ?? ''}
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

function AssistantFlow({
  fastReply,
  fastThinking,
  slowReply,
  slowThinking,
}: {
  fastReply: string;
  fastThinking: string;
  slowReply: string;
  slowThinking: string;
}) {
  return (
    <div className="assistant-flow">
      {fastThinking.trim() ? <AssistantFlowBlock label="快路思考" tone="thinking" text={fastThinking} /> : null}
      {fastReply ? <AssistantFlowBlock label="快路回复" tone="reply" text={fastReply} /> : null}
      {slowThinking.trim() ? <AssistantFlowBlock label="慢路思考" tone="thinking" text={slowThinking} /> : null}
      {slowReply ? <AssistantFlowBlock label="慢路回复" tone="reply" text={slowReply} /> : null}
    </div>
  );
}

function AssistantFlowBlock({ label, text, tone }: { label: string; text: string; tone: 'thinking' | 'reply' }) {
  return (
    <section className="assistant-flow-block" data-tone={tone}>
      <div className="assistant-flow-label">{label}</div>
      <div className="assistant-flow-text">{text}</div>
    </section>
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
