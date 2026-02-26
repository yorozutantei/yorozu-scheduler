"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

type Member = {
  id: number;
  name: string;
  color: string | null;
};

type TodoRow = {
  id: number;
  title: string;
  detail: string | null;
  assignee: string;
  status: "todo" | "doing" | "done";
  due_date: string | null; // date
  done_at: string | null;
  created_at: string;
};

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function statusLabel(s: TodoRow["status"]) {
  if (s === "todo") return "TODO";
  if (s === "doing") return "DOING";
  return "DONE";
}

function nextStatus(s: TodoRow["status"]): TodoRow["status"] {
  if (s === "todo") return "doing";
  if (s === "doing") return "done";
  return "todo";
}

export default function TodoPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [todos, setTodos] = useState<TodoRow[]>([]);

  // 追加フォーム
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [assignee, setAssignee] = useState("");
  const [dueDate, setDueDate] = useState<string>("");

  const memberNames = useMemo(() => members.map((m) => m.name), [members]);
  const memberMap = useMemo(() => new Map(members.map((m) => [m.name, m])), [members]);

  const todoList = useMemo(() => todos.filter((t) => t.status !== "done"), [todos]);
  const doneList = useMemo(() => todos.filter((t) => t.status === "done"), [todos]);

  useEffect(() => {
    async function fetchAll() {
      // members
      const { data: mData, error: mErr } = await supabase
        .from("members")
        .select("*")
        .order("id", { ascending: true });

      if (mErr) console.error("members取得エラー:", mErr);
      const mlist = (mData ?? []) as Member[];
      setMembers(mlist);

      // assignee 初期値
      if (!assignee && mlist.length > 0) setAssignee(mlist[0].name);

      // todos
      const { data: tData, error: tErr } = await supabase
        .from("todos")
        .select("*")
        .order("status", { ascending: true })
        .order("due_date", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false });

      if (tErr) console.error("todos取得エラー:", tErr);
      setTodos((tData ?? []) as TodoRow[]);
    }

    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addTodo() {
    const t = title.trim();
    if (!t) {
      alert("タイトルは必須です");
      return;
    }

    const payload = {
      title: t,
      detail: detail.trim() ? detail.trim() : null,
      assignee: assignee || "未設定",
      status: "todo" as const,
      due_date: dueDate ? dueDate : null, // "YYYY-MM-DD"
    };

    const { data, error } = await supabase
      .from("todos")
      .insert([payload])
      .select("*")
      .single();

    if (error) {
      console.error("insert失敗:", error);
      alert("ToDoの追加に失敗しました（Consoleを確認）");
      return;
    }

    setTodos((prev) => [data as TodoRow, ...prev]);
    setTitle("");
    setDetail("");
    setDueDate("");
  }

  async function toggleStatus(todo: TodoRow) {
    const newStatus = nextStatus(todo.status);

    // done_at は done の時だけ入れる
    const patch: Partial<TodoRow> = {
      status: newStatus,
      done_at: newStatus === "done" ? new Date().toISOString() : null,
    };

    // 先にUI反映（軽快）
    setTodos((prev) => prev.map((t) => (t.id === todo.id ? { ...t, ...(patch as any) } : t)));

    const { data, error } = await supabase
      .from("todos")
      .update(patch)
      .eq("id", todo.id)
      .select("*")
      .maybeSingle();

    if (error) {
      console.error("update失敗:", error);
      alert("更新に失敗しました（Consoleを確認）");
      location.reload(); // 最小復旧
      return;
    }
    if (!data) {
      alert("更新0件でした（RLS/ID不一致の可能性）");
      location.reload();
      return;
    }

    // DBの値で確定（念のため）
    setTodos((prev) => prev.map((t) => (t.id === todo.id ? (data as TodoRow) : t)));
  }

  async function editTodo(todo: TodoRow) {
    const newTitle = window.prompt("タイトル", todo.title);
    if (newTitle === null) return;

    const newDetail = window.prompt("詳細（空でもOK）", todo.detail ?? "");
    if (newDetail === null) return;

    const newAssignee = window.prompt("担当（メンバー名）", todo.assignee);
    if (newAssignee === null) return;

    const newDue = window.prompt("期限（YYYY-MM-DD / 空でなし）", todo.due_date ?? "");
    if (newDue === null) return;

    const patch = {
      title: newTitle.trim() || todo.title,
      detail: newDetail.trim() ? newDetail.trim() : null,
      assignee: newAssignee.trim() || "未設定",
      due_date: newDue.trim() ? newDue.trim() : null,
    };

    // UI先更新
    setTodos((prev) => prev.map((t) => (t.id === todo.id ? { ...t, ...patch } as any : t)));

    const { data, error } = await supabase
      .from("todos")
      .update(patch)
      .eq("id", todo.id)
      .select("*")
      .maybeSingle();

    if (error) {
      console.error("update失敗:", error);
      alert("編集に失敗しました（Consoleを確認）");
      location.reload();
      return;
    }
    if (!data) {
      alert("編集0件でした（RLS/ID不一致の可能性）");
      location.reload();
      return;
    }

    setTodos((prev) => prev.map((t) => (t.id === todo.id ? (data as TodoRow) : t)));
  }

  async function deleteTodo(id: number) {
    const ok = window.confirm("このToDoを削除しますか？");
    if (!ok) return;

    // UI先
    const backup = todos;
    setTodos((prev) => prev.filter((t) => t.id !== id));

    const { error } = await supabase.from("todos").delete().eq("id", id);
    if (error) {
      console.error("delete失敗:", error);
      alert("削除に失敗しました（Consoleを確認）");
      setTodos(backup);
      return;
    }
  }

  function AssigneeBadge({ name }: { name: string }) {
    const m = memberMap.get(name);
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "2px 8px",
          borderRadius: 999,
          background: "rgba(0,0,0,0.06)",
          fontSize: 12,
        }}
      >
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: 999,
            background: m?.color || "#999",
            display: "inline-block",
          }}
        />
        {name}
      </span>
    );
  }

  return (
    <div style={{ padding: 14, maxWidth: 980, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>ToDo</h1>
        <div style={{ opacity: 0.7, fontSize: 12 }}>todo→doing→done をクリックで回せます</div>
      </div>

      {/* 追加フォーム */}
      <div
        style={{
          marginTop: 12,
          padding: 12,
          borderRadius: 12,
          background: "rgba(0,0,0,0.03)",
          display: "grid",
          gap: 10,
        }}
      >
        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ fontWeight: 700 }}>タイトル</div>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例：ショート7本編集 / サムネ作成 / 配信告知"
            style={{ padding: 10, borderRadius: 10, border: "1px solid rgba(0,0,0,0.15)" }}
          />
        </div>

        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ fontWeight: 700 }}>詳細（任意）</div>
          <textarea
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            placeholder="補足、手順、リンクなど"
            style={{ padding: 10, borderRadius: 10, border: "1px solid rgba(0,0,0,0.15)", minHeight: 70 }}
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ fontWeight: 700 }}>担当</div>
            <select
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              style={{ padding: 10, borderRadius: 10, border: "1px solid rgba(0,0,0,0.15)" }}
            >
              {memberNames.length === 0 && <option value="未設定">未設定</option>}
              {memberNames.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ fontWeight: 700 }}>期限（任意）</div>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              style={{ padding: 10, borderRadius: 10, border: "1px solid rgba(0,0,0,0.15)" }}
            />
          </div>

          <div style={{ display: "grid", gap: 6, alignContent: "end" }}>
            <button
              onClick={addTodo}
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid rgba(0,0,0,0.2)",
                cursor: "pointer",
                fontWeight: 800,
              }}
            >
              追加
            </button>
          </div>
        </div>
      </div>

      {/* 未完了 */}
      <h2 style={{ marginTop: 18, fontSize: 16 }}>やるべきこと（{todoList.length}）</h2>
      <div style={{ display: "grid", gap: 10 }}>
        {todoList.length === 0 && <div style={{ opacity: 0.7 }}>未完了ToDoはありません</div>}
        {todoList.map((t) => (
          <div
            key={t.id}
            style={{
              padding: 12,
              borderRadius: 12,
              border: "1px solid rgba(0,0,0,0.12)",
              display: "grid",
              gap: 8,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div style={{ fontWeight: 800, fontSize: 15 }}>{t.title}</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <AssigneeBadge name={t.assignee} />
                {t.due_date && (
                  <span style={{ fontSize: 12, opacity: 0.75 }}>期限：{t.due_date}</span>
                )}
              </div>
            </div>

            {t.detail && <div style={{ whiteSpace: "pre-wrap", opacity: 0.9 }}>{t.detail}</div>}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                onClick={() => toggleStatus(t)}
                style={{
                  padding: "8px 10px",
                  borderRadius: 10,
                  border: "1px solid rgba(0,0,0,0.2)",
                  cursor: "pointer",
                  fontWeight: 800,
                }}
                title="クリックで todo→doing→done"
              >
                {statusLabel(t.status)}
              </button>
              <button
                onClick={() => editTodo(t)}
                style={{
                  padding: "8px 10px",
                  borderRadius: 10,
                  border: "1px solid rgba(0,0,0,0.2)",
                  cursor: "pointer",
                }}
              >
                編集
              </button>
              <button
                onClick={() => deleteTodo(t.id)}
                style={{
                  padding: "8px 10px",
                  borderRadius: 10,
                  border: "1px solid rgba(0,0,0,0.2)",
                  cursor: "pointer",
                }}
              >
                削除
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* 完了 */}
      <h2 style={{ marginTop: 18, fontSize: 16 }}>できたこと（{doneList.length}）</h2>
      <div style={{ display: "grid", gap: 10 }}>
        {doneList.length === 0 && <div style={{ opacity: 0.7 }}>完了一覧はまだありません</div>}
        {doneList.map((t) => (
          <div
            key={t.id}
            style={{
              padding: 12,
              borderRadius: 12,
              border: "1px solid rgba(0,0,0,0.12)",
              opacity: 0.85,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
              <div style={{ fontWeight: 800 }}>{t.title}</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <AssigneeBadge name={t.assignee} />
                {t.done_at && <span style={{ fontSize: 12, opacity: 0.75 }}>完了：{new Date(t.done_at).toLocaleString("ja-JP")}</span>}
              </div>
            </div>

            {t.detail && <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{t.detail}</div>}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
              <button
                onClick={() => toggleStatus(t)}
                style={{
                  padding: "8px 10px",
                  borderRadius: 10,
                  border: "1px solid rgba(0,0,0,0.2)",
                  cursor: "pointer",
                  fontWeight: 800,
                }}
                title="クリックで done→todo に戻せます"
              >
                {statusLabel(t.status)}
              </button>
              <button
                onClick={() => editTodo(t)}
                style={{
                  padding: "8px 10px",
                  borderRadius: 10,
                  border: "1px solid rgba(0,0,0,0.2)",
                  cursor: "pointer",
                }}
              >
                編集
              </button>
              <button
                onClick={() => deleteTodo(t.id)}
                style={{
                  padding: "8px 10px",
                  borderRadius: 10,
                  border: "1px solid rgba(0,0,0,0.2)",
                  cursor: "pointer",
                }}
              >
                削除
              </button>
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 18, opacity: 0.65, fontSize: 12 }}>
        使いながら欲しくなったら：担当の複数人対応 / ラベル（配信・編集など）/ 完了の週次まとめ も追加できます。
      </div>
    </div>
  );
}