import { useContext, useEffect, useState } from 'preact/hooks';
import { sb, q, toate } from '../supabase.js';
import { Ctx } from '../app.jsx';
import { bani, data, luna, suma, IMPARTIRI, csv, descarca } from '../format.js';
import { procentAfisat } from './editor.jsx';
import logo from '../assets/fastudios-dark.svg';

// Raportul pentru Matei: doar ce e confirmat, cu fiecare linie care are efect.
export function Raport() {
  const { nom } = useContext(Ctx);
  const [d, setD] = useState(null);
  const [eroare, setEroare] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [luni, linii, manuale, rambursari] = await Promise.all([
          q(sb.from('v_rezumat_luna').select('*').order('luna')),
          toate(() => sb.from('v_tranzactii').select('*').eq('stare', 'confirmat').not('efect_matei', 'is', null).neq('efect_matei', 0).order('data_extras').order('id')),
          q(sb.from('elemente_manuale').select('*').eq('stare', 'confirmat').order('luna')),
          q(sb.from('rambursari').select('*').eq('stare', 'confirmat').is('tranzactie_id', null).order('data')),
        ]);
        setD({ luni, linii, manuale, rambursari });
      } catch (e) { setEroare(e.message); }
    })();
  }, []);

  if (eroare) return <p class="eroare">{eroare}</p>;
  if (!d) return <p>Se încarcă…</p>;

  const cat = (c) => nom.categorii.find((x) => x.cod === c)?.eticheta || 'Fără categorie';
  const peCategorie = {};
  for (const l of d.linii) (peCategorie[cat(l.categorie)] ||= []).push(l);
  const total = suma(d.luni, (l) => l.sold_luna);
  const deschise = d.luni.filter((l) => l.status !== 'inchisa');

  function exporta() {
    descarca('raport_calcul_matei.csv', csv(d.linii, [
      ['data_extras', 'Data'], ['cont_nume', 'Cont'], ['contrapartida', 'Contrapartidă'], ['descriere', 'Descriere'],
      [(r) => cat(r.categorie), 'Categorie'], ['suma', 'Sumă'], ['moneda', 'Monedă'], ['suma_ron', 'Sumă RON'], ['curs', 'Curs'], ['sursa_curs', 'Sursa cursului'],
      ['tva_ron', 'TVA inclus (RON)'], [(r) => IMPARTIRI[r.impartire], 'Împărțire'], [(r) => procentAfisat(r), '% Matei'], ['efect_matei', 'Matei datorează (RON)'], ['nota', 'Notă / dovadă'],
      ['confirmat_de', 'Confirmat de'], ['confirmat_la', 'Confirmat la'],
    ]));
  }

  return (
    <div class="raport">
      <div class="nu-print filtre">
        <button onClick={() => window.print()}>Printează / PDF</button>
        <button onClick={exporta}>Export CSV cu toate liniile</button>
      </div>
      <img src={logo} alt="FA Studios" style={{ height: '20px', marginTop: '8px' }} />
      <h1 class="titlu">Calcul Alex – Matei, noiembrie 2025 – octombrie 2026</h1>
      <p class="gri">Generat la {new Date().toLocaleString('ro-RO')}. Conține doar elemente confirmate, fiecare cu dovada ei.</p>
      {deschise.length > 0 && <p class="atentie">Atenție: {deschise.length} luni nu sunt încă închise ({deschise.map((l) => luna(l.luna)).join(', ')}). Suma poate să se schimbe.</p>}
      <section class="erou" style={{ gridTemplateColumns: '1fr' }}>
        <div class="principal">
          <div class="eticheta">{total >= 0 ? 'Matei datorează lui Alex' : 'Alex datorează lui Matei'}</div>
          <div class="mare">{bani(Math.abs(total))}<small>RON</small></div>
          <div class="sub">Din august 2026 sumele sunt fără TVA. Plățile către Matei, mama lui, Antonia și TH Media contează 100% ale lui.</div>
        </div>
      </section>

      <h2>Pe luni</h2>
      <table class="tabel">
        <thead><tr><th>Luna</th><th class="n">Din tranzacții</th><th class="n">Elemente manuale</th><th class="n">Rambursări</th><th class="n">Sold lună</th><th>Stare</th></tr></thead>
        <tbody>{d.luni.map((l) => (
          <tr><td>{luna(l.luna)}</td><td class="n">{bani(l.efect_tranzactii)}</td><td class="n">{bani(l.efect_manual)}</td>
            <td class="n">{bani(l.rambursari)}</td><td class="n"><b>{bani(l.sold_luna)}</b></td><td>{l.status === 'inchisa' ? 'Închisă' : 'Deschisă'}</td></tr>
        ))}</tbody>
        <tfoot><tr><td>Total</td><td class="n">{bani(suma(d.luni, (l) => l.efect_tranzactii))}</td><td class="n">{bani(suma(d.luni, (l) => l.efect_manual))}</td>
          <td class="n">{bani(suma(d.luni, (l) => l.rambursari))}</td><td class="n"><b>{bani(total)}</b></td><td></td></tr></tfoot>
      </table>

      <h2>Pe categorii</h2>
      <table class="tabel">
        <thead><tr><th>Categorie</th><th class="n">Linii</th><th class="n">Matei datorează</th></tr></thead>
        <tbody>{Object.entries(peCategorie).sort((a, b) => suma(b[1], (x) => x.efect_matei) - suma(a[1], (x) => x.efect_matei)).map(([c, l]) => (
          <tr><td>{c}</td><td class="n">{l.length}</td><td class="n">{bani(suma(l, (x) => x.efect_matei))}</td></tr>
        ))}</tbody>
      </table>

      {d.manuale.length > 0 && <>
        <h2>Elemente manuale</h2>
        <table class="tabel">
          <thead><tr><th>Luna</th><th>Descriere</th><th class="n">Sumă</th><th class="n">RON</th><th>Sens</th><th>Dovadă</th></tr></thead>
          <tbody>{d.manuale.map((m) => (
            <tr><td>{luna(m.luna)}</td><td>{m.descriere}</td><td class="n">{bani(m.suma, m.moneda)}</td><td class="n">{bani(m.suma_ron)}</td>
              <td>{m.sens === 'matei_datoreaza_alex' ? 'Matei → Alex' : 'Alex → Matei'}</td><td class="mic">{m.dovada}</td></tr>
          ))}</tbody>
        </table>
      </>}

      {d.rambursari.length > 0 && <>
        <h2>Bani dați înapoi de Matei (în afara extraselor)</h2>
        <table class="tabel">
          <thead><tr><th>Data</th><th class="n">Sumă</th><th class="n">RON</th><th>Cum</th><th>Dovadă</th></tr></thead>
          <tbody>{d.rambursari.map((r) => (
            <tr><td>{data(r.data)}</td><td class="n">{bani(r.suma, r.moneda)}</td><td class="n">{bani(r.suma_ron)}</td><td>{r.metoda}</td><td class="mic">{r.dovada}</td></tr>
          ))}</tbody>
        </table>
      </>}

      <h2>Toate liniile cu efect ({d.linii.length})</h2>
      <table class="tabel mic">
        <thead><tr><th>Data</th><th>Cont</th><th>Contrapartidă</th><th>Categorie</th><th class="n">Sumă</th><th class="n">TVA</th><th>Împărțire</th><th class="n">Matei datorează</th><th>Dovadă</th></tr></thead>
        <tbody>{d.linii.map((l) => (
          <tr><td class="nowrap">{data(l.data_extras)}</td><td class="nowrap">{l.cont_cod}</td><td>{l.contrapartida}</td><td>{cat(l.categorie)}</td>
            <td class="n nowrap">{bani(l.suma, l.moneda)}{l.moneda !== 'RON' && <div class="gri">{bani(l.suma_ron, 'RON')}</div>}</td>
            <td class="n nowrap">{l.tva_ron ? bani(l.tva_ron) : ''}</td>
            <td>{l.impartire === 'procent' ? `${procentAfisat(l)}% Matei` : IMPARTIRI[l.impartire]}</td>
            <td class="n nowrap">{bani(l.efect_matei)}</td><td>{l.nota}</td></tr>
        ))}</tbody>
      </table>
    </div>
  );
}
