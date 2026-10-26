# aFinder Mobile

Mobilní aplikace pro iOS a Android, která se připojí k běžícímu aFinderu na Macu (Windows, Linuxu) přes WebSocket relay na Cloudflare. Telefon a počítač nemusí být ve stejné síti a nikde se neotevírá port ani nenastavuje router.

## Struktura

```
mobile/
  app/        Expo SDK 57 (React Native + TypeScript, expo-router): iOS a Android z jednoho kódu
  relay/      Cloudflare Worker + Durable Object: jen přeposílá šifrované bajty
src/shared/companion/            protokol a kryptografie, sdílené desktopem, telefonem, relayem a testy
src/main/services/companion.ts   strana aFinderu: odchozí spojení na relay, párování, obsluha požadavků
src/renderer/src/components/CompanionSettings.tsx   Nastavení → Telefon
scripts/smoke-companion.cjs      end-to-end test: relay + aFinder + telefonní klient
```

`mobile/app` a `mobile/relay` mají vlastní `package.json` a `node_modules`. Typecheck a vitest aFinderu pokrývají jen `src/`, takže se Electron a React Native závislosti nemíchají. Aplikace i relay importují sdílený kód z `src/shared` relativní cestou (Metro ho má ve `watchFolders`, wrangler ho přibalí).

## Spuštění

```bash
# Relay lokálně (ws://127.0.0.1:8787)
cd mobile/relay && npm install && npm run dev
npm test                 # testy relaye v runtime Workers
npm run deploy           # nasazení na Cloudflare (wrangler login)

# Mobilní aplikace
cd mobile/app && npm install
npm run ios              # nativní build do iOS simulátoru (Xcode)
npm run android          # Android emulátor / zařízení
npm start                # jen Metro, pro už nainstalovaný dev build
npm run typecheck

# Celý řetězec end to end (z kořene repozitáře)
npm run test:companion
# Totéž proti nasazenému relayi
npm run build && AFINDER_RELAY=wss://afinder-relay.danielhromadka1.workers.dev npx electron scripts/smoke-companion.cjs
```

V aFinderu: **Nastavení → Telefon → Povolit připojení**. Pole Relay server může zůstat prázdné: výchozí je nasazený relay `wss://afinder-relay.danielhromadka1.workers.dev` (`DEFAULT_RELAY` v `src/shared/companion/protocol.ts`). Pro lokální vývoj tam patří `ws://127.0.0.1:8787`.

## Jak to funguje

```
 Telefon ──wss──▶ Cloudflare Worker ──▶ Durable Object „room“ ◀──wss── aFinder (desktop)
                                         (1 room = 1 počítač)
           ◀──────── end-to-end šifrovaný kanál (relay vidí jen ciphertext) ────────▶
```

1. **Zapnutí.** Funkce je ve výchozím stavu vypnutá (stejně jako MCP a AI funkce) a její kód se do main procesu načte až při prvním použití. Po zapnutí si aFinder vytvoří identitu (X25519) a tajemství místnosti. Obojí uloží do `companion.json` v `userData`, zašifrované přes `safeStorage`. Pak otevře **odchozí** WebSocket na relay, který drží a sám obnovuje (backoff až 60 s, ping každých 30 s).
2. **Místnost.** `room = base64url(SHA-256(tajemství))`. Relay při připojení počítače spočítá hash tajemství a porovná ho s názvem místnosti, takže nic neukládá a místnost nikdo jiný nepřevezme.
3. **Párování.** Nastavení ukáže QR kód `afinder://pair?v=1&relay=…&room=…&key=<veřejný klíč počítače>&code=<jednorázový kód>&name=…`, platný 5 minut a jen pro jeden telefon. Telefon pošle svůj veřejný klíč a název zašifrované klíčem odvozeným z `DH(efemérní, klíč počítače) ‖ kód`. Obě obrazovky ukážou stejný šestimístný kód (SAS) a uživatel potvrdí na počítači. Špatný pokus kód spálí. Odkaz funguje i jako deep link: naskenování systémovým fotoaparátem otevře aplikaci rovnou na párování.
4. **Spojení.** Handshake ve stylu Noise IK. Telefon pošle `e_c` a svůj statický klíč zašifrovaný klíčem z `DH(e_c, S_h)`, takže relay nevidí, kdo se připojuje. Počítač odpoví `e_h` a prvním šifrovaným rámcem. Klíče session vznikají z `DH(e_c,e_h) ‖ DH(e_c,S_h) ‖ DH(s_c,e_h)` (HKDF-SHA256), z čehož plyne forward secrecy i vzájemné ověření. Každý směr má vlastní klíč XChaCha20-Poly1305 a nonce je čítač, takže zopakovaný, vynechaný nebo přeházený rámec session ukončí. Neznámý telefon dostane `unknown-device`.
5. **Provoz.** Uvnitř běží RPC: JSON požadavky a odpovědi plus binární bloky po 256 KiB. Okno je 16 bloků s potvrzováním, takže pomalý telefon zpomalí počítač a nic se nehromadí v paměti. Nahrávání se zapisuje do skrytého dočasného souboru a přejmenuje se až po kontrole velikosti.
6. **Odvolání.** Nastavení → Telefon → Odebrat smaže klíč telefonu a jeho otevřená spojení se okamžitě zavřou.

