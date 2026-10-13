import { useContext, useEffect, useState } from 'preact/hooks';
import { sb, q } from '../supabase.js';
import { Ctx } from '../app.jsx';
import { bani, data, luna, LUNI, citesteSuma, citesteCurs, rotunjeste } from '../format.js';

// Sumele se citesc strict: „3.000” înseamnă trei mii. Ce nu e număr oprește salvarea.
function citeste(f) {
  const suma = citesteSuma(f.suma);
  if (typeof suma !== 'number' || suma <= 0) return { eroare: 'Suma nu e un număr pozitiv (ex. 3.000 sau 1.234,56).' };
  if (f.moneda === 'RON') return { suma, curs: 1, suma_ron: suma };
  const curs = citesteCurs(f.curs);
  const ronScris = citesteSuma(f.suma_ron);
  if (curs === undefined) return { eroare: 'Cursul nu e un număr (ex. 5,2).' };
  if (ronScris === undefined) return { eroare: 'Suma în RON nu e un număr.' };
  const suma_ron = ronScris !== null ? Math.abs(ronScris) : curs ? rotunjeste(suma * curs) : null;
  if (curs && ronScris !== null && Math.abs(suma_ron - suma * curs) > Math.max(0.01, suma_ron * 0.005)) {
    return { eroare: `Suma în RON nu se potrivește cu cursul: ${bani(suma)} × ${curs} = ${bani(suma * curs)}.` };
  }
  return { suma, curs, suma_ron };
}

// Ce s-a înțeles din formular, arătat înainte de „Adaugă”.
function Citit({ f }) {
  if (!f.suma) return null;
  const r = citeste(f);
  if (r.eroare) return <span class="citit rau">{r.eroare}</span>;
  return <span class="citit">= {bani(r.suma, f.moneda)}{f.moneda !== 'RON' && r.suma_ron !== null ? ` = ${bani(r.suma_ron, 'RON')}` : ''}</span>;
}

function useLuniInchise() {
  const [inchise, setInchise] = useState(new Set());
  useEffect(() => {
    q(sb.from('luni').select('luna,status').eq('status', 'inchisa')).then((l) => setInchise(new Set(l.map((x) => x.luna)))).catch(() => {});
  }, []);
  return inchise;
}
const STARE = { propus: 'Propus', intrebare: 'Întrebare', confirmat: 'Confirmat' };

export function Manual() {
  return (
    <div>
      <h1 class="titlu">Sume manuale</h1>
      <p class="intro">
        Ce nu apare în extrasele încărcate: sume convenite (ex. 3.000 EUR pentru Beetle), bani dați înapoi de Matei
        și plăți făcute de Matei din conturile lui. Fiecare are nevoie de dovadă și de confirmare.
      </p>
      <Elemente />
      <Rambursari />
      <PlatiMatei />
    </div>
  );
}

