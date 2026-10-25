# Fantasy NHL 2026/27

Aplikace pro naši sedmičlennou ligu. Každý má 3 útočníky, 1 obránce a 1 brankáře.

## Bodování a pravidla
- **Útočník:** gól 2 b., asistence 1 b.
- **Obránce:** gól 3 b., asistence 1 b.
- **Brankář:** čisté konto 5 b., asistence 1 b.
- 1 bod = 5 Kč. Každý platí každému, kdo je nad ním, za každý bod rozdílu.
- Měsíc se uzavírá poslední den měsíce podle času NHL a body se nulují.
- Každé místo v sestavě boduje maximálně 82 zápasů. Počítá se jen základní část.

### Zranění
- Hráč, který vynechá 2 zápasy (brankář 3), se označí jako zraněný.
- Majitel má 48 h na výběr volného náhradníka na stejné pozici. Když nikoho nevybere, aplikace nasadí nejlepšího volného hráče.
- Jakmile zraněný hráč znovu nastoupí, automaticky se vrací do sestavy.

## Jak to funguje
| Část | Kde | Co dělá |
|---|---|---|
| `docs/` | GitHub Pages | Webová aplikace, čte data z Firestore |
| `sync/` | GitHub Actions, každou hodinu | Stáhne výsledky z NHL API, spočítá body, zranění, náhradníky a 82 zápasů |
| `firestore.rules` | Firebase | Z aplikace jde zapsat jen návrh sestavy, výběr náhradníka a „vyplaceno“ |
| `seed/league.json` | – | Hráči ligy, barvy a říjen 2026 z Excelu |

Přihlášení je jen výběrem jména a nemá heslo. Kdo má odkaz, může vybrat za kohokoli, což mezi kamarády stačí.

## Zprovoznění (jednou)

### 1. Firebase
1. Na [console.firebase.google.com](https://console.firebase.google.com) založ projekt, například `fantasy-nhl-2026`. Google Analytics nepotřebuješ. Tarif Spark (zdarma) stačí.
2. **Build → Firestore Database → Create database**. Vyber *production mode* a umístění `eur3 (Europe)`.
3. **Firestore → Rules**: vlož obsah souboru `firestore.rules` a dej **Publish**.
4. **Project settings → General → Your apps → Web (`</>`)**: zaregistruj aplikaci. Hodnoty z `firebaseConfig` vlož do `docs/firebase-config.js`.
5. **Project settings → Service accounts → Generate new private key**: stáhne se soubor JSON. Nikomu ho neposílej a nedávej ho do repa.

### 2. GitHub
1. Repo `fantasy-nhl-2026` nastav jako **veřejné**. Actions i Pages pak běží zdarma bez omezení.
2. **Settings → Secrets and variables → Actions → New repository secret**:
   - Name: `FIREBASE_SERVICE_ACCOUNT`
   - Value: celý obsah staženého JSON souboru
3. **Settings → Pages**: Source *Deploy from a branch*, větev `main`, složka `/docs`.

### 3. Založení ligy
1. **Actions → NHL data → Run workflow**, v poli mode zvol `seed` a spusť. Založí se liga, prázdné sestavy a říjen z Excelu.
2. Ještě jednou spusť **Run workflow** s mode `sync`. Stáhnou se statistiky a rozpis zápasů. Dál už to poběží samo každou hodinu.
3. Pošli klukům odkaz z GitHub Pages. Každý si vybere jméno, v záložce **Týmy** si naklikne sestavu a potvrdí ji. Sestava se zamkne při další synchronizaci, nejpozději do hodiny, a body se počítají od té chvíle.

## Údržba
- **Konečný říjen z Excelu:** uprav `seed/league.json` a spusť workflow s mode `months`. Stav „vyplaceno“ zůstane.
- **Vyzkoušení beze změn:** spusť workflow se zaškrtnutým „Jen vyzkoušet“ a v logu uvidíš, co by se zapsalo.
- **Ruční opravy** (třeba odemknutí sestavy): ve Firebase konzoli přepni u dokumentu `rosters/<jméno>` pole `locked` na `false`.
- **Testy logiky:** `cd sync && npm install && npm test`

NHL API ani ESPN nejsou oficiálně dokumentované. Když se něco změní, adresy jsou na jednom místě v `sync/nhl.mjs`.
