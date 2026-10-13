import { useContext, useEffect, useState } from 'preact/hooks';
import { sb, q, toate } from '../supabase.js';
import { Ctx } from '../app.jsx';
import { bani, data, luna } from '../format.js';

const TITLURI = {
  extras_nereconciliat: 'Extrase care nu se reconciliază cu liniile din baza de date',
  lipsa_curs: 'Linii în valută fără sumă în RON',
  semn_gresit: 'Suma în RON are alt semn decât suma originală',
  transfer_fara_pereche: 'Transferuri interne fără linia pereche',
  transfer_nu_se_anuleaza: 'Transferuri interne care nu se anulează',
  cost_recurent: 'Costuri recurente confirmate fără exact o plată în lună',
  alocare_incompleta: 'Alocări de colaboratori care nu fac 100%',
  manual_fara_ron: 'Elemente manuale fără sumă în RON',
  rambursare_fara_ron: 'Rambursări fără sumă în RON',
};

export function Verificari() {
  const { nom } = useContext(Ctx);
  const [lista, setLista] = useState(null);
  const [importuri, setImporturi] = useState([]);
  const [mesaj, setMesaj] = useState('');

  async function incarca() {
    try {
      setLista(await q(sb.from('v_verificari').select('*')));
      setImporturi(await q(sb.from('importuri').select('*').order('cont_id').order('perioada_de')));
    } catch (e) { setMesaj(e.message); }
  }
  useEffect(() => { incarca(); }, []);

  async function propunePerechi() {
    setMesaj('Caut perechi…');
    try {
      const linii = await toate(() => sb.from('v_tranzactii').select('id,cont_id,titular,data_extras,suma,moneda,descriere,pereche_id,categorie,stare')
        .is('pereche_id', null).neq('stare', 'confirmat').order('data_extras'));
      const iban = Object.fromEntries(nom.conturi.map((c) => [c.id, (c.iban || '').replace(/\s/g, '')]));
      const titular = Object.fromEntries(nom.conturi.map((c) => [c.id, c.titular]));
      const folosit = new Set();
      const perechi = [];
      const zi = (d) => new Date(d).getTime() / 86400000;
      for (const a of linii) {
        if (a.suma >= 0 || folosit.has(a.id)) continue;
        const b = linii.find((x) => !folosit.has(x.id) && x.id !== a.id && x.cont_id !== a.cont_id && x.moneda === a.moneda
          && Math.round(x.suma * 100) === -Math.round(a.suma * 100) && Math.abs(zi(x.data_extras) - zi(a.data_extras)) <= 3
          && iban[x.cont_id] !== iban[a.cont_id]
          && (a.descriere.replace(/\s/g, '').includes(iban[x.cont_id]) || x.descriere.replace(/\s/g, '').includes(iban[a.cont_id])));
        if (b) { folosit.add(a.id); folosit.add(b.id); perechi.push([a, b]); }
      }
      let interne = 0, alex = 0;
      for (const [a, b] of perechi) {
        const intern = titular[a.cont_id] === titular[b.cont_id];
        const nota = `Propus automat: pereche cu #${'X'} (aceeași sumă, ±3 zile, IBAN-ul celuilalt cont apare în descriere).`;
        for (const [x, y] of [[a, b], [b, a]]) {
          const upd = intern
            ? { categorie: 'transfer_intern', impartire: 'exclus', stare: 'propus', pereche_id: y.id, nota: nota.replace('X', y.id) }
            : { categorie: 'transfer_alex', pereche_id: y.id, nota: nota.replace('X', y.id) + ' Transfer între firmă și Alex: împărțirea rămâne de decis.' };
          await q(sb.from('clasificari').update(upd).eq('tranzactie_id', x.id));
        }
        intern ? interne++ : alex++;
      }
      setMesaj(`Am găsit ${perechi.length} perechi: ${interne} între conturile firmei (propuse ca „exclus”), ${alex} între firmă și Alex (doar legate, fără împărțire). Toate trebuie confirmate în Tranzacții.`);
      incarca();
    } catch (e) { setMesaj(e.message); }
  }

  const grupe = {};
  for (const v of lista || []) (grupe[v.verificare] ||= []).push(v);
  const cont = (id) => nom.conturi.find((c) => c.id === id);

  return (
    <div>
      <section class="card">
        <h3>Extrase încărcate</h3>
        <table class="tabel">
          <thead><tr><th>Cont</th><th>Perioada</th><th>Fișier</th><th class="n">Linii</th><th class="n">Sold inițial</th><th class="n">Intrări</th><th class="n">Ieșiri</th><th class="n">Sold final</th><th>Verificare</th></tr></thead>
          <tbody>{importuri.map((i) => (
            <tr>
              <td>{cont(i.cont_id)?.nume}</td><td class="nowrap">{data(i.perioada_de)} – {data(i.perioada_pana)}</td>
              <td class="mic">{i.fisier}</td><td class="n">{i.nr_linii}</td>
              <td class="n">{bani(i.sold_initial)}</td><td class="n">{bani(i.total_intrari)}</td><td class="n">{bani(i.total_iesiri)}</td><td class="n">{bani(i.sold_final)}</td>
              <td class="mic gri">{i.nota}</td>
            </tr>
          ))}</tbody>
        </table>
        {!importuri.length && <p class="gri">Niciun extras încărcat încă. Mergi la Import.</p>}
      </section>

      <section class="card">
        <h3>Transferuri între conturile proprii</h3>
        <p class="mic gri">Banii mutați între BT, Revolut Business și Revolut Personal apar de două ori. Butonul leagă perechile (aceeași sumă, ±3 zile, IBAN-ul celuilalt cont în descriere). Nimic nu se confirmă automat.</p>
        <button onClick={propunePerechi}>Propune perechi de transfer</button>
        {mesaj && <p class="mesaj">{mesaj}</p>}
      </section>

      {!lista ? <p>Se încarcă…</p> : Object.keys(grupe).length === 0 ? <p class="ok">Nicio problemă găsită.</p> : Object.entries(grupe).map(([k, l]) => (
        <section class="card">
          <h3>{TITLURI[k] || k} <span class="gri">({l.length})</span></h3>
          <ul class="verificari">{l.slice(0, 200).map((v) => (
            <li>
              {v.luna && <span class="gri">{luna(v.luna)} · </span>}
              {v.tranzactie_id ? <a href={`#/tranzactii?id=${v.tranzactie_id}&luna=${v.luna || ''}`}>#{v.tranzactie_id}</a> : null} {v.detaliu}
            </li>
          ))}</ul>
          {l.length > 200 && <p class="gri mic">… și încă {l.length - 200}</p>}
        </section>
      ))}
    </div>
  );
}