function Elemente() {
  const [lista, setLista] = useState([]);
  const [f, setF] = useState({ luna: LUNI[0], data: '', descriere: '', suma: '', moneda: 'RON', curs: '', suma_ron: '', sens: 'matei_datoreaza_alex', dovada: '' });
  const [mesaj, setMesaj] = useState('');
  const inchise = useLuniInchise();
  const incarca = async () => setLista(await q(sb.from('elemente_manuale').select('*').order('luna').order('id')));
  useEffect(() => { incarca().catch((e) => setMesaj(e.message)); }, []);

  async function adauga(e) {
    e.preventDefault(); setMesaj('');
    const c = citeste(f);
    if (c.eroare) { setMesaj(c.eroare); return; }
    const r = { ...f, data: f.data || null, ...c, dovada: f.dovada || null };
    try { await q(sb.from('elemente_manuale').insert(r)); setF({ ...f, descriere: '', suma: '', curs: '', suma_ron: '', dovada: '' }); incarca(); }
    catch (er) { setMesaj(er.message); }
  }
  async function stare(id, s) { try { await q(sb.from('elemente_manuale').update({ stare: s }).eq('id', id)); incarca(); } catch (e) { setMesaj(e.message); } }
  async function sterge(id) { if (confirm('Ștergi elementul? Rămâne în jurnal.')) { try { await q(sb.from('elemente_manuale').delete().eq('id', id)); incarca(); } catch (e) { setMesaj(e.message); } } }

  return (
    <section class="card">
      <h3>Elemente manuale</h3>
      <form class="rand-form" onSubmit={adauga}>
        <select value={f.luna} onChange={(e) => setF({ ...f, luna: e.target.value })}>{LUNI.map((l) => <option value={l}>{luna(l)}</option>)}</select>
        <input type="date" value={f.data} onInput={(e) => setF({ ...f, data: e.target.value })} />
        <input class="lat" required placeholder="Descriere (ex. Beetle, 33.750 TH Media)" value={f.descriere} onInput={(e) => setF({ ...f, descriere: e.target.value })} />
        <input required placeholder="Sumă" value={f.suma} onInput={(e) => setF({ ...f, suma: e.target.value })} />
        <select value={f.moneda} onChange={(e) => setF({ ...f, moneda: e.target.value })}>{['RON', 'EUR', 'USD'].map((m) => <option>{m}</option>)}</select>
        {f.moneda !== 'RON' && <>
          <input class="scurt" placeholder="Curs" value={f.curs} onInput={(e) => setF({ ...f, curs: e.target.value })} />
          <input placeholder="RON (din curs)" value={f.suma_ron} onInput={(e) => setF({ ...f, suma_ron: e.target.value })} />
        </>}
        <select value={f.sens} onChange={(e) => setF({ ...f, sens: e.target.value })}>
          <option value="matei_datoreaza_alex">Matei datorează lui Alex</option>
          <option value="alex_datoreaza_matei">Alex datorează lui Matei</option>
        </select>
        <input placeholder="Dovadă" value={f.dovada} onInput={(e) => setF({ ...f, dovada: e.target.value })} />
        <button class="primar">Adaugă</button>
      </form>
      <Citit f={f} />
      {mesaj && <p class="eroare">{mesaj}</p>}
      <table class="tabel">
        <thead><tr><th>Luna</th><th>Descriere</th><th class="n">Sumă</th><th class="n">RON</th><th>Sens</th><th>Dovadă</th><th>Stare</th><th></th></tr></thead>
        <tbody>{lista.map((x) => (
          <tr>
            <td>{luna(x.luna)}{x.data && <div class="mic gri">{data(x.data)}</div>}</td>
            <td>{x.descriere}<div class="mic gri">{x.creat_de}</div></td>
            <td class="n">{bani(x.suma, x.moneda)}</td><td class="n">{bani(x.suma_ron)}</td>
            <td>{x.sens === 'matei_datoreaza_alex' ? 'Matei → Alex' : 'Alex → Matei'}</td>
            <td class="mic">{x.dovada}</td>
            <td><select disabled={inchise.has(x.luna)} value={x.stare} onChange={(e) => stare(x.id, e.target.value)}>{Object.entries(STARE).map(([k, v]) => <option value={k}>{v}</option>)}</select></td>
            <td>{inchise.has(x.luna) ? <span class="mic gri">lună închisă</span> : <button class="mic" onClick={() => sterge(x.id)}>Șterge</button>}</td>
          </tr>
        ))}</tbody>
      </table>
    </section>
  );
}

