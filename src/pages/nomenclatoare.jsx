import { useContext, useEffect, useState } from 'preact/hooks';
import { sb, q } from '../supabase.js';
import { Ctx } from '../app.jsx';
import { bani, luna, LUNI, IMPARTIRI, citesteSuma, citesteProcent } from '../format.js';

// Valori din tabel: sume și procente citite strict; ce nu e număr rămâne neschimbat.
const num = (x) => { const v = citesteSuma(x); return v === undefined ? NaN : v; };
const procent = (x) => (String(x ?? '').trim() === '' ? null : citesteProcent(x) ?? NaN);

export function Nomenclatoare() {
  return (
    <div>
      <h1 class="titlu">Proiecte și costuri</h1>
      <p class="intro">Clienții și procentul lui Matei pe fiecare proiect, costurile recurente, colaboratorii și categoriile.</p>
      <Simplu tabel="clienti" titlu="Clienți și proiecte" campuri={[['nume', 'Nume'], ['procent_matei', '% Matei', null, procent], ['cui', 'CUI'], ['tip', 'Tip', ['necunoscut', 'retainer', 'one_time', 'mixt']],
        ['activitate', 'Al cui', ['necunoscut', 'alex', 'matei', 'comun']], ['nota', 'Notă']]}
        nota="„% Matei” e partea lui Matei din profitul proiectului. Se propune pe liniile legate de client, dar fiecare linie se confirmă separat. Gol = încă nestabilit." />
      <Costuri />
      <Alocari />
      <Simplu tabel="colaboratori" titlu="Colaboratori" campuri={[['nume', 'Nume'], ['nota', 'Notă']]} />
      <Simplu tabel="categorii" titlu="Categorii" cheie="cod" campuri={[['cod', 'Cod'], ['eticheta', 'Etichetă'], ['ordine', 'Ordine']]} />
    </div>
  );
}

function Costuri() {
  const { nom, reincarcaNom } = useContext(Ctx);
  const [mesaj, setMesaj] = useState('');
  const [nou, setNou] = useState({ nume: '', suma: '', moneda: 'RON', zi_luna: '', impartire: 'necunoscut' });

  async function salveaza(c, upd) {
    if (Object.values(upd).some((x) => Number.isNaN(x))) { setMesaj('Valoarea nu e un număr.'); return; }
    try { await q(sb.from('costuri_recurente').update(upd).eq('id', c.id)); reincarcaNom(); setMesaj(''); }
    catch (e) { setMesaj(e.message); }
  }
  async function adauga(e) {
    e.preventDefault();
    try {
      await q(sb.from('costuri_recurente').insert({ ...nou, suma: num(nou.suma), zi_luna: num(nou.zi_luna) }));
      setNou({ nume: '', suma: '', moneda: 'RON', zi_luna: '', impartire: 'necunoscut' }); reincarcaNom();
    } catch (er) { setMesaj(er.message); }
  }

  return (
    <section class="card">
      <h3>Costuri recurente</h3>
      <p class="mic gri">Doar costurile bifate „confirmat” intră în verificarea numărului de plăți pe lună (ex. mașina lui Matei: 2 facturi pe lună, RCI Broker și RCI Leasing). Plățile reale se leagă de cost din panoul fiecărei tranzacții.</p>
      {mesaj && <p class="eroare">{mesaj}</p>}
      <div class="tabel-lat">
      <table class="tabel">
        <thead><tr><th>Nume</th><th class="n">Sumă</th><th>Zi</th><th>Plăți/lună</th><th>Împărțire</th><th>%M</th><th>Cont</th><th>Prima lună</th><th>Ultima lună</th><th>Notă</th><th>Confirmat</th></tr></thead>
        <tbody>{nom.costuri.map((c) => (
          <tr>
            <td><input value={c.nume} onChange={(e) => salveaza(c, { nume: e.target.value })} /></td>
            <td class="n nowrap"><input class="scurt" value={c.suma} onChange={(e) => salveaza(c, { suma: num(e.target.value) })} /> {c.moneda}</td>
            <td><input class="scurt" value={c.zi_luna ?? ''} onChange={(e) => salveaza(c, { zi_luna: num(e.target.value) })} /></td>
            <td><input class="scurt" value={c.plati_pe_luna} onChange={(e) => salveaza(c, { plati_pe_luna: num(e.target.value) })} /></td>
            <td><select value={c.impartire} onChange={(e) => salveaza(c, { impartire: e.target.value })}>
              <option value="necunoscut">Necunoscut</option>
              {Object.entries(IMPARTIRI).map(([k, v]) => <option value={k}>{v}</option>)}
            </select></td>
            <td><input class="scurt" value={c.procent_matei ?? ''} onChange={(e) => salveaza(c, { procent_matei: procent(e.target.value) })} /></td>
            <td><select value={c.cont_id ?? ''} onChange={(e) => salveaza(c, { cont_id: num(e.target.value) })}>
              <option value="">—</option>
              {nom.conturi.map((x) => <option value={x.id}>{x.cod}</option>)}
            </select></td>
            <td><select value={c.prima_luna ?? ''} onChange={(e) => salveaza(c, { prima_luna: e.target.value || null })}>
              <option value="">—</option>{LUNI.map((l) => <option value={l}>{luna(l)}</option>)}
            </select></td>
            <td><select value={c.ultima_luna ?? ''} onChange={(e) => salveaza(c, { ultima_luna: e.target.value || null })}>
              <option value="">—</option>{LUNI.map((l) => <option value={l}>{luna(l)}</option>)}
            </select></td>
            <td><textarea rows="2" value={c.nota ?? ''} onChange={(e) => salveaza(c, { nota: e.target.value })} /></td>
            <td><input type="checkbox" checked={c.confirmat} onChange={(e) => salveaza(c, { confirmat: e.target.checked })} /></td>
          </tr>
        ))}</tbody>
      </table>
      </div>
      <form class="rand-form" onSubmit={adauga}>
        <input required placeholder="Nume cost nou" value={nou.nume} onInput={(e) => setNou({ ...nou, nume: e.target.value })} />
        <input required placeholder="Sumă" value={nou.suma} onInput={(e) => setNou({ ...nou, suma: e.target.value })} />
        <select value={nou.moneda} onChange={(e) => setNou({ ...nou, moneda: e.target.value })}>{['RON', 'EUR', 'USD'].map((m) => <option>{m}</option>)}</select>
        <input placeholder="Zi" value={nou.zi_luna} onInput={(e) => setNou({ ...nou, zi_luna: e.target.value })} />
        <button>Adaugă</button>
      </form>
    </section>
  );
}