### Relay

- Jeden Durable Object na místnost. Počítač má tag `host`, telefony `c:<id>`. Zprávy od telefonu dostanou předponu `[id u32]`, zprávy počítače se podle ní doručí.
- Používá **WebSocket Hibernation API**: nečinná místnost se uspí a spojení zůstanou otevřená. `ping`/`pong` vyřizuje runtime (`setWebSocketAutoResponse`), takže kvůli keep-alive se objekt nebudí.
- Telefony dostávají `{"t":"host","online":…}`. Novější připojení téhož počítače nahradí starší (kód 4001).
- Ochrany: limit 60 připojení za minutu na IP (binding Rate Limiting), nejvýš 16 telefonů v místnosti a limit velikosti zprávy.

### Co telefon umí

| Operace | Poznámka |
|---|---|
| `info`, `places`, `list`, `thumbnail` | Procházení včetně archivů a vzdálených připojení aFinderu. Náhledy přes Quick Look (macOS) a Explorer (Windows), na Linuxu ikony. |
| `download`, `stat` | Stažení od zadaného bajtu (přerušený přenos pokračuje) a verze souboru (velikost + čas změny) pro ověření kopie v telefonu. |
| `replace` | Uložení úprav zpět přes původní soubor. S `base` selže chybou `conflict`, pokud se soubor na počítači mezitím změnil, a nic nepřepíše. |
| `upload`, `mkdir`, `rename`, `trash` | Jen když má telefon v Nastavení zaškrtnuté „Smí měnit soubory“ (výchozí je jen čtení) a jen pro soubory na tomto počítači. Akce se zapisují do historie aktivit pod názvem telefonu. |

### Otevírání souborů

Cílem je, aby uživatel nepoznal, že soubor leží na počítači.

- **Klepnutí soubor otevře.** Telefon si stáhne kopii (`src/lib/files.ts`) a ukáže ji systémovým způsobem (`src/lib/open.ts`). Průběh se ukazuje jen jako tenká lišta v řádku. Další klepnutí stahování zruší, klepnutí na jiný soubor přepne.
- **iOS: Quick Look** (lokální Expo modul `modules/afinder-open`) zobrazí fotky se zoomem, video, audio, PDF, Office i text. Mezi obrázky a videi ve složce, které už jsou v telefonu, se dá listovat swipem. Dva sousední soubory do 25 MB se mezitím stáhnou dopředu. Úpravy v Markupu se uloží do kopie.
- **Android:** soubor dostane aplikace zvolená systémem (ACTION_VIEW, s právem zápisu ACTION_EDIT přes `FileProvider`). Co aplikace uloží, skončí v kopii.
- **Kopie a cache:** kopie se znovu použije, dokud se na počítači nezmění velikost ani čas změny (`sameVersion`). Přerušené stahování pokračuje z `.part` souboru. Cache má limit 1 GB a nejdéle nepoužité kopie se mažou. Index je v `afinder-files.json` v dokumentech aplikace.
- **Uložení zpět:** po zavření náhledu telefon porovná kopii a změněný soubor pošle přes `replace` s verzí, ze které vznikl. Při kolizi se uživatel rozhodne: *Ponechat obě verze* (nahraje se vedle jako „název 2“), *Přepsat verzi na počítači*, nebo *Zahodit moje úpravy*. Malé textové soubory (do 1 MB) mají vlastní editor (dlouhý stisk → Upravit text). Zápis platí jen se svolením „Smí měnit soubory“.
- **Offline:** *Mít k dispozici offline* přesune kopii z cache do dokumentů, kde ji systém ani limit nesmažou. Úvodní obrazovka má sekci Offline, která se otevře i bez počítače. Při každém připojení (`hosts.ts`) se offline soubory synchronizují oběma směry. Soubor změněný na obou stranách se označí a nepřepíše.
- **Omezení:** video se přehraje až po stažení celého souboru. Opravdové streamování by vyžadovalo lokální HTTP proxy v nativním kódu, které by AVPlayeru a ExoPlayeru servírovalo rozsahy přes `download` s offsetem. Úpravy v aplikacích, které na iOS dostanou soubor přes „Otevřít v…“, se nevrátí, protože iOS jim předá kopii. Řeší to až integrace do Souborů.

