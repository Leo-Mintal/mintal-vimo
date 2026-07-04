import { buildClosedContextPayload, mergePendingPreview, normalizePreview, passesRiskMatrix, sanitizeSettingsPatch, shouldAutoSavePreview } from './ChatAgent';
import type { AgentModelOption, RecordPreview } from '../../types/agent';
import type { RecordItem } from '../../types/record';

const basePreview: RecordPreview = {
  type: 'memo',
  title: '门禁密码',
  content: '门禁密码是 1234',
  datetime_text: null,
  datetime_iso: null,
  need_reminder: false,
  confidence: 0.88,
  field_confidence: {
    type: 0.5,
    content: 0.9,
  },
  field_risk: {
    type: 'low',
    content: 'low',
  },
  status: 'ready',
  missing_fields: [],
  reply: '我先作为备忘记下。',
  intent: 'new_record',
  record_action: 'create',
  related_ids: [],
  should_preview: true,
};

assert(passesRiskMatrix(basePreview, { accepted: {}, changed: {} }), 'low-risk type guess should pass');

const modelOptions: AgentModelOption[] = [
  { key: 'deepseek_v4_flash', label: 'DeepSeek', description: '', model: 'deepseek-v4-flash', default: true },
];
assert(
  sanitizeSettingsPatch({ model_key: 'unknown_model' }, modelOptions) === null,
  'settings patch should reject model keys that are not returned by the backend',
);
assert(
  sanitizeSettingsPatch({ model_key: 'deepseek_v4_flash' }, modelOptions)?.model_key === 'deepseek_v4_flash',
  'settings patch should allow backend-listed model keys',
);

const manyRecords: RecordItem[] = Array.from({ length: 35 }, (_, index) => ({
  ...basePreview,
  id: `rec_${index}`,
  created_at: `2026-07-${String(index + 1).padStart(2, '0')} 10:00:00`,
  updated_at: `2026-07-${String(index + 1).padStart(2, '0')} 10:00:00`,
  deleted_at: null,
  previous_status: null,
}));
const closedContexts = buildClosedContextPayload(manyRecords);
assert(closedContexts.length === 30, 'closed contexts should be capped before sending to the model');
assert(closedContexts[0].id === 'rec_34', 'closed contexts should keep the newest records first');

assert(
  !passesRiskMatrix(
    {
      ...basePreview,
      type: 'todo',
      need_reminder: true,
      datetime_text: '晚点',
      field_confidence: {
        ...basePreview.field_confidence,
        datetime: 0.7,
        need_reminder: 0.9,
      },
      field_risk: {
        ...basePreview.field_risk,
        datetime: 'high',
        need_reminder: 'high',
      },
    },
    { accepted: {}, changed: {} },
  ),
  'high-risk low-confidence datetime should require confirmation',
);

const reminderWithoutISO: RecordPreview = {
  ...basePreview,
  type: 'todo',
  need_reminder: true,
  datetime_text: '晚点',
  field_confidence: {
    type: 0.9,
    content: 0.9,
    datetime: 0.9,
    need_reminder: 0.9,
  },
  field_risk: {
    type: 'low',
    content: 'low',
    datetime: 'high',
    need_reminder: 'high',
  },
};

assert(passesRiskMatrix(reminderWithoutISO, { accepted: {}, changed: {} }), 'risk matrix should accept high-confidence reminder fields');
assert(!shouldAutoSavePreview(reminderWithoutISO, [], null, { accepted: {}, changed: {} }), 'autosave should still require datetime_iso for reminders');

const pendingReminder: RecordPreview = {
  ...basePreview,
  type: 'todo',
  title: '拉窗帘',
  content: '把窗帘拉上再睡',
  need_reminder: true,
  datetime_text: null,
  datetime_iso: null,
  status: 'need_confirmation',
  missing_fields: ['datetime'],
  intent: 'new_record',
  record_action: 'create',
};

const pendingTimeUpdate: RecordPreview = {
  ...basePreview,
  type: 'todo',
  title: '拉窗帘',
  content: '把窗帘拉上再睡',
  need_reminder: true,
  datetime_text: '十点',
  datetime_iso: '2026-07-03 22:00:00',
  status: 'ready',
  missing_fields: [],
  intent: 'update_pending',
  record_action: 'update',
  target_id: 'pending_curtain',
  context_target_id: 'pending_curtain',
};

