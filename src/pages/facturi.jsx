import { useEffect, useState } from 'preact/hooks';
import { sb, q, toate } from '../supabase.js';
import { mergi } from '../app.jsx';
import { bani, data, suma } from '../format.js';
import { parseazaFactura } from '../efactura.js';

// Din august 2026 calculul e fără TVA. Facturile din SPV dau TVA-ul fiecărei încasări și plăți către colaboratori.
export function Facturi() {
  return (
    <div>
      <h1 class="titlu">Facturi și TVA</h1>
      <p class="intro">
        Încarci arhivele e-Factura din SPV (emise și primite), aplicația citește facturile și propune TVA-ul pentru fiecare
        încasare de la clienți și fiecare plată către colaboratori din august 2026. TVA-ul unei plăți parțiale e proporțional cu suma plătită.
        Propunerile se aplică doar când apeși tu „Aplică”.
      </p>
      <Incarca />
      <Propuneri />
    </div>
  );
}

function lipsaMigrare(m) {
  return /facturi|v_tva_propuneri|importa_facturi|aplica_tva/.test(m) && /(does not exist|Could not find|schema cache)/i.test(m)
    ? 'Baza de date nu are încă tabelele pentru facturi. Trebuie rulată migrarea supabase/migrations/20261026100200_facturi.sql.'
    : m;
}

function Incarca() {
  const [facturi, setFacturi] = useState(null);
  const [erori, setErori] = useState([]);
  const [stare, setStare] = useState('');
  const [lucru, setLucru] = useState(false);

  async function citeste(e) {
    setStare(''); setErori([]); setFacturi(null);
    const fisiere = [...e.target.files].filter((f) => /\.xml$/i.test(f.name));
    const gasite = new Map();
    const err = [];
    for (const f of fisiere) {
      try {
        const x = parseazaFactura(await f.text(), f.name);
        if (x) gasite.set(`${x.directie}|${x.emitent_cui}|${x.numar}`, x);
      } catch (er) { err.push(er.message); }
    }
    setErori(err);
    setFacturi([...gasite.values()].sort((a, b) => a.data.localeCompare(b.data) || a.numar.localeCompare(b.numar)));
    if (!gasite.size) setStare(fisiere.length ? 'Nicio factură în fișierele alese (doar semnături sau alt XML).' : 'Nu ai ales niciun fișier XML.');
    e.target.value = '';
  }

  async function salveaza() {
    setLucru(true);
    let noi = 0, act = 0;
    try {
      for (let i = 0; i < facturi.length; i += 100) {
        setStare(`Se salvează ${i} / ${facturi.length}…`);
        const [r] = await q(sb.rpc('importa_facturi', { p: facturi.slice(i, i + 100) }));
        noi += r.noi; act += r.actualizate;
      }
      setStare(`✓ ${noi} facturi noi, ${act} actualizate. Propunerile de TVA de mai jos s-au recalculat.`);
      setFacturi(null);
      window.dispatchEvent(new Event('facturi-salvate'));
    } catch (e) { setStare('❌ ' + lipsaMigrare(e.message)); }
    setLucru(false);
  }

  const emise = facturi?.filter((f) => f.directie === 'emisa') || [];
  const primite = facturi?.filter((f) => f.directie === 'primita') || [];
  return (
    <section class="card">
      <h3>1. Încarcă facturile</h3>
      <p class="mic gri">
        Alege folderul unei arhive dezarhivate (ex. „arhiva-facturi-emise-2026.09.01-2026.09.30-…”) sau direct fișierele XML.
        Se citesc doar facturile („…_2_…xml”); semnăturile și PDF-urile sunt ignorate. O factură încărcată de două ori se actualizează, nu se dublează.
      </p>
      <div class="rand">
        <label class="buton">Alege un folder<input type="file" webkitdirectory="" directory="" multiple hidden onChange={citeste} /></label>
        <label class="buton">Alege fișiere XML<input type="file" accept=".xml,text/xml,application/xml" multiple hidden onChange={citeste} /></label>
      </div>
      {erori.length > 0 && <div class="eroare">{erori.length} fișiere nu s-au putut citi:<ul>{erori.slice(0, 10).map((x) => <li class="mic">{x}</li>)}</ul></div>}
      {facturi?.length > 0 && (
        <>
          <table class="tabel">
            <thead><tr><th></th><th class="n">Facturi</th><th>Perioada</th><th class="n">Fără TVA</th><th class="n">TVA</th><th class="n">Total</th></tr></thead>
            <tbody>
              {[['Emise (clienți)', emise], ['Primite (furnizori, colaboratori)', primite]].filter(([, l]) => l.length).map(([t, l]) => (
                <tr><td>{t}</td><td class="n">{l.length}</td><td class="nowrap">{data(l[0].data)} – {data(l[l.length - 1].data)}</td>
                  <td class="n">{bani(suma(l, (x) => x.net))}</td><td class="n">{bani(suma(l, (x) => x.tva))}</td><td class="n">{bani(suma(l, (x) => x.total))}</td></tr>
              ))}
            </tbody>
          </table>
          <p class="mic gri">Sumele sunt în moneda fiecărei facturi (aproape toate în RON).</p>
          <button class="primar" disabled={lucru} onClick={salveaza}>{lucru ? 'Se salvează…' : `Salvează ${facturi.length} facturi`}</button>
        </>
      )}
      {stare && <p class="mesaj">{stare}</p>}
    </section>
  );
}

