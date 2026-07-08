import type { AgentMessageRequest, AgentMessageResponse, AgentModelsResponse, AgentProgressEvent, AgentProgressStatus, AgentRecordExecutionAction, AgentRecordExecutionEvent, AgentStreamEvent } from '../types/agent';
import { API_BASE, apiHeaders, requestJSON } from './api';

export function listAgentModels() {
  return requestJSON<AgentModelsResponse>('/api/agent/models');
}

export async function sendAgentMessageStream(
  request: AgentMessageRequest,
  onEvent: (event: AgentStreamEvent) => void | Promise<void>,
  signal?: AbortSignal,
) {
  try {
    return await readAgentEventStream('/api/agent/messages/stream', request, onEvent, signal);
  } catch (error) {
    if (!shouldRetryWithoutRecentMessages(error, request)) {
      throw error;
    }
    return readAgentEventStream('/api/agent/messages/stream', withoutRecentMessages(request), onEvent, signal);
  }
}

function shouldRetryWithoutRecentMessages(error: unknown, request: AgentMessageRequest) {
  return Boolean(request.recent_messages?.length && error instanceof Error && error.message.includes('unknown field "recent_messages"'));
}

function withoutRecentMessages(request: AgentMessageRequest): AgentMessageRequest {
  const { recent_messages: _recentMessages, ...rest } = request;
  return rest;
}

async function readAgentEventStream(
  path: string,
  request: AgentMessageRequest,
  onEvent: (event: AgentStreamEvent) => void | Promise<void>,
  signal?: AbortSignal,
) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: apiHeaders({ Accept: 'text/event-stream' }),
    body: JSON.stringify(request),
    signal,
  });

  if (!response.ok) {
    let message = `请求失败：${response.status}`;
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      if (body.error?.message) {
        message = body.error.message;
      }
    } catch {
      // Keep the status-based message when the stream endpoint did not return JSON.
    }
    throw new Error(message);
  }
  if (!response.body) {
    throw new Error('浏览器不支持流式响应');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const events = splitSSEEvents(buffer);
      buffer = events.rest;
      for (const eventText of events.items) {
        const event = parseSSEEvent(eventText);
        if (event) {
          await onEvent(event);
        }
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      const event = parseSSEEvent(buffer);
      if (event) {
        await onEvent(event);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function splitSSEEvents(buffer: string) {
  const normalized = buffer.replace(/\r\n/g, '\n');
  const parts = normalized.split('\n\n');
  return {
    items: parts.slice(0, -1),
    rest: parts[parts.length - 1] ?? '',
  };
}

function parseSSEEvent(raw: string): AgentStreamEvent | null {
  const lines = raw.split('\n');
  let eventName = 'message';
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith('event:')) {
      eventName = line.slice('event:'.length).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart());
    }
  }
  const dataText = dataLines.join('\n');
  const data = dataText ? JSON.parse(dataText) as Record<string, unknown> : {};
  switch (eventName) {
    case 'progress': {
      const event = parseProgressEvent(data);
      return event ? { type: 'progress', event } : null;
    }
    case 'record_execution':
      return { type: 'record_execution', event: parseRecordExecutionEvent(data) };
    case 'fast_delta':
      return { type: 'fast_delta', delta: typeof data.delta === 'string' ? data.delta : '' };
    case 'fast_thinking':
      return { type: 'fast_thinking', content: typeof data.content === 'string' ? data.content : '' };
    case 'fast_done':
      return {
        type: 'fast_done',
        route: data.route === 'chat_only' ? 'chat_only' : 'continue_slow',
      };
    case 'fast_error':
      return { type: 'fast_error', message: typeof data.message === 'string' ? data.message : '快路请求失败' };
    case 'slow_thinking':
      return { type: 'slow_thinking', content: typeof data.content === 'string' ? data.content : '' };
    case 'final':
      return { type: 'final', response: data as unknown as AgentMessageResponse };
    case 'done':
      return { type: 'done' };
    case 'error':
      return { type: 'error', message: typeof data.message === 'string' ? data.message : '请求失败' };
    default:
      return null;
  }
}

function parseRecordExecutionEvent(data: Record<string, unknown>): AgentRecordExecutionEvent {
  return {
    action: normalizeRecordExecutionAction(data.action),
    status: data.status === 'failed' ? 'failed' : 'completed',
    record: data.record,
    error: typeof data.error === 'string' ? data.error : undefined,
  };
}

function normalizeRecordExecutionAction(value: unknown): AgentRecordExecutionAction {
  return value === 'created' || value === 'updated' || value === 'deleted' || value === 'restored' ? value : 'none';
}

function parseProgressEvent(data: Record<string, unknown>): AgentProgressEvent | null {
  const type = typeof data.type === 'string' ? data.type.trim() : '';
  const title = typeof data.title === 'string' ? data.title.trim() : '';
  if (!type || !title) {
    return null;
  }
  return {
    id: typeof data.id === 'string' ? data.id : `${type}-${Number(data.seq) || 0}`,
    turn_id: typeof data.turn_id === 'string' ? data.turn_id : '',
    seq: typeof data.seq === 'number' && Number.isFinite(data.seq) ? data.seq : 0,
    type,
    title,
    detail: typeof data.detail === 'string' && data.detail.trim() ? data.detail.trim() : undefined,
    status: normalizeProgressStatus(data.status),
    payload: data.payload,
    created_at: typeof data.created_at === 'string' ? data.created_at : new Date().toISOString(),
  };
}

function normalizeProgressStatus(value: unknown): AgentProgressStatus {
  return value === 'running' || value === 'completed' || value === 'warning' || value === 'failed' ? value : 'completed';
}