function Alocari() {
  const { nom } = useContext(Ctx);
  const [l, setL] = useState(LUNI[0]);
  const [lista, setLista] = useState([]);
  const [plati, setPlati] = useState([]);
  const [f, setF] = useState({ colaborator_id: '', sursa_tip: 'matei', client_id: '', procent: '' });
  const [mesaj, setMesaj] = useState('');

  async function incarca() {
    try {
      setLista(await q(sb.from('alocari').select('*').eq('luna', l).order('colaborator_id')));
      setPlati(await q(sb.from('v_tranzactii').select('colaborator_id, suma_ron, suma, moneda').eq('luna', l).not('colaborator_id', 'is', null)));
    } catch (e) { setMesaj(e.message); }
  }
  useEffect(() => { incarca(); }, [l]);

  async function adauga(e) {
    e.preventDefault(); setMesaj('');
    const p = procent(f.procent);
    if (p === null || Number.isNaN(p)) { setMesaj('Procentul trebuie să fie între 0 și 100.'); return; }
    try {
      await q(sb.from('alocari').insert({ luna: l, colaborator_id: Number(f.colaborator_id), sursa_tip: f.sursa_tip,
        client_id: f.sursa_tip === 'client' ? Number(f.client_id) : null, procent: p }));
      setF({ ...f, procent: '' }); incarca();
    } catch (er) { setMesaj(er.message); }
  }
  async function upd(id, x) { try { await q(sb.from('alocari').update(x).eq('id', id)); incarca(); } catch (e) { setMesaj(e.message); } }
  async function sterge(id) { try { await q(sb.from('alocari').delete().eq('id', id)); incarca(); } catch (e) { setMesaj(e.message); } }

  const platit = (cid) => plati.filter((p) => p.colaborator_id === cid).reduce((a, p) => a + Math.round((p.suma_ron ?? 0) * 100), 0) / 100;
  const sursa = (a) => a.sursa_tip === 'client' ? nom.clienti.find((c) => c.id === a.client_id)?.nume : { alex: 'Activitatea lui Alex', matei: 'Activitatea lui Matei', comun: 'Comun' }[a.sursa_tip];

  return (
    <section class="card">
      <h3>Alocarea colaboratorilor pe lună</h3>
      <p class="mic gri">Din ce bani a fost acoperit fiecare colaborator în luna respectivă. Suma pe colaborator trebuie să fie 100%. Procentul rezultat pentru Matei se aplică apoi plăților colaboratorului din luna aceea (împărțire „Procent Matei”).</p>
      <select value={l} onChange={(e) => setL(e.target.value)}>{LUNI.map((x) => <option value={x}>{luna(x)}</option>)}</select>
      {mesaj && <p class="eroare">{mesaj}</p>}
      <table class="tabel">
        <thead><tr><th>Colaborator</th><th class="n">Plătit în lună (RON)</th><th>Acoperit din</th><th class="n">%</th><th>Stare</th><th></th></tr></thead>
        <tbody>{lista.map((a) => (
          <tr>
            <td>{nom.colaboratori.find((c) => c.id === a.colaborator_id)?.nume}</td>
            <td class="n">{bani(platit(a.colaborator_id))}</td>
            <td>{sursa(a)}</td><td class="n">{a.procent}</td>
            <td><select value={a.stare} onChange={(e) => upd(a.id, { stare: e.target.value })}><option value="propus">Propus</option><option value="confirmat">Confirmat</option></select></td>
            <td><button class="mic" onClick={() => sterge(a.id)}>Șterge</button></td>
          </tr>
        ))}</tbody>
      </table>
      <form class="rand-form" onSubmit={adauga}>
        <select required value={f.colaborator_id} onChange={(e) => setF({ ...f, colaborator_id: e.target.value })}>
          <option value="">Colaborator…</option>{nom.colaboratori.map((c) => <option value={c.id}>{c.nume}</option>)}
        </select>
        <select value={f.sursa_tip} onChange={(e) => setF({ ...f, sursa_tip: e.target.value })}>
          <option value="matei">Activitatea lui Matei</option><option value="alex">Activitatea lui Alex</option>
          <option value="comun">Comun</option><option value="client">Un client anume</option>
        </select>
        {f.sursa_tip === 'client' && <select required value={f.client_id} onChange={(e) => setF({ ...f, client_id: e.target.value })}>
          <option value="">Client…</option>{nom.clienti.map((c) => <option value={c.id}>{c.nume}</option>)}
        </select>}
        <input required placeholder="%" value={f.procent} onInput={(e) => setF({ ...f, procent: e.target.value })} />
        <button>Adaugă</button>
      </form>
    </section>
  );
}

