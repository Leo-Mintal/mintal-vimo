import { ChatAgent } from '../components/ChatAgent/ChatAgent';
import { MobileShell } from '../components/MobileShell/MobileShell';

export function ChatPage() {
  return (
    <MobileShell>
      <ChatAgent />
    </MobileShell>
  );
}
