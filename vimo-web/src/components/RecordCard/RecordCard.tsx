import {
  Bell,
  BookOpenText,
  CalendarClock,
  Check,
  ClipboardList,
  Edit3,
  FileText,
  Lightbulb,
  Save,
  Sparkles,
  StickyNote,
  Trash2,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { FieldRiskLevel, RecordPreview, RecordStatus, RecordType, RiskField } from '../../types/agent';

interface RecordCardProps {
  preview: RecordPreview;
  onDiscard: () => void;
  onSave: (preview: RecordPreview) => Promise<void>;
}

const typeOptions: Array<{ value: RecordType; label: string }> = [
  { value: 'todo', label: '待办' },
  { value: 'journal', label: '日记' },
  { value: 'memo', label: '备忘' },
  { value: 'idea', label: '想法' },
  { value: 'unknown', label: '待确认' },
];

const typeMeta = {
  todo: { label: '待办', icon: ClipboardList, tone: 'bg-[#14342a] text-[#7ee0a0]' },
  journal: { label: '日记', icon: BookOpenText, tone: 'bg-[#123040] text-[#8bd8ff]' },
  memo: { label: '备忘', icon: StickyNote, tone: 'bg-[#3a202d] text-[#ff85a1]' },
  idea: { label: '想法', icon: Lightbulb, tone: 'bg-[#292242] text-[#c8b6ff]' },
  unknown: { label: '确认', icon: Sparkles, tone: 'bg-[#70521f] text-[#f8f4ed]' },
} satisfies Record<RecordType, { label: string; icon: typeof ClipboardList; tone: string }>;

export function RecordCard({ preview, onDiscard, onSave }: RecordCardProps) {
  const [draft, setDraft] = useState(preview);
  const [editing, setEditing] = useState(preview.status === 'need_confirmation');
  const isDeleteAction = (draft.record_action ?? (draft.intent === 'delete_record' ? 'delete' : undefined)) === 'delete';
  const [saving, setSaving] = useState(false);
  const confidence = useMemo(() => Math.round((draft.confidence || 0) * 100), [draft.confidence]);
  const dataPoints = useMemo(() => buildDataPoints(draft), [draft]);
  const readyCount = useMemo(() => dataPoints.filter((point) => point.ready).length, [dataPoints]);
  const riskSummary = useMemo(() => buildRiskSummary(draft), [draft]);
  const meta = typeMeta[draft.type];
  const TypeIcon = isDeleteAction ? Trash2 : meta.icon;

  async function save() {
    setSaving(true);
    try {
      await onSave({
        ...draft,
        status: normalizeStatus(draft.status),
        missing_fields: draft.status === 'ready' ? [] : draft.missing_fields,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={`rounded-[16px] border ${isDeleteAction ? 'border-[#6f3543] bg-[#1b1219]' : 'border-[#353044] bg-[#181522]'} p-2.5 text-[#f8f4ed] shadow-sm backdrop-blur`}>
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-[12px] ${isDeleteAction ? 'bg-[#3b1728] text-[#ff85a1]' : meta.tone}`}>
            <TypeIcon size={14} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="rounded-full bg-[#111018] px-1.5 py-0.5 text-[10px] font-bold text-[#d8c8b8]">{isDeleteAction ? '删除确认' : meta.label}</span>
              <span className="rounded-full bg-[#14342a] px-1.5 py-0.5 text-[10px] font-bold text-[#7ee0a0]">{confidence}%</span>
            </div>
            <h2 className="mt-0.5 truncate text-sm font-semibold leading-5 text-[#f8f4ed]">{draft.title || '未命名记录'}</h2>
          </div>
        </div>
        <div
          className={`grid h-8 w-8 shrink-0 place-items-center rounded-[12px] ${
            isDeleteAction ? 'bg-[#3b1728] text-[#ff85a1]' : draft.status === 'ready' ? 'bg-[#14342a] text-[#7ee0a0]' : 'bg-[#70521f] text-[#f8f4ed]'
          }`}
          title={isDeleteAction ? '将移入回收站' : draft.status === 'ready' ? '可保存' : '待确认'}
        >
          {isDeleteAction ? <Trash2 size={14} /> : draft.status === 'ready' ? <Check size={14} /> : <Edit3 size={13} />}
        </div>
      </div>

      {riskSummary.length ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {riskSummary.map((item) => (
            <span
              className={`rounded-full px-2 py-1 text-[10px] font-bold ${
                item.level === 'high' ? 'bg-[#70521f] text-[#f8f4ed]' : 'bg-[#242032] text-[#d8c8b8]'
              }`}
              key={item.field}
              title={`${item.label} ${Math.round(item.confidence * 100)}%`}
            >
              {item.label} {Math.round(item.confidence * 100)}%
            </span>
          ))}
        </div>
      ) : null}

      <div className="mb-2 rounded-[14px] border border-[#353044] bg-[#111018] p-2">
        <div className="mb-1.5 flex items-center justify-between text-[11px] font-bold text-[#d8c8b8]">
          <span>识别完整度</span>
          <span>{readyCount}/{dataPoints.length}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-[#242032]">
          <div className="h-full rounded-full bg-gradient-to-r from-[#7ee0a0] via-[#8bd8ff] to-[#c8b6ff]" style={{ width: `${confidence}%` }} />
        </div>
        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
          {dataPoints.map((point) => (
            <DataPoint key={point.label} {...point} />
          ))}
        </div>
      </div>

      {isDeleteAction ? (
        <div className="space-y-2 rounded-[14px] border border-[#6f3543] bg-[#111018] p-2 text-xs leading-5 text-[#d8c8b8]">
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-[#ff85a1]">
            <Trash2 size={13} />
            将移入回收站，可在回收站恢复
          </div>
          <p className="line-clamp-3 rounded-[12px] bg-[#1b1219] px-2.5 py-1.5 text-[#f8f4ed]">{draft.content}</p>
          <div className="flex flex-wrap gap-1.5">
            <Info icon={<CalendarClock size={12} />} value={draft.datetime_iso ?? draft.datetime_text ?? '无'} />
            <Info icon={<Bell size={12} />} value={draft.need_reminder ? '提醒开' : '提醒关'} />
          </div>
        </div>
      ) : editing ? (
        <div className="grid gap-1.5 rounded-[14px] border border-[#353044] bg-[#111018] p-2 sm:grid-cols-2">
          <label className="block text-[11px] font-bold text-[#d8c8b8]/75">
            <select
              aria-label="类型"
              className="mt-1 h-8 w-full rounded-[12px] border border-[#3a3548] bg-[#181522] px-2 text-xs text-[#f8f4ed]"
              onChange={(event) => setDraft({ ...draft, type: event.target.value as RecordType })}
              value={draft.type}
            >
              {typeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-[11px] font-bold text-[#d8c8b8]/75">
            <input
              aria-label="标题"
              className="mt-1 h-8 w-full rounded-[12px] border border-[#3a3548] bg-[#181522] px-2 text-xs text-[#f8f4ed]"
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              placeholder="标题"
              value={draft.title}
            />
          </label>
          <label className="block text-[11px] font-bold text-[#d8c8b8]/75 sm:col-span-2">
            <textarea
              aria-label="内容"
              className="mt-1 min-h-12 w-full resize-none rounded-[12px] border border-[#3a3548] bg-[#181522] px-2 py-1.5 text-xs leading-5 text-[#f8f4ed]"
              onChange={(event) => setDraft({ ...draft, content: event.target.value })}
              placeholder="内容"
              value={draft.content}
            />
          </label>
          <label className="block text-[11px] font-bold text-[#d8c8b8]/75">
            <input
              aria-label="时间"
              className="mt-1 h-8 w-full rounded-[12px] border border-[#3a3548] bg-[#181522] px-2 text-xs text-[#f8f4ed]"
              onChange={(event) =>
                setDraft({
                  ...draft,
                  datetime_iso: event.target.value || null,
                  datetime_text: event.target.value ? draft.datetime_text : null,
                })
              }
              placeholder="2026-07-01 15:00:00"
              value={draft.datetime_iso ?? ''}
            />
          </label>
          <label className="flex min-h-8 items-center justify-between rounded-[12px] bg-[#181522] px-2 text-xs font-semibold text-[#d8c8b8]">
            <span className="flex items-center gap-1.5">
              <Bell size={13} />
              提醒
            </span>
            <input
              checked={draft.need_reminder}
              className="h-4 w-4 accent-leaf"
              onChange={(event) => setDraft({ ...draft, need_reminder: event.target.checked })}
              type="checkbox"
            />
          </label>
        </div>
      ) : (
        <div className="space-y-2 text-xs leading-5 text-[#d8c8b8]">
          <p className="line-clamp-3 rounded-[14px] bg-[#111018] px-2.5 py-1.5">{draft.content}</p>
          <div className="flex flex-wrap gap-1.5">
            <Info icon={<CalendarClock size={12} />} value={draft.datetime_iso ?? draft.datetime_text ?? '无'} />
            <Info icon={<Bell size={12} />} value={draft.need_reminder ? '开' : '关'} />
            {draft.missing_fields.length ? <Info icon={<Edit3 size={12} />} value={draft.missing_fields.join(', ')} /> : null}
          </div>
        </div>
      )}

      <div className="mt-2.5 flex gap-1.5">
        <button
          aria-label={isDeleteAction ? '确认删除' : '保存'}
          className={`flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[13px] px-2 text-xs font-bold text-[#f8f4ed] shadow-pop transition hover:-translate-y-0.5 active:translate-y-0 disabled:bg-[#2b2735] disabled:text-[#d8c8b8]/70 disabled:shadow-none ${
            isDeleteAction ? 'bg-[#3b1728] hover:bg-[#6f3543]' : 'bg-[#70521f] hover:bg-[#3a202d]'
          }`}
          disabled={saving}
          onClick={save}
          type="button"
        >
          {isDeleteAction ? <Trash2 size={14} /> : <Save size={14} />}
          {saving ? (isDeleteAction ? '删除中' : '保存中') : isDeleteAction ? '确认删除' : '保存'}
        </button>
        {!isDeleteAction ? (
          <button
            aria-label={editing ? '完成编辑' : '编辑'}
            className="grid h-9 w-9 place-items-center rounded-[13px] border border-[#353044] bg-[#242032] text-[#d8c8b8] transition hover:-translate-y-0.5 hover:text-[#7ee0a0] active:translate-y-0"
            onClick={() => setEditing(!editing)}
            title={editing ? '完成编辑' : '编辑'}
            type="button"
          >
            {editing ? <Check size={14} /> : <Edit3 size={14} />}
          </button>
        ) : null}
        <button
          aria-label="丢弃"
          className="grid h-9 w-9 place-items-center rounded-[13px] border border-[#353044] bg-[#242032] text-[#d8c8b8] transition hover:-translate-y-0.5 hover:text-[#ff85a1] active:translate-y-0"
          onClick={onDiscard}
          title="丢弃"
          type="button"
        >
          {draft.status === 'discarded' ? <X size={14} /> : <Trash2 size={14} />}
        </button>
      </div>
    </section>
  );
}

function Info({ icon, value }: { icon: ReactNode; value: string }) {
  return (
    <div className="flex min-h-6 max-w-full items-center gap-1 rounded-full bg-[#111018] px-2 py-1 text-[11px] font-bold text-[#d8c8b8]">
      <span className="shrink-0 text-[#d8c8b8]/70">{icon}</span>
      <span className="truncate">{value}</span>
    </div>
  );
}

function DataPoint({
  icon,
  label,
  ready,
  value,
}: {
  icon: ReactNode;
  label: string;
  ready: boolean;
  value: string;
}) {
  return (
    <div className={`min-w-0 rounded-[12px] border px-2 py-1.5 ${ready ? 'border-[#353044] bg-[#181522]' : 'border-dashed border-[#353044] bg-[#111018]'}`}>
      <div className="mb-0.5 flex items-center justify-between gap-1.5">
        <span className="flex min-w-0 items-center gap-1 text-[10px] font-bold text-[#d8c8b8]/75">
          <span className={ready ? 'text-[#7ee0a0]' : 'text-[#d8c8b8]/70'}>{icon}</span>
          {label}
        </span>
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${ready ? 'bg-[#7ee0a0]' : 'bg-[#4a4152]'}`} />
      </div>
      <div className={`truncate text-xs font-bold ${ready ? 'text-[#f8f4ed]' : 'text-[#d8c8b8]/70'}`}>{value}</div>
    </div>
  );
}

function buildDataPoints(draft: RecordPreview) {
  const hasContent = Boolean(draft.content.trim());
  const hasTime = Boolean(draft.datetime_iso || draft.datetime_text);
  return [
    {
      icon: <FileText size={13} />,
      label: '内容',
      ready: hasContent,
      value: hasContent ? draft.content : '待补充',
    },
    {
      icon: <CalendarClock size={13} />,
      label: '时间',
      ready: hasTime,
      value: draft.datetime_iso ?? draft.datetime_text ?? '无',
    },
    {
      icon: <Bell size={13} />,
      label: '提醒',
      ready: true,
      value: draft.need_reminder ? '已开' : '关闭',
    },
    {
      icon: <Edit3 size={13} />,
      label: '缺失',
      ready: draft.missing_fields.length === 0,
      value: draft.missing_fields.length ? draft.missing_fields.join(', ') : '完整',
    },
  ];
}

function normalizeStatus(status: RecordStatus): RecordStatus {
  return status === 'need_confirmation' ? 'ready' : status;
}

const fieldLabels: Record<RiskField, string> = {
  type: '类型',
  title: '标题',
  content: '内容',
  datetime: '时间',
  need_reminder: '提醒',
  target: '目标',
};

function buildRiskSummary(draft: RecordPreview) {
  const fields: RiskField[] = ['type', 'datetime', 'need_reminder', 'target', 'content', 'title'];
  return fields
    .map((field) => {
      const level = draft.field_risk?.[field];
      const confidence = draft.field_confidence?.[field];
      if (!level || typeof confidence !== 'number') {
        return null;
      }
      if (level !== 'high' && confidence >= 0.85) {
        return null;
      }
      return {
        field,
        label: fieldLabels[field],
        level: level as FieldRiskLevel,
        confidence,
      };
    })
    .filter((item): item is { field: RiskField; label: string; level: FieldRiskLevel; confidence: number } => Boolean(item));
}
