import { useContext, useEffect, useState } from 'preact/hooks';
import { sb, q } from '../supabase.js';
import { Ctx, mergi } from '../app.jsx';
import { bani, luna, suma } from '../format.js';

// Verificările care schimbă suma: o lună nu se poate confirma cât timp are una dintre ele.
export const VERIFICARI_BANI = ['lipsa_curs', 'semn_gresit', 'transfer_nu_se_anuleaza', 'manual_fara_ron',
  'rambursare_fara_ron', 'rambursare_legata', 'tva_lipsa', 'ron_diferit_de_curs'];

export function Prezentare() {
  const { email } = useContext(Ctx);
  const [d, setD] = useState(null);
  const [eroare, setEroare] = useState('');
  const [mesaj, setMesaj] = useState('');
  const [detalii, setDetalii] = useState(false);

  async function incarca() {
    try {
      const eu = email.toLowerCase();
      const [luni, intrebari, generale, probleme, pentruMine, raspunsuri] = await Promise.all([
        q(sb.from('v_rezumat_luna').select('*').order('luna')),
        q(sb.from('intrebari').select('id', { count: 'exact', head: true }).neq('stare', 'rezolvata')),
        q(sb.from('intrebari').select('id', { count: 'exact', head: true }).neq('stare', 'rezolvata').is('tranzactie_id', null).is('element_id', null)),
        q(sb.from('v_verificari').select('verificare,luna').in('verificare', VERIFICARI_BANI)),
        q(sb.from('intrebari').select('id', { count: 'exact', head: true }).eq('stare', 'deschisa').or(`pentru.eq.${eu},pentru.is.null`)),
        q(sb.from('intrebari').select('id', { count: 'exact', head: true }).eq('stare', 'raspunsa').eq('creat_de', eu)),
      ]);
      setD({ luni, intrebari: intrebari.count, generale: generale.count, probleme, pentruMine: pentruMine.count, raspunsuri: raspunsuri.count });
    } catch (e) { setEroare(e.message); }
  }
  useEffect(() => { incarca(); }, []);

  async function confirma(l) {
    setMesaj('');
    try {
      const r = await q(sb.rpc('confirma_luna', { p_luna: l }));
      setMesaj(r === 'inchisa' ? `Luna ${luna(l)} este închisă.` : `Ai confirmat ${luna(l)}. Mai trebuie confirmată de celălalt membru (${r.replace('confirmata ', '')}).`);
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
  if (!d) return <p class="gri">Se încarcă…</p>;

  const { luni } = d;
  const total = suma(luni, (l) => l.sold_luna);
  const inLucru = suma(luni, (l) => l.in_lucru);
  const linii = luni.reduce((a, l) => a + l.linii, 0);
  const confirmate = luni.reduce((a, l) => a + l.confirmate, 0);
  const neclasificate = luni.reduce((a, l) => a + l.neclasificate, 0);
  const propuse = luni.reduce((a, l) => a + l.propuse, 0);
  const pct = linii ? Math.floor((confirmate / linii) * 100) : 0;
  const inchise = luni.filter((l) => l.status === 'inchisa').length;
  const problemePeLuna = {};
  for (const p of d.probleme) problemePeLuna[p.luna] = (problemePeLuna[p.luna] || 0) + 1;

  const pasi = [
    [neclasificate, 'linii de clasificat', () => mergi('tranzactii', { stare: 'neclasificat' })],
    [propuse, 'propuneri de confirmat', () => mergi('tranzactii', { stare: 'propus' })],
    [d.pentruMine, 'întrebări la care trebuie să răspunzi tu', () => mergi('intrebari', { stare: 'mine' })],
    ...(d.raspunsuri ? [[d.raspunsuri, 'răspunsuri primite la întrebările tale', () => mergi('intrebari', { stare: 'raspunsuri' })]] : []),
    [d.intrebari, d.generale ? `întrebări deschise în total (${d.generale} generale)` : 'întrebări deschise în total', () => mergi('intrebari', { stare: 'deschisa' })],
    [d.probleme.length, 'probleme care schimbă suma', () => mergi('verificari')],
  ];

  return (
    <div>
      <section class="erou">
        <div class="principal">
          <div class="eticheta">{total >= 0 ? 'Matei datorează lui Alex' : 'Alex datorează lui Matei'}, din ce e confirmat</div>
          <div class="mare">{bani(Math.abs(total))}<small>RON</small></div>
          <div class="sub">În lucru, încă neconfirmat: {bani(inLucru, 'RON')}</div>
          <div class="bara"><div style={{ width: pct + '%' }} /></div>
          <div class="sub">{confirmate.toLocaleString('ro-RO')} din {linii.toLocaleString('ro-RO')} linii confirmate ({pct}%) · {inchise} din {luni.length} luni închise</div>
        </div>
        <div class="de-facut">
          <h3>Ce urmează</h3>
          {pasi.map(([n, t, f]) => (
            <a class={`pas ${n ? '' : 'gata'}`} href="#" onClick={(e) => { e.preventDefault(); f(); }}>
              <b>{n ? n.toLocaleString('ro-RO') : '✓'}</b><span>{t}</span><i>→</i>
            </a>
          ))}
        </div>
      </section>

      {mesaj && <p class="mesaj">{mesaj}</p>}

      <div class="filtre">
        <h2 style={{ margin: '8px 0', flex: 1 }}>Pe luni</h2>
        <button class="mic" onClick={() => setDetalii(!detalii)}>{detalii ? 'Ascunde detaliile' : 'Arată detaliile'}</button>
      </div>
      <div class="tabel-lat">
        <table class="tabel">
          <thead>
            <tr>
              <th>Luna</th><th>Confirmate</th><th class="n">Întrebări</th>
              {detalii && <><th class="n">Din tranzacții</th><th class="n">Manual</th><th class="n">Rambursări</th><th class="n">În lucru</th></>}
              <th class="n">Sold lună</th><th>Stare</th><th></th>
            </tr>
          </thead>
          <tbody>
            {luni.map((l) => {
              const p = l.linii ? Math.floor((l.confirmate / l.linii) * 100) : 0;
              const amConfirmat = (l.confirmata_de || '').split(', ').includes(email);
              return (
                <tr class="luni-rand">
                  <td><a href="#" onClick={(e) => { e.preventDefault(); mergi('tranzactii', { luna: l.luna }); }}>{luna(l.luna)}</a></td>
                  <td>
                    <div class="progres-mic"><div class="bara"><div style={{ width: p + '%' }} /></div>
                      <span class="mic gri nowrap">{l.confirmate}/{l.linii}</span></div>
                  </td>
                  <td class="n">{l.intrebari_deschise ? <b class="atentie">{l.intrebari_deschise}</b> : <span class="gri">0</span>}</td>
                  {detalii && <>
                    <td class="n">{bani(l.efect_tranzactii)}</td><td class="n">{bani(l.efect_manual)}</td>
                    <td class="n">{bani(l.rambursari)}</td><td class="n gri">{bani(l.in_lucru)}</td>
                  </>}
                  <td class="n"><b>{bani(l.sold_luna)}</b></td>
                  <td>
                    <span class={`eticheta-stare ${l.status}`}>{l.status === 'inchisa' ? 'Închisă' : 'Deschisă'}</span>
                    {l.confirmata_de && l.status !== 'inchisa' && <div class="mic gri">confirmată de {l.confirmata_de}</div>}
                    {problemePeLuna[l.luna] > 0 && <div class="mic atentie">{problemePeLuna[l.luna]} probleme de verificat</div>}
                  </td>
                  <td class="n">
                    {l.status === 'inchisa'
                      ? <button class="mic" onClick={() => redeschide(l.luna)}>Redeschide</button>
                      : <button class="mic" disabled={amConfirmat} title={amConfirmat ? 'Ai confirmat deja luna. Orice modificare anulează confirmarea.' : ''}
                          onClick={() => confirma(l.luna)}>{amConfirmat ? 'Confirmată de tine' : 'Confirmă luna'}</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td><td class="mic gri">{confirmate}/{linii}</td><td class="n">{luni.reduce((a, l) => a + l.intrebari_deschise, 0) || ''}</td>
              {detalii && <>
                <td class="n">{bani(suma(luni, (l) => l.efect_tranzactii))}</td>
                <td class="n">{bani(suma(luni, (l) => l.efect_manual))}</td>
                <td class="n">{bani(suma(luni, (l) => l.rambursari))}</td>
                <td class="n gri">{bani(inLucru)}</td>
              </>}
              <td class="n"><b>{bani(total)}</b></td><td colSpan={2}></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <details class="cum">
        <summary>Cum se calculează suma</summary>
        <ul>
          <li>Fiecare linie din extrase are o împărțire: 50/50, 100% Matei, 100% Alex, un procent sau „exclus”.</li>
          <li>O plată din banii firmei sau ai lui Alex adaugă partea lui Matei la ce datorează. O încasare scade partea lui Matei.</li>
          <li>Din august 2026 se calculează fără TVA (TVA-ul trece prin firmă, nu e al nimănui).</li>
          <li>Se adaugă sumele manuale (de exemplu Beetle) și se scad banii dați înapoi de Matei.</li>
          <li>Intră în sumă doar ce a fost confirmat. O lună se închide când e confirmată de amândoi; orice modificare anulează confirmarea.</li>
        </ul>
      </details>
    </div>
  );
}
