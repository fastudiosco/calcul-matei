import { useContext, useEffect, useState } from 'preact/hooks';
import { sb, q } from '../supabase.js';
import { Ctx } from '../app.jsx';
import { bani, data, dataOra, STARI, IMPARTIRI } from '../format.js';
import { WhatsappContext } from './whatsapp.jsx';

const CAMPURI = ['stare', 'categorie', 'impartire', 'procent_matei', 'contrapartida', 'client_id', 'colaborator_id',
  'cost_recurent_id', 'pereche_id', 'suma_ron', 'curs', 'sursa_curs', 'nota'];

export function mesajEroare(m) {
  if (/clasificari_check/.test(m) || /stare <> 'confirmat'/.test(m)) return 'O linie confirmată trebuie să aibă o împărțire aleasă.';
  if (/procent_matei/.test(m) && /check/.test(m)) return 'Alege procentul lui Matei (0-100).';
  return m;
}

export function Editor({ id, inchide, salvat, urmator, anterior, filtreaza }) {
  const { nom } = useContext(Ctx);
  const [t, setT] = useState(null);
  const [v, setV] = useState(null);
  const [mesaj, setMesaj] = useState('');
  const [intrebari, setIntrebari] = useState([]);
  const [istoric, setIstoric] = useState([]);
  const [perechi, setPerechi] = useState(null);
  const [nouaIntrebare, setNouaIntrebare] = useState('');

  async function incarca() {
    try {
      const [r] = await q(sb.from('v_tranzactii').select('*').eq('id', id));
      setT(r);
      setV(Object.fromEntries(CAMPURI.map((k) => [k, r[k] ?? ''])));
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

  if (!t || !v) return <aside class="panou"><p>Se încarcă…</p></aside>;

  const set = (k, x) => setV({ ...v, [k]: x });
  const strain = t.moneda !== 'RON';

  async function salveaza(stareNoua, merge) {
    setMesaj('');
    const upd = {};
    for (const k of CAMPURI) {
      let x = v[k];
      if (x === '') x = null;
      if (['procent_matei', 'suma_ron', 'curs'].includes(k) && x !== null) x = Number(String(x).replace(',', '.'));
      if (['client_id', 'colaborator_id', 'cost_recurent_id', 'pereche_id'].includes(k) && x !== null) x = Number(x);
      upd[k] = x;
    }
    if (stareNoua) upd.stare = stareNoua;
    if (strain && upd.curs && upd.suma_ron === null) upd.suma_ron = Math.round(t.suma * upd.curs * 100) / 100;
    try {
      await q(sb.from('clasificari').update(upd).eq('tranzactie_id', id));
      salvat();
      if (merge && urmator) urmator(); else incarca();
    } catch (e) { setMesaj(mesajEroare(e.message)); }
  }

  async function cautaPerechi() {
    const de = new Date(t.data_extras); de.setDate(de.getDate() - 4);
    const pana = new Date(t.data_extras); pana.setDate(pana.getDate() + 4);
    const iso = (d) => d.toISOString().slice(0, 10);
    try {
      setPerechi(await q(sb.from('v_tranzactii').select('id,data_extras,cont_cod,contrapartida,suma,moneda,descriere')
        .neq('cont_id', t.cont_id).gte('data_extras', iso(de)).lte('data_extras', iso(pana))
        .eq('suma', -t.suma).limit(20)));
    } catch (e) { setMesaj(e.message); }
  }

  async function adaugaIntrebare() {
    if (!nouaIntrebare.trim()) return;
    try {
      await q(sb.from('intrebari').insert({ tranzactie_id: id, titlu: nouaIntrebare.trim() }));
      await q(sb.from('clasificari').update({ stare: 'intrebare' }).eq('tranzactie_id', id));
      setNouaIntrebare('');
      salvat(); incarca();
    } catch (e) { setMesaj(e.message); }
  }

  const cost = nom.costuri;
  return (
    <aside class="panou">
      <div class="panou-sus">
        <button class="mic" onClick={anterior} disabled={!anterior} title="Linia anterioară (↑)">↑</button>
        <button class="mic" onClick={urmator} disabled={!urmator} title="Linia următoare (↓)">↓</button>
        <span class="gri mic">#{t.id} · {t.cont_nume}</span>
        <button class="mic" onClick={inchide} title="Închide (Esc)">✕</button>
      </div>

      <div class={`suma-mare ${t.suma < 0 ? 'neg' : 'poz'}`}>{bani(t.suma, t.moneda)}</div>
      <div class="gri">
        Data din extras {data(t.data_extras)}{t.data_reala && t.data_reala !== t.data_extras ? ` · data reală ${data(t.data_reala)}` : ''}
        {t.suma_originala && <> · original {t.suma_originala}</>}
      </div>
      <pre class="descriere-completa">{t.descriere}</pre>
      {t.contrapartida && <button class="link mic" onClick={() => filtreaza(t.contrapartida)}>Arată toate liniile cu „{t.contrapartida}”</button>}

      <div class="grila">
        <label>Categorie
          <select value={v.categorie} onChange={(e) => set('categorie', e.target.value)}>
            <option value="">—</option>
            {nom.categorii.map((c) => <option value={c.cod}>{c.eticheta}</option>)}
          </select>
        </label>
        <label>Împărțire
          <select value={v.impartire} onChange={(e) => set('impartire', e.target.value)}>
            <option value="">—</option>
            {Object.entries(IMPARTIRI).map(([k, x]) => <option value={k}>{x}</option>)}
          </select>
        </label>
        {v.impartire === 'procent' && (
          <label>% al lui Matei<input type="number" min="0" max="100" step="0.01" value={v.procent_matei} onInput={(e) => set('procent_matei', e.target.value)} /></label>
        )}
        <label>Contrapartidă<input value={v.contrapartida} onInput={(e) => set('contrapartida', e.target.value)} /></label>
        {strain && <>
          <label>Curs (1 {t.moneda} = ? RON)<input value={v.curs} onInput={(e) => set('curs', e.target.value)} /></label>
          <label>Sumă în RON<input value={v.suma_ron} onInput={(e) => set('suma_ron', e.target.value)} placeholder={v.curs ? String(Math.round(t.suma * Number(String(v.curs).replace(',', '.')) * 100) / 100) : ''} /></label>
          <label>Sursa cursului<input value={v.sursa_curs} onInput={(e) => set('sursa_curs', e.target.value)} placeholder="ex. BNR 12.03.2026 / conversie Revolut" /></label>
        </>}
        <label>Client
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
            {cost.map((c) => <option value={c.id}>{c.nume}</option>)}
          </select>
        </label>
        <label>Linia pereche (transfer)
          <span class="rand"><input value={v.pereche_id} onInput={(e) => set('pereche_id', e.target.value)} placeholder="ID" />
            <button type="button" class="mic" onClick={cautaPerechi}>Caută</button></span>
        </label>
      </div>
      {perechi && (
        <div class="perechi">
          {perechi.length === 0 ? <span class="gri mic">Nicio linie cu suma opusă în ±4 zile în alt cont.</span> : perechi.map((p) => (
            <div class="pereche" onClick={() => { set('pereche_id', String(p.id)); setPerechi(null); }}>
              #{p.id} · {data(p.data_extras)} · {p.cont_cod} · {bani(p.suma, p.moneda)} · {p.contrapartida}
            </div>
          ))}
        </div>
      )}
      <label class="lat">Notă / dovadă
        <textarea rows="3" value={v.nota} onInput={(e) => set('nota', e.target.value)} placeholder="De unde știm: data, mesaj WhatsApp, factură, confirmare de la Matei…" />
      </label>

      <div class="actiuni">
        <button onClick={() => salveaza(null)}>Salvează</button>
        <button onClick={() => salveaza('propus', true)} title="Robert propune, Alex confirmă">Propune și următoarea</button>
        <button class="primar" onClick={() => salveaza('confirmat', true)}>Confirmă și următoarea</button>
      </div>
      <div class="gri mic">Stare: <span class={`eticheta-stare ${t.stare}`}>{STARI[t.stare]}</span>
        {t.confirmat_de && <> · confirmat de {t.confirmat_de} la {dataOra(t.confirmat_la)}</>}
        {t.efect_matei !== null && <> · efect {bani(t.efect_matei, 'RON')}</>}
      </div>
      {mesaj && <p class="eroare">{mesaj}</p>}

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

      <h4>Din WhatsApp cu Matei</h4>
      <WhatsappContext data={t.data_reala || t.data_extras} suma={t.suma} />

      <h4>Istoric</h4>
      <Istoric intrari={istoric} />
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
