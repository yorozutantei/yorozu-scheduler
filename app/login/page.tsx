"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.replace("/calendar");
    });
  }, [router]);

  const signIn = async () => {
    setMsg("送信中...");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) setMsg("エラー: " + error.message);
    else setMsg("ログイン用メールを送りました。メールのリンクを開いてください。");
  };

  return (
    <div style={{ maxWidth: 420, margin: "40px auto", padding: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>ログイン</h1>
      <p>メールアドレスを入れて「送信」。届いたリンクを開くとログインできます。</p>

      <input
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="email@example.com"
        style={{ width: "100%", padding: 10, marginTop: 12 }}
      />

      <button
        onClick={signIn}
        style={{ width: "100%", padding: 12, marginTop: 12 }}
      >
        ログインメールを送る
      </button>

      {msg && <pre style={{ whiteSpace: "pre-wrap", marginTop: 12 }}>{msg}</pre>}
    </div>
  );
}