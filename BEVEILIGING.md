# Beveiligingsrapport CrewHarbor

Datum: 8 november 2026 · Gecontroleerd: database (Supabase), servercode (edge function `crewdeck`), website en app.

## Kort samengevat

CrewHarbor is goed beveiligd opgezet. Er is **geen enkel lek gevonden waarmee iemand bij gegevens van een ander bedrijf kan komen**. Een paar dingen heb ik meteen opgelost. Een paar dingen moet jij nog doen (zie "Wat jij nog moet doen").

## Wat al goed is

| Onderdeel | Hoe het werkt |
|---|---|
| Gegevens gescheiden per bedrijf | Niemand kan rechtstreeks in de tabellen kijken. Alles loopt via functies die eerst controleren wie je bent, bij welk bedrijf je hoort en welke rechten je hebt. |
| Inloggen | E-mail + wachtwoord (minstens 10 tekens), veilig opgeslagen door Supabase. Te vaak fout = tijdelijk geblokkeerd. |
| Tweestapsverificatie | Iedereen kan het aanzetten. Het bedrijf kan het verplichten voor beheerders. Beheer (jouw paneel) werkt alleen met 2FA. |
| Prikklok | Code van 8 cijfers die elke 20 seconden verandert. Te vaak fout = slot. Eigen pincode alleen als de eigenaar het tijdelijk toestaat. |
| Geheime sleutels | Het mailwachtwoord en de Mollie-sleutel worden versleuteld opgeslagen met `CREWHARBOR_KEY`. |
| Verbinding | Altijd versleuteld (HTTPS). Gegevens staan in Frankfurt (EU) en zijn versleuteld op schijf. |
| Logboek | Alle belangrijke acties en inlogpogingen worden vastgelegd. |
| Privacy (AVG) | Bewaartermijnen per soort gegeven, automatisch opruimen, export van eigen gegevens en van het hele bedrijf. |
| Formulieren op de website | Beschermd tegen spam-bots en tegen te veel berichten achter elkaar. |

## Vandaag opgelost

1. **Beheer-functies dichtgezet voor bezoekers zonder account.** Elf nieuwe functies (facturen, support) waren in principe aan te roepen zonder in te loggen. Ze controleerden zelf al of je beheerder bent, dus er lekte niets. Nu zijn ze voor anonieme bezoekers helemaal dicht.
2. **Beveiligingsheaders voor crewharbor.nl** (bestand `_headers`). De site kan niet meer in een ander venster (iframe) worden geladen, browsers dwingen HTTPS af, en camera/microfoon/locatie staan uit.
3. **Ziekmelding (AVG).** Werkgevers mogen niet vastleggen wélke ziekte iemand heeft. Het voorbeeld "griep" is weg, en er staat nu: *schrijf hier niet wat je hebt*.
4. **Profielfoto's van oud-medewerkers** worden elke nacht automatisch weggehaald.

## Wat jij nog moet doen (belangrijk)

| # | Wat | Waarom | Hoe |
|---|---|---|---|
| 1 | **Database-wachtwoord van Sparkapps wijzigen** | Het stond in een bestand en kwam in de chat. | Supabase → project Sparkapps → Settings → Database → Reset password. Verwijder daarna `postgresqlpostgres…txt` uit Downloads. |
| 2 | **`CREWHARBOR_KEY` bewaren in je wachtwoordmanager** | Zonder deze sleutel zijn het mailwachtwoord en de Mollie-sleutel niet meer te lezen. | Hij stond in de chat. Wil je hem vervangen? Zeg het, dan doen we het samen (daarna mailwachtwoord en Mollie-sleutel opnieuw invullen). |
| 3 | **Uitgelekte wachtwoorden blokkeren** | Supabase kan wachtwoorden weigeren die al eens zijn uitgelekt (HaveIBeenPwned). | Supabase → Authentication → Sign In / Providers → Email → "Leaked password protection" aan. Dit kan alleen met het Pro-abonnement. |
| 4 | **GitHub-repository privé en GitHub Pages uit** | De code is nu openbaar. Er staan geen geheimen in, maar privé is netter. | Doen zodra crewharbor.nl via Cloudflare werkt (stap in het stappenplan). |
| 5 | **Back-ups** | Bij het gratis Supabase-abonnement zijn er geen dagelijkse back-ups die jij kunt terugzetten. | Supabase Pro (dagelijkse back-ups), eventueel met Point-in-Time Recovery. |

## Over end-to-end-versleuteling

Je vroeg of end-to-end-versleuteling (E2E) kan. Eerlijk antwoord: **voor CrewHarbor als geheel is dat geen goed idee.**

Bij E2E kan alleen de gebruiker zelf de gegevens lezen, de server niet. Maar de server van CrewHarbor móét de gegevens kunnen lezen om zijn werk te doen:
- uren en pauzes uitrekenen, verlofsaldo bijhouden;
- het rooster aan collega's laten zien en meldingen/mails sturen;
- de salarisexport en facturen maken;
- rechten controleren (wie mag wat zien).

Met E2E werkt dat allemaal niet meer. En raakt iemand zijn sleutel kwijt, dan zijn de gegevens voorgoed weg.

**Wat wél zinvol is (voorstel):**

1. **Extra versleuteling voor gevoelige velden** met een sleutel op de server (Supabase Vault). Bijvoorbeeld toelichtingen bij verlof en ziekte, notities, en de documenten. Lekt ooit een database-back-up, dan zijn die velden onleesbaar. *Moeite: middel.*
2. **Documenten versleuteld opslaan** in de opslag (bijv. contracten, loonstroken). *Moeite: middel.*
3. **Sterkere Content-Security-Policy**: alleen eigen scripts toestaan. Dat beschermt extra tegen het invoegen van kwaadaardige code. Hiervoor moeten eerst een paar losse stukjes script in de pagina's worden verplaatst. *Moeite: klein.*
4. **Waarschuwing bij inloggen vanaf een nieuw apparaat** per mail. *Moeite: klein.*
5. **Eigen 2FA-app** (stond al op de planning). *Moeite: groot.*
6. **Controle door een extern bureau (pentest)** voordat je grote klanten binnenhaalt. *Kosten: vanaf ± € 2.000.*

Mijn advies: eerst de 5 punten bij "Wat jij nog moet doen", daarna voorstel 3 en 1.

## Niet gevonden / gecontroleerd

- Alle functies die de app gebruikt controleren eerst wie je bent (of zijn bewust openbaar: pakketten en support).
- Gebruikers kunnen niet direct in de tabellen kijken of schrijven.
- Teksten van gebruikers worden overal veilig weergegeven (geen ingevoegde code mogelijk).
- Wachtwoorden, pincodes en geheime sleutels worden nooit leesbaar opgeslagen.
