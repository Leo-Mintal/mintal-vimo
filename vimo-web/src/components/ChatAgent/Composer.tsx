import { BookOpenText, ClipboardList, Lightbulb, Mic, SendHorizontal, StickyNote } from 'lucide-react';
import { FormEvent, useRef, useState } from 'react';

interface ComposerProps {
  disabled?: boolean;
  onSend: (message: string) => void;
}

const intents = [
  { label: '待办', icon: ClipboardList },
  { label: '日记', icon: BookOpenText },
  { label: '备忘', icon: StickyNote },
  { label: '想法', icon: Lightbulb },
];

export function Composer({ disabled, onSend }: ComposerProps) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    const message = value.trim();
    if (!message || disabled) {
      return;
    }
    onSend(message);
    setValue('');
  }

  return (
    <form
      className="border-t border-[#353044] bg-[#111018]/95 px-3 pb-[calc(env(safe-area-inset-bottom)+10px)] pt-2 backdrop-blur-xl"
      onSubmit={submit}
    >
      <div className="mb-1.5 flex gap-1.5 overflow-x-auto pb-1">
        {intents.map((intent) => {
          const Icon = intent.icon;
          return (
            <button
              aria-label={intent.label}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-[12px] border border-[#3a3548] bg-[#242032] text-[#d8c8b8] shadow-sm transition hover:-translate-y-0.5 hover:bg-[#3a202d] hover:text-[#ff85a1] active:translate-y-0 disabled:opacity-50"
              disabled={disabled}
              key={intent.label}
              onClick={() => inputRef.current?.focus()}
              title={intent.label}
              type="button"
            >
              <Icon size={14} />
            </button>
          );
        })}
      </div>
      <div className="flex min-h-11 items-end gap-1.5 rounded-[16px] border border-[#3a3548] bg-[#181522] px-2 py-1.5 shadow-sm">
        <button
          aria-label="语音输入暂未开放"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-[12px] bg-[#292242] text-[#c8b6ff]/70"
          disabled
          title="语音输入将在下一阶段支持"
          type="button"
        >
          <Mic size={15} />
        </button>
        <textarea
          ref={inputRef}
          className="max-h-20 min-h-8 flex-1 resize-none border-0 bg-transparent px-1 py-1.5 text-[13px] font-medium leading-5 text-[#f8f4ed] outline-none placeholder:font-semibold placeholder:text-[#b8aa9e]"
          disabled={disabled}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit(event);
            }
          }}
          placeholder="想到什么啦？"
          rows={1}
          value={value}
        />
        <button
          aria-label="发送"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-[12px] bg-[#70521f] text-[#f8f4ed] shadow-pop transition hover:-translate-y-0.5 hover:bg-[#3a202d] active:translate-y-0 disabled:cursor-not-allowed disabled:bg-[#2b2735] disabled:text-[#9f9288] disabled:shadow-none"
          disabled={disabled || !value.trim()}
          type="submit"
        >
          <SendHorizontal size={15} />
        </button>
      </div>
    </form>
  );
}
