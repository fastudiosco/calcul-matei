import { useEffect, useState, useCallback } from 'preact/hooks';
import { createContext } from 'preact';
import { sb, q } from './supabase.js';
import { Login } from './pages/login.jsx';
import { Prezentare } from './pages/prezentare.jsx';
import { Tranzactii } from './pages/tranzactii.jsx';
import { Intrebari } from './pages/intrebari.jsx';
import { Manual } from './pages/manual.jsx';
import { Nomenclatoare } from './pages/nomenclatoare.jsx';
import { Verificari } from './pages/verificari.jsx';
import { Raport } from './pages/raport.jsx';
import { Jurnal } from './pages/jurnal.jsx';
import { Import } from './pages/import.jsx';
import logoAlb from './assets/fastudios-light.svg';

export const Ctx = createContext(null);

// [cheie, titlu, pagină, principală]: cele principale sunt munca de zi cu zi, restul sunt unelte.
const PAGINI = [
  ['prezentare', 'Rezumat', Prezentare, true],
  ['tranzactii', 'Tranzacții', Tranzactii, true],
  ['intrebari', 'Întrebări', Intrebari, true],
  ['raport', 'Raport pentru Matei', Raport, true],
  ['manual', 'Sume manuale', Manual],
  ['nomenclatoare', 'Proiecte și costuri', Nomenclatoare],
  ['verificari', 'Verificări', Verificari],
  ['jurnal', 'Istoric', Jurnal],
  ['import', 'Import', Import],
];

// Rută din hash: #/tranzactii?luna=2026-03-01
function citesteRuta() {
  const h = location.hash.replace(/^#\/?/, '');
  const [p, qs] = h.split('?');
  return { pagina: p || 'prezentare', params: Object.fromEntries(new URLSearchParams(qs || '')) };
}

export function mergi(pagina, params = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null)).toString();
  location.hash = `#/${pagina}${qs ? '?' + qs : ''}`;
}

export function App() {
  const [sesiune, setSesiune] = useState(undefined);
  const [ruta, setRuta] = useState(citesteRuta());
  const [nom, setNom] = useState(null);
  const [eroare, setEroare] = useState('');
  const [recuperare, setRecuperare] = useState(false);

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setSesiune(data.session));
    const { data: sub } = sb.auth.onAuthStateChange((ev, s) => {
      setSesiune(s);
      if (ev === 'PASSWORD_RECOVERY') setRecuperare(true);
    });
    const f = () => setRuta(citesteRuta());
    window.addEventListener('hashchange', f);
    return () => { sub.subscription.unsubscribe(); window.removeEventListener('hashchange', f); };
  }, []);

  const incarcaNom = useCallback(async () => {
    try {
      const [conturi, categorii, clienti, colaboratori, costuri, membri] = await Promise.all([
        q(sb.from('conturi').select('*').order('id')),
        q(sb.from('categorii').select('*').order('ordine')),
        q(sb.from('clienti').select('*').order('nume')),
        q(sb.from('colaboratori').select('*').order('nume')),
        q(sb.from('costuri_recurente').select('*').order('id')),
        q(sb.from('membri').select('*')),
      ]);
      setNom({ conturi, categorii, clienti, colaboratori, costuri, membri });
      setEroare('');
    } catch (e) { setEroare(e.message); }
  }, []);

  useEffect(() => { if (sesiune) incarcaNom(); }, [sesiune, incarcaNom]);

  if (sesiune === undefined) return <div class="centru">Se încarcă…</div>;
  if (!sesiune) return <Login />;
  if (recuperare) return <ParolaNoua gata={() => setRecuperare(false)} />;
  if (eroare) return <div class="centru"><p class="eroare">{eroare}</p></div>;
  if (!nom) return <div class="centru">Se încarcă…</div>;
  if (!nom.membri.length) {
    return (
      <div class="centru">
        <p>Contul <b>{sesiune.user.email}</b> nu are acces la acest calcul.</p>
        <button onClick={() => sb.auth.signOut()}>Ieșire</button>
      </div>
    );
  }

  const Pagina = (PAGINI.find((p) => p[0] === ruta.pagina) || PAGINI[0])[2];
  const email = sesiune.user.email;
  return (
    <Ctx.Provider value={{ nom, reincarcaNom: incarcaNom, email }}>
      <header class="sus">
        <a class="marca" href="#/prezentare"><img src={logoAlb} alt="FA Studios" /><span>Calcul Matei</span></a>
        <nav>
          {PAGINI.filter((p) => p[3]).map(([k, t]) => <a href={`#/${k}`} class={ruta.pagina === k ? 'activ' : ''}>{t}</a>)}
          <i class="sep" />
          {PAGINI.filter((p) => !p[3]).map(([k, t]) => <a href={`#/${k}`} class={`secundar ${ruta.pagina === k ? 'activ' : ''}`}>{t}</a>)}
        </nav>
        <span class="user"><span>{email}</span> <button class="mic" onClick={() => sb.auth.signOut()}>Ieșire</button></span>
      </header>
      <main><Pagina params={ruta.params} key={ruta.pagina} /></main>
    </Ctx.Provider>
  );
}

function ParolaNoua({ gata }) {
  const [p, setP] = useState('');
  const [mesaj, setMesaj] = useState('');
  async function salveaza(e) {
    e.preventDefault();
    const { error } = await sb.auth.updateUser({ password: p });
    if (error) setMesaj(error.message); else gata();
  }
  return (
    <div class="login">
      <form onSubmit={salveaza}>
        <h1>Parolă nouă</h1>
        <label>Parola nouă<input type="password" minLength={10} required value={p} onInput={(e) => setP(e.target.value)} autocomplete="new-password" /></label>
        <button>Salvează</button>
        {mesaj && <p class="mesaj">{mesaj}</p>}
      </form>
    </div>
  );
}
