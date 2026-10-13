import { useEffect, useState } from 'preact/hooks';
import { sb, toate as toatePaginat } from '../supabase.js';
import { ziPlus } from '../format.js';

// Mesajele din WhatsApp din jurul datei unei tranzacții: întâi cele care pomenesc suma.
export function WhatsappContext({ data, suma }) {
  const [mesaje, setMesaje] = useState(null);
  const [toate, setToate] = useState(false);
  const [eroare, setEroare] = useState('');

  useEffect(() => {
    setMesaje(null);
    toatePaginat(() => sb.from('whatsapp').select('id,la,autor,text').gte('la', ziPlus(data, -3)).lt('la', ziPlus(data, 4)).order('la').order('id'))
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

// Parsează exportul WhatsApp (_chat.txt): "[dd/mm/yyyy, HH:MM:SS] Autor: text".
// Exportul de pe iPhone termină fiecare mesaj cu CRLF, iar rândurile din interiorul unui mesaj
// (inclusiv bucăți de conversație lipite sau redirecționate) doar cu LF. Când fișierul are CRLF,
// doar CRLF poate începe un mesaj nou, ca un fragment lipit să rămână în mesajul care îl conține.
export function parseazaChat(txt) {
  const curat = txt.replace(/[‎‏ ]/g, '');
  const bucati = curat.includes('\r\n') ? curat.split('\r\n') : curat.split('\n');
  const re = /^\[(\d{2})\/(\d{2})\/(\d{4}), (\d{2}):(\d{2}):(\d{2})\] ([^:\n]+):(?: ([\s\S]*))?$/;
  const rez = [];
  let ultim = null;
  for (const l of bucati) {
    const m = re.exec(l);
    if (m) {
      ultim = { la: `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}`, autor: m[7].trim(), text: m[8] || '' };
      rez.push(ultim);
    } else if (ultim) {
      ultim.text += '\n' + l;
    }
  }
  return rez.map((m) => ({ ...m, text: m.text.trim() }))
    .filter((m) => m.text && !/^Waiting for this message/.test(m.text) && !/end-to-end encrypted/.test(m.text));
}