function Simplu({ tabel, titlu, campuri, cheie = 'id', nota }) {
  const { reincarcaNom } = useContext(Ctx);
  const [lista, setLista] = useState([]);
  const [nou, setNou] = useState({});
  const [mesaj, setMesaj] = useState('');
  const incarca = async () => setLista(await q(sb.from(tabel).select('*').order(campuri[0][0])));
  useEffect(() => { incarca().catch((e) => setMesaj(e.message)); }, []);

  const valoare = (k, v) => { const c = campuri.find((x) => x[0] === k); return c?.[3] ? c[3](v) : v === '' ? null : v; };
  async function upd(r, k, v) {
    const x = valoare(k, v);
    if (Number.isNaN(x)) { setMesaj(`„${v}” nu e un procent între 0 și 100.`); return; }
    setMesaj('');
    try { await q(sb.from(tabel).update({ [k]: x }).eq(cheie, r[cheie])); incarca(); reincarcaNom(); }
    catch (e) { setMesaj(e.message); }
  }
  async function adauga(e) {
    e.preventDefault();
    const r = Object.fromEntries(Object.entries(nou).map(([k, v]) => [k, valoare(k, v)]));
    if (Object.values(r).some((x) => Number.isNaN(x))) { setMesaj('O valoare nu e validă.'); return; }
    try { await q(sb.from(tabel).insert(r)); setNou({}); incarca(); reincarcaNom(); }
    catch (er) { setMesaj(er.message); }
  }
  const camp = (r, [k, eticheta, opt], onCh) => opt
    ? <select value={r[k] ?? opt[0]} onChange={(e) => onCh(e.target.value)}>{opt.map((o) => <option>{o}</option>)}</select>
    : <input class={k === 'procent_matei' ? 'scurt' : ''} placeholder={eticheta} value={r[k] === null || r[k] === undefined ? '' : String(r[k]).replace('.', ',')} onChange={(e) => onCh(e.target.value)} />;

  return (
    <section class="card">
      <h3>{titlu}</h3>
      {nota && <p class="mic gri" style={{ margin: 0 }}>{nota}</p>}
      {mesaj && <p class="eroare">{mesaj}</p>}
      <table class="tabel">
        <thead><tr>{campuri.map((c) => <th>{c[1]}</th>)}</tr></thead>
        <tbody>{lista.map((r) => <tr>{campuri.map((c) => <td>{c[0] === cheie && cheie !== 'id' ? r[c[0]] : camp(r, c, (v) => upd(r, c[0], v))}</td>)}</tr>)}</tbody>
      </table>
      <form class="rand-form" onSubmit={adauga}>
        {campuri.map((c) => camp(nou, c, (v) => setNou({ ...nou, [c[0]]: v })))}
        <button>Adaugă</button>
      </form>
    </section>
  );
}
