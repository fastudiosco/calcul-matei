import { useContext, useEffect, useState } from 'preact/hooks';
import { sb, q, toate } from '../supabase.js';
import { Ctx } from '../app.jsx';
import { bani, data, luna, suma, IMPARTIRI, STARI, csv, descarca } from '../format.js';
import { numeMembru } from '../membri.js';
import { procentAfisat } from './editor.jsx';
import logo from '../assets/fastudios-dark.svg';

const COLOANE = 'id,luna,data_extras,cont_cod,titular,contrapartida,descriere,suma,moneda,suma_ron,tva_ron,curs,sursa_curs,'
  + 'categorie,impartire,procent_matei,procent_precis,stare,efect_matei,nota,confirmat_de,confirmat_la,client_id,colaborator_id';

// O linie e „confirmată”, „propusă” (are o împărțire, încă neconfirmată) sau „nedecisă” (fără împărțire).
function situatie(l) {
  if (l.stare === 'confirmat') return 'confirmat';
  return l.impartire ? 'propus' : 'nedecis';
}

// Elementele manuale, cu semnul din calcul: pozitiv = Matei datorează lui Alex.
const semnManual = (m) => (m.sens === 'matei_datoreaza_alex' ? 1 : -1) * Number(m.suma_ron || 0);

// „1 linie”, „5 linii”, „20 de linii”.
export function cate(n, unu, multe) {
  if (n === 1) return `1 ${unu}`;
  const r = n % 100;
  return `${n.toLocaleString('ro-RO')} ${(r === 0 && n !== 0) || r >= 20 ? 'de ' : ''}${multe}`;
}

const procentText = (p) => `${String(Number(p)).replace('.', ',')}%`;

// Tabelele noi (creditele, textele regulilor) vin dintr-o migrare: până atunci raportul merge fără ele.
// Orice altă eroare se arată, nu se ascunde.
async function optional(promise) {
  try { return { date: await q(promise) }; } catch (e) {
    if (['PGRST205', '42P01'].includes(e.code) || /does not exist|schema cache/i.test(e.message)) return { date: null };
    return { date: null, eroare: e.message };
  }
}

