import { useEffect, useState } from 'preact/hooks';
import { sb, q } from '../supabase.js';
import { Istoric } from './editor.jsx';

const PAS = 300;

export function Jurnal() {
  const [tabel, setTabel] = useState('');
  const [email, setEmail] = useState('');
  const [lista, setLista] = useState(null);
  const [total, setTotal] = useState(0);
  const [eroare, setEroare] = useState('');

  async function incarca(de) {
    try {
      let x = sb.from('jurnal').select('*', { count: 'exact' }).order('la', { ascending: false }).order('id', { ascending: false }).range(de, de + PAS - 1);
      if (tabel) x = x.eq('tabel', tabel);
      if (email) x = x.eq('email', email);
      const { data, count } = await q(x);
      setTotal(count ?? data.length);
      setLista(de === 0 ? data : [...lista, ...data]);
    } catch (e) { setEroare(e.message); }
  }
  useEffect(() => { setLista(null); incarca(0); }, [tabel, email]);

  return (
    <div>
      <h1 class="titlu">Istoric</h1>
      <p class="intro">Fiecare modificare din baza de date, cu cine a făcut-o și când. Istoricul e scris de baza de date, nu de aplicație, deci nu poate fi ocolit.</p>
      <div class="filtre">
        <select value={tabel} onChange={(e) => setTabel(e.target.value)}>
          <option value="">Toate tabelele</option>
          {['clasificari', 'tranzactii', 'intrebari', 'elemente_manuale', 'rambursari', 'alocari', 'costuri_recurente', 'luni', 'confirmari_luna', 'importuri', 'clienti', 'colaboratori', 'categorii', 'membri']
            .map((t) => <option>{t}</option>)}
        </select>
        <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      {eroare && <p class="eroare">{eroare}</p>}
      {!lista ? <p class="gri">Se încarcă…</p> : (
        <div>
          <p class="sumar">Ultimele {lista.length.toLocaleString('ro-RO')} din {total.toLocaleString('ro-RO')} modificări</p>
          {lista.map((j) => (
            <div class="jurnal-rand">
              <span class="eticheta-stare">{j.tabel} #{j.rand_id}</span> <Istoric intrari={[j]} />
            </div>
          ))}
          {lista.length < total && <p><button onClick={() => incarca(lista.length)}>Încă {Math.min(PAS, total - lista.length)}</button></p>}
        </div>
      )}
    </div>
  );
}
