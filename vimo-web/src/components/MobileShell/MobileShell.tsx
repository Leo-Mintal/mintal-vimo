import type { ReactNode } from 'react';

interface MobileShellProps {
  children: ReactNode;
}

export function MobileShell({ children }: MobileShellProps) {
  return (
    <main className="min-h-dvh text-[var(--text-strong)]">
      <div className="h-dvh min-h-dvh w-full overflow-hidden">
        {children}
      </div>
    </main>
  );
}
