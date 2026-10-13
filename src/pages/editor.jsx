import { useContext, useEffect, useState } from 'preact/hooks';
import { sb, q } from '../supabase.js';
import { Ctx } from '../app.jsx';
import { bani, data, dataOra, STARI, IMPARTIRI, citesteSuma, citesteCurs, citesteProcent, rotunjeste, ziPlus, efectLinie } from '../format.js';
import { WhatsappContext } from './whatsapp.jsx';

const CAMPURI = ['stare', 'categorie', 'impartire', 'contrapartida', 'client_id', 'colaborator_id',
  'cost_recurent_id', 'pereche_id', 'suma_ron', 'tva_ron', 'curs', 'sursa_curs', 'nota'];
// Câmpurile care schimbă suma: dacă se schimbă pe o linie confirmată, linia trebuie confirmată din nou.
const MATERIALE = ['categorie', 'impartire', 'procent_matei', 'procent_precis', 'suma_ron', 'tva_ron', 'curs',
  'client_id', 'colaborator_id', 'cost_recurent_id', 'pereche_id'];

export function mesajEroare(m) {
  if (/confirmat_are_ron/.test(m)) return 'O linie confirmată trebuie să aibă suma în RON (completează cursul).';
  if (/clasificari_check1/.test(m) || (/procent_matei/.test(m) && /check/.test(m))) return 'Alege procentul lui Matei (0-100).';
  if (/clasificari_check/.test(m) || /stare <> 'confirmat'/.test(m)) return 'O linie confirmată trebuie să aibă o împărțire aleasă.';
  return m;
}

export function procentAfisat(r) {
  const p = r.procent_precis ?? r.procent_matei;
  return p === null || p === undefined ? '' : String(Number(p)).replace('.', ',');
}

const egal = (a, b) => (a ?? null) === (b ?? null) || (a !== null && b !== null && a !== undefined && b !== undefined && Number(a) === Number(b) && !isNaN(Number(a)));