const mergedPending = mergePendingPreview(pendingReminder, pendingTimeUpdate, 'pending_curtain');
assert(mergedPending.datetime_text === '十点', 'pending merge should keep the newly supplied time text');
assert(mergedPending.datetime_iso === '2026-07-03 22:00:00', 'pending merge should keep the newly supplied datetime');
assert(mergedPending.missing_fields.length === 0, 'pending merge should clear missing fields after confirmation');
assert(mergedPending.context_target_id === 'pending_curtain', 'pending merge should keep the context target id');

const previewWithPrimaryCandidateTime = normalizePreview({
  ...basePreview,
  type: 'unknown',
  title: '',
  content: '',
  need_reminder: false,
  datetime_text: null,
  datetime_iso: null,
  record_candidates: [
    {
      id: 'candidate_1',
      intent_id: 'intent_primary',
      type: 'todo',
      title: '拉窗帘',
      content: '把窗帘拉上再睡',
      need_reminder: true,
      datetime_text: '十点',
      datetime_iso: '2026-07-03 22:00:00',
      confidence: 0.92,
      field_confidence: {
        type: 0.95,
        content: 0.92,
        datetime: 0.92,
        need_reminder: 0.93,
      },
      field_risk: {
        type: 'low',
        content: 'low',
        datetime: 'high',
        need_reminder: 'high',
      },
      status: 'ready',
      missing_fields: [],
      record_action: 'update',
      target_id: 'pending_curtain',
      related_ids: [],
      execution_decision: 'auto_execute',
      should_preview: true,
      primary: true,
    },
  ],
});
assert(previewWithPrimaryCandidateTime.type === 'todo', 'normalizePreview should seed type from primary candidate');
assert(previewWithPrimaryCandidateTime.need_reminder, 'normalizePreview should seed reminder flag from primary candidate');
assert(previewWithPrimaryCandidateTime.datetime_text === '十点', 'normalizePreview should seed time text from primary candidate');
assert(previewWithPrimaryCandidateTime.datetime_iso === '2026-07-03 22:00:00', 'normalizePreview should seed datetime from primary candidate');

assert(
  shouldAutoSavePreview(
    {
      ...basePreview,
      intent: 'delete_record',
      record_action: 'delete',
      target_id: 'rec_1',
      intent_trace: {
        gate_reasons: ['hard_stop_delete'],
      },
    },
    [{ ...basePreview, id: 'rec_1', created_at: '', updated_at: '', deleted_at: null, previous_status: null }],
    null,
    { accepted: {}, changed: {} },
  ),
  'autosave should allow unique delete because records are recoverable from trash',
);

assert(
  shouldAutoSavePreview(
    {
      ...basePreview,
      intent: 'delete_record',
      record_action: 'delete',
      target_id: null,
      related_ids: ['rec_1'],
      field_confidence: {
        ...basePreview.field_confidence,
        target: 0.93,
      },
    },
    [{ ...basePreview, id: 'rec_1', created_at: '', updated_at: '', deleted_at: null, previous_status: null }],
    null,
    { accepted: {}, changed: {} },
  ),
  'autosave should allow unique related id delete',
);

assert(
  !shouldAutoSavePreview(
    {
      ...basePreview,
      intent: 'delete_record',
      record_action: 'delete',
      target_id: null,
      related_ids: ['rec_1', 'rec_2'],
      intent_trace: {
        gate_reasons: ['hard_stop_target_not_unique'],
      },
    },
    [
      { ...basePreview, id: 'rec_1', created_at: '', updated_at: '', deleted_at: null, previous_status: null },
      { ...basePreview, id: 'rec_2', created_at: '', updated_at: '', deleted_at: null, previous_status: null },
    ],
    null,
    { accepted: {}, changed: {} },
  ),
  'autosave should still block delete when target is not unique',
);

