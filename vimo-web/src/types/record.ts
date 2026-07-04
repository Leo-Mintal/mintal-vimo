import type { RecordPreview } from './agent';
import type { RecordStatus } from './agent';

export interface RecordItem extends RecordPreview {
  id: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
  previous_status?: RecordStatus | null;
}

export interface RecordsResponse {
  records: RecordItem[];
}

export interface RecordResponse {
  record: RecordItem;
}
