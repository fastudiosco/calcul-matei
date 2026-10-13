import { useState } from 'preact/hooks';
import { sb } from '../supabase.js';

export function Login() {
  const [email, setEmail] = useState('');
  const [parola, setParola] = useState('');
  const [mesaj, setMesaj] = useState('');
  const [lucru, setLucru] = useState(false);

  async function intra(e) {
    e.preventDefault();
    setLucru(true); setMesaj('');
    const { error } = await sb.auth.signInWithPassword({ email, password: parola });
    setLucru(false);
    if (error) setMesaj(error.message === 'Invalid login credentials' ? 'Email sau parolă greșită.' : error.message);
  }

  async function resetare() {
    if (!email) { setMesaj('Scrie emailul mai întâi.'); return; }
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    setMesaj(error ? error.message : 'Ți-am trimis pe email un link pentru parolă nouă.');
  }

  return (
    <div class="login">
      <form onSubmit={intra}>
        <h1>Calcul Matei</h1>
        <label>Email<input type="email" value={email} onInput={(e) => setEmail(e.target.value)} required autocomplete="username" /></label>
        <label>Parolă<input type="password" value={parola} onInput={(e) => setParola(e.target.value)} required autocomplete="current-password" /></label>
        <button type="submit" disabled={lucru}>{lucru ? 'Se verifică…' : 'Intră'}</button>
        <button type="button" class="link" onClick={resetare}>Am uitat parola</button>
        {mesaj && <p class="mesaj">{mesaj}</p>}
      </form>
    </div>
  );
}