const FILE = [
  ['de_aplicat', 'De aplicat'],
  ['diferit', 'TVA diferit de factură'],
  ['fara_factura', 'Fără factură'],
  ['gata', 'Aplicate / corecte'],
];

function Propuneri() {
  const [lista, setLista] = useState(null);
  const [fila, setFila] = useState('de_aplicat');
  const [sel, setSel] = useState(new Set());
  const [mesaj, setMesaj] = useState('');
  const [eroare, setEroare] = useState('');
  const [neplatite, setNeplatite] = useState([]);

  async function incarca() {
    setEroare('');
    try {
      const l = await toate(() => sb.from('v_tva_propuneri').select('*').order('data_extras').order('tranzactie_id'));
      setLista(l);
      // Bifate din start doar potrivirile după numărul facturii; cele după sumă le bifezi tu după ce le verifici.
      setSel(new Set(l.filter((x) => x.situatie === 'nou' && x.metoda?.startsWith('numărul')).map((x) => x.tranzactie_id)));
      const platite = new Set(l.map((x) => x.factura_id).filter(Boolean));
      const emise = await toate(() => sb.from('facturi').select('id,numar,data,client,total,tva').eq('directie', 'emisa').gte('data', '2026-08-01').order('data'));
      setNeplatite(emise.filter((f) => !platite.has(f.id)));
    } catch (e) { setEroare(lipsaMigrare(e.message)); }
  }
  useEffect(() => {
    incarca();
    window.addEventListener('facturi-salvate', incarca);
    return () => window.removeEventListener('facturi-salvate', incarca);
  }, []);

  async function aplica() {
    const ids = [...sel].filter((id) => vizibile.some((x) => x.tranzactie_id === id));
    if (!ids.length) { setMesaj('Bifează cel puțin o linie.'); return; }
    setMesaj('Se aplică…');
    try {
      const n = await q(sb.rpc('aplica_tva', { p_ids: ids }));
      setMesaj(`✓ TVA aplicat pe ${n} linii. Liniile confirmate al căror TVA s-a schimbat au redevenit „Propus” și trebuie confirmate din nou.`);
      incarca();
    } catch (e) { setMesaj('❌ ' + lipsaMigrare(e.message)); }
  }

  if (eroare) return <section class="card"><h3>2. TVA pe încasări și plăți</h3><p class="eroare">{eroare}</p></section>;
  if (!lista) return <section class="card"><h3>2. TVA pe încasări și plăți</h3><p class="gri">Se încarcă…</p></section>;

  const inFila = {
    de_aplicat: (x) => x.situatie === 'nou',
    diferit: (x) => x.situatie === 'diferit',
    fara_factura: (x) => x.situatie === 'fara_factura',
    gata: (x) => x.situatie === 'la_fel',
  };
  const vizibile = lista.filter(inFila[fila]);
  const bifabil = fila === 'de_aplicat' || fila === 'diferit';
  const comuta = (id) => { const s = new Set(sel); s.has(id) ? s.delete(id) : s.add(id); setSel(s); };
  const toateBifate = vizibile.length > 0 && vizibile.every((x) => sel.has(x.tranzactie_id));
  const bifeaza = () => {
    const s = new Set(sel);
    for (const x of vizibile) toateBifate ? s.delete(x.tranzactie_id) : s.add(x.tranzactie_id);
    setSel(s);
  };
  const alese = vizibile.filter((x) => sel.has(x.tranzactie_id));

  return (
    <>
      <section class="card" style={{ marginTop: '18px' }}>
        <h3>2. TVA pe încasări și plăți către colaboratori (din aug 2026)</h3>
        <div class="file">
          {FILE.map(([k, t]) => (
            <button class={`mic ${fila === k ? 'activ' : ''}`} onClick={() => setFila(k)}>{t} <span class="gri">{lista.filter(inFila[k]).length}</span></button>
          ))}
        </div>
        {fila === 'diferit' && <p class="mic gri">Linii care au deja un TVA completat, altul decât cel din factură. Bifează doar ce vrei să înlocuiești.</p>}
        {fila === 'fara_factura' && <p class="mic gri">Nicio factură încărcată nu are numărul din descrierea plății sau exact aceeași sumă. Încarcă arhiva lunii sau completează TVA-ul în panoul liniei.</p>}
        {vizibile.length === 0 ? <p class="gri">Nimic aici.</p> : (
          <div class="tabel-lat">
            <table class="tabel">
              <thead><tr>
                {bifabil && <th><input type="checkbox" checked={toateBifate} onChange={bifeaza} /></th>}
                <th>Data</th><th>Linia</th><th class="n">Suma</th><th>Factura</th><th class="n">Total factură</th><th class="n">TVA factură</th>
                <th class="n">TVA propus</th><th class="n">TVA acum</th><th>Cum s-a găsit</th>
              </tr></thead>
              <tbody>{vizibile.map((x) => (
                <tr>
                  {bifabil && <td><input type="checkbox" checked={sel.has(x.tranzactie_id)} onChange={() => comuta(x.tranzactie_id)} /></td>}
                  <td class="nowrap">{data(x.data_extras)}</td>
                  <td class="mic"><a href="#" onClick={(e) => { e.preventDefault(); mergi('tranzactii', { id: x.tranzactie_id }); }}>#{x.tranzactie_id}</a>{' '}
                    {x.categorie === 'colaborator' ? 'colaborator' : 'încasare'} · {x.contrapartida || x.descriere?.slice(0, 60)}</td>
                  <td class="n nowrap">{bani(x.suma_ron)}</td>
                  <td class="mic">{x.numar ? <>{x.numar} · {data(x.data_factura)}<br /><span class="gri">{x.partener}</span></> : '—'}</td>
                  <td class="n">{bani(x.total)}</td><td class="n">{bani(x.tva_factura)}</td>
                  <td class="n"><b>{bani(x.tva_calculat)}</b></td>
                  <td class="n gri">{x.tva_actual === null ? '—' : bani(x.tva_actual)}</td>
                  <td class="mic gri">{x.metoda || ''}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        {bifabil && vizibile.length > 0 && (
          <div class="rand">
            <button class="primar" onClick={aplica} disabled={!alese.length}>Aplică TVA pe {alese.length} linii</button>
            <span class="mic gri">TVA în total: {bani(suma(alese, (x) => x.tva_calculat), 'RON')}</span>
          </div>
        )}
        {mesaj && <p class="mesaj">{mesaj}</p>}
      </section>

      {neplatite.length > 0 && (
        <section class="card" style={{ marginTop: '18px' }}>
          <h3>Facturi emise din aug 2026 fără încasare găsită</h3>
          <p class="mic gri">Pot fi neîncasate încă, încasate în alt cont sau după ultimul extras importat.</p>
          <table class="tabel">
            <thead><tr><th>Factura</th><th>Data</th><th>Client</th><th class="n">Total</th><th class="n">TVA</th></tr></thead>
            <tbody>{neplatite.map((f) => <tr><td>{f.numar}</td><td>{data(f.data)}</td><td>{f.client}</td><td class="n">{bani(f.total)}</td><td class="n">{bani(f.tva)}</td></tr>)}</tbody>
          </table>
        </section>
      )}
    </>
  );
}