function Rambursari() {
  const [lista, setLista] = useState([]);
  const [f, setF] = useState({ data: '', suma: '', moneda: 'RON', curs: '', suma_ron: '', metoda: '', tranzactie_id: '', dovada: '' });
  const [mesaj, setMesaj] = useState('');
  const inchise = useLuniInchise();
  const incarca = async () => setLista(await q(sb.from('rambursari').select('*').order('data')));
  useEffect(() => { incarca().catch((e) => setMesaj(e.message)); }, []);

  async function adauga(e) {
    e.preventDefault(); setMesaj('');
    if (!f.data) { setMesaj('Alege data.'); return; }
    const c = citeste(f);
    if (c.eroare) { setMesaj(c.eroare); return; }
    if (f.tranzactie_id && !/^\d+$/.test(f.tranzactie_id.trim())) { setMesaj('ID-ul liniei din extras trebuie să fie un număr.'); return; }
    const r = { data: f.data, luna: f.data.slice(0, 7) + '-01', moneda: f.moneda, ...c,
      metoda: f.metoda || null, tranzactie_id: f.tranzactie_id ? Number(f.tranzactie_id) : null, dovada: f.dovada || null };
    try { await q(sb.from('rambursari').insert(r)); setF({ ...f, suma: '', curs: '', suma_ron: '', tranzactie_id: '', dovada: '' }); incarca(); }
    catch (er) { setMesaj(er.message); }
  }
  async function stare(id, s) { try { await q(sb.from('rambursari').update({ stare: s }).eq('id', id)); incarca(); } catch (e) { setMesaj(e.message); } }
  async function sterge(id) { if (confirm('Ștergi rambursarea? Rămâne în jurnal.')) { try { await q(sb.from('rambursari').delete().eq('id', id)); incarca(); } catch (e) { setMesaj(e.message); } } }

  return (
    <section class="card">
      <h3>Bani dați înapoi de Matei</h3>
      <p class="mic gri">Dacă banii apar într-un extras încărcat, completează ID-ul liniei: atunci suma se numără o singură dată, prin linia respectivă (clasificată „Bani primiți de la Matei”, 100% Matei).</p>
      <form class="rand-form" onSubmit={adauga}>
        <input type="date" required value={f.data} onInput={(e) => setF({ ...f, data: e.target.value })} />
        <input required placeholder="Sumă" value={f.suma} onInput={(e) => setF({ ...f, suma: e.target.value })} />
        <select value={f.moneda} onChange={(e) => setF({ ...f, moneda: e.target.value })}>{['RON', 'EUR', 'USD'].map((m) => <option>{m}</option>)}</select>
        {f.moneda !== 'RON' && <>
          <input class="scurt" placeholder="Curs" value={f.curs} onInput={(e) => setF({ ...f, curs: e.target.value })} />
          <input placeholder="RON (din curs)" value={f.suma_ron} onInput={(e) => setF({ ...f, suma_ron: e.target.value })} />
        </>}
        <input placeholder="Cum (cash, transfer…)" value={f.metoda} onInput={(e) => setF({ ...f, metoda: e.target.value })} />
        <input placeholder="ID linie extras (opțional)" value={f.tranzactie_id} onInput={(e) => setF({ ...f, tranzactie_id: e.target.value })} />
        <input placeholder="Dovadă" value={f.dovada} onInput={(e) => setF({ ...f, dovada: e.target.value })} />
        <button class="primar">Adaugă</button>
      </form>
      <Citit f={f} />
      {mesaj && <p class="eroare">{mesaj}</p>}
      <table class="tabel">
        <thead><tr><th>Data</th><th class="n">Sumă</th><th class="n">RON</th><th>Cum</th><th>Linie</th><th>Dovadă</th><th>Stare</th><th></th></tr></thead>
        <tbody>{lista.map((x) => (
          <tr>
            <td>{data(x.data)}</td><td class="n">{bani(x.suma, x.moneda)}</td><td class="n">{bani(x.suma_ron)}</td>
            <td>{x.metoda}</td><td>{x.tranzactie_id ? <a href={`#/tranzactii?id=${x.tranzactie_id}`}>#{x.tranzactie_id}</a> : ''}</td>
            <td class="mic">{x.dovada}</td>
            <td><select disabled={inchise.has(x.luna)} value={x.stare} onChange={(e) => stare(x.id, e.target.value)}>{Object.entries(STARE).map(([k, v]) => <option value={k}>{v}</option>)}</select></td>
            <td>{inchise.has(x.luna) ? <span class="mic gri">lună închisă</span> : <button class="mic" onClick={() => sterge(x.id)}>Șterge</button>}</td>
          </tr>
        ))}</tbody>
      </table>
    </section>
  );
}

function PlatiMatei() {
  const { nom } = useContext(Ctx);
  const cont = nom.conturi.find((c) => c.cod === 'MATEI');
  const [lista, setLista] = useState([]);
  const [f, setF] = useState({ data_extras: '', descriere: '', suma: '', moneda: 'RON' });
  const [mesaj, setMesaj] = useState('');
  const inchise = useLuniInchise();
  const incarca = async () => setLista(await q(sb.from('v_tranzactii').select('*').eq('manual', true).order('data_extras')));
  useEffect(() => { incarca().catch((e) => setMesaj(e.message)); }, []);

  async function adauga(e) {
    e.preventDefault(); setMesaj('');
    const s = citesteSuma(f.suma);
    if (typeof s !== 'number' || s === 0) { setMesaj('Suma nu e un număr (ex. 1.234,56).'); return; }
    try {
      await q(sb.from('tranzactii').insert({ cont_id: cont.id, manual: true, data_extras: f.data_extras, data_reala: f.data_extras,
        descriere: f.descriere, suma: -Math.abs(s), moneda: f.moneda }));
      setF({ ...f, descriere: '', suma: '' }); incarca();
    } catch (er) { setMesaj(er.message); }
  }
  async function sterge(id) { if (confirm('Ștergi linia? Rămâne în jurnal.')) { try { await q(sb.from('tranzactii').delete().eq('id', id)); incarca(); } catch (e) { setMesaj(e.message); } } }

  return (
    <section class="card">
      <h3>Plăți făcute de Matei</h3>
      <p class="mic gri">Ce a plătit Matei din banii lui pentru lucruri comune sau ale lui Alex. Linia apare apoi în Tranzacții, unde se clasifică și se confirmă ca oricare alta.</p>
      <form class="rand-form" onSubmit={adauga}>
        <input type="date" required value={f.data_extras} onInput={(e) => setF({ ...f, data_extras: e.target.value })} />
        <input class="lat" required placeholder="Ce a plătit" value={f.descriere} onInput={(e) => setF({ ...f, descriere: e.target.value })} />
        <input required placeholder="Sumă plătită" value={f.suma} onInput={(e) => setF({ ...f, suma: e.target.value })} />
        <select value={f.moneda} onChange={(e) => setF({ ...f, moneda: e.target.value })}>{['RON', 'EUR', 'USD'].map((m) => <option>{m}</option>)}</select>
        <button class="primar">Adaugă</button>
      </form>
      {f.suma && <span class={typeof citesteSuma(f.suma) === 'number' ? 'citit' : 'citit rau'}>{typeof citesteSuma(f.suma) === 'number' ? `= ${bani(Math.abs(citesteSuma(f.suma)), f.moneda)}` : 'nu e un număr'}</span>}
      {mesaj && <p class="eroare">{mesaj}</p>}
      <table class="tabel">
        <thead><tr><th>Data</th><th>Descriere</th><th class="n">Sumă</th><th>Stare</th><th></th></tr></thead>
        <tbody>{lista.map((x) => (
          <tr>
            <td>{data(x.data_extras)}</td><td><a href={`#/tranzactii?id=${x.id}&cont=MATEI`}>{x.descriere}</a></td>
            <td class="n">{bani(x.suma, x.moneda)}</td><td><span class={`eticheta-stare ${x.stare}`}>{x.stare}</span></td>
            <td>{inchise.has(x.luna) ? <span class="mic gri">lună închisă</span> : <button class="mic" onClick={() => sterge(x.id)}>Șterge</button>}</td>
          </tr>
        ))}</tbody>
      </table>
    </section>
  );
}