// Raportul pentru Matei: suma, cum s-a ajuns la ea pe blocuri (cu regula fiecăruia), creditele, ce mai lipsește.
export function Raport() {
  const { nom, editor } = useContext(Ctx);
  const [d, setD] = useState(null);
  const [eroare, setEroare] = useState('');
  const [mesaj, setMesaj] = useState('');
  const [deschise, setDeschise] = useState(false);

  async function incarca() {
    try {
      const [luni, linii, manuale, rambursari, credite, grafic, reguli, lipsuri] = await Promise.all([
        q(sb.from('v_rezumat_luna').select('*').order('luna')),
        toate(() => sb.from('v_tranzactii').select(COLOANE).order('data_extras').order('id')),
        q(sb.from('elemente_manuale').select('*').order('luna').order('id')),
        q(sb.from('rambursari').select('*').order('data')),
        optional(sb.from('v_credite').select('*').order('id')),
        optional(sb.from('credite_grafic').select('*').order('credit_id').order('nr')),
        optional(sb.from('raport_reguli').select('*').order('tip').order('ordine')),
        q(sb.from('v_lipsuri').select('*').order('ordine')).catch(() => []),
      ]);
      setD({
        luni, linii, manuale, rambursari, lipsuri,
        credite: credite.date, grafic: grafic.date || [], reguli: reguli.date || [],
        eroriOptionale: [credite.eroare, grafic.eroare, reguli.eroare].filter(Boolean),
      });
    } catch (e) { setEroare(e.message); }
  }
  useEffect(() => { incarca(); }, []);

  // La print (butonul sau Cmd+P) se deschid toate blocurile, ca PDF-ul să aibă toate liniile; după print revin cum erau.
  useEffect(() => {
    let inainte = [];
    const deschide = () => {
      inainte = [...document.querySelectorAll('.raport details')].map((el) => [el, el.open]);
      for (const [el] of inainte) el.open = true;
    };
    const inchide = () => { for (const [el, era] of inainte) el.open = era; inainte = []; };
    window.addEventListener('beforeprint', deschide);
    window.addEventListener('afterprint', inchide);
    return () => { window.removeEventListener('beforeprint', deschide); window.removeEventListener('afterprint', inchide); };
  }, []);

  async function sincronizeaza() {
    setMesaj('');
    try {
      const [r] = await q(sb.rpc('sincronizeaza_credite'));
      setMesaj(`Creditele: ${cate(r.actualizate, 'element actualizat', 'elemente actualizate')}`
        + (r.confirmate_diferite ? `; ${cate(r.confirmate_diferite, 'element confirmat nu mai corespunde', 'elemente confirmate nu mai corespund')} (redeschide-le în Sume manuale)` : '')
        + (r.fara_grafic ? `; ${cate(r.fara_grafic, 'credit nu are', 'credite nu au')} în grafic toate ratele necesare` : '') + '.');
      incarca();
    } catch (e) { setMesaj(e.message); }
  }

  // Rutele sunt în hash (#/raport), deci un link #bloc-… ar schimba pagina: deschidem blocul și derulăm la el.
  function arataBloc(id) {
    const el = document.getElementById(`bloc-${id}`);
    if (el) { el.open = true; el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }

  if (eroare) return <p class="eroare">{eroare}</p>;
  if (!d) return <p class="gri">Se încarcă…</p>;

  const cat = (c) => nom.categorii.find((x) => x.cod === c)?.eticheta || 'Fără categorie';
  const cine = (l) => nom.colaboratori.find((x) => x.id === l.colaborator_id)?.nume
    || nom.clienti.find((x) => x.id === l.client_id)?.nume || l.contrapartida || '';
  const blocuriDef = d.reguli.filter((r) => r.tip === 'bloc');
  const generale = d.reguli.filter((r) => r.tip === 'general');
  const legenda = d.reguli.filter((r) => r.tip === 'legenda');

  // Fiecare linie merge în blocul care îi are categoria (fără categorie = ''); ce nu e acoperit are blocul lui.
  const blocuri = blocuriDef.map((b) => ({ ...b, linii: [] }));
  const dupaCategorie = {};
  for (const b of blocuri) for (const c of b.categorii) dupaCategorie[c] = b;
  for (const l of d.linii) {
    let b = dupaCategorie[l.categorie ?? ''];
    if (!b) {
      b = { id: `cat-${l.categorie ?? ''}`, titlu: cat(l.categorie), categorii: [l.categorie ?? ''],
        text: 'Linii decise una câte una: împărțirea fiecăreia e în tabel, iar motivul în notă.', linii: [] };
      blocuri.push(b);
      dupaCategorie[l.categorie ?? ''] = b;
    }
    b.linii.push(l);
  }
  for (const b of blocuri) {
    const s = { confirmat: [], propus: [], nedecis: [] };
    for (const l of b.linii) s[situatie(l)].push(l);
    b.confirmat = suma(s.confirmat, (l) => l.efect_matei);
    b.propus = suma(s.propus, (l) => l.efect_matei);
    b.nedecise = s.nedecis.length;
    b.valoareNedecisa = suma(s.nedecis, (l) => Math.abs(Number(l.suma_ron ?? 0)));
    b.valoare = suma(b.linii, (l) => Math.abs(Number(l.suma_ron ?? 0)));
  }
  const cuLinii = blocuri.filter((b) => b.linii.length);

  const totalConfirmat = suma(d.luni, (l) => l.sold_luna);
  const liniiPropuse = d.linii.filter((l) => situatie(l) === 'propus');
  const nedecise = d.linii.filter((l) => situatie(l) === 'nedecis');
  const manualeConfirmate = d.manuale.filter((m) => m.stare === 'confirmat');
  const manualePropuse = d.manuale.filter((m) => m.stare !== 'confirmat');
  const rambursariInafara = d.rambursari.filter((r) => !r.tranzactie_id);
  const rambursariPropuse = rambursariInafara.filter((r) => r.stare !== 'confirmat');
  const deConfirmat = suma(liniiPropuse, (l) => l.efect_matei) + suma(manualePropuse, semnManual) - suma(rambursariPropuse, (r) => r.suma_ron);
  const totalProiectat = totalConfirmat + deConfirmat;
  const neconfirmate = [
    liniiPropuse.length && cate(liniiPropuse.length, 'linie', 'linii'),
    manualePropuse.length && cate(manualePropuse.length, 'sumă manuală', 'sume manuale'),
    rambursariPropuse.length && cate(rambursariPropuse.length, 'rambursare', 'rambursări'),
  ].filter(Boolean);
  const luniInchise = d.luni.filter((l) => l.status === 'inchisa').length;
  const confirmate = d.linii.filter((l) => l.stare === 'confirmat').length;
  const final = luniInchise === d.luni.length && d.luni.length > 0;
  const directie = (v) => (v >= 0 ? 'Matei datorează lui Alex' : 'Alex datorează lui Matei');
  // Suma confirmată adunată pe blocuri trebuie să fie aceeași cu cea pe luni; dacă nu, ceva nu e într-o lună din calcul.
  const totalBlocuri = suma(cuLinii, (b) => b.confirmat) + suma(manualeConfirmate, semnManual)
    - suma(rambursariInafara.filter((r) => r.stare === 'confirmat'), (r) => r.suma_ron);
  const creditePartiale = (d.credite || []).filter((c) => c.rate_confirmate > 0
    && (c.stare_incasare !== 'confirmat' || c.element_stare !== 'confirmat'));

  const liniePeId = Object.fromEntries(d.linii.map((l) => [l.id, l]));
  // Ce e deja confirmat din calculul unui credit: ratele confirmate, plus încasarea și elementul manual, dacă sunt confirmate.
  const confirmatCredit = (c) => suma((c.plati_ids || []).map((id) => liniePeId[id]).filter((l) => l && l.stare === 'confirmat'), (l) => l.efect_matei)
    + (c.stare_incasare === 'confirmat' ? Number(c.efect_incasare || 0) : 0)
    + (c.element_stare === 'confirmat' ? Number(c.element_suma_ron || 0) : 0);
  const zone = [];
  for (const r of d.lipsuri) {
    let z = zone.find((x) => x.zona === r.zona);
    if (!z) zone.push(z = { zona: r.zona, randuri: 0, linii: 0, suma: 0 });
    z.randuri += 1; z.linii += r.linii || 0; z.suma += Number(r.suma || 0);
  }

  function exporta() {
    const bloc = (l) => (dupaCategorie[l.categorie ?? '']?.titlu) || cat(l.categorie);
    descarca('raport_calcul_matei.csv', csv(d.linii, [
      ['id', 'ID'], ['data_extras', 'Data'], ['cont_cod', 'Cont'], [cine, 'Cine'], ['descriere', 'Descriere'],
      [bloc, 'Bloc'], [(r) => cat(r.categorie), 'Categorie'], ['suma', 'Sumă'], ['moneda', 'Monedă'], ['suma_ron', 'Sumă RON'], ['curs', 'Curs'],
      ['tva_ron', 'TVA inclus (RON)'], [(r) => IMPARTIRI[r.impartire] || '', 'Împărțire'], [(r) => (r.impartire ? procentAfisat(r) : ''), '% Matei'],
      ['efect_matei', 'Matei datorează (RON)'], [(r) => STARI[r.stare], 'Stare'], ['nota', 'Notă / dovadă'],
      [(r) => numeMembru(nom, r.confirmat_de), 'Confirmat de'], ['confirmat_la', 'Confirmat la'],
    ]));
  }

  return (
    <div class="raport">
      <div class="nu-print filtre">
        <button onClick={() => window.print()}>Printează / PDF</button>
        <button onClick={exporta}>Export CSV cu toate liniile</button>
        <button onClick={() => setDeschise(!deschise)}>{deschise ? 'Ascunde liniile' : 'Arată toate liniile'}</button>
        {editor && d.credite && <button onClick={sincronizeaza}>Recalculează creditele</button>}
      </div>
      {mesaj && <p class="mesaj nu-print">{mesaj}</p>}
      {d.eroriOptionale.map((e) => <p class="eroare">{e}</p>)}

      <img src={logo} alt="FA Studios" style={{ height: '20px', marginTop: '8px' }} />
      <h1 class="titlu">Calcul Alex – Matei, noiembrie 2025 – octombrie 2026</h1>
      <p class="gri">
        Generat la {new Date().toLocaleString('ro-RO')}. {confirmate.toLocaleString('ro-RO')} din {cate(d.linii.length, 'linie', 'linii')} confirmate
        · {luniInchise} din {d.luni.length} luni închise.
      </p>
      {!final && <p class="atentie">Suma nu e încă finală: se poate schimba până când toate lunile sunt confirmate și închise.</p>}

      <section class="erou raport-erou">
        <div class="principal">
          <div class="eticheta">{directie(totalConfirmat)}, din ce e confirmat</div>
          <div class="mare">{bani(Math.abs(totalConfirmat))}<small>RON</small></div>
          <div class="sub">Doar liniile și sumele manuale confirmate. Din 20.08.2026 se socotește fără TVA; liniile la care TVA-ul încă nu e scos sunt la „Ce mai lipsește”.</div>
          {creditePartiale.length > 0 && <div class="sub">
            La credite nu sunt confirmate încă toate cele trei părți care se echilibrează (banii primiți, ratele și ce mai era de plătit la data de tăiere):
            din ele e confirmat deocamdată {bani(suma(creditePartiale, confirmatCredit))} lei pentru Matei, iar toate trei dau {bani(suma(creditePartiale, (c) => c.cost_matei))} lei.
          </div>}
        </div>
        <div class="de-facut">
          <h3>Dacă se confirmă și propunerile</h3>
          <div class="cifra">{bani(Math.abs(totalProiectat))} <small>RON</small></div>
          <p class="gri mic" style={{ margin: 0 }}>{directie(totalProiectat)}. {neconfirmate.length
            ? <>Propunerile încă neconfirmate ({neconfirmate.join(', ')}) schimbă suma cu {deConfirmat > 0 ? '+' : ''}{bani(deConfirmat)} lei. Liniile cu întrebări care au deja o împărțire sunt numărate aici.</>
            : 'Nu mai sunt propuneri neconfirmate.'}</p>
          {nedecise.length > 0 && <p class="gri mic" style={{ margin: 0 }}>Încă fără împărțire: {cate(nedecise.length, 'linie', 'linii')}, în valoare de {bani(suma(nedecise, (l) => Math.abs(Number(l.suma_ron ?? 0))))} lei
            (valoarea liniilor, nu efectul) — pe blocuri în coloana „Fără decizie”, <a href="#/tranzactii?impartire=-" target="_blank" rel="noopener">lista în Tranzacții</a>.</p>}
        </div>
      </section>

      <h2>Cum s-a ajuns la sumă</h2>
      <p class="gri mic">Pozitiv = Matei datorează lui Alex; negativ = scade din ce datorează Matei. „Propus” = împărțire stabilită, încă neconfirmată.</p>
      <div class="tabel-lat">
        <table class="tabel">
          <thead><tr><th>Bloc</th><th class="n">Linii</th><th class="n">Valoare</th><th class="n">Confirmat</th><th class="n">Propus</th><th class="n">Fără decizie</th></tr></thead>
          <tbody>{cuLinii.map((b) => (
            <tr>
              <td><a href="#" onClick={(e) => { e.preventDefault(); arataBloc(b.id); }}>{b.titlu}</a></td>
              <td class="n">{b.linii.length}</td>
              <td class="n nowrap">{bani(b.valoare)}</td>
              <td class="n nowrap"><b>{bani(b.confirmat)}</b></td>
              <td class="n nowrap gri">{b.propus ? bani(b.propus) : ''}</td>
              <td class="n nowrap">{b.nedecise ? <span class="atentie">{b.nedecise} · {bani(b.valoareNedecisa)}</span> : ''}</td>
            </tr>
          ))}
          <tr><td>Sume manuale: Beetle și partea lui Matei din ce mai era de plătit la credite</td><td class="n gri">{cate(d.manuale.length, 'element', 'elemente')}</td><td class="n"></td>
            <td class="n nowrap"><b>{bani(suma(manualeConfirmate, semnManual))}</b></td>
            <td class="n nowrap gri">{manualePropuse.length ? bani(suma(manualePropuse, semnManual)) : ''}</td><td></td></tr>
          {rambursariInafara.length > 0 &&
            <tr><td>Bani dați înapoi de Matei în afara extraselor</td><td class="n gri">{cate(rambursariInafara.length, 'rambursare', 'rambursări')}</td><td class="n"></td>
              <td class="n nowrap"><b>{bani(-suma(rambursariInafara.filter((r) => r.stare === 'confirmat'), (r) => r.suma_ron))}</b></td>
              <td class="n nowrap gri">{rambursariPropuse.length ? bani(-suma(rambursariPropuse, (r) => r.suma_ron)) : ''}</td><td></td></tr>}
          </tbody>
          <tfoot><tr><td>Total</td><td class="n">{d.linii.length}</td><td></td>
            <td class="n nowrap"><b>{bani(totalConfirmat)}</b></td><td class="n nowrap">{bani(deConfirmat)}</td>
            <td class="n nowrap">{nedecise.length ? cate(nedecise.length, 'linie', 'linii') : ''}</td></tr></tfoot>
        </table>
      </div>
      {Math.abs(totalBlocuri - totalConfirmat) >= 0.005 &&
        <p class="atentie">Suma pe blocuri ({bani(totalBlocuri)}) nu e aceeași cu cea pe luni ({bani(totalConfirmat)}): există linii sau sume în afara lunilor din calcul.</p>}

      {generale.length > 0 && <>
        <h2>Regulile calculului</h2>
        <ul class="reguli">{generale.map((r) => <li>{r.titlu && <b>{r.titlu}. </b>}{r.text}</li>)}</ul>
      </>}

      {d.credite && d.credite.length > 0 && <>
        <h2>Creditele firmei</h2>
        <p class="intro">
          Banii primiți și ratele plătite se împart 50/50; la data de tăiere Matei preia jumătate din ce mai era de plătit: capitalul rămas
          și dobânda și comisioanele acumulate până atunci (din grafic, pe zile). Banii împrumutați se anulează, așa că Matei suportă jumătate
          din dobânzile și comisioanele de până la data de tăiere.
        </p>
        {d.credite.map((c) => <Credit c={c} grafic={d.grafic.filter((g) => g.credit_id === c.id)} liniePeId={liniePeId} deschis={deschise} editor={editor} />)}
      </>}

      <h2>Pe luni</h2>
      <div class="tabel-lat">
        <table class="tabel">
          <thead><tr><th>Luna</th><th class="n">Linii confirmate</th><th class="n">Din tranzacții</th><th class="n">Manual</th><th class="n">Rambursări</th>
            <th class="n">Sold confirmat</th><th class="n">Propus</th><th>Stare</th></tr></thead>
          <tbody>{d.luni.map((l) => (
            <tr><td>{luna(l.luna)}</td><td class="n">{l.confirmate}/{l.linii}</td><td class="n">{bani(l.efect_tranzactii)}</td><td class="n">{bani(l.efect_manual)}</td>
              <td class="n">{bani(l.rambursari)}</td><td class="n"><b>{bani(l.sold_luna)}</b></td><td class="n gri">{bani(l.in_lucru)}</td>
              <td>{l.status === 'inchisa' ? 'Închisă' : 'Deschisă'}</td></tr>
          ))}</tbody>
          <tfoot><tr><td>Total</td><td class="n">{confirmate}/{d.linii.length}</td><td class="n">{bani(suma(d.luni, (l) => l.efect_tranzactii))}</td>
            <td class="n">{bani(suma(d.luni, (l) => l.efect_manual))}</td><td class="n">{bani(suma(d.luni, (l) => l.rambursari))}</td>
            <td class="n"><b>{bani(totalConfirmat)}</b></td><td class="n gri">{bani(suma(d.luni, (l) => l.in_lucru))}</td><td></td></tr></tfoot>
        </table>
      </div>
      <p class="gri mic">„Propus” pe luni numără doar liniile în starea „Propus”; tabelul de sus numără și liniile cu întrebări care au deja o împărțire.</p>

      <h2>Sume manuale</h2>
      <div class="tabel-lat">
        <table class="tabel">
          <thead><tr><th>Luna</th><th>Descriere</th><th class="n">Sumă</th><th class="n">RON</th><th>Sens</th><th>Stare</th><th>Dovadă</th></tr></thead>
          <tbody>{d.manuale.map((m) => (
            <tr><td class="nowrap">{luna(m.luna)}</td><td>{m.descriere}</td><td class="n nowrap">{bani(m.suma, m.moneda)}</td><td class="n nowrap">{bani(m.suma_ron)}</td>
              <td class="nowrap">{m.sens === 'matei_datoreaza_alex' ? 'Matei → Alex' : 'Alex → Matei'}</td>
              <td><span class={`eticheta-stare ${m.stare}`}>{STARI[m.stare] || m.stare}</span></td><td class="mic">{m.dovada}</td></tr>
          ))}</tbody>
        </table>
      </div>

      {d.rambursari.length > 0 && <>
        <h2>Bani dați înapoi de Matei</h2>
        <div class="tabel-lat">
          <table class="tabel">
            <thead><tr><th>Data</th><th class="n">Sumă</th><th class="n">RON</th><th>Cum</th><th>Stare</th><th>Dovadă</th></tr></thead>
            <tbody>{d.rambursari.map((r) => (
              <tr><td>{data(r.data)}</td><td class="n">{bani(r.suma, r.moneda)}</td><td class="n">{bani(r.suma_ron)}</td><td>{r.metoda}</td>
                <td><span class={`eticheta-stare ${r.stare}`}>{STARI[r.stare] || r.stare}</span>{r.tranzactie_id ? <div class="mic gri">e deja în extrase (linia {r.tranzactie_id})</div> : null}</td>
                <td class="mic">{r.dovada}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </>}

      {zone.length > 0 && <>
        <h2>Ce mai lipsește</h2>
        <table class="tabel">
          <tbody>{zone.map((z) => (
            <tr><td><a href="#/lipsuri">{z.zona}</a></td><td class="n">{z.linii ? cate(z.linii, 'linie', 'linii') : cate(z.randuri, 'punct', 'puncte')}</td>
              <td class="n nowrap">{z.suma ? bani(z.suma, 'RON') : ''}</td></tr>
          ))}</tbody>
        </table>
      </>}

      <h2>Pe blocuri, linie cu linie</h2>
      {cuLinii.map((b) => (
        <details class="bloc-raport" id={`bloc-${b.id}`} open={deschise}>
          <summary>
            <b>{b.titlu}</b>
            <span class="gri mic"> · {cate(b.linii.length, 'linie', 'linii')} · confirmat {bani(b.confirmat)}{b.propus ? ` · propus ${bani(b.propus)}` : ''}{b.nedecise ? ` · ${b.nedecise} fără decizie` : ''}</span>
          </summary>
          {b.text && <p class="regula">{b.text}</p>}
          <Linii linii={b.linii} cat={cat} cine={cine} nom={nom} />
        </details>
      ))}

      {legenda.length > 0 && <>
        <h2>Deciziile lui Alex la care trimit notele</h2>
        <p class="gri mic">Unele note citează reguli numerotate („regula 26”). Acestea sunt:</p>
        <ul class="reguli">{legenda.map((r) => <li><b>{r.titlu}.</b> {r.text}</li>)}</ul>
      </>}
    </div>
  );
}

function Linii({ linii, cat, cine, nom }) {
  return (
    <div class="tabel-lat">
      <table class="tabel mic">
        <thead><tr><th>Data</th><th>Cont</th><th>Cine</th><th>Categorie</th><th class="n">Sumă</th><th class="n">TVA</th><th>Împărțire</th>
          <th class="n">Matei datorează</th><th>Stare</th><th>Dovadă</th></tr></thead>
        <tbody>{linii.map((l) => (
          <tr>
            <td class="nowrap"><a href={`#/tranzactii?luna=${l.luna}&id=${l.id}`} target="_blank" rel="noopener">{data(l.data_extras)}</a></td>
            <td class="nowrap">{l.cont_cod}</td>
            <td>{cine(l)}<div class="gri mic">{(l.descriere || '').slice(0, 70)}</div></td>
            <td>{cat(l.categorie)}</td>
            <td class="n nowrap">{bani(l.suma, l.moneda)}{l.moneda !== 'RON' && l.suma_ron != null && <div class="gri">{bani(l.suma_ron, 'RON')}</div>}</td>
            <td class="n nowrap">{l.tva_ron ? bani(l.tva_ron) : ''}</td>
            <td>{l.impartire === 'procent' ? `${procentAfisat(l)}% Matei` : IMPARTIRI[l.impartire] || ''}</td>
            <td class="n nowrap">{l.efect_matei != null ? bani(l.efect_matei) : ''}</td>
            <td><span class={`eticheta-stare ${l.stare}`}>{STARI[l.stare]}</span>
              {l.confirmat_de && <div class="mic gri nowrap">{numeMembru(nom, l.confirmat_de)}{l.confirmat_la ? `, ${data(l.confirmat_la)}` : ''}</div>}</td>
            <td class="nota-raport">{l.nota}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

// Un credit: datele din contract, cum intră în calcul și graficul de rambursare până după ultima rată plătită.
function Credit({ c, grafic, liniePeId, deschis, editor }) {
  const n = Number(c.rate_platite);
  const plati = (c.plati_ids || []).map((id) => liniePeId[id]).filter(Boolean);
  const element = Number(c.element_suma_ron ?? 0);
  const parte = Number(c.parte_matei_sold ?? 0);
  const inCalcul = Number(c.efect_incasare ?? 0) + Number(c.efect_rate ?? 0) + element;
  const diferentaGrafic = c.rate_grafic != null ? Number(c.platit) - Number(c.rate_grafic) : 0;
  const lunaTaiere = `${c.data_taiere.slice(0, 7)}-01`;
  const altaLuna = c.element_manual_id != null && c.element_luna && c.element_luna !== lunaTaiere;
  const deSincronizat = !c.grafic_lipsa && ((parte > 0 && (c.element_manual_id == null || Math.abs(element - parte) >= 0.005 || altaLuna))
    || (parte <= 0 && c.element_manual_id != null));
  // Fiecare linie se rotunjește la bani, deci totalul poate diferi de calculul pe credit cu câte un ban pe linie.
  const abatere = Math.abs(inCalcul - Number(c.cost_matei ?? 0));
  const nepotrivit = !c.grafic_lipsa && abatere > 0.01 * (n + 2) + 1e-9;
  // Ratele scadente până la data de tăiere care nu sunt încă în extrase (de ex. octombrie, neimportat).
  const lipsa = grafic.filter((g) => g.nr > n && g.data_scadenta <= c.data_taiere);
  // Dobânda și comisioanele acumulate până la data de tăiere: ratele de mai sus întregi, prima de după tăiere pe zile.
  const acumulat = c.acumulat ?? null;
  // Negativ doar dacă în extrase e o rată plătită înainte, dar scadentă după data de tăiere.
  const avans = acumulat != null && Number(acumulat) < 0;
  const partiAcumulat = [
    lipsa.length === 1 ? `din rata ${lipsa[0].nr}: toată dobânda și tot comisionul`
      : lipsa.length > 1 ? `din ratele ${lipsa.map((g) => g.nr).join(', ')}: toată dobânda și tot comisionul` : '',
    c.rata_partiala && Number(c.zile_partiale) > 0
      ? `din rata ${c.rata_partiala}: partea pentru ${c.zile_partiale} din cele ${cate(Number(c.zile_rata_partiala), 'zi', 'zile')}` : '',
  ].filter(Boolean);
  const lunaLinie = (id) => liniePeId[id]?.luna;
  const randuri = grafic.filter((g) => g.nr <= Math.max(n, lipsa.length ? lipsa[lipsa.length - 1].nr : 0) + 1);
  const p = procentText(c.procent_matei);
  const partial = c.rate_confirmate > 0 && (c.stare_incasare !== 'confirmat' || c.element_stare !== 'confirmat');

  return (
    <section class="card credit">
      <h3>{c.nume}</h3>
      <p class="gri" style={{ margin: 0 }}>
        {c.creditor}{c.contract && `, contract ${c.contract}`}, acordat la {data(c.data_acordare)}: {bani(c.valoare, 'RON')}
        {c.dobanda && `, dobândă ${c.dobanda}`}{c.luni && `, ${cate(Number(c.luni), 'lună', 'luni')}`}.
      </p>
      <p class="mic" style={{ margin: 0 }}>
        Data de tăiere: {data(c.data_taiere)} · extrase importate până la {data(c.extrase_pana) || '—'} · ultima rată găsită: {c.ultima_plata ? data(c.ultima_plata) : '—'}
      </p>
      {c.nota && <p class="mic gri" style={{ margin: 0 }}>{c.nota}</p>}
      {lipsa.length > 0 && <p class="atentie" style={{ margin: 0 }}>
        {lipsa.length === 1 ? `Rata ${lipsa[0].nr} (scadentă ${data(lipsa[0].data_scadenta)}) nu e încă în extrase`
          : `Ratele ${lipsa.map((g) => g.nr).join(', ')} nu sunt încă în extrase`}{acumulat != null ? <>: dobânda și comisioanele {lipsa.length === 1 ? 'ei' : 'lor'} sunt
        deja socotite mai jos, din grafic. După import, capitalul rămas devine {bani(lipsa[lipsa.length - 1].sold)} lei, iar costul nu se schimbă
        dacă {lipsa.length === 1 ? 'rata a fost plătită' : 'ratele au fost plătite'} conform graficului.</> : '.'}
      </p>}
      {c.grafic_lipsa && <p class="eroare">{c.sold == null
        ? `Graficul nu are rândul pentru rata ${n}${editor ? '; trebuie adăugat în graficul creditului' : ''}.`
        : `Graficul nu are toate ratele necesare pentru dobânda acumulată (de la ultima rată din extrase până la prima de după data de tăiere)${editor ? '; ratele lipsă trebuie adăugate în graficul creditului' : ''}.`}</p>}
      {c.sold_creditor_vechi && <p class="atentie" style={{ margin: 0 }}>Soldul de la creditor ({bani(c.sold_creditor)} lei) e după rata {c.sold_creditor_dupa_rata},
        dar în extrase sunt {cate(n, 'rată', 'rate')}: până se potrivesc, capitalul rămas se ia din grafic.</p>}
      {partial && <p class="mic atentie" style={{ margin: 0 }}>
        {c.stare_incasare !== 'confirmat' && c.element_stare !== 'confirmat'
          ? 'Ratele sunt confirmate, dar banii primiți și ce mai era de plătit la data de tăiere sunt doar propuse'
          : c.stare_incasare !== 'confirmat'
            ? 'Ratele și ce mai era de plătit la data de tăiere sunt confirmate, dar banii primiți sunt doar propuși'
            : 'Ratele și banii primiți sunt confirmate, dar ce mai era de plătit la data de tăiere e doar propus'}: până se confirmă toate trei,
        suma confirmată conține doar o parte din calculul creditului.</p>}

      <div class="tabel-lat">
        <table class="tabel">
          <thead><tr><th>Ce intră în calcul</th><th class="n">Bani (lei)</th><th class="n">Matei datorează</th><th>Stare</th></tr></thead>
          <tbody>
            <tr>
              <td>Banii primiți în cont (<a href={`#/tranzactii?luna=${lunaLinie(c.tranzactie_incasare_id) || ''}&id=${c.tranzactie_incasare_id}`} target="_blank" rel="noopener">linia {c.tranzactie_incasare_id}</a>), {p} pentru Matei
                {Number(c.comision_acordare) ? `; ${bani(c.comision_acordare)} lei au fost reținuți de creditor la acordare` : ''}</td>
              <td class="n nowrap">{bani(-Number(c.primit))}</td><td class="n nowrap">{bani(c.efect_incasare)}</td>
              <td>{c.stare_incasare && <span class={`eticheta-stare ${c.stare_incasare}`}>{STARI[c.stare_incasare]}</span>}
                {c.impartire_incasare !== '50_50' && <div class="mic atentie">împărțirea liniei e {IMPARTIRI[c.impartire_incasare] || 'necompletată'}</div>}</td>
            </tr>
            <tr>
              <td>{cate(n, 'rată plătită', 'rate plătite')}{plati.length ? ` (${data(plati[0].data_extras)} – ${data(plati[plati.length - 1].data_extras)})` : ''}, {p} pentru Matei</td>
              <td class="n nowrap">{bani(c.platit)}</td><td class="n nowrap">{bani(c.efect_rate)}</td>
              <td class="mic">{c.rate_confirmate}/{n} confirmate{c.rate_fara_impartire ? <div class="atentie">{c.rate_fara_impartire} fără împărțire</div> : null}</td>
            </tr>
            <tr>
              <td>Ce mai era de plătit la {data(c.data_taiere)}: Matei preia {p}
                {!c.grafic_lipsa && <div class="mic gri">capitalul rămas după rata {n}{c.scadenta_ultima_rata ? ` (scadentă ${data(c.scadenta_ultima_rata)})` : ''}
                  {c.sursa_sold === 'creditor' ? `, din extrasul creditorului la ${data(c.data_sold_creditor)}` : ', din grafic'}: {bani(c.sold)} lei
                  {acumulat != null && (avans
                    ? <>, minus dobânda și comisioanele plătite în avans pentru după {data(c.data_taiere)}, din grafic: {bani(-Number(acumulat))} lei</>
                    : <>, plus dobânda și comisioanele de la {data(c.acumulat_de_la)} până la {data(c.data_taiere)}, din grafic:
                      {' '}{bani(acumulat)} lei{partiAcumulat.length ? ` (${partiAcumulat.join('; ')})` : ''}</>)}</div>}</td>
              <td class="n nowrap">{c.grafic_lipsa ? '—' : bani(c.sold_taiere ?? c.sold)}</td><td class="n nowrap">{c.element_manual_id ? bani(element) : ''}</td>
              <td>{c.element_stare && <span class={`eticheta-stare ${c.element_stare}`}>{STARI[c.element_stare]}</span>}
                {deSincronizat && <div class="mic atentie">{!editor ? 'în curs de actualizare'
                  : c.element_stare === 'confirmat'
                    ? `ar trebui ${bani(parte)}${altaLuna ? ` în ${luna(lunaTaiere)}` : ''}; elementul e confirmat: trece-l pe Propus în Sume manuale, apoi apasă „Recalculează creditele”`
                    : `ar trebui ${bani(parte)}${altaLuna ? ` în ${luna(lunaTaiere)} (acum e în ${luna(c.element_luna)})` : ''}: apasă „Recalculează creditele”`}</div>}</td>
            </tr>
          </tbody>
          <tfoot><tr><td>Costul creditului până la {data(c.data_taiere)} · partea lui Matei</td><td class="n nowrap">{c.grafic_lipsa ? '—' : bani(c.cost)}</td>
            <td class="n nowrap"><b>{bani(inCalcul)}</b></td>
            <td class="mic">{c.grafic_lipsa ? '—' : nepotrivit ? <span class="atentie">ar trebui {bani(c.cost_matei)}</span>
              : `se potrivește${abatere >= 0.005 ? ' (rotunjire pe linii)' : ''}`}</td></tr></tfoot>
        </table>
      </div>

      {!c.grafic_lipsa && <p class="mic" style={{ margin: 0 }}>
        Cost = rate plătite + ce mai era de plătit la {data(c.data_taiere)} − bani primiți = {bani(c.platit)} + {bani(c.sold_taiere ?? c.sold)} − {bani(c.primit)} = {bani(c.cost)} lei:
        dobânzi {bani(c.dobanda_grafic ?? 0)} și comisioane {bani(c.comision_grafic ?? 0)} din grafic până la rata {n}
        {acumulat == null ? '' : avans
          ? `, minus dobânzi ${bani(-Number(c.dobanda_acumulata))} și comisioane ${bani(-Number(c.comision_acumulat))} plătite în avans pentru după ${data(c.data_taiere)}`
          : `, dobânzi ${bani(c.dobanda_acumulata)} și comisioane ${bani(c.comision_acumulat)} acumulate de atunci până la ${data(c.data_taiere)}`}
        {Number(c.comision_acordare) ? `, ${bani(c.comision_acordare)} reținuți la acordare` : ''}
        {Math.abs(diferentaGrafic) >= 0.01
          ? `. Ratele plătite diferă de grafic cu ${bani(diferentaGrafic)} lei (${bani(c.platit)} față de ${bani(c.rate_grafic)}); explicația e în nota creditului de mai sus`
          : ''}.
      </p>}
      {c.dovada && <p class="mic gri" style={{ margin: 0 }}>Dovadă: {c.dovada}</p>}

      <details class="bloc-raport" open={deschis}>
        <summary>Graficul de rambursare, {randuri.length === 1 ? 'prima rată' : `primele ${cate(randuri.length, 'rată', 'rate')}`}</summary>
        <div class="tabel-lat">
          <table class="tabel mic">
            <thead><tr><th class="n">Nr.</th><th>Scadență</th><th>Plătit</th><th class="n">Capital</th><th class="n">Dobândă</th><th class="n">Comision</th><th class="n">Rată</th><th class="n">Sold rămas</th></tr></thead>
            <tbody>{randuri.map((g) => {
              const pl = plati[g.nr - 1];
              const neimportata = !pl && g.data_scadenta <= c.data_taiere;
              return (
                <tr class={g.nr <= n ? '' : 'gri'}>
                  <td class="n">{g.nr}</td><td class="nowrap">{data(g.data_scadenta)}</td>
                  <td class="nowrap">{pl ? <a href={`#/tranzactii?luna=${pl.luna}&id=${pl.id}`} target="_blank" rel="noopener">{data(pl.data_extras)} · {bani(-Number(pl.suma))}</a>
                    : neimportata ? <span class="atentie">lipsește din extrase{acumulat != null ? '; dobânda și comisionul sunt socotite' : ''}</span>
                    : acumulat != null && !avans && g.nr === c.rata_partiala && Number(c.zile_partiale) > 0
                      ? <span class="gri">dobânda și comisionul pentru {c.zile_partiale} din cele {cate(Number(c.zile_rata_partiala), 'zi', 'zile')}</span>
                    : <span class="gri">—</span>}</td>
                  <td class="n">{bani(g.capital)}</td><td class="n">{bani(g.dobanda)}</td><td class="n">{bani(g.comision)}</td><td class="n">{bani(g.rata)}</td>
                  <td class="n">{g.nr === n ? <b>{bani(g.sold)}</b> : bani(g.sold)}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
