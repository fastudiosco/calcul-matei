import { useEffect, useState } from 'preact/hooks';
import { sb, q } from '../supabase.js';

// Mesajele din WhatsApp din jurul datei unei tranzacții: întâi cele care pomenesc suma.
export function WhatsappContext({ data, suma }) {
  const [mesaje, setMesaje] = useState(null);
  const [toate, setToate] = useState(false);
  const [eroare, setEroare] = useState('');

  useEffect(() => {
    const zi = (d, n) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
    q(sb.from('whatsapp').select('id,la,autor,text').gte('la', zi(data, -3)).lt('la', zi(data, 4)).order('la').limit(1000))
      .then(setMesaje).catch((e) => setEroare(e.message));
  }, [data]);

  if (eroare) return <p class="eroare">{eroare}</p>;
  if (!mesaje) return <p class="gri mic">Se încarcă…</p>;
  if (!mesaje.length) return <p class="gri mic">Niciun mesaj în ±3 zile (sau conversația nu e încărcată încă).</p>;

  const intreg = Math.floor(Math.abs(suma));
  const forme = new Set([String(intreg), intreg.toLocaleString('ro-RO'), intreg.toLocaleString('en-US')]);
  if (intreg >= 1000) forme.add(String(intreg / 1000).replace('.', ',') + 'k');
  const re = new RegExp(`(^|[^\\d])(${[...forme].map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\d])`);
  const potrivite = intreg >= 10 ? mesaje.filter((m) => re.test(m.text)) : [];
  const arata = toate ? mesaje : potrivite;

  return (
    <div class="whatsapp">
      <div class="gri mic">
        {potrivite.length} mesaje pomenesc {intreg} în ±3 zile · {mesaje.length} mesaje în total ·{' '}
        <button class="link mic" onClick={() => setToate(!toate)}>{toate ? 'doar cele cu suma' : 'arată toate'}</button>
      </div>
      {arata.map((m) => (
        <div class={`wa ${m.autor.startsWith('Alex') ? 'eu' : ''} ${potrivite.includes(m) ? 'gasit' : ''}`}>
          <span class="gri mic">{m.la.slice(0, 16).replace('T', ' ')} · {m.autor}</span>
          <div>{m.text}</div>
        </div>
      ))}
    </div>
  );
}

// Parsează exportul WhatsApp (_chat.txt): "[dd/mm/yyyy, HH:MM:SS] Autor: text"
export function parseazaChat(txt) {
  const linii = txt.replace(/‎|‏| /g, '').split(/\r?\n/);
  const re = /^\[(\d{2})\/(\d{2})\/(\d{4}), (\d{2}):(\d{2}):(\d{2})\] ([^:]+): ([\s\S]*)$/;
  const rez = [];
  let ultim = null;
  for (const l of linii) {
    const m = re.exec(l);
    if (m) {
      ultim = { la: `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}`, autor: m[7].trim(), text: m[8] };
      rez.push(ultim);
    } else if (ultim) {
      ultim.text += '\n' + l;
    }
  }
  return rez.map((m) => ({ ...m, text: m.text.trim() }))
    .filter((m) => m.text && !/^Waiting for this message/.test(m.text) && !/end-to-end encrypted/.test(m.text));
}
