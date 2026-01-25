// File: src/app/page.tsx
import { redirect } from "next/navigation";
import { supabaseServer } from "../lib/supabase/server";

export default async function HomePage() {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();

  if (data.user) redirect("/admin");
  redirect("/login");
}
