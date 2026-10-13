import { useEffect, useState } from 'preact/hooks';
import { sb, q } from '../supabase.js';
import { Istoric } from './editor.jsx';

export function Jurnal() {
  const [tabel, setTabel] = useState('');
  const [email, setEmail] = useState('');
  const [lista, setLista] = useState(null);
  const [eroare, setEroare] = useState('');

  useEffect(() => {
    (async () => {
      try {
        let x = sb.from('jurnal').select('*').order('la', { ascending: false }).limit(300);
        if (tabel) x = x.eq('tabel', tabel);
        if (email) x = x.eq('email', email);
        setLista(await q(x));
      } catch (e) { setEroare(e.message); }
    })();
  }, [tabel, email]);

  return (
    <div>
      <p class="explicatie">Fiecare modificare din baza de date, cu cine a făcut-o și când. Jurnalul e scris de baza de date, nu de aplicație, deci nu poate fi ocolit.</p>
      <div class="filtre">
        <select value={tabel} onChange={(e) => setTabel(e.target.value)}>
          <option value="">Toate tabelele</option>
          {['clasificari', 'tranzactii', 'intrebari', 'elemente_manuale', 'rambursari', 'alocari', 'costuri_recurente', 'luni', 'confirmari_luna', 'importuri', 'clienti', 'colaboratori', 'categorii', 'membri']
            .map((t) => <option>{t}</option>)}
        </select>
        <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      {eroare && <p class="eroare">{eroare}</p>}
      {!lista ? <p>Se încarcă…</p> : (
        <div>
          {lista.map((j) => (
            <div class="jurnal-rand">
              <span class="eticheta-stare">{j.tabel} #{j.rand_id}</span> <Istoric intrari={[j]} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
