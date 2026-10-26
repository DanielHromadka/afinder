# aFinder

🇬🇧 [English](README.md) · 🇨🇿 Čeština (podrobný popis funkcí)

Minimalistický správce souborů ve stylu Windows XP. Primárně pro **macOS**, podporuje i **Windows** a **Linux**. Electron + TypeScript + React.

Lokalizace: **čeština, angličtina, němčina a španělština** (Nastavení → Jazyk; výchozí je jazyk systému).

## Funkce

- Procházení složek: panel úloh nebo strom složek, adresní řádek, Zpět/Vpřed/Nahoru, řazení podle sloupců, měnitelná šířka sloupců.
- **Filtr** (⌘F nebo `/`): okamžitý, nezávislý na velikosti písmen i diakritice, shodné znaky jsou podtržené. Režim **Fuzzy** hledá znaky v pořadí s mezerami.
- **Hledání v podsložkách** (přepínač Podsložky, ⌥⌘F): filtr prohledá celý strom pod aktuální složkou. Hledá samostatný `utilityProcess` do šířky, výsledky přibývají průběžně (max. 5000). Přibude sloupec Umístění. Symlinky a balíčky `.app` se neprocházejí, skryté složky jen při zobrazení skrytých souborů.
- **Taby** (⌘T, ⌘W, ⌃Tab, ⌘1–9): každý tab má vlastní složku, historii, filtr, řazení a seskupení. Prostřední tlačítko myši na složce ji otevře v novém tabu. Taby jdou přetahovat v rámci panelu i mezi panely.
- **Panely (split screen)** (tlačítko Panely, ⌘\\): 1–4 panely vedle sebe s nastavitelnou šířkou. Tab přepíná aktivní panel. F5 kopíruje a F6 přesouvá výběr do vedlejšího panelu. Soubory jdou mezi panely i přetahovat.
- **Více oken** (⌘N): další okno se otevře ve stejné složce. Drag & drop funguje i mezi okny. Rozložení panelů a tabů hlavního okna se pamatuje.
- **Automatizace** (tlačítko Automatizace): popište spouštěč, workflow a očekávaný výsledek. Claude Code připraví deterministický skript a samostatné ověření; při chybějících údajích položí otázky. Návrh lze před uložením upravit. Běhy už AI nepoužívají.
- **AI agent** (tlačítko AI agent, ⌃\`): integrovaný panel, který ve složce spustí **Claude Code**, **Codex**, **OpenCode** nebo běžný terminál přímo v aFinderu. Agent pracuje nad danou složkou a změny souborů se hned promítají do seznamu. Funguje to i přes kontextové menu složky (*Otevřít v Claude Code / v Codexu / v OpenCode / v terminálu*). Relace mají vlastní taby, panel jde zvětšit tažením a skrýt bez ukončení relací. Soubory přetažené do panelu se vloží jako cesty v uvozovkách, stejně jako položka *Vložit cestu do AI agenta*. Panel používá `node-pty` a `xterm.js` a spouští vaši přihlašovací shell (`zsh -l -i`), takže `PATH` a aliasy odpovídají běžnému terminálu i při spuštění z Docku. Nabídka ukáže jen nainstalované agenty.
- **Starší relace agentů** (tlačítko ↺ v liště AI agenta nebo *+ → Starší relace…*): seznam dřívějších konverzací Claude Code, Codexu a OpenCode, i těch už zavřených, s názvem (vlastní nebo vygenerovaný název relace, jinak první zpráva) a časem poslední aktivity. Výchozí jsou relace z aktuální složky, zaškrtnutím *Ze všech složek* se ukážou všechny. Dá se hledat a filtrovat podle agenta. *Pokračovat* (nebo dvojklik) otevře novou záložku ve složce relace a spustí `claude --resume <id>` / `codex resume <id>` / `opencode -s <id>`. aFinder čte jen začátky přepisů v `~/.claude/projects` a `~/.codex/sessions` a databázi OpenCode (`~/.local/share/opencode/opencode.db`, jen pro čtení; bez podagentních a archivovaných relací), a to až po otevření seznamu.
- **Seskupení do virtuálních složek** (tlačítko Seskupit): podle roku, měsíce, týdne, dne (datum změny), druhu, přípony nebo velikosti. Skupiny se dají sbalit kliknutím. Dvojklik otevře skupinu jako virtuální složku (`~/Documents ⟩ Říjen 2026`), ⌘↑ nebo Backspace z ní vystoupí. Funguje i nad výsledky hledání v podsložkách.
- **Velikosti složek** se počítají rekurzivně na pozadí v `utilityProcess`, průběžně (`≥ 1,2 GB`) a s cache. Změny hlídá `fs.watch` (FSEvents).
- **Náhled souborů** (tlačítko Náhled, ⇧⌘P / Alt+P): panel vpravo od seznamu s nastavitelnou šířkou. Zapíná se zvlášť pro každý tab (i v každém panelu), stav si tab pamatuje i po restartu. Text a zdrojový kód zobrazí v editoru **Monaco** (editor z VS Code) se zvýrazněním syntaxe a barvami podle vzhledu (prvních 2 MB). Dále umí obrázky, PDF (prohlížeč Chromia), video a audio, **Word** (.docx převedený přes `mammoth` a vykreslený v izolovaném rámci bez skriptů) a **Excel** (.xlsx, prvních 500 řádků a 50 sloupců, přepínání listů). **3D modely** (.glb, .gltf, .stl, .obj, .ply, .3mf do 50 MB) vykreslí přes three.js a dají se otáčet myší a přibližovat kolečkem. Větší nebo nečitelné modely ukážou systémový náhled. Ostatní formáty (pptx, Keynote, Pages, doc, xls, RTF, HEIC …) ukáže přes systémový náhled: Quick Look na macOS a náhledy Průzkumníka na Windows. Soubory neznámého typu se otestují, jestli nejsou textové. **Mezerník** otevře stejný náhled ve velkém okně (Rychlý náhled), šipky přepínají soubory, Esc nebo mezerník ho zavře. Soubory čte renderer přes protokol `afinder-file://` s podporou Range požadavků, takže se dá přetáčet video. Monaco se načte až při prvním náhledu textu, three.js až při prvním 3D modelu.
- **Úpravy v náhledu:** textové soubory jdou v náhledu upravit (tlačítko Upravit, uložení ⌘S / Ctrl+S). Když soubor mezitím změní někdo jiný (třeba AI agent), náhled se sám načte znovu. Pokud máte neuložené změny, nabídne *Přepsat* nebo *Načíst znovu* a nic nepřepíše potichu. Při přechodu na jiný soubor se rozpracované změny uloží. Upravit nejde soubor, který není celý načtený (nad 2 MB), soubor mimo UTF-8 a soubor uvnitř archivu.
- **Úpravy obrázků:** u obrázku v Rychlém náhledu (mezerník) nebo v panelu náhledu je tlačítko **Upravit** (z panelu se editor otevře v Rychlém náhledu). Nabízí šipku, čáru, obdélník, elipsu (s výplní nebo bez, Shift drží 45° a čtverec), pero, zvýrazňovač a text. Dále ořez, rozpixelování oblasti (zakrytí citlivých údajů), otočení a překlopení, změnu velikosti a barevné úpravy (jas, kontrast, sytost, odstín, odstíny šedi, sépie, inverze). Funguje Zpět/Znovu (⌘Z / ⇧⌘Z). **Uložit** (⌘S) přepíše originál (PNG, JPEG, WebP) s kontrolou, jestli se soubor mezitím nezměnil. **Uložit jako kopii** (⇧⌘S) vytvoří `název (upraveno).ext`. GIF, BMP, SVG, AVIF a ICO se ukládají jen jako kopie PNG. Metadata (EXIF) se při uložení nezachovají.
- **Snímek obrazovky** (Úlohy → Snímek obrazovky, paleta, ⇧⌘S / Ctrl+Shift+S): výřez, okno nebo celá obrazovka. Na macOS používá nativní `screencapture` (při prvním použití si systém řekne o oprávnění Nahrávání obrazovky). Na Windows a Linuxu vyfotí celou obrazovku pod kurzorem a výřez se udělá v editoru. Okna aFinderu se během snímku schovají. Snímek se uloží do aktuální složky (nebo do Obrázků, když složka není místní a zapisovatelná) a vybere se. Dialog potom nabídne *Upravit* (editor obrázků, případně rovnou s ořezem) nebo *Kopírovat do schránky*.
- **Nedávné soubory:** sekce *Nedávné* v levém panelu ukazuje posledních 8 souborů, které jste v aFinderu otevřeli, vytvořili, upravili nebo vyfotili. Klik soubor ukáže v jeho složce, dvojklik ho otevře, pravé tlačítko nabídne odebrání ze seznamu nebo vymazání seznamu. Seznam (max. 50 položek) zůstává jen v `recents.json` v tomto počítači a dá se vypnout v Nastavení → Soubory (vypnutí ho vymaže). Archivy a vzdálená úložiště se nezapisují.
- **Prezentace obrázků:** pravé tlačítko na výběru několika obrázků nabídne *Přehrát jako prezentaci*. Na jednom obrázku nabídne prezentaci všech obrázků ve složce od něj. Běží přes celou obrazovku s prolínáním a automatickým přechodem (2–20 s, volba se pamatuje), volitelně dokola. Mezerník ji pozastaví, ←/→ přepínají obrázky, Esc ji ukončí. Ovládací lišta zmizí, když se myš nehýbe.
- **Paleta příkazů** (⌘K / Ctrl+K, na Windows a Linuxu také Ctrl+Shift+P): jedno vyhledávací pole pro všechny akce. Najde příkazy pro složku a výběr, přepínače zobrazení a seskupení, přechod do oblíbených, umístění a připojených serverů, taby a panely, konzoli, vzhledy, jazyky i AI akce. Hledá fuzzy, bez ohledu na diakritiku, a ukazuje klávesové zkratky.
- **AI nad soubory** (pravé tlačítko na souboru, výběru nebo prázdném místě, případně paleta): *Zeptat se AI…* (napíšete otázku), *Shrnout pomocí AI* a *Popsat složku pomocí AI* spustí Claude Code (nebo Codex či OpenCode) v integrované konzoli s první zprávou o vybraných souborech; v konverzaci jde pokračovat. *Navrhnout názvy pomocí AI…* otevře hromadné přejmenování v režimu *Návrh od AI*: Claude Code v neinteraktivním režimu bez nástrojů dostane jen názvy (ne obsah souborů) a vrátí návrhy. Ty projdou stejnou kontrolou kolizí a nepovolených znaků jako ruční přejmenování, přípony zůstanou a návrh jde upřesnit vlastním pokynem (*Navrhnout znovu*). Soubory z archivu nebo ze serveru dostane agent jako místní kopie; celé vzdálené složky se mu kvůli velikosti nepředávají.
- **Oblíbené** (pravé tlačítko → *Přidat do oblíbených*, ⌃⌘T / Ctrl+Shift+D): připne soubor nebo složku do sekce Oblíbené v levém panelu. Kliknutí na složku ji otevře, kliknutí na soubor otevře jeho složku a soubor vybere. Pravým tlačítkem na oblíbenou položku ji jde otevřít v novém tabu nebo okně, posunout v pořadí nebo odebrat.
- **Hromadné přejmenování** (F2 nebo *Přejmenovat* při výběru více položek): nahrazení textu (i regulárním výrazem se skupinami `$1`), přidání textu před nebo za název, nebo název s pořadovým číslem. K tomu změna velikosti písmen a ponechání přípony. Živý náhled starých a nových názvů předem odhalí prázdné názvy, nepovolené znaky, duplicity i kolize s existujícími soubory. Přejmenování probíhá ve dvou krocích přes dočasné názvy, takže jdou i prohození (a↔b). Při chybě se vrátí do původního stavu.
- **Stav gitu:** v repozitáři mají soubory štítek **M** (změněno), **A** (přidáno), **U** (nesledováno), **R** (přejmenováno), **D** (smazáno) nebo **!** (konflikt). Ignorované soubory jsou zašedlé a složky se změnami uvnitř mají také štítek. Ve stavovém řádku je větev a počet commitů k odeslání a stažení (⎇ main ↑1). Obnovuje se se změnami ve složce, při návratu do okna a každých 15 s. Bez nainstalovaného gitu se nic nezobrazí. Na macOS se `/usr/bin/git` použije, jen když jsou nainstalované Command Line Tools, takže nevyskočí instalační dialog.
- **Archivy jako složky:** `.zip`, `.jar`, `.tar`, `.tar.gz`, `.tgz` a `.tar.zst` se dvojklikem otevřou jako složka (`~/Downloads/projekt.zip/src`). Funguje v nich náhled, rychlý náhled, otevření souboru, kopírování ven (⌘C/⌘V, F5, drag & drop i do Finderu) a velikosti složek. Archiv je jen pro čtení. Soubory se vybalují až při potřebě do dočasné složky, která se při ukončení aplikace smaže. Systémový rozbalovač je v kontextovém menu jako *Otevřít v systémové aplikaci*.
- **Vytvoření archivu:** *Vytvořit archiv…* v kontextovém menu (nebo v paletě) zabalí vybrané soubory a složky, *Archivovat tuto složku…* na prázdném místě zabalí celou aktuální složku do archivu vedle ní. Na výběr je ZIP (Deflate), TAR.GZ (gzip), TAR.ZST (Zstandard) a nekomprimovaný TAR, komprese bez komprese / rychlá / normální / maximální, název a cílová složka. Průběh jde zrušit (nedokončený archiv se smaže), existující soubor se nikdy nepřepíše (vznikne „název 2.zip“) a symbolické odkazy se ukládají jako odkazy. Funguje jen pro položky na tomto počítači.
- **Vzdálená úložiště** (levý panel → *Připojit server…*): **SFTP** (heslo, soukromý klíč nebo SSH agent) a **S3** (AWS i kompatibilní služby jako MinIO, Cloudflare R2, Wasabi nebo Backblaze B2; bez klíčů se použije profil z `~/.aws`). Připojení se chová jako složka. Adresní řádek ukazuje `sftp://uživatel@server/cesta` nebo `s3://bucket/prefix` a tyto adresy do něj jde i napsat. Funguje procházení, náhled (soubory do 200 MB), otevření, kopírování a přesun mezi diskem a serverem (⌘C/⌘V, F5/F6, drag & drop), nová složka, přejmenování i hromadné, úprava textu v náhledu a smazání. Smazání je trvalé, protože server nemá koš, a aplikace se na něj vždy zeptá. Hesla a tajné klíče se ukládají zašifrovaně v systémové klíčence. Klíč SSH serveru se při prvním připojení zapamatuje a při jeho změně se připojení odmítne. Stažené soubory se drží v dočasné cache, která se při ukončení smaže; změny v souboru otevřeném v jiné aplikaci se na server nenahrají. *Otevřít v terminálu* ve složce na SFTP otevře v integrované konzoli `ssh` rovnou do té složky na serveru (klíč, agent i heslo řeší ssh samo). Rekurzivní hledání, git a velikosti složek na vzdálených úložištích zatím nefungují. Technicky je každé připojení připojené do virtuální složky `<data aplikace>/Remote/<id>` a backend implementuje rozhraní `RemoteProvider` (`src/main/services/remote/provider.ts`). Další backend (např. WebDAV) stačí přidat jako novou implementaci tohoto rozhraní.
- **SharePoint a OneDrive** (typ *SharePoint / OneDrive* v dialogu připojení): knihovna dokumentů webu SharePointu (adresa webu, volitelně název knihovny, třeba „Dokumenty“ nebo „Shared Documents“) nebo vlastní OneDrive, přes Microsoft Graph. Přihlášení proběhne v systémovém prohlížeči včetně MFA a token se uloží zašifrovaně, takže další připojení už proběhne bez přihlašování. Adresy mají tvar `sharepoint://contoso.sharepoint.com/sites/Team/Dokumenty/…` a `onedrive://me/…`. Smazané položky jdou do koše SharePointu nebo OneDrivu. Velké soubory se nahrávají po částech a při omezení počtu požadavků (HTTP 429) aplikace počká a zkusí to znovu. Je potřeba registrace aplikace v Microsoft Entra ID: platforma *Mobilní a desktopové aplikace* s přesměrováním `http://localhost`, zapnuté *Allow public client flows* a delegovaná oprávnění `Files.ReadWrite.All` + `Sites.Read.All` (pro OneDrive stačí `Files.ReadWrite`). Do dialogu se zadá její *Application (client) ID* a tenant (výchozí `organizations`).
- **Jiný počítač s aFinderem a vzdálená plocha** (typ *aFinder na jiném počítači* v dialogu připojení): na druhém počítači se v Nastavení → Vzdálený přístup zapne přístup z jiných počítačů, klikne na *Spárovat počítač* a zkopíruje odkaz `afinder://pair?…`. Ten se vloží do dialogu, oba počítače ukážou stejný kód a druhý počítač spárování potvrdí. Spojení jde přes stejný relay server jako telefon a je šifrované mezi počítači. Soubory druhého počítače se pak chovají jako složka: kořen ukazuje jeho místa (domov, plocha, disky), funguje procházení, kopírování oběma směry, přejmenování, přesun a mazání do koše na druhém počítači. *Vzdálená plocha* (kontextová nabídka připojení nebo paleta příkazů) otevře okno s jeho obrazovkou. S oprávněním *Smí ovládat počítač* jde ovládat myší a klávesnicí, včetně celé obrazovky se zachycením systémových zkratek, prohození Cmd ↔ Ctrl mezi Macem a Windows/Linuxem a ručního poslání či převzetí schránky. Co spárovaný počítač smí (měnit soubory, vidět obrazovku, ovládat), se nastavuje na ovládaném počítači v seznamu spárovaných zařízení. Sledování ani ovládání se nepotvrzuje (přístup bez dozoru), ve všech oknech aFinderu je ale vidět lišta s tím, kdo počítač ovládá, a tlačítkem pro ukončení. Na Macu je pro ovládání potřeba povolit aFinder v *Zpřístupnění*. Vstup vkládá malý pomocný program `native/afinder-input` (Rust, knihovna enigo; macOS, Windows a Linux s X11). Verze z Mac App Store ovládat nejde. Přihlašovací obrazovku, zamčený počítač ani dialogy UAC ovládat nejde, protože aFinder běží v uživatelské relaci.
- **Nová složka** jedním klikem (⇧⌘N) s okamžitým přejmenováním.
- **Terminál** (tlačítko Terminál, ⇧⌘T): otevře integrovaný terminál v aktuální složce. Systémový terminál (Terminal.app, Windows Terminal …) je v kontextovém menu jako *Otevřít v systémovém terminálu*.
- **Kopírování a přesun:** ⌘C / ⌘X / ⌘V, ⌥⌘V (přesunout jako ve Finderu), ⌘D (duplikovat). Funguje se systémovou schránkou, takže soubory jdou kopírovat z Finderu i do něj. Při kolizi názvů se nabídne Nahradit / Ponechat obě / Přeskočit. Nahrazené položky jdou do koše.
- **Drag & drop:** na složku v seznamu, do stromu i do prázdné plochy (= aktuální složka). Funguje i z Finderu a do Finderu. Na stejném disku se přesouvá, mezi disky kopíruje, ⌥ vynutí kopii.
- **Vzhledy** (Nastavení → Vzhled): Windows XP, **Moderní (macOS, výchozí)** (plochý vzhled současného Finderu se světlou i tmavou variantou podle systému a na macOS s nativními tlačítky okna), Klasický (Windows 98), Cyberpunk, FBI, J.A.R.V.I.S. (HUD z Iron Mana), Barbie, Batman, Bitcoin, Matrix (zelený fosfor a digitální déšť) a DOS (modré panely Norton Commanderu v textovém režimu VGA). Volba se pamatuje a změna vzhledu, jazyka, oblíbených i dalších nastavení se hned projeví ve všech otevřených oknech.
- **Informace podle vzhledu** (Nastavení → *Informace podle vzhledu ve stavovém řádku*, výchozí vypnuto): každý vzhled přidá do stavového řádku vlastní údaj. Windows XP a Klasický ukáží volné místo na disku, Moderní „X GB k dispozici“ jako Finder, Cyberpunk dobu běhu a vytížení CPU, J.A.R.V.I.S. CPU, RAM a zaplnění disku, Matrix operátora (`uživatel@počítač`), DOS volné místo v bajtech jako poslední řádek příkazu `DIR`, FBI naposledy změněný soubor, Barbie počet obrázků, Batman počet programů, skriptů a instalátorů a Bitcoin aktuální kurz BTC v USD (CoinGecko, jednou za 5 minut; jediný údaj, který potřebuje síť). Systémové údaje se zjišťují jen pro viditelný tab a jen u vzhledů, které je potřebují.
- **Hodiny a kalendář** ve stavovém řádku: den v týdnu, datum a čas podle jazyka aplikace, celé datum v tooltipu. Kliknutím se otevře kalendář s živým časem (se sekundami), čísly týdnů podle ISO 8601 a zvýrazněným dneškem. Šipky nebo kolečko myši listují měsíci, tlačítko Dnes vrátí aktuální měsíc a Esc kalendář zavře.
- Kontextové menu, přesun do koše, zobrazení ve Finderu, kopírování cesty, skryté soubory (⇧⌘.).

## Historie aktivit a lokální sémantické hledání

V **Nastavení → Historie aktivit** zapněte ukládání historie. Výchozí stav je **vypnuto**; nevzniká databáze ani modelový worker. Zaznamenávají se navštívené adresáře, otevření, vytvoření, přejmenování, kopírování, přesuny, koš, ukládání úprav a spuštění terminálu, projektu či automatizace. Historie nezaznamenává obsah souborů, AI prompty ani výstup terminálu. Vlastní poznámku nebo fragment lze uložit výslovně s názvem a adresářem. Jde o historii operací aFinderu, nikoli sledování celého systému.

Okno historie otevřete z nastavení nebo z palety příkazů (⌘K). Umožňuje textové hledání, filtrování podle operace a adresáře včetně podadresářů, stránkování, otevření adresáře v novém tabu a export celé historie do JSON. Vypnutí zastaví další zaznamenávání, zachová však starší záznamy k prohlížení. **Smazat historii a index** odstraní databázi, fragmenty i vektory. Uchování lze nastavit na 7, 30, 90 nebo 365 dnů; maximálně 10 000 záznamů. Automatické promazání probíhá při používání historie.

**Lokální sémantické vyhledávání** má samostatný přepínač, také výchozí vypnutý. Vyžaduje zapnutou historii a výslovné **Stáhnout lokální model**. Vestavěný ONNX Runtime (`onnxruntime-node`) používá kvantovaný vícejazyčný `Xenova/multilingual-e5-small` (pevně určená revize, 384 rozměrů, CPU se dvěma vlákny). Ollama ani jiný server není potřeba. Model se stahuje z Hugging Face, zabírá přibližně 144 MB a další indexace i hledání pracují offline. Indexují se jen metadata historie a ručně uložené fragmenty, ne obsah celého disku. Vektory pro 10 000 záznamů zabírají asi 15 MB bez režie databáze. Paměť při načteném modelu závisí na délce textů a dávce; worker běží odděleně od UI, zpracovává dávky po osmi záznamech a po minutě nečinnosti se ukončí.

Databáze je v `activity/history.sqlite`, model v `embedding-model/` pod uživatelskými daty aplikace. Změny nastavení ihned zastaví rozpracovanou indexaci. Nové záznamy se po zapnutí postupně indexují; v režimu **Význam** se hledá až po stisknutí tlačítka, přesné textové shody se kombinují s podobností vektorů. Textové hledání funguje i bez modelu. Test integrace: `npm run test:activity`; skutečný offline model lze přidat přes `AFINDER_MODEL_CACHE=/cesta/k/cache npm run test:activity` (cache musí už obsahovat stažený model).


## Docker deployment

The Linux desktop can also run in a container with browser access through noVNC. Run `mkdir -p workspace` followed by `docker compose up -d --build`, then open <http://localhost:6080/vnc.html?autoconnect=true&resize=scale>. Settings and models persist in a named volume; only `workspace/` is shared by default. The endpoint binds to localhost. See [Docker deployment](docs/docker.md) for existing-folder mounts, image transport, remote access and limitations.

## Lokální asistent pro soubory

V **Nastavení → Lokální asistent souborů** lze zapnout osm úloh: návrh cílové složky, třídění adresáře, přiřazení k projektu, štítky, doporučení aplikace, zpřesnění hledání, kontrolu umístění a přípravu předání. Výchozí stav je **vypnuto**. Model Laya (přibližně 1,33 GB) se stáhne až samostatným tlačítkem; potom běží přímo v aplikaci na CPU, offline a bez Ollamy. Čtení krátkých textových úryvků má vlastní výchozí vypnutý přepínač. PDF a Office soubory se posuzují pouze podle metadat.

Úlohy najdete v kontextovém menu souborů/prázdného místa a v paletě ⌘K. Analýza zpracuje nejvýše 50 souborů, nabídne upravitelný přehled a změny provede až po potvrzení. Kolize názvů zachovají oba soubory. Nejisté návrhy zůstávají neoznačené; skóre modelu není zárukou správnosti. Štítky se ukládají pouze v aFinderu a lze je smazat v Nastavení. Podrobnosti a omezení: [docs/file-assistant.md](docs/file-assistant.md).

## Automatizace

Otevřete **Automatizace**, popište přesné cesty, spouštěč, postup a ověřitelné výsledky a zvolte **Navrhnout pomocí Claude Code**. Generování vyžaduje nainstalovaný a přihlášený Claude Code; agent při návrhu nemá přístup k souborům. Zkontrolujte plán i oba skripty a uložte návrh. Uložení vždy pozastaví spouštěč. Poté použijte **Spustit a ověřit** nebo **Zapnout spouštěč**.

Podporované spouštěče: ruční běh, interval v minutách, denní místní čas a spuštění aplikace. Plánování běží pouze při spuštěném aFinderu (na macOS i po zavření posledního okna). Zmeškané naplánované běhy se provedou jednou. Úloha, která již běží, se nespouští souběžně. Časový limit platí pro workflow i ověření dohromady; běh lze zastavit. Úspěch se zaznamená až po úspěšném dokončení samostatného ověření.

**Šablona synchronizace** funguje i bez AI: zadejte dvě existující místní složky a interval. Kopíruje nové a změněné soubory jednosměrně přes dočasné soubory, zachovává nadbytečné cílové soubory a ověřuje obsah pomocí SHA-256. Překrývající se složky a symbolické odkazy odmítá. Chybějící cílovou složku ani odpojený disk automaticky nevytváří.

Skripty jsou CommonJS pro vestavěný Node.js a exportují asynchronní funkci:

```js
module.exports = async function () {
  // Deterministické operace; pro neúspěch vyhoďte Error.
};
```

Každá fáze běží v odděleném procesu s uživatelskými oprávněními. Nejde o bezpečnostní sandbox; před uložením zkontrolujte operace a cesty. Doplňkové balíčky nejsou součástí běhového prostředí. Automatizace, spouštěče a posledních 20 běhů na úlohu se ukládají do `automations/automations.json` v uživatelských datech aplikace; log každého běhu uchovává posledních 24 000 znaků. Nedokončené běhy se po restartu označí jako přerušené.

## Vývoj

```bash
npm install
npm run dev        # spuštění s HMR
npm test           # unit testy (matcher, cesty, překlady, zkratky, seskupení, formátování)
npm run typecheck
npm run test:automations # Electron: vytvoření, synchronizace, ověření, přesun dialogu a zastavení běhu
npm run dist       # macOS: .dmg pro arm64 + x64 do dist/
npm run dist:win   # Windows: NSIS instalátor pro x64 + arm64
npm run dist:linux # Linux: AppImage + .deb pro x64 + arm64
npm run icons      # znovu vygeneruje build/icon.png a build/drag.png ze SVG
```

## Architektura

```
src/main/            hlavní proces: okno, IPC, služby (fileSystem, sizeService, settings)
src/workers/         sizeWorker (velikosti složek), searchWorker (hledání v podsložkách) – utilityProcess
src/preload/         contextBridge → typované window.api
src/shared/types.ts  sdílené typy a názvy IPC kanálů
src/shared/paths.ts  práce s cestami pro POSIX i Windows (C:\, \\server\share) – použitelné i v rendereru
src/shared/i18n/     slovníky cs (referenční), en, de, es + t() / plural() / tos()
src/renderer/        React UI (components/, lib/, styles/xp.css)
```

Renderer běží s `contextIsolation`, `sandbox` a bez `nodeIntegration`. Všechny operace se soubory jdou přes IPC a main proces cesty validuje. Terminál se spouští vždy s polem argumentů, nikdy přes shell: na macOS `open -a Terminal`, na Windows Windows Terminal → PowerShell → cmd, na Linuxu první dostupný z `x-terminal-emulator`, GNOME Terminal, Konsole, Xfce Terminal, kitty, Alacritty a xterm.

## Platformy

| | macOS | Windows | Linux |
|---|---|---|---|
| Kořeny ve stromu | `/` (Macintosh HD) | disky `C:\`, `D:\` … | `/` |
| Místa | Plocha, Dokumenty, Stažené, domov, Aplikace, svazky v `/Volumes` | totéž + všechny disky | totéž + `/media/<uživatel>`, `/run/media/<uživatel>`, `/mnt` |
| Schránka se soubory | `NSFilenamesPboardType` (Finder) | `CF_HDROP` (Průzkumník) | `text/uri-list` |
| Skryté soubory | tečka na začátku | tečka + známé systémové položky | tečka na začátku |
| Hlavní modifikátor | ⌘ | Ctrl | Ctrl |

Poznámky k Windows a Linuxu:

- Windows nemá skrytí jen podle názvu. Node.js nezpřístupňuje atribut „skrytý“, proto se skrývají soubory s tečkou a známé systémové položky (`desktop.ini`, `$Recycle.Bin`, `pagefile.sys` …).
- Názvy na Windows nesmí obsahovat `\ / : * ? " < > |`; koncové tečky a mezery se odstraní.
- Titulek okna i jeho tlačítka kreslí aplikace sama na všech platformách. Na macOS jsou skryté systémové „semafory“.
- Konzole na Windows spouští PowerShell, na Linuxu a macOS přihlašovací shell uživatele. `node-pty` je nativní modul s předkompilovanými binárkami pro macOS a Windows; linuxový balíček je potřeba sestavit na Linuxu (`npm install && npm run dist:linux`), aby se modul zkompiloval pro Linux.
- Instalátory nejsou podepsané. Windows SmartScreen a macOS Gatekeeper je proto při prvním spuštění zablokují, dokud se nenastaví podpis.

## Překlady

Texty jsou v `src/shared/i18n/`. `cs.ts` je referenční slovník, ostatní jazyky musí mít všechny jeho klíče (hlídá to typová kontrola i test, včetně shody `{parametrů}`). Klíče s koncovkou `.mac` / `.win` / `.linux` jsou varianty podle platformy (`tos()`), koncovky `.one` / `.few` / `.many` / `.other` jsou tvary množného čísla (`plural()`, podle `Intl.PluralRules`). Datum, čísla a řazení se řídí locale zvoleného jazyka. Nový jazyk přidáte souborem slovníku a položkou v `LANGUAGES` v `src/shared/i18n/index.ts`.

## Vlastní vzhled

Vzhled je CSS téma nad základem `styles/xp.css`. Nové téma přidáte takto:

1. Přidejte položku do `THEMES` v `src/shared/types.ts` (id, název, barva pozadí okna).
2. Vytvořte `src/renderer/src/styles/theme-<id>.css`. Pravidla zapište pod `:root[data-theme='<id>']`: nejdřív přepište CSS proměnné (barvy, písmo), potom podle potřeby jednotlivé komponenty.
3. Importujte soubor v `src/renderer/src/main.tsx`.

## Klávesové zkratky

Zkratky jdou změnit v Nastavení (⌘, / Ctrl+,) v sekci *Klávesové zkratky*: klikněte na zkratku a stiskněte nové klávesy. Obsazenou nebo vyhrazenou kombinaci (⌘1–9, ⌘, a na macOS ⌘Q/⌘H/⌘M) aplikace odmítne, zkratku jde i vypnout nebo vrátit na výchozí. Tabulka níže ukazuje výchozí zkratky.

| Akce | macOS | Windows / Linux |
|---|---|---|
| Filtr | ⌘F, `/` (Esc vymaže) | Ctrl+F, `/` |
| Hledat v podsložkách | ⌥⌘F | Ctrl+Shift+F |
| Nová složka | ⇧⌘N | Ctrl+Shift+N |
| Integrovaný terminál | ⇧⌘T | Ctrl+Alt+T, Ctrl+Shift+T |
| Otevřít | Enter, ⌘↓, dvojklik | Enter, Alt+↓, dvojklik |
| Rychlý náhled | Mezerník | Mezerník |
| Paleta příkazů | ⌘K | Ctrl+K, Ctrl+Shift+P |
| Panel náhledu (pro aktuální tab) | ⇧⌘P | Alt+P |
| Přidat do / odebrat z oblíbených | ⌃⌘T | Ctrl+Shift+D |
| Přejmenovat | F2 | F2 |
| Do koše | ⌘⌫ | Delete |
| Nahoru | ⌘↑, Backspace | Alt+↑, Backspace |
| Zpět / Vpřed | ⌘[ / ⌘] | Alt+← / Alt+→ |
| Skryté soubory | ⇧⌘. | Ctrl+H |
| Kopírovat / Vyjmout / Vložit | ⌘C / ⌘X / ⌘V | Ctrl+C / Ctrl+X / Ctrl+V |
| Přesunout sem | ⌥⌘V | Ctrl+Shift+V |
| Duplikovat | ⌘D | Ctrl+D |
| Kopírovat cestu | ⌥⌘C | Ctrl+Shift+C |
| Vybrat vše | ⌘A | Ctrl+A |
| Nový tab / zavřít tab | ⌘T / ⌘W | Ctrl+T / Ctrl+W |
| Další / předchozí tab | ⌃Tab / ⌃⇧Tab, ⇧⌘] / ⇧⌘[ | Ctrl+Tab / Ctrl+Shift+Tab, Ctrl+PgDn / Ctrl+PgUp |
| Tab 1–8 / poslední | ⌘1–⌘8 / ⌘9 | Ctrl+1–Ctrl+8 / Ctrl+9 |
| Rozdělit / spojit panely | ⌘\\ | Ctrl+\\ |
| Přepnout panel | Tab | Tab |
| Kopírovat / přesunout do vedlejšího panelu | F5 / F6 | F5 / F6 |
| Nové okno | ⌘N | Ctrl+N |
| Zobrazit / skrýt AI agenta | ⌃\` | Ctrl+\` |
| Kopírovat / vložit v AI agentovi | ⌘C / ⌘V | Ctrl+Shift+C / Ctrl+Shift+V |

Na Windows a Linuxu se zkratky vyhýbají Ctrl+Alt, protože na mnoha evropských rozloženích (i českém) to je AltGr pro psaní znaků. Výjimkou je Ctrl+Alt+T pro terminál (linuxová konvence); stejně funguje i Ctrl+Shift+T. Menu a tooltipy ukazují zkratky platformy, na které aplikace běží.

Enter otevírá položku jako ve Windows (ve Finderu by přejmenovával).

## Poznámky

- Velikost je logická (`stat.size`). Finder ukazuje velikost na disku, čísla se proto mohou mírně lišit.
- Pro čtení chráněných složek (např. `~/Library/Mail`) povolte aplikaci **Plný přístup k disku** v Nastavení systému → Soukromí a zabezpečení.
- Ikony jsou vlastní SVG ve stylu Luna, neobsahují žádné assety Microsoftu.

## Pracovní plochy a oblasti

Okno je rozdělené na **oblasti** po vzoru Blenderu. Každá oblast zobrazuje jeden editor: **Soubory** (panely s taby), **Složky**, **Úlohy a místa**, **Náhled** (sleduje výběr v aktivním tabu), **Správa verzí (Git)** a **Konzole a agenti**. Soubory jsou v každé ploše vždy, ostatní editory nejvýš jednou.

- **Přesun:** oblast chytněte za hlavičku (u Souborů a Konzole za úchyt ⠿) a pusťte na okraj jiné oblasti – vlevo, vpravo, nahoru nebo dolů. Puštěním doprostřed se oblasti prohodí. Esc přesun zruší.
- **Velikost:** oddělovače mezi oblastmi lze táhnout myší i ovládat šipkami (Shift = větší krok).
- **Typ oblasti:** tlačítko s ikonou v hlavičce (nebo pravé tlačítko) mění editor, rozdělí oblast a přidá další, maximalizuje ji nebo zavře.
- **Maximalizace:** ⌘⇧↩ / Ctrl+Shift+Enter zobrazí oblast, ve které jste naposledy klikli, přes celé okno; stejná zkratka rozložení vrátí.
- **Pracovní plochy** jsou taby nad oblastmi: Soubory, Commander (dva panely), Agent (konzole vpravo) a Náhled. Dvojklik (nebo F2) přejmenuje, tažením se mění pořadí, kontextová nabídka duplikuje, smaže nebo vrátí výchozí rozložení, + přidá novou plochu. Přepínání: Ctrl+⌘+] / [ (Ctrl+Shift+PageDown / PageUp), paleta příkazů.
- **Akcie:** oblíbené tituly (tickery Yahoo Finance, např. `AAPL`, `CEZ.PR`, `^GSPC`, `BTC-USD`) s cenou a změnou za den, týden, měsíc a rok; vyhledávání podle tickeru i názvu firmy a pod seznamem interaktivní graf TradingView (bezplatný widget). Ceny jsou zdarma z Yahoo Finance (se zpožděním, nejvýš jednou za 5 minut) a stahují se jen, když je oblast zobrazená.
- **Průvodce aplikací:** interaktivní prohlídka, která krok za krokem zvýrazní skutečné části okna (navigace, karty, seznam souborů, filtr, postranní panel, zobrazení, panely, náhled, terminál, automatizace, typy panelů, vlastní rozložení, paleta, nastavení, nápověda) a vysvětlí, jak se používají. Na konci shrne, co všechno aplikace umí. Spustí se z nabídky **Nápověda** (tlačítko ? v toolbaru), z palety příkazů nebo klávesou **F1**; po prvním spuštění ho aFinder jednou nabídne. Listuje se šipkami, Esc ho zavře.
- **Nástroje:** jedna oblast se seznamem pomůcek (v úzké oblasti jako rozbalovací nabídka):
  - **kalkulačka** (základní a vědecká, vlastní parser bez `eval`, historie výsledků), **převod jednotek** (délka, hmotnost, teplota, plocha, objem, rychlost, data, čas) a **měn** podle denního kurzu ČNB – kurzy se stahují jen při otevření převodu měn, nejvýš jednou za hodinu;
  - **kontrolní součty** MD5, SHA-1, SHA-256 a SHA-512 souboru libovolné velikosti (ve workeru) i textu, s porovnáním proti vloženému hashi;
  - **převod obrázků** do JPEG, PNG nebo WebP se zmenšením a kvalitou; čte i HEIC a TIFF na macOS, výsledek se uloží vedle originálu;
  - **hledání duplicit** (velikost → prvních 64 KiB → SHA-256) s přesunem vybraných kopií do koše – aspoň jednu kopii vždy nechá; **mapa disku** jako treemap s přibližováním do složek;
  - **JSON a YAML** (formátování, zmenšení, převod, chyba s řádkem a sloupcem), **kódování** Base64/Base64URL/URL/HTML/hex, **UUID a hesla** (bezpečný generátor, entropie), **regulární výrazy** (shody, skupiny, náhrada; běží ve workeru, který se po sekundě zastaví), **čas a data** (Unixový čas, ISO, časová pásma, týden), **barvy** (HEX/RGB/HSL, kapátko z obrazovky);
  - **historie schránky** (posledních 50 textů, jen v paměti, ve výchozím stavu vypnutá), **stopky, minutka a pomodoro** s upozorněním, **světový čas** a **rychlá poznámka**.
  - **správce úloh** pro macOS, Windows i Linux: procesy jako v htop (řazení, filtr, ukončení i vynucené), živé grafy CPU, paměti, sítě a disku, vytížení jednotlivých jader; hardware a systém (verze OS, model, procesor, paměť, grafika, displeje, disky, svazky, baterie) a teploty a ventilátory, pokud je systém zpřístupní (Linux přes hwmon; macOS a Windows je běžným aplikacím většinou nedávají). Data čte worker jen při otevřeném nástroji. Správce úloh jde otevřít i jako samostatná oblast (typ oblasti *Správce úloh*).
- **Docker:** oblast pro práci s Dockerem bez terminálu. Připojí se k místnímu enginu (Docker Desktop, OrbStack, Colima, Rancher Desktop, Podman, `DOCKER_HOST`) přes jeho socket a ukáže verzi a počet běžících kontejnerů; když engine neběží, nabídne spuštění Docker Desktopu nebo OrbStacku a připojí se sám, jakmile naběhne.
  - **Kontejnery** seskupené podle compose projektů: stav, image, porty jako odkazy na `localhost`, živé CPU a paměť, filtr a *Jen běžící*. Akce spustit, zastavit, restartovat, pozastavit, ukončit násilím, smazat (s potvrzením) a **Terminál**, který v konzoli aFinderu otevře shell v kontejneru (`docker exec`, bash když je, jinak sh). U projektu up, restart, stop, stažení image, down (s potvrzením) a otevření jeho složky. Když má aktuální složka `compose.yaml` (nebo `docker-compose.yml`), nabídne *Spustit (compose up)*.
  - **Detail vybraného kontejneru:** živé **logy** (posledních N řádků, sledování s automatickým posunem, který se zastaví při posunu nahoru, čas, zalamování, hledání, stderr červeně, kopírování a uložení do souboru), **statistiky** (grafy CPU, paměti, sítě a disku) a **detail** (příkaz, restart, zdraví, porty, sítě, připojení s otevřením složky, proměnné prostředí se skrytými hodnotami, štítky).
  - **Image** (stažení s průběhem, smazání), **svazky** a **sítě** (kdo je používá, smazání nepoužívaných) a **úklid**: kolik místa zabírají kontejnery, image, svazky a build cache a co jde uvolnit, prune vždy až po potvrzení.
  - Seznamy se obnovují podle událostí enginu, živé hodnoty se čtou jen při zobrazené oblasti. Ověření v reálném Electronu proti falešnému enginu: `npm run test:docker`.
- **Co je nového** (Nápověda, paleta, Nastavení → Aktualizace): poznámky k vydání posledních verzí přibalené v aplikaci, takže fungují i offline. Po aktualizaci se jednou otevřou samy a dialog nabízející aktualizaci ukáže, co nová verze přináší.
- Přepnutí plochy ani přesun oblastí nezavře taby ani běžící terminály. Panely, pro které nová plocha nemá místo, se odloží a vrátí se s plochou, která jich ukazuje víc. Tlačítko **Oblasti** vpravo přidá nebo znovu zobrazí oblast. Tlačítko Složky v nástrojové liště přepíná postranní oblast mezi složkami a úlohami, ⌃\` skryje nebo zobrazí konzoli na jejím místě.

## Správa verzí (Git)

Oblast **Správa verzí** ukazuje repozitář složky v aktivním tabu: větev (přepnutí, nová větev), počty commitů napřed/pozadu, změny připravené ke commitu, ostatní změny a konflikty a posledních 30 commitů. Umí stage/unstage (jednotlivě i vše), zahodit změny (s potvrzením), commit a amend (⌘↩ / Ctrl+Enter), commit a push, pull, fetch, push (u nové větve ji publikuje s upstreamem), rebase na upstream nebo jinou větev, pokračovat / přeskočit / přerušit rozpracovaný rebase, merge či cherry-pick, stash a jeho vrácení. Mimo repozitář nabídne `git init`.

Sekce **Připravené ke commitu** (stage area) a **Změny** jsou vidět vždy, i prázdné, a tlačítka +/−/↺ u souborů i bez najetí myší. **Klepnutí na soubor** otevře rozdíly v okně s editorem Monaco (vedle sebe, nebo v jednom sloupci): u připravených HEAD ↔ index, u ostatních index ↔ pracovní kopie, nový soubor proti prázdnému. Z okna jde soubor rovnou připravit nebo vrátit z přípravy; dvojklik soubor otevře. **Graf historie** (tlačítko *Graf* u historie nebo menu ⋯) ukáže commity všech větví, nebo jen vybrané místní či vzdálené větve, jako graf s větvemi a merge, se štítky větví, HEAD a tagů; načítá se po 400 commitech. Klepnutí na commit ukáže zprávu, autora, datum, hash a změněné soubory, klepnutí na soubor jeho rozdíly v tom commitu (proti prvnímu rodiči).

Git běží bez interaktivních dotazů: přihlašovací údaje bere z credential helperu nebo ssh agenta. Když je potřeba ruční zásah, otevřete z nabídky ⋯ terminál v repozitáři. Ověření v reálném Electronu: `npm run test:workspace`.

## Licence

aFinder je svobodný software pod licencí [GNU GPL verze 3](LICENSE) nebo libovolné pozdější verze. Doom se s aplikací nedodává: doomgeneric (GPLv2) a Freedoom (BSD) se stahují zvlášť, jen tlačítkem *Stáhnout*.
