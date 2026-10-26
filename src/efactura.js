// Citește o factură e-Factura (UBL 2.1, CIUS-RO) din XML-ul din arhiva SPV (fișierele „…_2_…xml”).
// Fișierele de semnătură („…_3_…xml”) și orice alt XML întorc null, deci se poate alege tot folderul arhivei.
export const CUI_FA = '48787502';

const copii = (el, nume) => (el ? [...el.children].filter((c) => c.localName === nume) : []);
const primul = (el, ...cale) => cale.reduce((x, n) => copii(x, n)[0] || null, el);
const text = (el, ...cale) => (primul(el, ...cale)?.textContent || '').trim();
const numar = (s) => (s === '' ? null : Number(s));
const cui = (s) => s.toUpperCase().replace(/^RO/, '').replace(/\s/g, '');

// CUI-ul apare în locuri diferite după programul de facturare (uneori PartyIdentification e nr. de la Registrul Comerțului).
function parte(el) {
  const p = primul(el, 'Party');
  const coduri = [text(p, 'PartyTaxScheme', 'CompanyID'), text(p, 'PartyLegalEntity', 'CompanyID'), text(p, 'PartyIdentification', 'ID')]
    .map(cui).filter(Boolean);
  return {
    nume: text(p, 'PartyLegalEntity', 'RegistrationName') || text(p, 'PartyName', 'Name'),
    cui: coduri.find((x) => /^\d{2,10}$/.test(x)) || coduri[0] || '',
    coduri,
  };
}

export function parseazaFactura(xml, fisier = '') {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const r = doc.documentElement;
  if (!r || doc.getElementsByTagName('parsererror').length) return null;
  const nota = r.localName === 'CreditNote';
  if (r.localName !== 'Invoice' && !nota) return null;

  const moneda = text(r, 'DocumentCurrencyCode') || 'RON';
  const tip = text(r, nota ? 'CreditNoteTypeCode' : 'InvoiceTypeCode');
  const semn = nota || tip === '381' ? -1 : 1;
  const emitent = parte(primul(r, 'AccountingSupplierParty'));
  const client = parte(primul(r, 'AccountingCustomerParty'));
  const directie = emitent.coduri.includes(CUI_FA) ? 'emisa' : client.coduri.includes(CUI_FA) ? 'primita' : null;
  if (!directie) throw new Error(`${fisier || text(r, 'ID')}: nici emitentul, nici clientul nu e FA Studios (CUI ${CUI_FA}).`);

  // Facturile în valută pot avea două totaluri de TVA (în valută și în RON): îl luăm pe cel în moneda facturii.
  const taxe = copii(r, 'TaxTotal');
  const taxa = taxe.find((t) => primul(t, 'TaxAmount')?.getAttribute('currencyID') === moneda) || taxe[0];
  const totaluri = primul(r, 'LegalMonetaryTotal');
  const net = numar(text(totaluri, 'TaxExclusiveAmount')) ?? numar(text(totaluri, 'LineExtensionAmount'));
  const tva = numar(text(taxa, 'TaxAmount')) ?? 0;
  const total = numar(text(totaluri, 'TaxInclusiveAmount')) ?? numar(text(totaluri, 'PayableAmount'));
  if (net === null || total === null) throw new Error(`${fisier || text(r, 'ID')}: factura nu are totaluri.`);

  const linii = copii(r, nota ? 'CreditNoteLine' : 'InvoiceLine').map((l) => ({
    denumire: text(l, 'Item', 'Name'),
    descriere: text(l, 'Item', 'Description') || undefined,
    cantitate: numar(text(l, nota ? 'CreditedQuantity' : 'InvoicedQuantity')),
    valoare: semn * (numar(text(l, 'LineExtensionAmount')) ?? 0),
  }));

  return {
    directie,
    numar: text(r, 'ID'),
    data: text(r, 'IssueDate'),
    scadenta: text(r, 'DueDate') || text(r, 'PaymentMeans', 'PaymentDueDate') || null,
    emitent: emitent.nume, emitent_cui: emitent.cui,
    client: client.nume, client_cui: client.cui,
    moneda, net: semn * net, tva: semn * tva, total: semn * total,
    linii, fisier,
  };
}
