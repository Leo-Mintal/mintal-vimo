import type { ReactNode } from 'react';

interface MobileShellProps {
  children: ReactNode;
}

export function MobileShell({ children }: MobileShellProps) {
  return (
    <main className="min-h-dvh px-0 text-[#f8f4ed] sm:px-6 sm:py-6">
      <div className="mx-auto h-dvh min-h-dvh w-full overflow-hidden border-[#b85d70]/40 bg-[#111018]/95 shadow-none backdrop-blur sm:h-[calc(100dvh-3rem)] sm:min-h-[calc(100dvh-3rem)] sm:max-w-[1480px] sm:rounded-[32px] sm:border sm:shadow-soft">
        {children}
      </div>
    </main>
  );
}