### Sledování obrazovky počítače

Telefon může sledovat monitor počítače, ale nemůže ho ovládat.

- **Oprávnění:** každý telefon má v Nastavení → Telefon samostatné „Smí vidět obrazovku“, ve výchozím stavu vypnuté. Každé spuštění se navíc potvrzuje v systémovém dialogu na počítači, bez volby „vždy povolit“. Bez odpovědi do 60 s se požadavek odmítne.
- **Průběh:** `screenStart` doběhne až po potvrzení a vrátí ICE servery. Telefon nabídne příjem jednoho videa (`recvonly`) a nabídku pošle přes `screenSignal`. aFinder v **skrytém okně** (`main/services/screenCapture.ts`, `renderer/screen.html`, vlastní session s `setDisplayMediaRequestHandler` jen pro zvolený monitor) zachytí obraz a odpoví. ICE kandidáti jdou oběma směry: od telefonu přes `screenSignal`, od počítače jako push zpráva `{ ev: 'screen' }`. Starší verze aplikace push zprávy ignorují.
- **Bezpečnost:** video jde přes WebRTC (DTLS-SRTP) přímo mezi zařízeními, nebo přes TURN. Otisky DTLS v SDP putují jen uvnitř E2E relace ověřené klíči z párování, takže relay ani TURN nemůžou podvrhnout spojení.
- **Indikace a ukončení:** dokud sdílení běží, všechna okna aFinderu ukazují červený banner s tlačítkem *Ukončit sdílení*. Na macOS navíc svítí systémový indikátor nahrávání. Sdílení skončí také odpojením telefonu, jeho odebráním nebo odebráním oprávnění (`revoked`), když telefon 45 s neposlal ping (aplikace v pozadí), po 30 min bez dotyku na telefonu nebo když se zachycení do minuty nerozběhne. Začátek a konec se zapisují do historie aktivit (akce `screen` s délkou).
- **Kvalita:** delší strana max 1920 px a 30 fps. Při slabé síti se nejdřív ubírají snímky, ne rozlišení (`maintain-resolution`, max 4 Mb/s), aby text zůstal čitelný.
- **Telefon (`/screen`):** zobrazení přes celou obrazovku s otáčením (jinde je aplikace na výšku). Pinch přibližuje k bodu mezi prsty (až 6×), jedním i dvěma prsty se posouvá, obraz nikdy neodjede z okraje; dvojklep přiblíží 2,5× na místo klepnutí, další dvojklep vrátí celý obraz. Obrazovka zůstává rozsvícená (`expo-keep-awake`). Při více monitorech se nejdřív vybírá monitor.
- **macOS:** při prvním sledování se systém zeptá na oprávnění Nahrávání obrazovky. Pokud ho uživatel odmítne, telefon ukáže, kde ho zapnout.

#### TURN (mimo stejnou síť)

Bez TURN funguje sledování na stejné Wi-Fi a v příznivých sítích. Když se spojení do ~20 s nenaváže, telefon doporučí stejnou Wi-Fi. Pro mobilní data a firemní sítě je potřeba **Cloudflare Realtime TURN**:

1. V Cloudflare dashboardu: *Realtime → TURN Server → Create* a poznamenat si Key ID a API token.
2. `cd mobile/relay && npx wrangler secret put TURN_KEY_ID` a `npx wrangler secret put TURN_KEY_API_TOKEN`, potom `npm run deploy`.

**Nejdřív přímo, TURN jen jako záloha:** WebRTC volí cestu přes TURN až když přímá neprojde. Když video jde přes TURN (skryté okno to zjišťuje z `getStats` při spojení a pak každé 3 s), sníží se na delší stranu max 1280 px, 15 fps a 1,5 Mb/s, telefon ukazuje „Přes server · m:ss“ a sdílení skončí po **10 minutách** (`limit`). Potom aFinder **30 minut** nenabízí TURN vůbec, zkouší se jen přímé spojení (`screenStart` vrací `cooldownMs` a telefon při neúspěchu řekne, kdy bude server volný). Pauza je jen v paměti aFinderu. Spotřeba: 1,5 Mb/s × 10 min ≈ 110 MB na sezení, tedy i 5 sezení denně je ~17 GB měsíčně, hluboko pod 1 000 GB zdarma (pak 0,05 USD/GB).

