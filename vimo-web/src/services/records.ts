import type { RecordPreview, RecordStatus, RecordType } from '../types/agent';
import type { RecordItem, RecordResponse, RecordsResponse } from '../types/record';
import { requestJSON } from './api';

export interface RecordWriteInput {
  id?: string;
  type: RecordType;
  title: string;
  content: string;
  datetime_text: string | null;
  datetime_iso: string | null;
  need_reminder: boolean;
  confidence: number;
  status: RecordStatus;
  missing_fields: string[];
  deleted_at: string | null;
  previous_status: RecordStatus | '' | null;
}

export function listRecords() {
  return requestJSON<RecordsResponse>('/api/records');
}

export async function saveRecord(preview: RecordPreview, id?: string): Promise<RecordItem> {
  const record = recordPayload({
    ...preview,
    id,
    status: 'saved',
    missing_fields: preview.status === 'ready' ? [] : preview.missing_fields,
    deleted_at: null,
    previous_status: null,
  });
  const response = await requestJSON<RecordResponse>('/api/records', {
    method: 'POST',
    body: JSON.stringify(record),
  });
  return response.record;
}

export async function createRecord(input: RecordWriteInput): Promise<RecordItem> {
  const response = await requestJSON<RecordResponse>('/api/records', {
    method: 'POST',
    body: JSON.stringify(recordPayload(input)),
  });
  return response.record;
}

export async function updateRecord(id: string, patch: Partial<RecordWriteInput>): Promise<RecordItem> {
  const response = await requestJSON<RecordResponse>(`/api/records/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(recordPatchPayload(patch)),
  });
  return response.record;
}

export function deleteRecord(id: string) {
  return requestJSON<void>(`/api/records/${id}`, {
    method: 'DELETE',
  });
}

function recordPayload(input: Partial<RecordWriteInput>): RecordWriteInput {
  return {
    type: input.type ?? 'unknown',
    id: input.id,
    title: input.title ?? '',
    content: input.content ?? '',
    datetime_text: input.datetime_text ?? null,
    datetime_iso: input.datetime_iso ?? null,
    need_reminder: Boolean(input.need_reminder),
    confidence: typeof input.confidence === 'number' ? input.confidence : 1,
    status: input.status ?? 'saved',
    missing_fields: input.missing_fields ?? [],
    deleted_at: input.deleted_at ?? null,
    previous_status: input.previous_status ?? null,
  };
}

function recordPatchPayload(input: Partial<RecordWriteInput>) {
  const payload: Partial<RecordWriteInput> = {};
  const keys: Array<keyof RecordWriteInput> = [
    'type',
    'title',
    'content',
    'datetime_text',
    'datetime_iso',
    'need_reminder',
    'confidence',
    'status',
    'missing_fields',
    'deleted_at',
    'previous_status',
  ];
  for (const key of keys) {
    if (key in input) {
      payload[key] = input[key] as never;
    }
  }
  return payload;
}
