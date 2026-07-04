import { Copy, Edit3, RotateCcw, UserRound } from 'lucide-react';
import type { ReactNode } from 'react';

interface MessageBubbleProps {
  role: 'user' | 'assistant';
  content: string;
  compact?: boolean;
  beforeContent?: ReactNode;
  timestamp?: string;
  onCopy?: () => void;
  onOpenPending?: () => void;
  onRetry?: () => void;
}

export function MessageBubble({ role, content, compact, beforeContent, timestamp, onCopy, onOpenPending, onRetry }: MessageBubbleProps) {
  const isUser = role === 'user';
  return (
    <div className={`group flex gap-1.5 ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex flex-col ${isUser ? 'max-w-[72%] items-end' : 'max-w-[min(78%,720px)] items-start'}`}>
        {!isUser && beforeContent ? <div className="mb-1 w-full">{beforeContent}</div> : null}
        <div
          className={`whitespace-pre-wrap text-[13px] leading-5 transition ${
            isUser
              ? 'rounded-[15px] rounded-br-[5px] bg-[#70521f] px-3 py-1.5 text-[#f8f4ed] shadow-sm shadow-pop'
              : compact
                ? 'py-0.5 text-[#d8c8b8]'
                : 'py-0.5 text-[#f8f4ed]'
          }`}
        >
          {content}
        </div>
        {onOpenPending && !isUser ? (
          <button
            className="mt-1 inline-flex items-center gap-1 rounded-[9px] border border-[#70521f] bg-[#2b2417] px-2 py-1 text-[11px] font-bold text-[#f4d47c] shadow-sm transition hover:bg-[#3a3020] hover:text-[#f8f4ed]"
            onClick={onOpenPending}
            type="button"
          >
            <Edit3 size={12} />
            <span>补全信息</span>
          </button>
        ) : null}
        {timestamp ? <div className="mt-0.5 text-[10px] font-medium leading-3 text-[#d8c8b8]/45">{timestamp}</div> : null}
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

function UserAvatar() {
  return (
    <div className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-[10px] bg-[#3a202d] text-[#ff85a1]">
      <UserRound size={12} />
    </div>
  );
}

function IconAction({ children, label, onClick }: { children: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      aria-label={label}
      className="grid h-6 w-6 place-items-center rounded-[10px] border border-[#353044] bg-[#242032] text-[#d8c8b8]/70 shadow-sm transition hover:-translate-y-0.5 hover:text-[#ff85a1] active:translate-y-0"
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}
