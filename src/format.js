const nf = new Intl.NumberFormat('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function bani(v, moneda) {
  if (v === null || v === undefined || v === '') return '';
  const s = nf.format(Number(v));
  return moneda ? `${s} ${moneda}` : s;
}

// Sume adunate în bani întregi (bani = 1/100), ca să nu apară erori de virgulă mobilă.
export function suma(lista, f = (x) => x) {
  let c = 0;
  for (const x of lista) {
    const v = f(x);
    if (v !== null && v !== undefined && v !== '') c += Math.round(Number(v) * 100);
  }
  return c / 100;
}

export function luna(d) {
  if (!d) return '';
  const [y, m] = d.slice(0, 7).split('-');
  const nume = ['ian', 'feb', 'mar', 'apr', 'mai', 'iun', 'iul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  return `${nume[Number(m) - 1]} ${y}`;
}

export function data(d) {
  if (!d) return '';
  const [y, m, z] = d.slice(0, 10).split('-');
  return `${z}.${m}.${y}`;
}

export function dataOra(d) {
  if (!d) return '';
  const x = new Date(d);
  return x.toLocaleString('ro-RO', { dateStyle: 'short', timeStyle: 'short' });
}

export const LUNI = (() => {
  const r = [];
  for (let y = 2025, m = 11; y < 2026 || (y === 2026 && m <= 10); m++) {
    if (m > 12) { m = 1; y++; }
    r.push(`${y}-${String(m).padStart(2, '0')}-01`);
  }
  return r;
})();

export const STARI = {
  neclasificat: 'Neclasificat',
  propus: 'Propus',
  intrebare: 'Întrebare',
  confirmat: 'Confirmat',
};

export const IMPARTIRI = {
  '50_50': '50/50',
  matei_100: '100% Matei',
  alex_100: '100% Alex',
  procent: 'Procent Matei',
  exclus: 'Exclus din calcul',
};

export function csv(randuri, coloane) {
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const linii = [coloane.map((c) => esc(c[1])).join(',')];
  for (const r of randuri) linii.push(coloane.map((c) => esc(typeof c[0] === 'function' ? c[0](r) : r[c[0]])).join(','));
  return '﻿' + linii.join('\n');
}

export function descarca(nume, continut, tip = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([continut], { type: tip }));
  const a = document.createElement('a');
  a.href = url; a.download = nume; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Rotunjire la bani, jumătățile departe de zero, ca round() din Postgres.
export function rotunjeste(x) {
  return Math.sign(x) * Math.round(Math.abs(x) * 100 + 1e-7) / 100;
}

function curata(s) {
  return String(s).trim().replace(/[\s '’]/g, '');
}

// O sumă scrisă oricum: „1.234,56”, „1 234,56”, „1,234.56”, „3.000” (trei mii), „-75”.
// Un separator urmat de exact trei cifre înseamnă mii. Gol → null; ceva ce nu e sumă → undefined.
export function citesteSuma(s) {
  if (s === null || s === undefined) return null;
  let t = curata(s);
  if (t === '') return null;
  const semn = t.startsWith('-') || t.startsWith('−') ? -1 : 1;
  t = t.replace(/^[-−+]/, '');
  if (!/^\d[\d.,]*$/.test(t)) return undefined;
  const ultim = Math.max(t.lastIndexOf('.'), t.lastIndexOf(','));
  let intreg = t, zecimale = '';
  if (ultim !== -1 && t.length - ultim - 1 !== 3) { intreg = t.slice(0, ultim); zecimale = t.slice(ultim + 1); }
  if (!/^(\d+|\d{1,3}([.,]\d{3})+)$/.test(intreg) || zecimale.length > 2 || /[.,]/.test(zecimale)) return undefined;
  if (ultim !== -1 && t.length - ultim - 1 !== 3 && zecimale === '') return undefined;
  const n = Number(intreg.replace(/[.,]/g, '') + (zecimale ? '.' + zecimale : ''));
  return Number.isFinite(n) ? semn * n : undefined;
}

// Un curs: ultimul separator e virgula zecimală („5,0889” sau „5.0889”). Gol → null; invalid → undefined.
export function citesteCurs(s) {
  if (s === null || s === undefined) return null;
  const t = curata(s);
  if (t === '') return null;
  const m = /^(\d+)(?:[.,](\d{1,6}))?$/.exec(t);
  if (!m) return undefined;
  const n = Number(m[1] + (m[2] ? '.' + m[2] : ''));
  return n > 0 ? n : undefined;
}

// Procentul lui Matei: „50”, „33,33”, sau „1/3”. Întoarce numărul (până la 6 zecimale) sau undefined.
export function citesteProcent(s) {
  const t = curata(s ?? '');
  if (t === '') return undefined;
  const f = /^(\d+)\/(\d+)$/.exec(t);
  const n = f ? Math.round((Number(f[1]) / Number(f[2])) * 100 * 1e6) / 1e6 : citesteCurs(t);
  return n !== undefined && n !== null && n >= 0 && n <= 100 ? n : t === '0' ? 0 : undefined;
}

// Data d (AAAA-LL-ZZ) plus n zile, fără fus orar.
export function ziPlus(d, n) {
  const x = new Date(d.slice(0, 10) + 'T12:00:00Z');
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

// Efectul unei linii, la fel ca în baza de date (v_tranzactii.efect_matei).
export function efectLinie({ titular, impartire, procent, suma_ron, tva_ron }) {
  if (!impartire || impartire === 'exclus' || suma_ron === null || suma_ron === undefined) return null;
  const p = { '50_50': 50, matei_100: 100, alex_100: 0 }[impartire] ?? procent;
  if (p === null || p === undefined) return null;
  const baza = suma_ron - (tva_ron || 0);
  return rotunjeste(titular === 'matei' ? (baza * (100 - p)) / 100 : (-baza * p) / 100);
}
