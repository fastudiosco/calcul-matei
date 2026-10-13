import { useContext, useEffect, useMemo, useState } from 'preact/hooks';
import { sb, q, toate } from '../supabase.js';
import { Ctx, mergi } from '../app.jsx';
import { bani, data, luna, suma, LUNI, STARI, IMPARTIRI, csv, descarca } from '../format.js';
import { Editor } from './editor.jsx';

const GOL = { luna: '', cont: '', stare: '', categorie: '', q: '', sens: '', impartire: '' };

export function Tranzactii({ params }) {
  const { nom } = useContext(Ctx);
  const f = { ...GOL, ...params };
  const [randuri, setRanduri] = useState(null);
  const [eroare, setEroare] = useState('');
  const [sel, setSel] = useState(new Set());
  const [deschis, setDeschis] = useState(params.id ? Number(params.id) : null);
  const [text, setText] = useState(f.q);

  function seteaza(k, v) { mergi('tranzactii', { ...f, [k]: v, id: '' }); }

  async function incarca() {
    setEroare('');
    try {
      const r = await toate(() => {
        let x = sb.from('v_tranzactii').select('*').order('data_extras').order('id');
        if (f.luna) x = x.eq('luna', f.luna);
        if (f.cont) x = x.eq('cont_cod', f.cont);
        if (f.stare) x = x.eq('stare', f.stare);
        if (f.categorie === '-') x = x.is('categorie', null); else if (f.categorie) x = x.eq('categorie', f.categorie);
        if (f.impartire === '-') x = x.is('impartire', null); else if (f.impartire) x = x.eq('impartire', f.impartire);
        if (f.sens === 'iesiri') x = x.lt('suma', 0);
        if (f.sens === 'intrari') x = x.gt('suma', 0);
        if (f.q) {
          const t = f.q.replace(/[,()]/g, ' ').trim();
          const num = Number(t.replace(',', '.'));
          x = isNaN(num)
            ? x.or(`descriere.ilike.*${t}*,contrapartida.ilike.*${t}*,nota.ilike.*${t}*`)
            : x.or(`suma.eq.${num},suma.eq.${-num},descriere.ilike.*${t}*`);
        }
        return x;
      });
      setRanduri(r);
      setSel(new Set());
    } catch (e) { setEroare(e.message); }
  }
  useEffect(() => { incarca(); }, [JSON.stringify(f)]);

  const sumar = useMemo(() => {
    if (!randuri) return null;
    const pe = {};
    for (const r of randuri) (pe[r.moneda] ||= []).push(r);
    return {
      monede: Object.entries(pe).map(([m, l]) => `${bani(suma(l, (x) => x.suma))} ${m}`).join(' · '),
      efect: suma(randuri.filter((r) => r.stare === 'confirmat'), (r) => r.efect_matei),
      propus: suma(randuri.filter((r) => r.stare === 'propus'), (r) => r.efect_matei),
    };
  }, [randuri]);

  function comuta(id) {
    const s = new Set(sel); s.has(id) ? s.delete(id) : s.add(id); setSel(s);
  }
  function exportCsv() {
    descarca(`tranzactii${f.luna ? '_' + f.luna.slice(0, 7) : ''}.csv`, csv(randuri, [
      ['id', 'ID'], ['data_extras', 'Data'], ['cont_cod', 'Cont'], ['contrapartida', 'Contrapartidă'], ['descriere', 'Descriere'],
      ['suma', 'Sumă'], ['moneda', 'Monedă'], ['suma_ron', 'Sumă RON'], ['stare', 'Stare'], ['categorie', 'Categorie'],
      [(r) => IMPARTIRI[r.impartire] || '', 'Împărțire'], ['procent_matei', '% Matei'], ['efect_matei', 'Efect (Matei datorează)'], ['nota', 'Notă'],
    ]));
  }

  const idx = randuri ? randuri.findIndex((r) => r.id === deschis) : -1;

  return (
    <div class={deschis ? 'cu-panou' : ''}>
      <div class="filtre">
        <select value={f.luna} onChange={(e) => seteaza('luna', e.target.value)}>
          <option value="">Toate lunile</option>
          {LUNI.map((l) => <option value={l}>{luna(l)}</option>)}
        </select>
        <select value={f.cont} onChange={(e) => seteaza('cont', e.target.value)}>
          <option value="">Toate conturile</option>
          {nom.conturi.map((c) => <option value={c.cod}>{c.nume}</option>)}
        </select>
        <select value={f.stare} onChange={(e) => seteaza('stare', e.target.value)}>
          <option value="">Orice stare</option>
          {Object.entries(STARI).map(([k, v]) => <option value={k}>{v}</option>)}
        </select>
        <select value={f.categorie} onChange={(e) => seteaza('categorie', e.target.value)}>
          <option value="">Orice categorie</option>
          <option value="-">Fără categorie</option>
          {nom.categorii.map((c) => <option value={c.cod}>{c.eticheta}</option>)}
        </select>
        <select value={f.impartire} onChange={(e) => seteaza('impartire', e.target.value)}>
          <option value="">Orice împărțire</option>
          <option value="-">Fără împărțire</option>
          {Object.entries(IMPARTIRI).map(([k, v]) => <option value={k}>{v}</option>)}
        </select>
        <select value={f.sens} onChange={(e) => seteaza('sens', e.target.value)}>
          <option value="">Intrări și ieșiri</option>
          <option value="iesiri">Doar ieșiri</option>
          <option value="intrari">Doar intrări</option>
        </select>
        <form onSubmit={(e) => { e.preventDefault(); seteaza('q', text); }}>
          <input placeholder="Caută text sau sumă" value={text} onInput={(e) => setText(e.target.value)} />
        </form>
        <button class="mic" onClick={() => { setText(''); mergi('tranzactii', {}); }}>Resetează</button>
        <button class="mic" onClick={exportCsv} disabled={!randuri?.length}>Export CSV</button>
      </div>

      {eroare && <p class="eroare">{eroare}</p>}
      {!randuri ? <p>Se încarcă…</p> : (
        <>
          <p class="sumar">
            {randuri.length} linii · total {sumar.monede || '0'} · efect confirmat <b>{bani(sumar.efect, 'RON')}</b>
            {sumar.propus ? <> · propus {bani(sumar.propus, 'RON')}</> : null}
          </p>
          {sel.size > 0 && <Bulk ids={[...sel]} gata={incarca} anuleaza={() => setSel(new Set())} />}
          <table class="tabel tranzactii">
            <thead>
              <tr>
                <th><input type="checkbox" checked={sel.size && sel.size === randuri.length}
                  onChange={(e) => setSel(e.target.checked ? new Set(randuri.map((r) => r.id)) : new Set())} /></th>
                <th>Data</th><th>Cont</th><th>Contrapartidă / descriere</th><th class="n">Sumă</th>
                <th>Stare</th><th>Categorie</th><th>Împărțire</th><th class="n">Efect</th>
              </tr>
            </thead>
            <tbody>
              {randuri.map((r) => (
                <tr class={`${deschis === r.id ? 'selectat' : ''} ${r.stare}`} onClick={() => setDeschis(r.id)}>
                  <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={sel.has(r.id)} onChange={() => comuta(r.id)} /></td>
                  <td class="nowrap">{data(r.data_reala || r.data_extras)}</td>
                  <td class="nowrap mic">{r.cont_cod}</td>
                  <td>
                    <div class="cp">{r.contrapartida || '—'}</div>
                    <div class="desc">{r.descriere}</div>
                    {r.nota && <div class="nota">📝 {r.nota}</div>}
                  </td>
                  <td class={`n nowrap ${r.suma < 0 ? 'neg' : 'poz'}`}>
                    {bani(r.suma, r.moneda)}
                    {r.moneda !== 'RON' && r.suma_ron !== null && <div class="mic gri">{bani(r.suma_ron, 'RON')}</div>}
                  </td>
                  <td><span class={`eticheta-stare ${r.stare}`}>{STARI[r.stare]}</span>{r.intrebari_deschise > 0 && <span class="atentie"> ?</span>}</td>
                  <td class="mic">{nom.categorii.find((c) => c.cod === r.categorie)?.eticheta || ''}</td>
                  <td class="mic">{r.impartire === 'procent' ? `${r.procent_matei}% Matei` : IMPARTIRI[r.impartire] || ''}</td>
                  <td class="n nowrap">{bani(r.efect_matei)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {deschis && (
        <Editor id={deschis} key={deschis}
          inchide={() => setDeschis(null)}
          salvat={incarca}
          urmator={idx >= 0 && idx < randuri.length - 1 ? () => setDeschis(randuri[idx + 1].id) : null}
          anterior={idx > 0 ? () => setDeschis(randuri[idx - 1].id) : null}
          filtreaza={(t) => { setText(t); seteaza('q', t); }} />
      )}
    </div>
  );
}

function Bulk({ ids, gata, anuleaza }) {
  const { nom } = useContext(Ctx);
  const [v, setV] = useState({ categorie: '', impartire: '', procent_matei: '', stare: '' });
  const [mesaj, setMesaj] = useState('');

  async function aplica() {
    const upd = {};
    if (v.categorie) upd.categorie = v.categorie === '-' ? null : v.categorie;
    if (v.impartire) upd.impartire = v.impartire;
    if (v.impartire === 'procent') upd.procent_matei = Number(v.procent_matei);
    if (v.stare) upd.stare = v.stare;
    if (!Object.keys(upd).length) { setMesaj('Alege cel puțin un câmp.'); return; }
    if (upd.stare === 'confirmat' && !confirm(`Confirmi ${ids.length} linii? Intră în calculul final.`)) return;
    setMesaj('Se salvează…');
    try {
      for (let i = 0; i < ids.length; i += 200) {
        await q(sb.from('clasificari').update(upd).in('tranzactie_id', ids.slice(i, i + 200)));
      }
      setMesaj('');
      gata();
    } catch (e) { setMesaj(e.message); }
  }

  return (
    <div class="bulk">
      <b>{ids.length} selectate</b>
      <select value={v.categorie} onChange={(e) => setV({ ...v, categorie: e.target.value })}>
        <option value="">Categorie…</option>
        <option value="-">(fără categorie)</option>
        {nom.categorii.map((c) => <option value={c.cod}>{c.eticheta}</option>)}
      </select>
      <select value={v.impartire} onChange={(e) => setV({ ...v, impartire: e.target.value })}>
        <option value="">Împărțire…</option>
        {Object.entries(IMPARTIRI).map(([k, t]) => <option value={k}>{t}</option>)}
      </select>
      {v.impartire === 'procent' && <input type="number" min="0" max="100" step="0.01" placeholder="% Matei" value={v.procent_matei} onInput={(e) => setV({ ...v, procent_matei: e.target.value })} />}
      <select value={v.stare} onChange={(e) => setV({ ...v, stare: e.target.value })}>
        <option value="">Stare…</option>
        {Object.entries(STARI).map(([k, t]) => <option value={k}>{t}</option>)}
      </select>
      <button onClick={aplica}>Aplică</button>
      <button class="link" onClick={anuleaza}>Anulează selecția</button>
      {mesaj && <span class="mesaj">{mesaj}</span>}
    </div>
  );
}
