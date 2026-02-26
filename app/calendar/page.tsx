"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Calendar as RBCalendar, dateFnsLocalizer, View } from "react-big-calendar";
import withDragAndDrop from "react-big-calendar/lib/addons/dragAndDrop";
import "react-big-calendar/lib/css/react-big-calendar.css";
import "react-big-calendar/lib/addons/dragAndDrop/styles.css";

import {
  format,
  parse,
  startOfWeek,
  getDay,
  startOfMonth,
  endOfMonth,
  addYears,
} from "date-fns";
import { ja } from "date-fns/locale/ja";

import { createClient } from "@supabase/supabase-js";

// ✅ supabase は1回だけ作る
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type Member = {
  id: number;
  name: string;
  color: string | null;
};

type ScheduleRow = {
  id: number;
  member: string;
  title: string;
  description: string | null;
  start_date: string;
  end_date: string;
};

type TodoRow = {
  id: string; // uuid
  title: string;
  due_date: string | null; // "YYYY-MM-DD"
  status: "open" | "done" | string;
  assignee: string | null;
  detail?: string | null;
  done_at?: string | null;
  created_at?: string;
};

type MustItem = {
  id: string;
  text: string;
  done: boolean;
};

type MonthlyRow = {
  id: string;
  month: string; // "YYYY-MM-01"
  goal: string | null;
  must: MustItem[] | any; // jsonb
  updated_at?: string;
};

type SharedNoteRow = {
  id: string; // uuid
  title: string;
  content: string;
  updated_at?: string | null;
  created_at?: string | null;
};

type CalendarEventSchedule = {
  kind: "schedule";
  id: number;
  title: string;
  start: Date;
  end: Date;
  member: string;
  description?: string;
};

type CalendarEventTodo = {
  kind: "todo";
  id: string; // uuid
  title: string;
  start: Date;
  end: Date;
  assignee: string;
  status: "open" | "done" | string;
  due_date: string; // "YYYY-MM-DD"
};

type CalendarEvent = CalendarEventSchedule | CalendarEventTodo;

const locales = { ja };

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { locale: ja, weekStartsOn: 1 }),
  getDay,
  locales,
});

const DnDCalendar = withDragAndDrop(RBCalendar);
function DateHeader({ date }: { date: Date }) {
  const dow = date.getDay(); // 0=日, 6=土
  const color = dow === 0 ? "#dc2626" : dow === 6 ? "#2563eb" : undefined;
  return <span style={{ color, fontWeight: 800 }}>{date.getDate()}</span>;
}

