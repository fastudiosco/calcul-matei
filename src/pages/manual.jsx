import { useContext, useEffect, useState } from 'preact/hooks';
import { sb, q } from '../supabase.js';
import { Ctx } from '../app.jsx';
import { bani, data, luna, LUNI } from '../format.js';

const num = (x) => (x === '' || x === null ? null : Number(String(x).replace(',', '.')));
const STARE = { propus: 'Propus', intrebare: 'Întrebare', confirmat: 'Confirmat' };

export function Manual() {
  return (
    <div>
      <p class="explicatie">
        Aici intră ce nu apare în extrasele încărcate: sume convenite (ex. 3.000 EUR pentru Beetle), bani dați înapoi de Matei,
        și plăți făcute de Matei din conturile lui. Fiecare are nevoie de dovadă și de confirmare.
      </p>
      <Elemente />
      <Rambursari />
      <PlatiMatei />
    </div>
  );
}

function ronDin(s, c) { return s && c ? Math.round(num(s) * num(c) * 100) / 100 : null; }

function Elemente() {
  const [lista, setLista] = useState([]);
  const [f, setF] = useState({ luna: LUNI[0], data: '', descriere: '', suma: '', moneda: 'RON', curs: '', suma_ron: '', sens: 'matei_datoreaza_alex', dovada: '' });
  const [mesaj, setMesaj] = useState('');
  const incarca = async () => setLista(await q(sb.from('elemente_manuale').select('*').order('luna').order('id')));
  useEffect(() => { incarca().catch((e) => setMesaj(e.message)); }, []);

  async function adauga(e) {
    e.preventDefault(); setMesaj('');
    const r = { ...f, data: f.data || null, suma: num(f.suma), curs: f.moneda === 'RON' ? 1 : num(f.curs), dovada: f.dovada || null };
    r.suma_ron = f.moneda === 'RON' ? r.suma : (num(f.suma_ron) ?? ronDin(f.suma, f.curs));
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
          <input placeholder="Curs" value={f.curs} onInput={(e) => setF({ ...f, curs: e.target.value })} />
          <input placeholder={`RON ${ronDin(f.suma, f.curs) ?? ''}`} value={f.suma_ron} onInput={(e) => setF({ ...f, suma_ron: e.target.value })} />
        </>}
        <select value={f.sens} onChange={(e) => setF({ ...f, sens: e.target.value })}>
          <option value="matei_datoreaza_alex">Matei datorează lui Alex</option>
          <option value="alex_datoreaza_matei">Alex datorează lui Matei</option>
        </select>
        <input placeholder="Dovadă" value={f.dovada} onInput={(e) => setF({ ...f, dovada: e.target.value })} />
        <button>Adaugă</button>
      </form>
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
            <td><select value={x.stare} onChange={(e) => stare(x.id, e.target.value)}>{Object.entries(STARE).map(([k, v]) => <option value={k}>{v}</option>)}</select></td>
            <td><button class="mic" onClick={() => sterge(x.id)}>Șterge</button></td>
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
  const incarca = async () => setLista(await q(sb.from('rambursari').select('*').order('data')));
  useEffect(() => { incarca().catch((e) => setMesaj(e.message)); }, []);

  async function adauga(e) {
    e.preventDefault(); setMesaj('');
    if (!f.data) { setMesaj('Alege data.'); return; }
    const r = { data: f.data, luna: f.data.slice(0, 7) + '-01', suma: num(f.suma), moneda: f.moneda, curs: f.moneda === 'RON' ? 1 : num(f.curs),
      metoda: f.metoda || null, tranzactie_id: f.tranzactie_id ? Number(f.tranzactie_id) : null, dovada: f.dovada || null };
    r.suma_ron = f.moneda === 'RON' ? r.suma : (num(f.suma_ron) ?? ronDin(f.suma, f.curs));
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
          <input placeholder="Curs" value={f.curs} onInput={(e) => setF({ ...f, curs: e.target.value })} />
          <input placeholder={`RON ${ronDin(f.suma, f.curs) ?? ''}`} value={f.suma_ron} onInput={(e) => setF({ ...f, suma_ron: e.target.value })} />
        </>}
        <input placeholder="Cum (cash, transfer…)" value={f.metoda} onInput={(e) => setF({ ...f, metoda: e.target.value })} />
        <input placeholder="ID linie extras (opțional)" value={f.tranzactie_id} onInput={(e) => setF({ ...f, tranzactie_id: e.target.value })} />
        <input placeholder="Dovadă" value={f.dovada} onInput={(e) => setF({ ...f, dovada: e.target.value })} />
        <button>Adaugă</button>
      </form>
      {mesaj && <p class="eroare">{mesaj}</p>}
      <table class="tabel">
        <thead><tr><th>Data</th><th class="n">Sumă</th><th class="n">RON</th><th>Cum</th><th>Linie</th><th>Dovadă</th><th>Stare</th><th></th></tr></thead>
        <tbody>{lista.map((x) => (
          <tr>
            <td>{data(x.data)}</td><td class="n">{bani(x.suma, x.moneda)}</td><td class="n">{bani(x.suma_ron)}</td>
            <td>{x.metoda}</td><td>{x.tranzactie_id ? <a href={`#/tranzactii?id=${x.tranzactie_id}`}>#{x.tranzactie_id}</a> : ''}</td>
            <td class="mic">{x.dovada}</td>
            <td><select value={x.stare} onChange={(e) => stare(x.id, e.target.value)}>{Object.entries(STARE).map(([k, v]) => <option value={k}>{v}</option>)}</select></td>
            <td><button class="mic" onClick={() => sterge(x.id)}>Șterge</button></td>
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
  const incarca = async () => setLista(await q(sb.from('v_tranzactii').select('*').eq('manual', true).order('data_extras')));
  useEffect(() => { incarca().catch((e) => setMesaj(e.message)); }, []);

  async function adauga(e) {
    e.preventDefault(); setMesaj('');
    const s = num(f.suma);
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
        <button>Adaugă</button>
      </form>
      {mesaj && <p class="eroare">{mesaj}</p>}
      <table class="tabel">
        <thead><tr><th>Data</th><th>Descriere</th><th class="n">Sumă</th><th>Stare</th><th></th></tr></thead>
        <tbody>{lista.map((x) => (
          <tr>
            <td>{data(x.data_extras)}</td><td><a href={`#/tranzactii?id=${x.id}&cont=MATEI`}>{x.descriere}</a></td>
            <td class="n">{bani(x.suma, x.moneda)}</td><td>{x.stare}</td>
            <td><button class="mic" onClick={() => sterge(x.id)}>Șterge</button></td>
          </tr>
        ))}</tbody>
      </table>
    </section>
  );
}
