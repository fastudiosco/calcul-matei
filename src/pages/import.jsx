import { useContext, useState } from 'preact/hooks';
import { sb } from '../supabase.js';
import { Ctx } from '../app.jsx';
import { bani, data } from '../format.js';
import { parseazaChat } from './whatsapp.jsx';

// Importă fișierul pregătit din extrase (format calcul-matei/extrase@1).
// Baza de date verifică din nou totalurile și soldurile; un extras deja importat e sărit.
export function Import() {
  const { nom } = useContext(Ctx);
  const [fisier, setFisier] = useState(null);
  const [stari, setStari] = useState({});
  const [eroare, setEroare] = useState('');
  const [lucru, setLucru] = useState(false);

  async function citeste(e) {
    setEroare(''); setStari({});
    const f = e.target.files[0];
    if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      if (j.format !== 'calcul-matei/extrase@1') throw new Error('Fișierul nu are formatul așteptat.');
      setFisier(j);
    } catch (er) { setEroare(er.message); setFisier(null); }
  }

  async function importa() {
    setLucru(true);
    const s = {};
    for (const [i, x] of fisier.extrase.entries()) {
      s[i] = 'se importă…'; setStari({ ...s });
      const { data: id, error } = await sb.rpc('importa_extras', { p: x });
      s[i] = error ? '❌ ' + error.message : id === null ? 'deja importat' : `✓ importat (#${id})`;
      setStari({ ...s });
    }
    setLucru(false);
  }

  const cont = (cod) => nom.conturi.find((c) => c.cod === cod)?.nume || cod;
  return (
    <div>
      <p class="explicatie">Încarcă fișierul de import pregătit din extrasele băncilor. Fiecare extras se verifică din nou în baza de date (total intrări, total ieșiri, sold final și, unde există, soldul după fiecare linie) și intră tot sau deloc. Un extras deja importat nu se dublează.</p>
      <input type="file" accept=".json,application/json" onChange={citeste} />
      {eroare && <p class="eroare">{eroare}</p>}
      {fisier && (
        <>
          <table class="tabel">
            <thead><tr><th>Cont</th><th>Perioada</th><th class="n">Linii</th><th class="n">Intrări</th><th class="n">Ieșiri</th><th class="n">Sold final</th><th>Rezultat</th></tr></thead>
            <tbody>{fisier.extrase.map((x, i) => (
              <tr><td>{cont(x.cont_cod)}</td><td class="nowrap">{data(x.perioada_de)} – {data(x.perioada_pana)}</td><td class="n">{x.linii.length}</td>
                <td class="n">{bani(x.total_intrari)}</td><td class="n">{bani(x.total_iesiri)}</td><td class="n">{bani(x.sold_final)}</td><td class="mic">{stari[i] || ''}</td></tr>
            ))}</tbody>
          </table>
          <button class="primar" disabled={lucru} onClick={importa}>{lucru ? 'Se importă…' : `Importă ${fisier.extrase.length} extrase`}</button>
        </>
      )}
      <ImportWhatsapp />
    </div>
  );
}

function ImportWhatsapp() {
  const [mesaje, setMesaje] = useState(null);
  const [stare, setStare] = useState('');

  async function citeste(e) {
    const f = e.target.files[0];
    if (!f) return;
    const m = parseazaChat(await f.text());
    setMesaje(m);
    setStare(m.length ? `${m.length} mesaje, de la ${m[0].la.slice(0, 10)} la ${m[m.length - 1].la.slice(0, 10)}.` : 'Nu am găsit mesaje în fișier.');
  }
  async function importa() {
    for (let i = 0; i < mesaje.length; i += 1000) {
      setStare(`Se încarcă ${i} / ${mesaje.length}…`);
      const { error } = await sb.from('whatsapp').upsert(mesaje.slice(i, i + 1000), { onConflict: 'la,autor,hash', ignoreDuplicates: true });
      if (error) { setStare('❌ ' + error.message); return; }
    }
    setStare(`✓ Gata: ${mesaje.length} mesaje (cele deja încărcate au fost sărite).`);
  }

  return (
    <section class="card" style={{ marginTop: '24px' }}>
      <h3>Conversația WhatsApp cu Matei</h3>
      <p class="mic gri">Fișierul _chat.txt din arhiva exportată din WhatsApp. Mesajele apar apoi în panoul fiecărei tranzacții, în jurul datei ei.</p>
      <input type="file" accept=".txt,text/plain" onChange={citeste} />
      {stare && <p class="mesaj">{stare}</p>}
      {mesaje?.length > 0 && <button class="primar" onClick={importa}>Încarcă mesajele</button>}
    </section>
  );
}
