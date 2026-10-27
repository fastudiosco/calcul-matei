// Membrii: Alex (admin) și Robert (editor) lucrează în calcul; Matei (cititor) vede tot și pune întrebări.
export function rolMembru(nom, email) {
  const m = nom.membri.find((x) => x.email.toLowerCase() === (email || '').toLowerCase());
  return m ? m.rol : null;
}

export const poateEdita = (rol) => rol === 'admin' || rol === 'editor';

// Cui îi adresezi întrebarea: editorul celălalt; cititorul (Matei) îl întreabă pe admin (Alex).
export function celalalt(nom, email) {
  const eu = (email || '').toLowerCase();
  if (!poateEdita(rolMembru(nom, email))) return nom.membri.find((m) => m.rol === 'admin') || null;
  return nom.membri.find((m) => m.email.toLowerCase() !== eu && poateEdita(m.rol)) || null;
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
