import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

// Aruncă eroarea Supabase ca excepție, cu mesajul din baza de date (care e în română).
export async function q(promise) {
  const { data, error, count } = await promise;
  if (error) throw new Error(error.message || String(error));
  return count !== undefined && count !== null ? { data, count } : data;
}

// PostgREST întoarce maxim 1000 de rânduri; paginăm până terminăm.
export async function toate(build, pas = 1000) {
  const rez = [];
  for (let de = 0; ; de += pas) {
    const { data, error } = await build().range(de, de + pas - 1);
    if (error) throw new Error(error.message);
    rez.push(...data);
    if (data.length < pas) return rez;
  }
}
