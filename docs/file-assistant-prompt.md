# Lokální asistent pro práci se soubory

Implementuj v aFinderu lokálního asistenta Laya pro návrhy cílových složek, třídění adresáře, přiřazování k projektům, štítkování, doporučení aplikace, zpřesnění hledání, kontrolu vhodnosti umístění a přípravu souborů k předání.

Funkce je ve výchozím stavu vypnutá. Uživatel ji zapne v Nastavení a výslovně stáhne model. Čtení obsahu má samostatný, výchozí vypnutý přepínač; bez něj použij pouze metadata. Zpracování musí fungovat offline, bez Ollamy, bez odesílání dokumentů a v odděleném workeru. Před stažením ukaž velikost modelu.

Každá analýza je vyžádaná uživatelem a omezená na zvolené soubory nebo aktuální adresář. Cíle jsou existující adresáře z dodaného seznamu, případně jednoúrovňové kategorie při třídění. Návrhy zobraz v upravitelném přehledu; změny proveď až po potvrzení konkrétních položek. Před provedením ověř, že soubory a cíle od analýzy nebyly změněny, řeš kolize bez přepisování a ukaž výsledek i případná selhání. Rozhodovací skóre neprezentuj jako záruku správnosti.

Podporuj ruční úpravu kategorií a cílových složek. Uložené štítky jsou lokální a lze je smazat. Doporučení aplikací mohou vybírat pouze z dostupných aplikací. Relevance a předání vrací upravitelný výběr; export/předání kopíruje vybrané soubory do cíle. Kontrola umístění poskytuje doporučení, nikoli bezpečnostní záruku.

Otestuj výchozí vypnutí, samostatné oprávnění obsahu, zrušení analýzy, nesprávné vstupy, zastaralé návrhy, kolize, štítky, všechny režimy, skutečný lokální model, UI a souborové operace.

Konfigurace promptcraft: mode=both, tone=professional, audience=general, length=concise, format=structured, persona=none, language=cs, preserve_intent=true, add_examples=auto, explain=true.
