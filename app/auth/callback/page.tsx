"use client";

import { useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";

export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    // URLに含まれる認証情報をセッション化
    supabase.auth.getSession().finally(() => {
      router.replace("/calendar");
    });
  }, [router]);

  return <div style={{ padding: 16 }}>ログイン処理中...</div>;
}