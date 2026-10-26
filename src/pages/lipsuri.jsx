import { useContext, useEffect, useState } from 'preact/hooks';
import { sb, q } from '../supabase.js';
import { Ctx, mergi } from '../app.jsx';
import { bani, luna, suma } from '../format.js';

const NUME_VERIFICARI = {
  lipsa_curs: 'linii în valută fără sumă în RON',
  semn_gresit: 'sumă în RON cu alt semn',
  transfer_nu_se_anuleaza: 'transferuri interne care nu se anulează',
  manual_fara_ron: 'sume manuale fără RON',
  rambursare_fara_ron: 'rambursări fără RON',
  rambursare_legata: 'rambursări legate de o linie neconfirmată',
  tva_lipsa: 'încasări / plăți colaboratori din aug 2026 fără TVA',
  ron_diferit_de_curs: 'suma în RON nu se potrivește cu cursul',
};

// Tot ce lipsește ca suma finală să fie completă, în ordinea în care se rezolvă.
export function Lipsuri() {
  const { editor } = useContext(Ctx);
  const [randuri, setRanduri] = useState(null);
  const [eroare, setEroare] = useState('');

  useEffect(() => {
    q(sb.from('v_lipsuri').select('*').order('ordine').order('luna', { nullsFirst: true }).order('suma', { ascending: false, nullsFirst: false }))
      .then(setRanduri)
      .catch((e) => setEroare(/v_lipsuri/.test(e.message)
        ? 'Baza de date nu are încă lista. Trebuie rulată migrarea supabase/migrations/20261026100300_lipsuri.sql.'
        : e.message));
  }, []);

  if (eroare) return <div><h1 class="titlu">Ce lipsește</h1><p class="eroare">{eroare}</p></div>;
  if (!randuri) return <p class="gri">Se încarcă…</p>;

  const zone = [];
  for (const r of randuri) {
    let z = zone.find((x) => x.zona === r.zona);
    if (!z) zone.push(z = { zona: r.zona, randuri: [] });
    z.randuri.push(r);
  }
  const deschide = (r) => mergi(r.pagina, Object.fromEntries(new URLSearchParams(r.filtru || '')));
  // Matei nu are în meniu paginile de lucru (import, verificări, sume manuale, costuri).
  const areLink = (r) => editor || ['tranzactii', 'intrebari', 'prezentare'].includes(r.pagina);

  return (
    <div>
      <h1 class="titlu">Ce lipsește</h1>
      <p class="intro">
        Tot ce mai trebuie ca suma finală să fie completă. Suma din calcul ia în considerare doar liniile confirmate,
        deci orice rând de aici poate schimba rezultatul. Sumele sunt valoarea liniilor, nu efectul lor asupra datoriei.
      </p>
      {zone.length === 0 && <p class="ok">Nu lipsește nimic. Toate lunile sunt închise.</p>}
      {zone.map((z) => (
        <section class="card">
          <h3>{z.zona} <span class="gri mic">{z.randuri.reduce((a, r) => a + (r.linii || 1), 0).toLocaleString('ro-RO')}{z.randuri.some((r) => r.suma) && ` · ${bani(suma(z.randuri, (r) => r.suma), 'RON')}`}</span></h3>
          <table class="tabel">
            <tbody>{z.randuri.map((r) => (
              <tr>
                <td>{areLink(r)
                  ? <a href="#" onClick={(e) => { e.preventDefault(); deschide(r); }}>{NUME_VERIFICARI[r.ce] || r.ce}</a>
                  : NUME_VERIFICARI[r.ce] || r.ce}</td>
                <td class="nowrap gri">{r.luna ? luna(r.luna) : ''}</td>
                <td class="n">{r.linii ? `${r.linii.toLocaleString('ro-RO')} ${r.linii === 1 ? 'linie' : 'linii'}` : ''}</td>
                <td class="n nowrap">{r.suma ? bani(r.suma, 'RON') : ''}</td>
              </tr>
            ))}</tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
