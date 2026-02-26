"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

type Row = {
  id: number;
  name: string | null;
  created_at: string;
};

export default function Home() {
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState<string>("");

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("test")
        .select("id,name,created_at")
        .order("id", { ascending: true });

      if (error) {
        console.log("error:", error);
        setErr(error.message);
        return;
      }

      console.log("data:", data);
      setRows((data ?? []) as Row[]);
    })();
  }, []);

  return (
    <main style={{ padding: 40 }}>
      <h1>Supabase 接続テスト</h1>

      {err ? (
        <p style={{ color: "crimson" }}>エラー: {err}</p>
      ) : (
        <p>OK（Consoleにも data が出ます）</p>
      )}

      <ul>
        {rows.map((r) => (
          <li key={r.id}>
            #{r.id} / {r.name ?? "(null)"} / {r.created_at}
          </li>
        ))}
      </ul>
    </main>
  );
}