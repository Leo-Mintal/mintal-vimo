export type RecordType = 'todo' | 'journal' | 'memo' | 'idea' | 'unknown';
export type RecordStatus = 'ready' | 'need_confirmation' | 'saved' | 'discarded' | 'completed';
export type FieldRiskLevel = 'low' | 'high';
export type RiskField = 'type' | 'title' | 'content' | 'datetime' | 'need_reminder' | 'target';
export type AgentIntent =
  | 'new_record'
  | 'update_record'
  | 'delete_record'
  | 'update_pending'
  | 'confirm_pending'
  | 'duplicate_check'
  | 'similar_check'
  | 'clarify'
  | 'answer_query'
  | 'joke_response'
  | 'config_update';
export type RecordAction = 'create' | 'update' | 'delete' | 'none';
export type PendingState = 'open' | 'waiting_field' | 'ready_to_execute' | 'executed' | 'dismissed' | 'none';
export type ReplyPreset = 'INTJ' | 'ENFJ' | 'ISTP' | 'ENFP' | 'custom';
export type AgentModelKey = string;

export interface AgentModelOption {
  key: AgentModelKey;
  label: string;
  description: string;
  model: string;
  default: boolean;
  supports_thinking?: boolean;
}

export interface CustomAgentModel {
  key: AgentModelKey;
  label: string;
  description?: string;
  api_url: string;
  api_key: string;
  model: string;
  timeout_seconds?: number;
  supports_thinking?: boolean;
}

export interface SettingsPatch {
  preset?: ReplyPreset;
  custom_style?: string;
  nickname?: string;
  model_key?: AgentModelKey;
}

export interface RecordPreview {
  type: RecordType;
  title: string;
  content: string;
  datetime_text: string | null;
  datetime_iso: string | null;
  need_reminder: boolean;
  confidence: number;
  field_confidence?: Partial<Record<RiskField, number>> | null;
  field_risk?: Partial<Record<RiskField, FieldRiskLevel>> | null;
  status: RecordStatus;
  missing_fields: string[];
  reply: string;
  intent?: AgentIntent;
  record_action?: RecordAction;
  target_id?: string | null;
  related_ids?: string[];
  context_action?: 'open' | 'update' | 'close' | 'none';
  context_target_id?: string | null;
  pending_state?: PendingState | '';
  context_state?: PendingState | '';
  should_preview?: boolean;
  settings_patch?: SettingsPatch | null;
  primary_intent?: IntentItem | null;
  secondary_intents?: IntentItem[];
  record_candidates?: RecordCandidate[];
  execution_plan?: ExecutionItem[];
  reply_strategy?: ReplyStrategy | null;
  intent_trace?: IntentTrace | null;
}

export interface IntentItem {
  id?: string;
  intent?: AgentIntent;
  category?: string;
  action?: string;
  record_type?: RecordType;
  confidence?: number;
  risk?: FieldRiskLevel | '';
  evidence?: string[];
  target_id?: string | null;
}

export interface RecordCandidate {
  id?: string;
  intent_id?: string;
  type: RecordType;
  title: string;
  content: string;
  datetime_text: string | null;
  datetime_iso: string | null;
  need_reminder: boolean;
  confidence: number;
  field_confidence?: Partial<Record<RiskField, number>> | null;
  field_risk?: Partial<Record<RiskField, FieldRiskLevel>> | null;
  status: RecordStatus;
  missing_fields: string[];
  record_action?: RecordAction;
  target_id?: string | null;
  related_ids?: string[];
  execution_decision?: 'auto_execute' | 'preview' | 'pending' | 'ask_clarify' | 'no_op' | '';
  should_preview?: boolean;
  primary?: boolean;
}

export interface ExecutionItem {
  id?: string;
  intent_id?: string;
  candidate_id?: string;
  decision?: 'auto_execute' | 'preview' | 'pending' | 'ask_clarify' | 'no_op' | '';
  action?: RecordAction;
  risk?: FieldRiskLevel | '';
  reason?: string;
  target_id?: string | null;
}

export interface ReplyStrategy {
  focus_intent_id?: string;
  tone?: string;
  summary?: string;
  mention_intent_ids?: string[];
}

export interface IntentTrace {
  matched_context_id?: string | null;
  continuation_reason?: string;
  risk_reasons?: string[];
  discarded_alternatives?: string[];
  gate_reasons?: string[];
  state_transition?: string;
}

export interface AgentContextRecord {
  id?: string;
  layer?: 'open' | 'closed';
  context_kind?: string;
  type: RecordType;
  title: string;
  content: string;
  datetime_text: string | null;
  datetime_iso: string | null;
  need_reminder: boolean;
  status: RecordStatus;
  intent?: AgentIntent;
  record_action?: RecordAction;
  target_id?: string | null;
  related_ids?: string[];
  field_confidence?: Partial<Record<RiskField, number>> | null;
  field_risk?: Partial<Record<RiskField, FieldRiskLevel>> | null;
  record_candidates?: RecordCandidate[];
  execution_plan?: ExecutionItem[];
  pending_state?: PendingState | '';
  context_state?: PendingState | '';
  missing_fields: string[];
  deleted_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  last_user_message?: string | null;
  last_assistant_reply?: string | null;
}

export interface ReplyProfile {
  preset: ReplyPreset;
  custom_style: string;
  nickname: string;
  model_key?: AgentModelKey;
}

export interface FastReplyContext {
  turn_id?: string;
  state?: 'started' | 'partial' | 'done' | 'failed';
  content?: string;
}

export type FastReplyRoute = 'continue_slow' | 'chat_only';

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  created_at?: string;
}

export interface AgentMessageRequest {
  turn_id?: string;
  message: string;
  timezone: string;
  model_key?: AgentModelKey;
  custom_model?: CustomAgentModel;
  pending_record?: AgentContextRecord;
  recent_records?: AgentContextRecord[];
  open_contexts?: AgentContextRecord[];
  closed_contexts?: AgentContextRecord[];
  recent_messages?: ConversationMessage[];
  reply_profile?: ReplyProfile;
  fast_reply_context?: FastReplyContext;
  thinking?: ThinkingRequest;
}

export interface AgentMessageResponse {
  message: {
    role: 'assistant';
    content: string;
  };
  record_preview: RecordPreview;
  thinking?: ThinkingPayload | null;
}

export interface ThinkingRequest {
  enabled: boolean;
}

export interface ThinkingPayload {
  fast?: string;
  slow?: string;
}

export type AgentProgressStatus = 'running' | 'completed' | 'warning' | 'failed';

export interface AgentProgressEvent {
  id: string;
  turn_id: string;
  seq: number;
  type: string;
  title: string;
  detail?: string;
  status: AgentProgressStatus;
  payload?: unknown;
  created_at: string;
}

export type AgentRecordExecutionAction = 'created' | 'updated' | 'deleted' | 'restored' | 'none';

export interface AgentRecordExecutionEvent {
  action: AgentRecordExecutionAction;
  status: 'completed' | 'failed';
  record?: unknown;
  error?: string;
}

export type AgentStreamEvent =
  | { type: 'progress'; event: AgentProgressEvent }
  | { type: 'record_execution'; event: AgentRecordExecutionEvent }
  | { type: 'fast_delta'; delta: string }
  | { type: 'fast_thinking'; content: string }
  | { type: 'fast_done'; route?: FastReplyRoute }
  | { type: 'fast_error'; message: string }
  | { type: 'slow_thinking'; content: string }
  | { type: 'final'; response: AgentMessageResponse }
  | { type: 'done' }
  | { type: 'error'; message: string };

export interface AgentModelsResponse {
  models: AgentModelOption[];
}