Relay vydává krátkodobé údaje (4 h) jen ověřenému vlastníkovi místnosti (`{ t: 'ice' }`), nanejvýš jednou za 30 s, a aFinder je předá telefonu uvnitř E2E relace. TURN se platí za přenesená data, ale obsah nevidí.

### Integrace do aplikace Soubory / Android (zhodnocení, neimplementováno)

- **iOS File Provider** (`NSFileProviderReplicatedExtension`): počítač by se objevil v aplikaci Soubory a jiné aplikace by soubory otevíraly i ukládaly na místě. Vyžaduje samostatný nativní target (rozšíření) přidaný config pluginem, App Group se sdíleným Keychainem pro klíč telefonu a vlastní implementaci protokolu ve Swiftu nebo sdílený JS engine. Rozšíření běží v jiném procesu než React Native, takže `client.ts` nejde použít přímo. Rozšíření má i limity paměti (cca 20 MB) a běhu na pozadí. Odhad: řádově týdny, z toho nejvíc přepis kryptografie a RPC do Swiftu.
- **Android `DocumentsProvider`:** běží v procesu aplikace, takže je jednodušší. Stále ale potřebuje Kotlin, který z JS volá síťový klient, a blokující `openDocument` s `ParcelFileDescriptor` nad pipe nebo kopií.
- Doporučení: nejdřív Android `DocumentsProvider` (menší riziko), iOS File Provider až s ověřenou poptávkou.

Další fáze: hledání, to-do a poznámky, „otevřít na Macu“, omezení telefonu na vybrané složky, zámek aplikace přes Face ID, push notifikace a přímé spojení po místní síti.

## Technologie a proč

| Vrstva | Volba | Proč |
|---|---|---|
| Mobilní aplikace | **Expo SDK 57** (React Native 0.86), **TypeScript**, **expo-router** | Jeden kód pro iOS i Android. Sdílí s aFinderem protokol, kryptografii a překlady (`src/shared/i18n`, klíče `mobile.*`). Swift a Kotlin by znamenaly dva kódy, Flutter jiný jazyk; ani v jednom případě by nešlo nic sdílet. |
| Build a vydání | **EAS Build + EAS Submit** | Podepsané buildy pro App Store i Google Play v cloudu. `ios/` a `android/` se generují (`/ios`, `/android` jsou v `.gitignore`). |
| Seznamy a data | **FlashList**, **expo-image**, **TanStack Query** | Rychlé dlouhé seznamy, cache náhledů a výpisů, pull-to-refresh. |
| Párování | **expo-camera** (`CameraView`, QR), deep link `afinder://pair`, **expo-clipboard** | Skenování v aplikaci, systémovým fotoaparátem nebo vložením odkazu. |
| Klíče | **expo-secure-store** (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`) | Klíč telefonu i seznam počítačů jsou v Keychainu nebo Keystore a nepřenesou se ze zálohy na jiné zařízení. |
| Soubory | **expo-file-system** (`File`, `FileHandle`), **expo-sharing**, **expo-document-picker**, **expo-image-picker** | Stahování a nahrávání po blocích bez načtení celého souboru do paměti. |
| Kryptografie | **@noble/curves**, **@noble/ciphers**, **@noble/hashes**, plus `expo-crypto` jako zdroj náhody v Hermes | Auditovaný čistý TypeScript. Stejný kód běží v Electronu, v Hermes, ve Workeru i ve vitestu. |
| Relay | **Cloudflare Workers + Durable Objects** (Hibernation API), **wrangler**, **@cloudflare/vitest-plugin** | Web už běží na Cloudflare a nečinná místnost nic nestojí. Není co spravovat. |
| Desktop | `services/companion.ts`, načtený přes `await import()`, `qrcode` až při párování | Main proces zůstává štíhlý a neotevírá se žádný port. |

### Proč relay, a ne přímé spojení

Telefon bývá na mobilních datech nebo jiné Wi-Fi a počítač za NAT. Přímé spojení by chtělo port forwarding, nebo WebRTC se STUN/TURN, což je složitější a TURN stojí peníze. Obě strany se připojují **ven** přes `wss://` na port 443, takže to projde i firemní sítí. Relay je nedůvěryhodný a díky E2E šifrování na tom nezáleží.

### Známá omezení

- aFinder musí běžet (stačí minimalizovaný).
- iOS v pozadí uspí WebSocket. Aplikace se po návratu do popředí sama znovu připojí a přenosy běží v popředí.
- Mazání a nahrávání z telefonu funguje jen pro soubory na tomto počítači. Vzdálené servery by vyžadovaly potvrzovací dialog na počítači.
