# Frizētavas mājaslapa ar pierakstu sistēmu

Vienkārša, moderna mājaslapa frizierei: publiska lapa ar pakalpojumiem un cenām, klientu konti ar tiešsaistes pierakstu un pilns administratora panelis. Dizains — “glassy modern & minimal” ar Earthy Minimal krāsu paleti (#2E3A2F, #6B7F5B, #D9C9B2, #C96F4F, #F8F6EE).

## Palaišana

Vajadzīgs tikai **Node.js 18+** — nav jāinstalē neviena papildu pakotne.

```bash
npm start
```

Atver http://localhost:3000

Pirmajā palaišanā tiek izveidota tukša datubāze `data/db.json` un administratora konts:

- lietotājvārds: `admin`
- parole: `admin123` → **nomaini uzreiz** (Admin panelis → Iestatījumi)

Savu sākotnējo paroli var uzdot arī ar vides mainīgajiem: `ADMIN_USER=liga ADMIN_PASS=... npm start`.

### Demo dati

Lai apskatītu paneli ar grafikiem un pierakstiem (26 klienti, ~460 pieraksti):

```bash
npm run demo -- --force
```

Demo klients: `anna` / `anna123`. **Uzmanību:** šī komanda pārraksta `data/db.json` — palaid to tikai tad, kad serveris ir apturēts, un nekad uz īstiem datiem.

## Lapas

| Adrese | Kas tur ir |
|---|---|
| `/` | Publiskā lapa: pakalpojumi, cenas, darba laiks, kontakti, tuvākais brīvais laiks |
| `/pieslegties` | Pieslēgšanās (klientiem un administratoram) un reģistrācija |
| `/konts` | Klienta konts: pieteikties vizītei, pārcelt, atcelt, vēsture, profils |
| `/admin` | Administratora panelis |

Pēc pieslēgšanās sistēma pati novirza: administrators → `/admin`, klients → `/konts`.

## Administratora panelis

- **Pārskats** — ieņēmumi, vizītes, jauni klienti, noslodze; ieņēmumu līkne, populārākie pakalpojumi, noslogotākās dienas un stundas, lojālākie klienti, šodienas vizītes. Atgādinājums par neatzīmētām pagātnes vizītēm.
- **Kalendārs** — nedēļas/dienas skats; klikšķis uz brīva laika izveido pierakstu, klikšķis uz pieraksta — rediģē (statuss, laiks, pakalpojums, cena, piezīmes).
- **Pieraksti** — saraksts ar filtriem un CSV eksportu (atveras Excel).
- **Klienti** — klientu bāze, jauna klienta izveide ar lietotājvārdu un paroli (ģenerē automātiski), paroles atjaunošana, bloķēšana, piezīmes, vizīšu vēsture.
- **Pakalpojumi** — cenrādis: nosaukums, apraksts, ilgums, cena, krāsa, redzamība.
- **Darba laiks** — grafiks katrai nedēļas dienai ar pārtraukumu, brīvdienas/atvaļinājumi.
- **Iestatījumi** — salona informācija, pierakstu noteikumi (laika solis, cik iepriekš, līdz kuram brīdim var atcelt, maks. aktīvo pierakstu skaits, vai klienti drīkst paši reģistrēties), admina pieejas dati, rezerves kopija.

## Publicēšana internetā

Projektam der jebkurš hostings, kas atbalsta Node.js un **pastāvīgu disku** (dati glabājas failā `data/db.json`), piemēram, VPS, Railway (ar Volume) vai Render (ar Disk).

- Ports: `PORT` (noklusēti 3000)
- Datu mape: `DATA_DIR` (norādi uz pastāvīgā diska mapi)
- Laika josla: `TZ` (noklusēti `Europe/Riga`)
- Lieto HTTPS. Ja hostings ir aiz starpniekservera, sīkdatne automātiski kļūst `Secure`; to var arī piespiest ar `COOKIE_SECURE=1`.

Regulāri lejupielādē rezerves kopiju: Admin panelis → Iestatījumi → Rezerves kopija.

## Struktūra

```
server.js          HTTP serveris un API
lib/store.js       datu glabāšana (JSON fails) un noklusējuma dati
lib/util.js        paroļu šifrēšana (scrypt), laika palīgfunkcijas
scripts/demo.js    demo datu ģenerators
public/            HTML, CSS un JavaScript
```