function WeekdayHeader({ date, label }: { date: Date; label: string }) {
  const dow = date.getDay();
  const color = dow === 0 ? "#dc2626" : dow === 6 ? "#2563eb" : undefined;
  return <span style={{ color, fontWeight: 800 }}>{label}</span>;
}
const TODO_DONE_COLOR = "#9CA3AF";
const DEFAULT_COLOR = "#3174ad";
const TODAY_CELL_BG = "rgba(255, 223, 100, 0.18)";
const OVERDUE_BORDER = "2px solid rgba(220, 38, 38, 0.95)";

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function toLocalInputValue(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(
    d.getHours()
  )}:${pad2(d.getMinutes())}`;
}
function fromLocalInputValue(v: string) {
  return new Date(v);
}

function monthKey(d = new Date()) {
  const m = startOfMonth(d);
  return `${m.getFullYear()}-${pad2(m.getMonth() + 1)}-01`;
}

function dateStrToLocalStart(d: string) {
  const [y, m, day] = d.split("-").map((x) => Number(x));
  return new Date(y, m - 1, day, 0, 0, 0, 0);
}

function addDaysLocal(date: Date, days: number) {
  const x = new Date(date);
  x.setDate(x.getDate() + days);
  return x;
}

function toYmdLocal(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function todayYmd() {
  return toYmdLocal(new Date());
}

function safeJsonParse<T>(s: string | null, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

type UndoPayload =
  | { kind: "schedule"; row: CalendarEventSchedule }
  | { kind: "todo"; row: TodoRow };

export default function CalendarPage() {
  const [authChecked, setAuthChecked] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
useEffect(() => {
  (async () => {
    const { data } = await supabase.auth.getSession();

    if (data.session) {
      setIsLoggedIn(true);
    }

    console.error("SESSION_CHECK", !!data.session);

    setAuthChecked(true);
  })();
}, []);
  // ✅ Hydration対策：マウント後だけ描画
  const [mounted, setMounted] = useState(false);

  // ✅ 表示中の日付（月またぎ移動のため）
  const [currentDate, setCurrentDate] = useState<Date>(new Date());

  // ===== 予定 =====
  const [scheduleEvents, setScheduleEvents] = useState<CalendarEventSchedule[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedMember, setSelectedMember] = useState<string>("");

  // ===== ToDo =====
  const [todos, setTodos] = useState<TodoRow[]>([]);
  const [todoAssignee, setTodoAssignee] = useState<string>(""); // スロット追加時の担当デフォルト用

  const openTodos = useMemo(() => todos.filter((t) => t.status !== "done"), [todos]);

  // ===== 月間（目標 + やるべきこと）=====
  const [monthlyGoal, setMonthlyGoal] = useState("");
  const [monthlyMust, setMonthlyMust] = useState<MustItem[]>([]);
  const [mustNewText, setMustNewText] = useState("");

  // 保存状態（表示はしないがロジックは維持）
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const monthlyReadyRef = useRef(false);

  // ===== 予定モーダル =====
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const [formTitle, setFormTitle] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formMember, setFormMember] = useState("");
  const [formStart, setFormStart] = useState("");
  const [formEnd, setFormEnd] = useState("");

  // ===== ToDo編集モーダル =====
  const [todoModalOpen, setTodoModalOpen] = useState(false);
  const [editingTodoId, setEditingTodoId] = useState<string | null>(null);
  const [todoFormTitle, setTodoFormTitle] = useState("");
  const [todoFormDate, setTodoFormDate] = useState("");
  const [todoFormAssignee, setTodoFormAssignee] = useState("");
  const [todoFormDetail, setTodoFormDetail] = useState("");
  const [todoFormStatus, setTodoFormStatus] = useState<"open" | "done">("open");

  // ===== 表示フィルター =====
  const [showType, setShowType] = useState<"all" | "schedule" | "todo">("all");
  const [hideDoneTodos, setHideDoneTodos] = useState(false);
  const [memberVisible, setMemberVisible] = useState<Record<string, boolean>>({});

  // ✅ ビュー（week/month/day）
  const [view, setView] = useState<View>("week");

  // ===== Undo =====
  const [undo, setUndo] = useState<{ payload: UndoPayload } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ===== 共有ノート =====
  const [notesOpen, setNotesOpen] = useState(false);
  const [notes, setNotes] = useState<SharedNoteRow[]>([]);
  const [noteEditingId, setNoteEditingId] = useState<string | null>(null);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [notesSaving, setNotesSaving] = useState(false);

  const memberMap = useMemo(() => {
    const map = new Map<string, Member>();
    for (const m of members) map.set(m.name, m);
    return map;
  }, [members]);

  function getMemberColor(name: string) {
    const m = memberMap.get(name);
    return m?.color || DEFAULT_COLOR;
  }

  // 今日枠
  const todayOpenTodos = useMemo(() => {
    const t = todayYmd();
    return openTodos.filter((x) => (x.due_date ?? "") === t);
  }, [openTodos]);

  const overdueCount = useMemo(() => {
    const t = todayYmd();
    return openTodos.filter((x) => (x.due_date ?? "") !== "" && (x.due_date as string) < t).length;
  }, [openTodos]);

  // カレンダーに渡すイベント（予定 + ToDo）
  const allEvents: CalendarEvent[] = useMemo(() => {
    const todoEvents: CalendarEventTodo[] = todos
      .filter((t) => !!t.due_date)
      .filter((t) => !(hideDoneTodos && t.status === "done"))
      .map((t) => {
        const start = dateStrToLocalStart(t.due_date!);
        const end = addDaysLocal(start, 1);
        return {
          kind: "todo" as const,
          id: t.id,
          title: `🧾 ${t.title}`,
          start,
          end,
          assignee: t.assignee || "未設定",
          status: t.status,
          due_date: t.due_date!,
        };
      });

    const scheduleFiltered = scheduleEvents.filter((e) => {
      const v = memberVisible[e.member];
      return v === undefined ? true : v;
    });

    let merged: CalendarEvent[] = [...scheduleFiltered, ...todoEvents];
    if (showType !== "all") merged = merged.filter((e) => e.kind === showType);
    return merged;
  }, [todos, scheduleEvents, showType, hideDoneTodos, memberVisible]);

  // ====== 1) 初回：マウント & members取得 ======
  useEffect(() => {
    setMounted(true);

    (async () => {
      // members
      const { data: memberData, error: memberErr } = await supabase
        .from("members")
        .select("*")
        .order("id", { ascending: true });

      if (memberErr) console.error("members取得エラー:", memberErr);
      const mlist = (memberData ?? []) as Member[];
      setMembers(mlist);

      if (mlist.length > 0) {
        setSelectedMember((prev) => prev || mlist[0].name);
        setTodoAssignee((prev) => prev || mlist[0].name);

        setMemberVisible((prev) => {
          if (Object.keys(prev).length > 0) return prev;
          const obj: Record<string, boolean> = {};
          for (const m of mlist) obj[m.name] = true;
          return obj;
        });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ====== 2) 表示中日付に合わせて「向こう1年」範囲を取得 ======
  // 例：currentDate を中心に、過去1年〜未来1年を取得
  useEffect(() => {
    if (!mounted) return;

    (async () => {
      const from = startOfMonth(addYears(currentDate, -1));
      const to = endOfMonth(addYears(currentDate, 1));

      // schedules
      const { data: scheduleData, error: scheduleErr } = await supabase
        .from("schedules")
        .select("*")
        .gte("start_date", from.toISOString())
        .lte("start_date", to.toISOString())
        .order("start_date", { ascending: true });

      if (scheduleErr) console.error("schedules取得エラー:", scheduleErr);

      const srows = (scheduleData ?? []) as ScheduleRow[];
      const formatted: CalendarEventSchedule[] = srows
        .map((r) => ({
          kind: "schedule" as const,
          id: r.id,
          title: r.title,
          start: new Date(r.start_date),
          end: new Date(r.end_date),
          member: r.member,
          description: r.description ?? "",
        }))
        .filter((e) => !Number.isNaN(e.start.getTime()) && !Number.isNaN(e.end.getTime()));

      setScheduleEvents(formatted);

      // todos（due_date は YYYY-MM-DD なので同形式で比較）
      const fromYmd = toYmdLocal(from);
      const toYmd = toYmdLocal(to);

      const { data: todoData, error: todoErr } = await supabase
        .from("todos")
        .select("*")
        .gte("due_date", fromYmd)
        .lte("due_date", toYmd)
        .order("created_at", { ascending: false });

      if (todoErr) console.error("todos取得エラー:", todoErr);
      setTodos((todoData ?? []) as TodoRow[]);
    })();
  }, [currentDate, mounted]);

  // ====== 3) 月間（目標/やるべきこと）: 表示中の月に紐づけ ======
  //  - 月を移動したらその月の下書き→DBをロード
  useEffect(() => {
    if (!mounted) return;

    (async () => {
      monthlyReadyRef.current = false;
      const mk = monthKey(currentDate);

      const goalDraftKey = `monthly_goal_draft:${mk}`;
      const mustDraftKey = `monthly_must_draft:${mk}`;

      // 0) ローカル下書き
      const draftGoal = localStorage.getItem(goalDraftKey) ?? "";
      const draftMust = safeJsonParse<MustItem[]>(localStorage.getItem(mustDraftKey), []);
      setMonthlyGoal(draftGoal);
      setMonthlyMust(Array.isArray(draftMust) ? draftMust : []);

      // 1) DB
      const { data: monthlyData, error: monthlyErr } = await supabase
        .from("monthly_dashboard")
        .select("*")
        .eq("month", mk)
        .maybeSingle();

      if (monthlyErr) console.error("monthly_dashboard取得エラー:", monthlyErr);

      // 下書きが空ならDBを反映（下書き優先）
      if (monthlyData) {
        const row = monthlyData as MonthlyRow;

        setMonthlyGoal((prev) => (prev.trim() ? prev : row.goal ?? ""));
        setMonthlyMust((prev) => {
          if (prev.length > 0) return prev;
          const must = Array.isArray(row.must) ? (row.must as MustItem[]) : [];
          return must;
        });

        setSaveState("saved");
      } else {
        setSaveState("idle");
      }

      monthlyReadyRef.current = true;
    })();
  }, [currentDate, mounted]);

  // 下書き保存（表示中の月）
  useEffect(() => {
    if (!mounted) return;
    const mk = monthKey(currentDate);
    localStorage.setItem(`monthly_goal_draft:${mk}`, monthlyGoal);
  }, [monthlyGoal, currentDate, mounted]);

  useEffect(() => {
    if (!mounted) return;
    const mk = monthKey(currentDate);
    localStorage.setItem(`monthly_must_draft:${mk}`, JSON.stringify(monthlyMust ?? []));
  }, [monthlyMust, currentDate, mounted]);

  // DB自動保存（表示中の月）
  useEffect(() => {
    if (!mounted) return;
    if (!monthlyReadyRef.current) return;

    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    setSaveState("saving");

    autosaveTimer.current = setTimeout(async () => {
      const mk = monthKey(currentDate);
      const payload = {
        month: mk,
        goal: monthlyGoal,
        must: monthlyMust,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from("monthly_dashboard")
        .upsert(payload, { onConflict: "month" });

      if (error) {
        console.error("monthly autosave失敗:", error);
        setSaveState("error");
        return;
      }
      setSaveState("saved");
    }, 1200);

    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
  }, [monthlyGoal, monthlyMust, currentDate, mounted]);

  // ===== Must操作 =====
  function addMustItem() {
    const text = mustNewText.trim();
    if (!text) return;
    const item: MustItem = { id: crypto.randomUUID(), text, done: false };
    setMonthlyMust((prev) => [item, ...prev]);
    setMustNewText("");
  }
  function toggleMustItem(id: string) {
    setMonthlyMust((prev) => prev.map((x) => (x.id === id ? { ...x, done: !x.done } : x)));
  }
  function deleteMustItem(id: string) {
    setMonthlyMust((prev) => prev.filter((x) => x.id !== id));
  }

  // ===== 予定モーダル =====
  function openCreateModal(slotInfo: { start: Date; end: Date }) {
    setEditingId(null);
    setFormTitle("");
    setFormDesc("");
    setFormMember(selectedMember || (members[0]?.name ?? "未設定"));
    setFormStart(toLocalInputValue(slotInfo.start));
    setFormEnd(toLocalInputValue(slotInfo.end));
    setModalOpen(true);
  }
  function openEditModal(event: CalendarEventSchedule) {
    setEditingId(event.id);
    setFormTitle(event.title);
    setFormDesc(event.description ?? "");
    setFormMember(event.member);
    setFormStart(toLocalInputValue(event.start));
    setFormEnd(toLocalInputValue(event.end));
    setModalOpen(true);
  }
  function closeModal() {
    setModalOpen(false);
  }

  async function saveModal() {
    if (!formTitle.trim()) return alert("タイトルは必須です");

    const start = fromLocalInputValue(formStart);
    const end = fromLocalInputValue(formEnd);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return alert("開始/終了日時が不正です");
    if (end <= start) return alert("終了は開始より後にしてください");

    if (editingId === null) {
      const { data, error } = await supabase
        .from("schedules")
        .insert([
          {
            member: formMember || "未設定",
            title: formTitle,
            description: formDesc,
            start_date: start.toISOString(),
            end_date: end.toISOString(),
          },
        ])
        .select("*")
        .single();

      if (error) {
        console.error("insert失敗:", error);
        return alert("予定の追加に失敗しました（Consoleを確認）");
      }

      const r = data as ScheduleRow;
      const newEvent: CalendarEventSchedule = {
        kind: "schedule",
        id: r.id,
        title: r.title,
        start: new Date(r.start_date),
        end: new Date(r.end_date),
        member: r.member,
        description: r.description ?? "",
      };

      setScheduleEvents((prev) =>
        [...prev, newEvent].sort((a, b) => a.start.getTime() - b.start.getTime())
      );
      closeModal();
      return;
    }

    const { data, error } = await supabase
      .from("schedules")
      .update({
        member: formMember || "未設定",
        title: formTitle,
        description: formDesc,
        start_date: start.toISOString(),
        end_date: end.toISOString(),
      })
      .eq("id", editingId)
      .select("*")
      .single();

    if (error) {
      console.error("update失敗:", error);
      return alert("編集に失敗しました（Consoleを確認）");
    }

    const r = data as ScheduleRow;
    setScheduleEvents((prev) =>
      prev
        .map((e) =>
          e.id === editingId
            ? {
                ...e,
                title: r.title,
                member: r.member,
                description: r.description ?? "",
                start: new Date(r.start_date),
                end: new Date(r.end_date),
              }
            : e
        )
        .sort((a, b) => a.start.getTime() - b.start.getTime())
    );

    closeModal();
  }

  // ===== Undo =====
  function showUndo(payload: UndoPayload) {
    setUndo({ payload });

    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(async () => {
      const p = payload;
      if (p.kind === "schedule") await supabase.from("schedules").delete().eq("id", p.row.id);
      else await supabase.from("todos").delete().eq("id", p.row.id);

      setUndo(null);
    }, 5000);
  }

  function undoDelete() {
    if (!undo) return;
    if (undoTimer.current) clearTimeout(undoTimer.current);

    const p = undo.payload;
    if (p.kind === "schedule") {
      setScheduleEvents((prev) =>
        [...prev, p.row].sort((a, b) => a.start.getTime() - b.start.getTime())
      );
    } else {
      setTodos((prev) => [p.row, ...prev]);
    }

    setUndo(null);
  }

  async function deleteEventWithUndo(id: number) {
    const ok = window.confirm("この予定を削除しますか？（5秒以内ならUndoできます）");
    if (!ok) return;

    const target = scheduleEvents.find((e) => e.id === id);
    if (!target) return;

    setScheduleEvents((prev) => prev.filter((e) => e.id !== id));
    closeModal();
    showUndo({ kind: "schedule", row: target });
  }

  // ===== ToDo =====
  async function addTodo(title: string, due: string) {
    const tTitle = title.trim();
    const tDue = due.trim();
    if (!tTitle) return alert("ToDoタイトルを入れてください");
    if (!tDue) return alert("日付が不正です");

    const payload = {
      title: tTitle,
      due_date: tDue,
      status: "open",
      assignee: todoAssignee || "未設定",
      detail: "",
    };

    const { data, error } = await supabase.from("todos").insert([payload]).select("*").single();
    if (error) {
      console.error("todo insert失敗:", error);
      return alert("ToDoの追加に失敗しました（Consoleを確認）");
    }

    setTodos((prev) => [data as TodoRow, ...prev]);
  }

  function openTodoEditModalById(id: string) {
    const row = todos.find((x) => x.id === id);
    if (!row) return;

    setEditingTodoId(row.id);
    setTodoFormTitle(row.title);
    setTodoFormDate(row.due_date ?? todayYmd());
    setTodoFormAssignee(row.assignee ?? "未設定");
    setTodoFormDetail(row.detail ?? "");
    setTodoFormStatus((row.status === "done" ? "done" : "open") as "open" | "done");
    setTodoModalOpen(true);
  }

  function closeTodoModal() {
    setTodoModalOpen(false);
  }

  async function saveTodoModal() {
    if (!editingTodoId) return;
    if (!todoFormTitle.trim()) return alert("タイトルは必須です");
    if (!todoFormDate.trim()) return alert("日付は必須です");

    const { data, error } = await supabase
      .from("todos")
      .update({
        title: todoFormTitle.trim(),
        due_date: todoFormDate,
        assignee: todoFormAssignee || "未設定",
        detail: todoFormDetail ?? "",
        status: todoFormStatus,
        done_at: todoFormStatus === "done" ? new Date().toISOString() : null,
      })
      .eq("id", editingTodoId)
      .select("*")
      .single();

    if (error) {
      console.error("todo update失敗:", error);
      return alert("ToDoの編集に失敗しました（Consoleを確認）");
    }

    const updated = data as TodoRow;
    setTodos((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    closeTodoModal();
  }

  async function deleteTodoWithUndo(id: string) {
    const ok = window.confirm("このToDoを削除しますか？（5秒以内ならUndoできます）");
    if (!ok) return;

    const target = todos.find((t) => t.id === id);
    if (!target) return;

    setTodos((prev) => prev.filter((t) => t.id !== id));
    closeTodoModal();
    showUndo({ kind: "todo" as const, row: target });
  }

  async function toggleTodoQuick(id: string, currentStatus: string) {
    const next = currentStatus === "done" ? "open" : "done";

    setTodos((prev) =>
      prev.map((t) =>
        t.id === id ? { ...t, status: next, done_at: next === "done" ? new Date().toISOString() : null } : t
      )
    );

    const { data, error } = await supabase
      .from("todos")
      .update({
        status: next,
        done_at: next === "done" ? new Date().toISOString() : null,
      })
      .eq("id", id)
      .select("*")
      .single();

    if (error) {
      console.error("todo toggle失敗:", error);
      alert("ToDo更新に失敗しました（Consoleを確認）");
      location.reload();
      return;
    }

    const updated = data as TodoRow;
    setTodos((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
  }

  // ===== DnD（予定 + ToDo）=====
  async function onEventDrop(args: any) {
    const event = args.event as CalendarEvent;
    const start = args.start as Date;
    const end = args.end as Date;

    if (event.kind === "todo") {
      const nextDue = toYmdLocal(start);
      setTodos((prev) => prev.map((t) => (t.id === event.id ? { ...t, due_date: nextDue } : t)));

      const { error } = await supabase.from("todos").update({ due_date: nextDue }).eq("id", event.id);
      if (error) {
        console.error("todo drag update失敗:", error);
        alert("ToDoの日付変更の保存に失敗しました（Consoleを確認）");
        location.reload();
      }
      return;
    }

    if (event.kind !== "schedule") return;

    setScheduleEvents((prev) => prev.map((e) => (e.id === event.id ? { ...e, start, end } : e)));

    const { error } = await supabase
      .from("schedules")
      .update({ start_date: start.toISOString(), end_date: end.toISOString() })
      .eq("id", event.id);

    if (error) {
      console.error("drag update失敗:", error);
      alert("時間変更の保存に失敗しました（Consoleを確認）");
      location.reload();
    }
  }

  async function onEventResize(args: any) {
    const event = args.event as CalendarEvent;
    if (event.kind !== "schedule") return;

    const start = args.start as Date;
    const end = args.end as Date;

    setScheduleEvents((prev) => prev.map((e) => (e.id === event.id ? { ...e, start, end } : e)));

    const { error } = await supabase
      .from("schedules")
      .update({ start_date: start.toISOString(), end_date: end.toISOString() })
      .eq("id", event.id);

    if (error) {
      console.error("resize update失敗:", error);
      alert("時間変更の保存に失敗しました（Consoleを確認）");
      location.reload();
    }
  }

  // 空白ドラッグ：予定 or ToDo
  async function onSelectSlot(slotInfo: { start: Date; end: Date }) {
    const choice = window.prompt("追加するのは？  1=予定  2=ToDo", "1");
    if (!choice) return;

    if (choice.trim() === "2") {
      const title = window.prompt("ToDoタイトルを入力", "");
      if (!title?.trim()) return;
      const due = toYmdLocal(slotInfo.start);
      await addTodo(title.trim(), due);
      return;
    }

    openCreateModal(slotInfo);
  }

  // クリック：ToDoは編集モーダル、予定は編集モーダル
  function onSelectEvent(e: any) {
    const event = e as CalendarEvent;
    if (event.kind === "todo") {
      openTodoEditModalById(event.id);
      return;
    }
    openEditModal(event as CalendarEventSchedule);
  }

  // ===== 共有ノート：ロード/編集 =====
  async function loadNotes() {
    const { data, error } = await supabase
      .from("shared_notes")
      .select("*")
      .order("updated_at", { ascending: false });

    if (error) {
  console.error("shared_notes insert失敗:", error, (error as any)?.message, (error as any)?.details, (error as any)?.hint, (error as any)?.code);
  alert(`共有ノート追加失敗: ${(error as any)?.message ?? "Console確認"}`);
  return;
}
    setNotes((data ?? []) as SharedNoteRow[]);
  }

  function openNotes() {
    setNotesOpen(true);
    loadNotes();
  }

  function closeNotes() {
    setNotesOpen(false);
  }

  function startNewNote() {
    setNoteEditingId(null);
    setNoteTitle("");
    setNoteContent("");
  }

  function startEditNote(n: SharedNoteRow) {
    setNoteEditingId(n.id);
    setNoteTitle(n.title ?? "");
    setNoteContent(n.content ?? "");
  }

  async function saveNote() {
    const t = noteTitle.trim();
    if (!t) return alert("タイトルは必須です");

    setNotesSaving(true);
    try {
      if (!noteEditingId) {
        const { data, error } = await supabase
          .from("shared_notes")
          .insert([{ title: t, content: noteContent ?? "" }])
          .select("*")
          .single();

        if (error) {
          console.error("shared_notes insert失敗:", error);
          alert("共有ノートの追加に失敗しました（Consoleを確認）");
          return;
        }

        const row = data as SharedNoteRow;
        setNotes((prev) => [row, ...prev]);
        startEditNote(row);
        return;
      }

      const { data, error } = await supabase
        .from("shared_notes")
        .update({ title: t, content: noteContent ?? "", updated_at: new Date().toISOString() })
        .eq("id", noteEditingId)
        .select("*")
        .single();

      if (error) {
        console.error("shared_notes update失敗:", error);
        alert("共有ノートの保存に失敗しました（Consoleを確認）");
        return;
      }

      const row = data as SharedNoteRow;
      setNotes((prev) => prev.map((x) => (x.id === row.id ? row : x)));
      startEditNote(row);
    } finally {
      setNotesSaving(false);
    }
  }

  async function deleteNote(id: string) {
    const ok = window.confirm("このノートを削除しますか？");
    if (!ok) return;

    const { error } = await supabase.from("shared_notes").delete().eq("id", id);
    if (error) {
      console.error("shared_notes delete失敗:", error);
      alert("共有ノートの削除に失敗しました（Consoleを確認）");
      return;
    }

    setNotes((prev) => prev.filter((x) => x.id !== id));
    if (noteEditingId === id) startNewNote();
  }

  // ✅ Hydration対策
  if (!mounted) return null;
  const fieldStyle = {
  padding: 10,
  borderRadius: 12,
  border: "1px solid #e5e7eb",
  background: "#fff",
  outline: "none",
} as const;

const labelTitleStyle = {
  fontWeight: 800,
  fontSize: 12,
  opacity: 0.8,
} as const;
  const cardStyle = {
  background: "#fff",
  border: "1px solid #eee",
  borderRadius: 14,
  padding: 12,
  boxShadow: "0 10px 25px rgba(0,0,0,0.05)",
} as const;

const cardTitleStyle = {
  fontWeight: 900,
  marginBottom: 8,
} as const;

const btnStyle = {
  padding: "8px 10px",
  borderRadius: 10,
  border: "1px solid #e5e7eb",
  background: "#fff",
  fontWeight: 800,
} as const;
// 🔒 ログインチェック
if (!authChecked) return null;

if (!isLoggedIn) {
  window.location.href = "/login";
  return null;
}
  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      <div style={{
  position: "fixed",
  top: 10,
  right: 10,
  zIndex: 99999,
  background: "black",
  color: "white",
  padding: "6px 10px",
  fontSize: 12,
  borderRadius: 6
}}>
  authChecked: {String(authChecked)} / isLoggedIn: {String(isLoggedIn)}
</div>
      {/* 左：サイドバー */}
      {/* 左：サイドバー */}
<aside
  style={{
    width: 360,
    borderRight: "1px solid #eee",
    padding: 12,
    overflow: "auto",
    background: "#fafafa",
  }}
>
  {/* 🔥 今日 */}
  <div style={{ ...cardStyle, marginBottom: 12 }}>
    <div style={cardTitleStyle}>🔥 今日（{todayYmd()}）</div>

    <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 8 }}>
      期限切れ：{overdueCount} 件 / 今日：{todayOpenTodos.length} 件
    </div>

    {todayOpenTodos.length === 0 ? (
      <div style={{ opacity: 0.6, fontSize: 13 }}>今日のToDoはありません</div>
    ) : (
      <div style={{ display: "grid", gap: 8 }}>
        {todayOpenTodos.map((t) => (
          <div
            key={t.id}
            style={{
              border: "1px solid #eee",
              borderRadius: 12,
              padding: 10,
              background: "#fff",
              display: "grid",
              gap: 6,
            }}
          >
            <div style={{ fontWeight: 900 }}>{t.title}</div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>{t.assignee ?? "未設定"}</div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => toggleTodoQuick(t.id, t.status)} style={btnStyle}>
                完了
              </button>
              <button
                onClick={() => openTodoEditModalById(t.id)}
                style={{ ...btnStyle, background: "#f3f4f6" }}
              >
                編集
              </button>
            </div>
          </div>
        ))}
      </div>
    )}
  </div>

  {/* 📌 目標 */}
  <div style={{ ...cardStyle, marginBottom: 12 }}>
    <div style={cardTitleStyle}>📌 今月の目標（{monthKey(currentDate).slice(0, 7)}）</div>
    <textarea
      value={monthlyGoal}
      onChange={(e) => setMonthlyGoal(e.target.value)}
      style={{
        width: "100%",
        minHeight: 90,
        padding: 10,
        resize: "vertical",
        borderRadius: 12,
        border: "1px solid #e5e7eb",
      }}
      placeholder="例：毎日ショート投稿 / 配信の安定化 / 体調管理…"
    />
  </div>

  {/* ✅ 今月やるべきこと */}
  <div style={{ ...cardStyle, marginBottom: 12 }}>
    <div style={cardTitleStyle}>✅ 今月やるべきこと（{monthKey(currentDate).slice(0, 7)}）</div>

    <div style={{ display: "flex", gap: 8 }}>
      <input
        value={mustNewText}
        onChange={(e) => setMustNewText(e.target.value)}
        style={{
          flex: 1,
          padding: 10,
          borderRadius: 12,
          border: "1px solid #e5e7eb",
        }}
        placeholder="例：サムネテンプレ整備"
      />
      <button
        onClick={addMustItem}
        style={{
          padding: "10px 12px",
          borderRadius: 12,
          border: "1px solid #e5e7eb",
          background: "#fff",
          fontWeight: 900,
        }}
      >
        追加
      </button>
    </div>

    <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
      {monthlyMust.length === 0 && <div style={{ opacity: 0.6 }}>まだありません</div>}
      {monthlyMust.map((m) => (
        <div
          key={m.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: 10,
            border: "1px solid #eee",
            borderRadius: 12,
            background: "#fff",
          }}
        >
          <input type="checkbox" checked={m.done} onChange={() => toggleMustItem(m.id)} />
          <div
            style={{
              flex: 1,
              textDecoration: m.done ? "line-through" : "none",
              opacity: m.done ? 0.6 : 1,
              fontWeight: 700,
            }}
          >
            {m.text}
          </div>
          <button
            onClick={() => deleteMustItem(m.id)}
            style={{
              padding: "6px 10px",
              borderRadius: 10,
              border: "1px solid #e5e7eb",
              background: "#fff",
              fontWeight: 900,
            }}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  </div>

  {/* フィルター */}
  <div style={{ ...cardStyle, marginBottom: 12 }}>
    <div style={cardTitleStyle}>表示フィルター</div>

    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", gap: 6 }}>
        <button
          onClick={() => setShowType("all")}
          style={{ ...btnStyle, background: showType === "all" ? "#eef2ff" : "#fff" }}
        >
          全部
        </button>
        <button
          onClick={() => setShowType("schedule")}
          style={{ ...btnStyle, background: showType === "schedule" ? "#eef2ff" : "#fff" }}
        >
          予定だけ
        </button>
        <button
          onClick={() => setShowType("todo")}
          style={{ ...btnStyle, background: showType === "todo" ? "#eef2ff" : "#fff" }}
        >
          ToDoだけ
        </button>
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
        <input type="checkbox" checked={hideDoneTodos} onChange={(e) => setHideDoneTodos(e.target.checked)} />
        完了ToDoを非表示
      </label>

      <div style={{ marginTop: 4, fontWeight: 900, fontSize: 13 }}>メンバー表示</div>
      <div style={{ display: "grid", gap: 6 }}>
        {members.length === 0 ? (
          <div style={{ opacity: 0.6, fontSize: 13 }}>membersが0件の場合はRLS/seedを確認</div>
        ) : (
          members.map((m) => (
            <label key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={memberVisible[m.name] ?? true}
                onChange={(e) =>
                  setMemberVisible((prev) => ({
                    ...prev,
                    [m.name]: e.target.checked,
                  }))
                }
              />
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 999,
                  background: m.color || DEFAULT_COLOR,
                  display: "inline-block",
                }}
              />
              {m.name}
            </label>
          ))
        )}
      </div>
    </div>
  </div>

  {/* 表示（月/週/日） */}
  <div style={{ ...cardStyle, marginBottom: 12 }}>
    <div style={cardTitleStyle}>表示</div>
    <div style={{ display: "flex", gap: 6 }}>
      <button onClick={() => setView("month")} style={btnStyle}>
        月
      </button>
      <button onClick={() => setView("week")} style={btnStyle}>
        週
      </button>
      <button onClick={() => setView("day")} style={btnStyle}>
        日
      </button>
    </div>
  </div>
</aside>

      {/* 右：カレンダー */}
      <main style={{ flex: 1, minWidth: 0, padding: 12, position: "relative" }}>
        <div style={{ marginBottom: 10, display: "flex", gap: 10, alignItems: "center" }}>
          <div style={{ fontWeight: 700 }}>メンバー：</div>
          <select
            value={selectedMember}
            onChange={(e) => setSelectedMember(e.target.value)}
            style={{ padding: 6, minWidth: 180 }}
          >
            {members.length === 0 ? (
              <option value="">（membersが0件 / RLS確認）</option>
            ) : (
              members.map((m) => (
                <option key={m.id} value={m.name}>
                  {m.name}
                </option>
              ))
            )}
          </select>

          {/* ToDo担当（空白追加時の担当） */}
          <div style={{ marginLeft: 10, fontWeight: 700 }}>ToDo担当：</div>
          <select
            value={todoAssignee}
            onChange={(e) => setTodoAssignee(e.target.value)}
            style={{ padding: 6, minWidth: 180 }}
          >
            {members.length === 0 ? (
              <option value="未設定">未設定</option>
            ) : (
              members.map((m) => (
                <option key={m.id} value={m.name}>
                  {m.name}
                </option>
              ))
            )}
          </select>
        </div>

        <DnDCalendar
          localizer={localizer}
          events={allEvents}
          components={{
  month: { dateHeader: DateHeader },

  event: ({ event }: any) => {

    const start = new Date(event.start);

    const hhmm = start.toLocaleTimeString("ja-JP", {
      hour: "2-digit",
      minute: "2-digit",
    });

    const isTodo = event.kind === "todo";

    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontWeight: 800,
          fontSize: 12,
          overflow: "hidden",
        }}
      >
        <span>{isTodo ? "🧾" : "●"}</span>

        {!isTodo && <span>{hhmm}</span>}

        <span>{event.title}</span>
      </div>
    );
  },
}}
          startAccessor={(e: any) => e.start}
　　　　　endAccessor={(e: any) => e.end}
          culture="ja"
          selectable
          resizable
          views={["month", "week", "day", "agenda"]}
          view={view}
          onView={(v) => setView(v)}
          date={currentDate}
          onNavigate={(d) => setCurrentDate(d)}
          onSelectSlot={onSelectSlot}
          onSelectEvent={onSelectEvent}
          onEventDrop={onEventDrop}
          onEventResize={onEventResize}
          dayPropGetter={(date) => {
            const isToday = toYmdLocal(date) === todayYmd();
            if (!isToday) return {};
            return { style: { background: TODAY_CELL_BG } };
          }}
          eventPropGetter={(event: any) => {
            const ev = event as CalendarEvent;

            if (ev.kind === "todo") {
              const isToday = ev.due_date === todayYmd();
              const isOverdue = ev.status !== "done" && ev.due_date < todayYmd();
              const bg = ev.status === "done" ? TODO_DONE_COLOR : getMemberColor(ev.assignee || "未設定");

              return {
                style: {
                  backgroundColor: bg,
                  opacity: ev.status === "done" ? 0.55 : 0.95,
                  border: isOverdue ? OVERDUE_BORDER : isToday ? "3px solid #111" : "1px solid transparent",
                  boxShadow: isToday ? "0 0 0 2px rgba(0,0,0,0.12)" : "none",
                  fontWeight: isToday ? 900 : 700,
                },
              };
            }

            const bg = getMemberColor(ev.member);
            return { style: { backgroundColor: bg } };
          }}
        />

        {/* 共有ノートボタン（枠外に小さめ固定） */}
        <button
          onClick={openNotes}
          title="共有ノート"
          style={{
            position: "fixed",
            right: 14,
            bottom: 14,
            zIndex: 999999,
            width: 44,
            height: 44,
            borderRadius: 999,
            border: "1px solid #e5e7eb",
            background: "#fff",
            boxShadow: "0 10px 25px rgba(0,0,0,0.12)",
            fontSize: 18,
            cursor: "pointer",
          }}
        >
          📝
        </button>

        {/* 予定モーダル */}
        {modalOpen && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.35)",
              animation: "fadeInBackdrop 0.15s ease",
              display: "flex",
              alignItems: "stretch",
              justifyContent: "flex-end",
              padding: 16,
              zIndex: 9999,
            }}
            onClick={closeModal}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                width: 420,
                height: "100%",
                background: "rgba(255,255,255,0.96)",
                backdropFilter: "blur(8px)",
                borderRadius: 16,
                animation: "slideIn 0.2s ease",
                border: "1px solid rgba(229,231,235,0.9)",
                boxShadow: "-18px 0 45px rgba(0,0,0,0.18)",
                overflow: "auto",
                padding: 14,                            // パネル内余白
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  paddingBottom: 10,
                  borderBottom: "1px solid rgba(229,231,235,0.9)",
                }}
              >
                <div style={{ fontWeight: 900, fontSize: 15, letterSpacing: 0.2 }}>
  　　　　　　　　　{editingId === null ? "予定を追加" : "予定を編集"}
　　　　　　　　　</div>
                <button onClick={closeModal} style={{ padding: "6px 10px" }}>
                  ✕
                </button>
              </div>

              <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
                <label style={{ display: "grid", gap: 6 }}>
                  <div style={labelTitleStyle}>タイトル</div>
                  <input value={formTitle} onChange={(e) => setFormTitle(e.target.value)} style={fieldStyle} />
                </label>

                <label style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontWeight: 700 }}>内容（メモ）</div>
                  <textarea
                    value={formDesc}
                    onChange={(e) => setFormDesc(e.target.value)}
                    style={{ padding: 8, minHeight: 90, resize: "vertical" }}
                  />
                </label>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <label style={{ display: "grid", gap: 6 }}>
                    <div style={{ fontWeight: 700 }}>開始</div>
                    <input
                      type="datetime-local"
                      value={formStart}
                      onChange={(e) => setFormStart(e.target.value)}
                      style={{ padding: 8 }}
                    />
                  </label>
                  <label style={{ display: "grid", gap: 6 }}>
                    <div style={{ fontWeight: 700 }}>終了</div>
                    <input
                      type="datetime-local"
                      value={formEnd}
                      onChange={(e) => setFormEnd(e.target.value)}
                      style={{ padding: 8 }}
                    />
                  </label>
                </div>

                <label style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontWeight: 700 }}>メンバー</div>
                  <select value={formMember} onChange={(e) => setFormMember(e.target.value)} style={{ padding: 8 }}>
                    {members.map((m) => (
                      <option key={m.id} value={m.name}>
                        {m.name}
                      </option>
                    ))}
                    {members.length === 0 && <option value="未設定">未設定</option>}
                  </select>
                </label>

                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 6 }}>
                  {editingId !== null && (
                    <button
                      onClick={() => deleteEventWithUndo(editingId)}
                      style={{ padding: "8px 12px", background: "#ffe5e5" }}
                    >
                      削除（Undoあり）
                    </button>
                  )}
                  <button onClick={saveModal} style={{ padding: "8px 12px" }}>
                    保存
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ToDo編集モーダル */}
        {todoModalOpen && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.35)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 16,
              zIndex: 9999,
            }}
            onClick={closeTodoModal}
          >
            <div
              style={{
                width: "min(680px, 100%)",
                background: "#fff",
                borderRadius: 12,
                padding: 14,
                boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <div style={{ fontWeight: 800, fontSize: 16 }}>ToDoを編集</div>
                <button onClick={closeTodoModal} style={{ padding: "6px 10px" }}>
                  ✕
                </button>
              </div>

              <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
                <label style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontWeight: 700 }}>タイトル</div>
                  <input
                    value={todoFormTitle}
                    onChange={(e) => setTodoFormTitle(e.target.value)}
                    style={{ padding: 8 }}
                  />
                </label>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <label style={{ display: "grid", gap: 6 }}>
                    <div style={{ fontWeight: 700 }}>日付</div>
                    <input
                      value={todoFormDate}
                      onChange={(e) => setTodoFormDate(e.target.value)}
                      style={{ padding: 8 }}
                    />
                  </label>

                  <label style={{ display: "grid", gap: 6 }}>
                    <div style={{ fontWeight: 700 }}>担当</div>
                    <select
                      value={todoFormAssignee}
                      onChange={(e) => setTodoFormAssignee(e.target.value)}
                      style={{ padding: 8 }}
                    >
                      {members.map((m) => (
                        <option key={m.id} value={m.name}>
                          {m.name}
                        </option>
                      ))}
                      {members.length === 0 && <option value="未設定">未設定</option>}
                    </select>
                  </label>
                </div>

                <label style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontWeight: 700 }}>詳細（メモ）</div>
                  <textarea
                    value={todoFormDetail}
                    onChange={(e) => setTodoFormDetail(e.target.value)}
                    style={{ padding: 8, minHeight: 90, resize: "vertical" }}
                  />
                </label>

                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={todoFormStatus === "done"}
                    onChange={(e) => setTodoFormStatus(e.target.checked ? "done" : "open")}
                  />
                  完了にする
                </label>

                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 6 }}>
                  {editingTodoId && (
                    <button
                      onClick={() => deleteTodoWithUndo(editingTodoId)}
                      style={{ padding: "8px 12px", background: "#ffe5e5" }}
                    >
                      削除（Undoあり）
                    </button>
                  )}
                  <button onClick={saveTodoModal} style={{ padding: "8px 12px" }}>
                    保存
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 共有ノート モーダル */}
        {notesOpen && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.35)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 16,
              zIndex: 99999,
            }}
            onClick={closeNotes}
          >
            <div
              style={{
                width: "min(1100px, 100%)",
                height: "min(720px, 92vh)",
                background: "#fff",
                borderRadius: 12,
                boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
                overflow: "hidden",
                display: "grid",
                gridTemplateColumns: "320px 1fr",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* 左：ノート一覧 */}
              <div style={{ borderRight: "1px solid #eee", padding: 12, overflow: "auto" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                  <div style={{ fontWeight: 900 }}>共有ノート</div>
                  <button onClick={closeNotes} style={{ padding: "6px 10px" }}>
                    ✕
                  </button>
                </div>

                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <button onClick={startNewNote} style={{ padding: "8px 10px", fontWeight: 800 }}>
                    ＋ 新規
                  </button>
                  <button onClick={loadNotes} style={{ padding: "8px 10px" }}>
                    再読込
                  </button>
                </div>

                <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
                  {notes.length === 0 ? (
                    <div style={{ opacity: 0.6, fontSize: 13 }}>まだノートがありません</div>
                  ) : (
                    notes.map((n) => (
                      <div
                        key={n.id}
                        style={{
                          border: "1px solid #eee",
                          borderRadius: 10,
                          padding: 10,
                          cursor: "pointer",
                          background: n.id === noteEditingId ? "#f3f4f6" : "#fff",
                        }}
                        onClick={() => startEditNote(n)}
                      >
                        <div style={{ fontWeight: 900, marginBottom: 4, wordBreak: "break-word" }}>
                          {n.title}
                        </div>
                        <div style={{ fontSize: 12, opacity: 0.7, wordBreak: "break-word" }}>
                          {(n.content ?? "").slice(0, 60)}
                          {(n.content ?? "").length > 60 ? "…" : ""}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* 右：編集 */}
              <div style={{ padding: 12, display: "grid", gridTemplateRows: "auto 1fr auto", gap: 10 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <div style={{ fontWeight: 800 }}>タイトル</div>
                  <input
                    value={noteTitle}
                    onChange={(e) => setNoteTitle(e.target.value)}
                    style={{ flex: 1, padding: 8 }}
                    placeholder="例：配信手順 / ログイン情報 / 連絡先…"
                  />
                </div>

                <textarea
                  value={noteContent}
                  onChange={(e) => setNoteContent(e.target.value)}
                  style={{ width: "100%", height: "100%", padding: 10, resize: "none" }}
                  placeholder="ここに長文メモOK"
                />

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>
                    {noteEditingId ? `編集ID: ${noteEditingId.slice(0, 8)}…` : "新規作成"}
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    {noteEditingId && (
                      <button
                        onClick={() => deleteNote(noteEditingId)}
                        style={{ padding: "10px 12px", background: "#ffe5e5" }}
                      >
                        削除
                      </button>
                    )}
                    <button onClick={saveNote} disabled={notesSaving} style={{ padding: "10px 12px", fontWeight: 900 }}>
                      {notesSaving ? "保存中…" : "保存"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Undoバー */}
        {undo && (
          <div
            style={{
              position: "fixed",
              left: 12,
              bottom: 12,
              zIndex: 99999,
              background: "#111827",
              color: "#fff",
              padding: "10px 12px",
              borderRadius: 12,
              display: "flex",
              gap: 10,
              alignItems: "center",
              boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
            }}
          >
            <div style={{ fontSize: 13, opacity: 0.95 }}>削除しました（5秒以内なら戻せます）</div>
            <button
              onClick={undoDelete}
              style={{
                padding: "6px 10px",
                borderRadius: 10,
                background: "#fff",
                color: "#111827",
                fontWeight: 800,
              }}
            >
              Undo
            </button>
          </div>
        )}
      </main>
    </div>
  );
}