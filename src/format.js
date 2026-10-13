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
