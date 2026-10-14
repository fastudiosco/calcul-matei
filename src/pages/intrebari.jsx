import { useContext, useEffect, useState } from 'preact/hooks';
import { sb, q } from '../supabase.js';
import { Ctx, mergi } from '../app.jsx';
import { bani, data, dataOra, IMPARTIRI } from '../format.js';
import { numeMembru } from '../membri.js';

const SURSE = { data: 'Data tranzacției', whatsapp: 'WhatsApp', matei: 'Întrebat pe Matei', alex: 'Alex știe', document: 'Document / factură', altul: 'Altceva' };

// [cheie, titlu]: primele două sunt „inbox-ul” fiecăruia.
const FILE = [
  ['mine', 'Pentru mine'],
  ['raspunsuri', 'Răspunsuri primite'],
  ['deschisa', 'Toate deschise'],
  ['raspunsa', 'Cu răspuns'],
  ['rezolvata', 'Rezolvate'],
  ['', 'Toate'],
];

export function Intrebari({ params }) {
  const { email, nom } = useContext(Ctx);
  const eu = email.toLowerCase();
  const stare = params.stare ?? 'mine';
  const [lista, setLista] = useState(null);
  const [eroare, setEroare] = useState('');
  const [nou, setNou] = useState({ titlu: '', detalii: '' });

  async function incarca() {
    try {
      let x = sb.from('intrebari')
        .select('*, tranzactii(id, data_extras, suma, moneda, descriere, clasificari!clasificari_tranzactie_id_fkey(stare, categorie, impartire, procent_matei, procent_precis, nota))')
        .order('creat_la', { ascending: false });
      if (stare === 'mine') x = x.eq('stare', 'deschisa').or(`pentru.eq.${eu},pentru.is.null`);
      else if (stare === 'raspunsuri') x = x.eq('stare', 'raspunsa').eq('creat_de', eu);
      else if (stare) x = x.eq('stare', stare);
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

  const gol = {
    mine: 'Nimeni nu așteaptă un răspuns de la tine.',
    raspunsuri: 'Niciun răspuns nou la întrebările tale.',
  }[stare] || 'Nicio întrebare aici.';

  return (
    <div>
      <h1 class="titlu">Întrebări</h1>
      <p class="intro">
        Când nu știi ce e o linie, o clasifici cât poți și lași o întrebare din panoul liniei (sau pentru mai multe linii deodată, din selecția de pe pagina Tranzacții).
        Celălalt o vede aici, la „Pentru mine”, și răspunde când are timp. Când întrebarea e rezolvată, linia revine la „Propus”.
        Întrebările deschise opresc închiderea lunii lor.
      </p>
      <div class="file">
        {FILE.map(([k, t]) => (
          <button class={`mic ${stare === k ? 'activ' : ''}`} onClick={() => mergi('intrebari', { stare: k })}>{t}</button>
        ))}
      </div>
      {eroare && <p class="eroare">{eroare}</p>}
      {!lista ? <p>Se încarcă…</p> : lista.length === 0 ? <p class="gri">{gol}</p> : lista.map((i) => <Intrebare i={i} email={email} nom={nom} gata={incarca} />)}
      <form class="card" onSubmit={adauga} style={{ marginTop: '18px' }}>
        <b>Întrebare generală (fără o linie anume)</b>
        <input placeholder="Ex. Cum se împarte creditul BT de 1.000?" value={nou.titlu} onInput={(e) => setNou({ ...nou, titlu: e.target.value })} />
        <textarea rows="2" placeholder="Detalii" value={nou.detalii} onInput={(e) => setNou({ ...nou, detalii: e.target.value })} />
        <button>Adaugă</button>
      </form>
    </div>
  );
}

function Intrebare({ i, email, nom, gata }) {
  const [r, setR] = useState({ raspuns: i.raspuns || '', sursa_raspuns: i.sursa_raspuns || '' });
  const [mesaj, setMesaj] = useState('');
  const t = i.tranzactii;
  const c = t?.clasificari;
  const cat = c?.categorie ? nom.categorii.find((x) => x.cod === c.categorie)?.eticheta || c.categorie : null;
  const imp = c?.impartire === 'procent' ? `${Number(c.procent_precis ?? c.procent_matei).toLocaleString('ro-RO', { maximumFractionDigits: 2 })}% Matei` : IMPARTIRI[c?.impartire];

  async function salveaza(stare) {
    const upd = { raspuns: r.raspuns || null, sursa_raspuns: r.sursa_raspuns || null, stare };
    if (stare === 'rezolvata') { upd.rezolvat_de = email; upd.rezolvat_la = new Date().toISOString(); }
    if (stare === 'deschisa') { upd.rezolvat_de = null; upd.rezolvat_la = null; }
    if (stare === 'raspunsa' && !upd.raspuns) { setMesaj('Scrie răspunsul.'); return; }
    try { await q(sb.from('intrebari').update(upd).eq('id', i.id)); gata(); }
    catch (e) { setMesaj(e.message); }
  }

  return (
    <div class={`card intrebare ${i.stare}`}>
      <div>
        <b>{i.titlu}</b>{' '}
        <span class="gri mic">
          #{i.id} · {numeMembru(nom, i.creat_de)}{i.pentru ? ` → ${numeMembru(nom, i.pentru)}` : ''} · {dataOra(i.creat_la)}
        </span>
      </div>
      {i.detalii && <div>{i.detalii}</div>}
      {t && (
        <div class="mic">
          <a href={`#/tranzactii?id=${t.id}&luna=${t.data_extras.slice(0, 7)}-01`}>Deschide linia #{t.id}</a>
          {' '}· {data(t.data_extras)} · <b>{bani(t.suma, t.moneda)}</b> · <span class="gri">{t.descriere.slice(0, 140)}</span>
          <div class="clasificare gri">
            Clasificat până acum: {cat || 'fără categorie'} · {imp || 'fără împărțire'}
            {c?.nota && <> · 📝 {c.nota}</>}
          </div>
        </div>
      )}
      <div class="rand">
        <input placeholder="Răspuns" value={r.raspuns} onInput={(e) => setR({ ...r, raspuns: e.target.value })} />
        <select value={r.sursa_raspuns} onChange={(e) => setR({ ...r, sursa_raspuns: e.target.value })}>
          <option value="">Sursa răspunsului…</option>
          {Object.entries(SURSE).map(([k, v]) => <option value={k}>{v}</option>)}
        </select>
        <button class="mic" onClick={() => salveaza('raspunsa')} title="Cel care a întrebat citește răspunsul și actualizează linia">Trimite răspunsul</button>
        <button class="mic primar" onClick={() => salveaza('rezolvata')}>Rezolvată</button>
        {i.stare !== 'deschisa' && <button class="mic" onClick={() => salveaza('deschisa')}>Redeschide</button>}
      </div>
      {i.rezolvat_de && <div class="gri mic">Rezolvată de {numeMembru(nom, i.rezolvat_de)} la {dataOra(i.rezolvat_la)}</div>}
      {mesaj && <p class="eroare">{mesaj}</p>}
    </div>
  );
}