export function Editor({ id, inchide, salvat, urmator, anterior, filtreaza }) {
  const { nom } = useContext(Ctx);
  const [t, setT] = useState(null);
  const [v, setV] = useState(null);
  const [ronManual, setRonManual] = useState(false);
  const [mesaj, setMesaj] = useState('');
  const [intrebari, setIntrebari] = useState([]);
  const [istoric, setIstoric] = useState([]);
  const [perechi, setPerechi] = useState(null);
  const [nouaIntrebare, setNouaIntrebare] = useState('');

  async function incarca() {
    try {
      const [r] = await q(sb.from('v_tranzactii').select('*').eq('id', id));
      if (!r) throw new Error(`Linia #${id} nu există (a fost ștearsă sau reimportată).`);
      setT(r);
      const f = Object.fromEntries(CAMPURI.map((k) => [k, r[k] ?? '']));
      for (const k of ['suma_ron', 'tva_ron', 'curs']) if (f[k] !== '') f[k] = String(f[k]).replace('.', ',');
      f.procent = procentAfisat(r);
      setV(f);
      setRonManual(false);
      setIntrebari(await q(sb.from('intrebari').select('*').eq('tranzactie_id', id).order('creat_la')));
      setIstoric(await q(sb.from('jurnal').select('*').eq('tabel', 'clasificari').eq('rand_id', String(id)).order('la', { ascending: false }).limit(30)));
    } catch (e) { setMesaj(e.message); }
  }
  useEffect(() => { incarca(); }, [id]);

  useEffect(() => {
    const k = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
      if (e.key === 'Escape') inchide();
      if (e.key === 'ArrowDown' && urmator) { e.preventDefault(); urmator(); }
      if (e.key === 'ArrowUp' && anterior) { e.preventDefault(); anterior(); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [urmator, anterior]);

  if (!t || !v) {
    return (
      <aside class="panou">
        <div class="panou-sus"><span /><button class="mic" onClick={inchide} title="Închide (Esc)">✕</button></div>
        {mesaj ? <p class="eroare">{mesaj}</p> : <p class="gri">Se încarcă…</p>}
      </aside>
    );
  }

  const set = (k, x) => setV({ ...v, [k]: x });
  const strain = t.moneda !== 'RON';
  const semn = Math.sign(t.suma) || 1;

  // Ce s-ar salva acum, citit din formular. Erorile apar lângă câmpuri înainte de salvare.
  const curs = strain ? citesteCurs(v.curs) : 1;
  const ronScris = strain ? citesteSuma(v.suma_ron) : t.suma;
  const ronCalculat = strain && typeof curs === 'number' ? rotunjeste(t.suma * curs) : null;
  const ron = strain ? (ronScris === null ? ronCalculat : (typeof ronScris === 'number' ? semn * Math.abs(ronScris) : undefined)) : t.suma;
  const tvaScris = citesteSuma(v.tva_ron);
  const tva = typeof tvaScris === 'number' ? semn * Math.abs(tvaScris) : tvaScris;
  const procent = v.impartire === 'procent' ? citesteProcent(v.procent) : null;
  const efect = efectLinie({ titular: t.titular, impartire: v.impartire, procent, suma_ron: typeof ron === 'number' ? ron : null, tva_ron: typeof tva === 'number' ? tva : 0 });
  const nepotrivit = strain && typeof curs === 'number' && typeof ron === 'number' && ronScris !== null
    && Math.abs(ron - t.suma * curs) > Math.max(0.01, Math.abs(ron) * 0.005);
  const cuTva = t.data_extras >= '2026-08-01' && t.titular === 'firma';
  const client = nom.clienti.find((c) => String(c.id) === String(v.client_id));

  function construieste() {
    if (strain && curs === undefined) return 'Cursul nu e un număr (ex. 5,0889).';
    if (strain && ronScris === undefined) return 'Suma în RON nu e un număr (ex. 1.234,56).';
    if (tvaScris === undefined) return 'TVA-ul nu e un număr (ex. 199,50).';
    if (nepotrivit) return `Suma în RON nu se potrivește cu cursul: ${bani(t.suma)} × ${curs} = ${bani(t.suma * curs)}. Corectează cursul sau suma.`;
    if (typeof tva === 'number' && tva !== 0 && (typeof ron !== 'number' || Math.abs(tva) >= Math.abs(ron))) return 'TVA-ul trebuie să fie mai mic decât suma în RON.';
    if (v.impartire === 'procent' && procent === undefined) return 'Scrie procentul lui Matei (0-100, sau 1/3).';
    if (v.pereche_id !== '' && !/^\d+$/.test(String(v.pereche_id).trim())) return 'ID-ul liniei pereche trebuie să fie un număr.';
    const upd = {};
    for (const k of CAMPURI) upd[k] = v[k] === '' ? null : v[k];
    for (const k of ['client_id', 'colaborator_id', 'cost_recurent_id', 'pereche_id']) if (upd[k] !== null) upd[k] = Number(upd[k]);
    upd.curs = strain ? curs : 1;
    upd.suma_ron = typeof ron === 'number' ? ron : null;
    upd.tva_ron = typeof tva === 'number' ? tva : null;
    if (v.impartire === 'procent') {
      if (Math.round(procent * 100) / 100 === procent) { upd.procent_matei = procent; upd.procent_precis = null; }
      else { upd.procent_precis = procent; upd.procent_matei = Math.round(procent * 100) / 100; }
    }
    return upd;
  }

  async function salveaza(stareNoua, merge) {
    setMesaj('');
    const upd = construieste();
    if (typeof upd === 'string') { setMesaj(upd); return; }
    if (stareNoua) upd.stare = stareNoua;
    else if (t.stare === 'confirmat') {
      const vechi = { ...t, curs: strain ? t.curs : 1 };
      const schimbat = MATERIALE.some((k) => k in upd && !egal(upd[k], vechi[k]));
      if (schimbat) upd.stare = 'propus';  // o linie confirmată schimbată se confirmă din nou
    }
    try {
      await q(sb.from('clasificari').update(upd).eq('tranzactie_id', id));
      salvat();
      if (merge && urmator) urmator(); else {
        incarca();
        if (upd.stare === 'propus' && t.stare === 'confirmat' && !stareNoua) setMesaj('Ai schimbat o linie confirmată: a redevenit „propus” și trebuie confirmată din nou.');
      }
    } catch (e) { setMesaj(mesajEroare(e.message)); }
  }

  async function cautaPerechi() {
    try {
      setPerechi(await q(sb.from('v_tranzactii').select('id,data_extras,cont_cod,contrapartida,suma,moneda,descriere')
        .neq('cont_id', t.cont_id).gte('data_extras', ziPlus(t.data_extras, -4)).lte('data_extras', ziPlus(t.data_extras, 4))
        .eq('suma', -t.suma).limit(20)));
    } catch (e) { setMesaj(e.message); }
  }

  async function adaugaIntrebare() {
    if (!nouaIntrebare.trim()) return;
    try {
      // Întâi starea liniei: dacă luna e închisă, se oprește aici și nu rămâne o întrebare agățată.
      await q(sb.from('clasificari').update({ stare: 'intrebare' }).eq('tranzactie_id', id));
      await q(sb.from('intrebari').insert({ tranzactie_id: id, titlu: nouaIntrebare.trim() }));
      setNouaIntrebare('');
      salvat(); incarca();
    } catch (e) { setMesaj(e.message); }
  }

  const citit = (x, f) => (x === undefined ? <span class="citit rau">nu e un număr</span> : x === null ? null : <span class="citit">= {f(x)}</span>);

  return (
    <aside class="panou">
      <div class="panou-sus">
        <button class="mic" onClick={anterior} disabled={!anterior} title="Linia anterioară (↑)">↑</button>
        <button class="mic" onClick={urmator} disabled={!urmator} title="Linia următoare (↓)">↓</button>
        <span class="gri mic">#{t.id} · {t.cont_nume}</span>
        <button class="mic" onClick={inchide} title="Închide (Esc)">✕</button>
      </div>

      <div class={`suma-mare ${t.suma < 0 ? 'neg' : 'poz'}`}>{bani(t.suma, t.moneda)}</div>
      <div class="gri mic">
        {data(t.data_extras)}{t.data_reala && t.data_reala !== t.data_extras ? ` · plătit pe ${data(t.data_reala)}` : ''}
        {t.suma_originala && <> · original {t.suma_originala}</>}
        {' '}· <span class={`eticheta-stare ${t.stare}`}>{STARI[t.stare]}</span>
      </div>
      <pre class="descriere-completa">{t.descriere}</pre>
      {t.contrapartida && <button class="link mic" onClick={() => filtreaza(t.contrapartida)}>Toate liniile cu „{t.contrapartida}”</button>}

      <div class="bloc">
        <h4>Ce este</h4>
        <div class="grila">
          <label>Categorie
            <select value={v.categorie} onChange={(e) => set('categorie', e.target.value)}>
              <option value="">—</option>
              {nom.categorii.map((c) => <option value={c.cod}>{c.eticheta}</option>)}
            </select>
          </label>
          <label>Client / proiect
            <select value={v.client_id} onChange={(e) => set('client_id', e.target.value)}>
              <option value="">—</option>
              {nom.clienti.map((c) => <option value={c.id}>{c.nume}</option>)}
            </select>
          </label>
          <label>Colaborator
            <select value={v.colaborator_id} onChange={(e) => set('colaborator_id', e.target.value)}>
              <option value="">—</option>
              {nom.colaboratori.map((c) => <option value={c.id}>{c.nume}</option>)}
            </select>
          </label>
          <label>Cost recurent
            <select value={v.cost_recurent_id} onChange={(e) => set('cost_recurent_id', e.target.value)}>
              <option value="">—</option>
              {nom.costuri.map((c) => <option value={c.id}>{c.nume}</option>)}
            </select>
          </label>
          <label class="tot">Contrapartidă<input value={v.contrapartida} onInput={(e) => set('contrapartida', e.target.value)} /></label>
        </div>
      </div>

      <div class="bloc">
        <h4>Cum se împarte</h4>
        <div class="segmente">
          {Object.entries(IMPARTIRI).map(([k, x]) => (
            <button type="button" class={v.impartire === k ? 'activ' : ''} onClick={() => set('impartire', v.impartire === k ? '' : k)}>{x}</button>
          ))}
        </div>
        {v.impartire === 'procent' && (
          <div class="rand" style={{ marginTop: '8px' }}>
            <input class="scurt" value={v.procent} onInput={(e) => set('procent', e.target.value)} placeholder="%" />
            <span class="gri mic">% al lui Matei</span>
            <button type="button" class="mic" onClick={() => set('procent', '1/3')} title="Chiria biroului din 29.06.2026, cu Nicole">1/3</button>
            {procent === undefined && v.procent !== '' && <span class="citit rau">procent invalid</span>}
          </div>
        )}
        {client?.procent_matei !== null && client?.procent_matei !== undefined && !(v.impartire === 'procent' && procent === Number(client.procent_matei)) && (
          <button type="button" class="link mic" onClick={() => setV({ ...v, impartire: 'procent', procent: String(Number(client.procent_matei)).replace('.', ',') })}>
            Folosește procentul lui Matei pe {client.nume}: {String(Number(client.procent_matei)).replace('.', ',')}%
          </button>
        )}
      </div>

      <div class="bloc">
        <h4>Suma</h4>
        <div class="grila">
          {strain && <>
            <label>Curs (1 {t.moneda} = ? RON)
              <input value={v.curs} onInput={(e) => setV({ ...v, curs: e.target.value, suma_ron: ronManual ? v.suma_ron : '' })} placeholder="ex. 5,0889" />
              {citit(curs, (x) => String(x).replace('.', ','))}
            </label>
            <label>Sumă în RON
              <input value={v.suma_ron} onInput={(e) => { setRonManual(true); set('suma_ron', e.target.value); }} placeholder={ronCalculat !== null ? bani(ronCalculat) : 'din curs'} />
              {ronScris === null && ronCalculat !== null ? <span class="citit">calculat din curs</span> : citit(ron, (x) => bani(x, 'RON'))}
            </label>
            <label class="tot">Sursa cursului<input value={v.sursa_curs} onInput={(e) => set('sursa_curs', e.target.value)} placeholder="ex. conversie Revolut / BNR 12.03.2026" /></label>
          </>}
          <label class={strain ? '' : 'tot'}>TVA inclus în sumă (RON){cuTva && !v.tva_ron && <b class="atentie"> · de completat</b>}
            <input value={v.tva_ron} onInput={(e) => set('tva_ron', e.target.value)} placeholder={cuTva ? 'din factură, 0 dacă nu are' : 'doar din aug 2026'} />
            {citit(tva, (x) => bani(x, 'RON'))}
          </label>
          <label>Linia pereche (transfer)
            <span class="rand"><input value={v.pereche_id} onInput={(e) => set('pereche_id', e.target.value)} placeholder="ID" />
              <button type="button" class="mic" onClick={cautaPerechi}>Caută</button></span>
          </label>
        </div>
        {perechi && (
          <div class="perechi">
            {perechi.length === 0 ? <span class="gri mic" style={{ padding: '6px 10px', display: 'block' }}>Nicio linie cu suma opusă în ±4 zile în alt cont.</span> : perechi.map((p) => (
              <div class="pereche" onClick={() => { set('pereche_id', String(p.id)); setPerechi(null); }}>
                #{p.id} · {data(p.data_extras)} · {p.cont_cod} · {bani(p.suma, p.moneda)} · {p.contrapartida}
              </div>
            ))}
          </div>
        )}
        <div class={`efect-viu ${efect ? '' : 'zero'}`}>
          <span class="mic gri">Efect în calcul, cu valorile de mai sus</span>
          <b>{efect === null ? '—' : efect === 0 ? '0,00 RON' : `${efect > 0 ? 'Matei datorează' : 'Alex datorează'} ${bani(Math.abs(efect), 'RON')}`}</b>
          {nepotrivit && <span class="citit rau">Suma în RON nu se potrivește cu cursul.</span>}
        </div>
      </div>

      <div class="bloc">
        <label class="lat">Dovadă / notă
          <textarea rows="3" value={v.nota} onInput={(e) => set('nota', e.target.value)} placeholder="De unde știm: mesaj WhatsApp, factură, confirmare de la Matei…" />
        </label>
        <div class="actiuni">
          <button onClick={() => salveaza(null)}>Salvează</button>
          <button onClick={() => salveaza('propus', true)} title="Robert propune, Alex confirmă">Propune →</button>
          <button class="primar" onClick={() => salveaza('confirmat', true)}>Confirmă →</button>
        </div>
        {t.confirmat_de && <div class="gri mic">Confirmat de {t.confirmat_de}, {dataOra(t.confirmat_la)}</div>}
        {mesaj && <p class="eroare">{mesaj}</p>}
      </div>

      <div class="bloc">
        <h4>Întrebări</h4>
        {intrebari.map((i) => (
          <div class={`intrebare ${i.stare}`}>
            <b>{i.titlu}</b> <span class="gri mic">({i.stare}, {i.creat_de})</span>
            {i.raspuns && <div>→ {i.raspuns} <span class="gri mic">({i.sursa_raspuns})</span></div>}
          </div>
        ))}
        <div class="rand">
          <input placeholder="Ce nu e clar la linia asta?" value={nouaIntrebare} onInput={(e) => setNouaIntrebare(e.target.value)} />
          <button class="mic" onClick={adaugaIntrebare}>Întreabă</button>
        </div>
      </div>

      <div class="bloc">
        <h4>Din WhatsApp cu Matei</h4>
        <WhatsappContext data={t.data_reala || t.data_extras} suma={t.suma} />
      </div>

      <div class="bloc">
        <h4>Istoric</h4>
        <Istoric intrari={istoric} />
      </div>
    </aside>
  );
}

export function Istoric({ intrari }) {
  if (!intrari.length) return <p class="gri mic">Nicio modificare încă.</p>;
  return (
    <ul class="istoric">
      {intrari.map((j) => {
        const sch = j.actiune === 'UPDATE' && j.vechi && j.nou
          ? Object.keys(j.nou).filter((k) => !['actualizat_la', 'actualizat_de', 'confirmat_la', 'confirmat_de'].includes(k) && JSON.stringify(j.nou[k]) !== JSON.stringify(j.vechi[k]))
          : [];
        return (
          <li>
            <span class="gri">{dataOra(j.la)} · {j.email || 'sistem'}</span>{' '}
            {j.actiune === 'INSERT' ? 'creat' : j.actiune === 'DELETE' ? 'șters' : sch.map((k) => (
              <span class="schimbare">{k}: <s>{String(j.vechi[k] ?? '—')}</s> → {String(j.nou[k] ?? '—')}</span>
            ))}
          </li>
        );
      })}
    </ul>
  );
}
