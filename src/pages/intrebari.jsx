import { useContext, useEffect, useState } from 'preact/hooks';
import { sb, q } from '../supabase.js';
import { Ctx, mergi } from '../app.jsx';
import { bani, data, dataOra } from '../format.js';

const SURSE = { data: 'Data tranzacției', whatsapp: 'WhatsApp', matei: 'Întrebat pe Matei', alex: 'Alex știe', document: 'Document / factură', altul: 'Altceva' };

export function Intrebari({ params }) {
  const { email } = useContext(Ctx);
  const stare = params.stare ?? 'deschisa';
  const [lista, setLista] = useState(null);
  const [eroare, setEroare] = useState('');
  const [nou, setNou] = useState({ titlu: '', detalii: '' });

  async function incarca() {
    try {
      let x = sb.from('intrebari').select('*, tranzactii(id, data_extras, suma, moneda, descriere, cont_id)').order('creat_la', { ascending: false });
      if (stare) x = x.eq('stare', stare);
      setLista(await q(x));
    } catch (e) { setEroare(e.message); }
  }
  useEffect(() => { incarca(); }, [stare]);

  async function adauga(e) {
    e.preventDefault();
    if (!nou.titlu.trim()) return;
    try { await q(sb.from('intrebari').insert({ titlu: nou.titlu.trim(), detalii: nou.detalii || null })); setNou({ titlu: '', detalii: '' }); incarca(); }
    catch (er) { setEroare(er.message); }
  }

  return (
    <div>
      <div class="filtre">
        {[['deschisa', 'Deschise'], ['raspunsa', 'Cu răspuns'], ['rezolvata', 'Rezolvate'], ['', 'Toate']].map(([k, t]) => (
          <button class={stare === k ? 'primar mic' : 'mic'} onClick={() => mergi('intrebari', { stare: k })}>{t}</button>
        ))}
      </div>
      <form class="card" onSubmit={adauga}>
        <b>Întrebare generală (fără o linie anume)</b>
        <input placeholder="Ex. Cum se împarte creditul BT de 1.000?" value={nou.titlu} onInput={(e) => setNou({ ...nou, titlu: e.target.value })} />
        <textarea rows="2" placeholder="Detalii" value={nou.detalii} onInput={(e) => setNou({ ...nou, detalii: e.target.value })} />
        <button>Adaugă</button>
      </form>
      {eroare && <p class="eroare">{eroare}</p>}
      {!lista ? <p>Se încarcă…</p> : lista.length === 0 ? <p class="gri">Nicio întrebare aici.</p> : lista.map((i) => <Intrebare i={i} email={email} gata={incarca} />)}
    </div>
  );
}

function Intrebare({ i, email, gata }) {
  const [r, setR] = useState({ raspuns: i.raspuns || '', sursa_raspuns: i.sursa_raspuns || '' });
  const [mesaj, setMesaj] = useState('');
  const t = i.tranzactii;

  async function salveaza(stare) {
    const upd = { raspuns: r.raspuns || null, sursa_raspuns: r.sursa_raspuns || null, stare };
    if (stare === 'rezolvata') { upd.rezolvat_de = email; upd.rezolvat_la = new Date().toISOString(); }
    if (stare !== 'deschisa' && !upd.raspuns) { setMesaj('Scrie răspunsul.'); return; }
    try { await q(sb.from('intrebari').update(upd).eq('id', i.id)); gata(); }
    catch (e) { setMesaj(e.message); }
  }

  return (
    <div class={`card intrebare ${i.stare}`}>
      <div><b>{i.titlu}</b> <span class="gri mic">#{i.id} · {i.creat_de} · {dataOra(i.creat_la)}</span></div>
      {i.detalii && <div>{i.detalii}</div>}
      {t && (
        <div class="mic">
          <a href={`#/tranzactii?id=${t.id}&q=${encodeURIComponent(String(Math.abs(t.suma)))}`}>Linia #{t.id}</a>
          {' '}· {data(t.data_extras)} · <b>{bani(t.suma, t.moneda)}</b> · <span class="gri">{t.descriere.slice(0, 140)}</span>
        </div>
      )}
      <div class="rand">
        <input placeholder="Răspuns" value={r.raspuns} onInput={(e) => setR({ ...r, raspuns: e.target.value })} />
        <select value={r.sursa_raspuns} onChange={(e) => setR({ ...r, sursa_raspuns: e.target.value })}>
          <option value="">Sursa răspunsului…</option>
          {Object.entries(SURSE).map(([k, v]) => <option value={k}>{v}</option>)}
        </select>
        <button class="mic" onClick={() => salveaza('raspunsa')}>Salvează răspunsul</button>
        <button class="mic primar" onClick={() => salveaza('rezolvata')}>Rezolvată</button>
        {i.stare !== 'deschisa' && <button class="mic" onClick={() => salveaza('deschisa')}>Redeschide</button>}
      </div>
      {i.rezolvat_de && <div class="gri mic">Rezolvată de {i.rezolvat_de} la {dataOra(i.rezolvat_la)}</div>}
      {mesaj && <p class="eroare">{mesaj}</p>}
    </div>
  );
}
