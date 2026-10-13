# Calcul Matei

Aplicație internă FA Studios pentru calculul dintre Alex și Matei (noiembrie 2025 – octombrie 2026):
ce plăți și încasări din conturile lui Alex și ale firmei îl privesc pe Matei, cât a dat înapoi, și suma finală.
Folosită de Alex și Robert la `calcul.fastudios.co`.

## Principii
- **Nimic inventat.** Sumele vin din extrasele băncilor, importate și reconciliate cu totalurile și soldurile din extras.
  Liniile importate nu se pot modifica sau șterge (regulă în baza de date).
- **Nimic presupus.** Fiecare linie pornește „neclasificată”. Doar liniile **confirmate** intră în suma finală.
  Ce nu e clar devine o întrebare.
- **Totul se poate apăra.** Fiecare modificare ajunge în jurnal (cine, când, ce era înainte), scris de baza de date.
  Raportul arată fiecare linie cu efect, împărțirea și nota/dovada ei.
- **Luni închise.** O lună se închide când toate liniile sunt confirmate, nu are întrebări deschise și au confirmat-o toți membrii.
  Redeschiderea cere un motiv, care rămâne în istoric.

## Cum se calculează
Pentru fiecare linie confirmată, „Matei datorează lui Alex” crește cu cota lui Matei:
- cont al lui Alex sau al firmei: `efect = -suma_RON × %Matei`
  (o plată de 100 lei împărțită 50/50 ⇒ +50; o încasare de 100 lei din care 50% e a lui Matei ⇒ -50)
- plată făcută de Matei (introdusă manual): `efect = suma_RON × (100% - %Matei)`

Se adaugă elementele manuale confirmate (ex. sume convenite) și se scad rambursările lui Matei care nu apar deja în extrase.
Codul e în `supabase/migrations/20261013100300_calcul.sql` (`v_tranzactii`, `v_rezumat_luna`).

## Tehnic
- Frontend: Preact + Vite, fișiere statice (`dist/`), fără server propriu.
- Baza de date și autentificarea: Supabase (Postgres cu Row Level Security; doar emailurile din tabela `membri` văd date).
- Migrațiile sunt în `supabase/migrations/`, aplicate în ordine.
- Datele financiare **nu** intră în acest repo (`.gitignore` blochează pdf/csv/json).

```bash
npm install
npm run dev      # local, http://localhost:5173
npm run build    # rezultatul în dist/
```

## Publicare pe Cyber Folks
Varianta manuală: `npm run build`, apoi conținutul folderului `dist/` (inclusiv `.htaccess`) se urcă în folderul
subdomeniului `calcul.fastudios.co` din cPanel (File Manager sau FTP). La fiecare push pe `main`, GitHub Actions
construiește site-ul și îl pune la dispoziție ca arhivă „site-calcul” în tab-ul Actions.

Varianta automată: în repo, Settings → Secrets and variables → Actions, se adaugă `FTP_SERVER`, `FTP_USERNAME`,
`FTP_PASSWORD` și `FTP_DIR` (ex. `/calcul.fastudios.co/`). De atunci, fiecare push pe `main` publică singur.

## Conturi
Utilizatorii se creează în Supabase → Authentication → Users → Add user (cu „Auto Confirm”), iar emailul se adaugă în tabela `membri`.
În Authentication → URL Configuration, Site URL trebuie să fie `https://calcul.fastudios.co` (pentru linkul de resetare a parolei).
