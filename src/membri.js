// Cei doi membri: cine e celălalt (căruia îi adresezi întrebarea) și cum îi afișăm numele.
export function celalalt(nom, email) {
  const eu = (email || '').toLowerCase();
  return nom.membri.find((m) => m.email.toLowerCase() !== eu) || null;
}

export function numeMembru(nom, email) {
  if (!email) return '';
  const m = nom.membri.find((x) => x.email.toLowerCase() === email.toLowerCase());
  return m ? m.nume : email;
}

// Întrebări-tip, ca să nu scrii de fiecare dată același lucru.
export const INTREBARI_RAPIDE = [
  'Ce este plata asta?',
  'E a firmei sau personală?',
  'Cum se împarte cu Matei?',
  'Ce client / proiect este?',
  'Am clasificat-o bine?',
];