assert(
  !shouldAutoSavePreview(
    {
      ...basePreview,
      intent: 'delete_record',
      record_action: 'delete',
      target_id: 'rec_1',
      related_ids: ['rec_1', 'rec_2'],
      field_confidence: {
        ...basePreview.field_confidence,
        target: 0.96,
      },
    },
    [
      { ...basePreview, id: 'rec_1', created_at: '', updated_at: '', deleted_at: null, previous_status: null },
      { ...basePreview, id: 'rec_2', created_at: '', updated_at: '', deleted_at: null, previous_status: null },
    ],
    null,
    { accepted: {}, changed: {} },
  ),
  'autosave should block multi-target delete until the pending task is confirmed',
);

assert(
  !shouldAutoSavePreview(
    {
      ...basePreview,
      intent: 'delete_record',
      record_action: 'delete',
      target_id: 'rec_1',
      field_confidence: {
        ...basePreview.field_confidence,
        target: 0.7,
      },
    },
    [{ ...basePreview, id: 'rec_1', created_at: '', updated_at: '', deleted_at: null, previous_status: null }],
    null,
    { accepted: {}, changed: {} },
  ),
  'autosave should still block delete when target confidence is low',
);

assert(
  passesRiskMatrix(
    {
      ...basePreview,
      type: 'todo',
      need_reminder: true,
      datetime_iso: '2026-07-02 21:00:00',
      field_confidence: {
        ...basePreview.field_confidence,
        datetime: 0.8,
        need_reminder: 0.9,
      },
      field_risk: {
        ...basePreview.field_risk,
        datetime: 'high',
        need_reminder: 'high',
      },
    },
    { accepted: { datetime: 8 }, changed: { datetime: 0 } },
  ),
  'accepted feedback should lower high-risk threshold moderately',
);

assert(
  shouldAutoSavePreview(
    {
      ...basePreview,
      type: 'todo',
      intent: 'new_record',
      record_action: 'create',
      title: '去健身',
      content: '去健身',
      need_reminder: true,
      datetime_text: '下午五点',
      datetime_iso: '2026-07-03 17:00:00',
      confidence: 0.93,
      field_confidence: {
        type: 0.93,
        content: 0.93,
        datetime: 0.93,
        need_reminder: 0.93,
      },
      field_risk: {
        type: 'low',
        content: 'low',
        datetime: 'high',
        need_reminder: 'high',
      },
      intent_trace: {
        gate_reasons: ['hard_stop_target_not_unique'],
      },
    },
    [],
    null,
    { accepted: {}, changed: {} },
  ),
  'autosave should allow a high-confidence new reminder when target gate belongs to another candidate',
);

assert(
  shouldAutoSavePreview(
    {
      ...basePreview,
      type: 'todo',
      intent: 'new_record',
      record_action: 'create',
      title: '睡觉提醒',
      content: '晚上十一点提醒睡觉',
      need_reminder: true,
      datetime_text: '晚上十一点',
      datetime_iso: '2026-07-03 23:00:00',
      confidence: 0.94,
      field_confidence: {
        type: 0.94,
        content: 0.94,
        datetime: 0.94,
        need_reminder: 0.94,
      },
      field_risk: {
        type: 'low',
        content: 'low',
        datetime: 'high',
        need_reminder: 'high',
      },
      record_candidates: [
        {
          id: 'candidate_sleep',
          intent_id: 'intent_sleep',
          type: 'todo',
          title: '睡觉提醒',
          content: '晚上十一点提醒睡觉',
          datetime_text: '晚上十一点',
          datetime_iso: '2026-07-03 23:00:00',
          need_reminder: true,
          confidence: 0.94,
          field_confidence: {
            type: 0.94,
            content: 0.94,
            datetime: 0.94,
            need_reminder: 0.94,
          },
          field_risk: {
            type: 'low',
            content: 'low',
            datetime: 'high',
            need_reminder: 'high',
          },
          status: 'ready',
          missing_fields: [],
          record_action: 'create',
          related_ids: [],
          execution_decision: 'preview',
          should_preview: true,
        },
      ],
    },
    [],
    null,
    { accepted: {}, changed: {} },
  ),
  'autosave should allow a high-confidence secondary reminder even when model marks the candidate as preview',
);

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}
