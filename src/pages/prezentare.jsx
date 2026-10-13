import { useContext, useEffect, useState } from 'preact/hooks';
import { sb, q } from '../supabase.js';
import { Ctx, mergi } from '../app.jsx';
import { bani, luna, suma } from '../format.js';

export function Prezentare() {
  const { email } = useContext(Ctx);
  const [luni, setLuni] = useState(null);
  const [eroare, setEroare] = useState('');
  const [mesaj, setMesaj] = useState('');

  async function incarca() {
    try { setLuni(await q(sb.from('v_rezumat_luna').select('*').order('luna'))); }
    catch (e) { setEroare(e.message); }
  }
  useEffect(() => { incarca(); }, []);

  async function confirma(l) {
    setMesaj('');
    try {
      const r = await q(sb.rpc('confirma_luna', { p_luna: l }));
      setMesaj(r === 'inchisa' ? `Luna ${luna(l)} este închisă.` : `Ai confirmat ${luna(l)} (${r}).`);
      incarca();
    } catch (e) { setMesaj(e.message); }
  }
  async function redeschide(l) {
    const motiv = prompt(`De ce redeschizi ${luna(l)}?`);
    if (!motiv) return;
    try { await q(sb.rpc('redeschide_luna', { p_luna: l, p_motiv: motiv })); incarca(); }
    catch (e) { setMesaj(e.message); }
  }

  if (eroare) return <p class="eroare">{eroare}</p>;
  if (!luni) return <p>Se încarcă…</p>;

  const total = suma(luni, (l) => l.sold_luna);
  const inLucru = suma(luni, (l) => l.in_lucru);
  const linii = luni.reduce((a, l) => a + l.linii, 0);
  const confirmate = luni.reduce((a, l) => a + l.confirmate, 0);
  const intrebari = luni.reduce((a, l) => a + l.intrebari_deschise, 0);
  const pct = linii ? Math.round((confirmate / linii) * 100) : 0;

  return (
    <div>
      <section class="cifra">
        <div>
          <div class="eticheta">Matei datorează lui Alex (doar elemente confirmate)</div>
          <div class={`mare ${total < 0 ? 'neg' : ''}`}>{bani(total, 'RON')}</div>
          <div class="sub">În lucru, încă neconfirmat: {bani(inLucru, 'RON')}</div>
        </div>
        <div class="progres">
          <div class="bara"><div style={{ width: pct + '%' }} /></div>
          <div class="sub">{confirmate} din {linii} linii confirmate ({pct}%) · {intrebari} întrebări deschise</div>
        </div>
      </section>

      <p class="explicatie">
        Cum se calculează: fiecare linie confirmată adaugă cota lui Matei. O plată făcută de Alex sau de firmă, împărțită 50/50,
        înseamnă că Matei datorează jumătate. O încasare în contul lui Alex din care o parte e a lui Matei scade suma.
        Liniile marcate „exclus” nu contează. La final se adaugă elementele manuale și se scad rambursările lui Matei.
        Pozitiv înseamnă că Matei datorează lui Alex.
      </p>

      {mesaj && <p class="mesaj">{mesaj}</p>}

      <table class="tabel">
        <thead>
          <tr>
            <th>Luna</th><th class="n">Linii</th><th class="n">Neclasificate</th><th class="n">Propuse</th>
            <th class="n">Întrebări</th><th class="n">Confirmate</th><th class="n">Din tranzacții</th>
            <th class="n">Manual</th><th class="n">Rambursări</th><th class="n">Sold lună</th><th class="n">În lucru</th>
            <th>Stare</th><th></th>
          </tr>
        </thead>
        <tbody>
          {luni.map((l) => (
            <tr>
              <td><a href="#" onClick={(e) => { e.preventDefault(); mergi('tranzactii', { luna: l.luna }); }}>{luna(l.luna)}</a></td>
              <td class="n">{l.linii}</td>
              <td class="n">{l.neclasificate ? <a href="#" onClick={(e) => { e.preventDefault(); mergi('tranzactii', { luna: l.luna, stare: 'neclasificat' }); }}>{l.neclasificate}</a> : 0}</td>
              <td class="n">{l.propuse}</td>
              <td class="n">{l.cu_intrebari + l.intrebari_deschise ? <b class="atentie">{l.intrebari_deschise}</b> : 0}</td>
              <td class="n">{l.confirmate}</td>
              <td class="n">{bani(l.efect_tranzactii)}</td>
              <td class="n">{bani(l.efect_manual)}</td>
              <td class="n">{bani(l.rambursari)}</td>
              <td class="n"><b>{bani(l.sold_luna)}</b></td>
              <td class="n gri">{bani(l.in_lucru)}</td>
              <td>
                {l.status === 'inchisa' ? <span class="eticheta-stare confirmat">Închisă</span>
                  : <span class="eticheta-stare">Deschisă</span>}
                {l.confirmata_de && <div class="mic gri">confirmată de {l.confirmata_de}</div>}
              </td>
              <td>
                {l.status === 'inchisa'
                  ? <button class="mic" onClick={() => redeschide(l.luna)}>Redeschide</button>
                  : <button class="mic" disabled={(l.confirmata_de || '').includes(email)} onClick={() => confirma(l.luna)}>Confirmă luna</button>}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>Total</td><td class="n">{linii}</td><td colSpan={4}></td>
            <td class="n">{bani(suma(luni, (l) => l.efect_tranzactii))}</td>
            <td class="n">{bani(suma(luni, (l) => l.efect_manual))}</td>
            <td class="n">{bani(suma(luni, (l) => l.rambursari))}</td>
            <td class="n"><b>{bani(total)}</b></td>
            <td class="n gri">{bani(inLucru)}</td><td colSpan={2}></td>
          </tr>
        </tfoot>
      </table>
      <p class="mic gri">O lună se închide doar când toate liniile sunt confirmate, nu mai are întrebări deschise și au confirmat-o toți membrii.</p>
    </div>
  );
}
