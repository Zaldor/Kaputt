# KAPUTT! — Regolamento 3.0

**Stato:** Development / Playtest  
**Build:** K3-E1 — Extremes  
**Baseline precedente:** 2.7

> Questa versione contiene le meccaniche già definite per Kaputt! 3.0. Regole non ancora validate — in particolare Punti Fortuna, condizioni delle modalità e bilanciamento — restano soggette a revisione.

## 1. Concetto

Kaputt! è un gioco di rischio, strategia e fortuna basato su una decisione presa con informazione incompleta.

A ogni turno vengono lanciati due dadi a sei facce senza conoscerne il risultato. Il giocatore ne rivela uno soltanto e, conoscendo il **Numero da Battere (NtB)**, deve scegliere:

- **ATTACCO** — moltiplicare i dadi;
- **DIFESA** — sommare i dadi.

La scelta viene effettuata prima di conoscere il secondo dado ed è irrevocabile.

L'Attacco produce risultati più elevati ma può provocare un **Kaputt!**.  
La Difesa produce meno punti ma protegge dal Kaputt! e tende a ridurre il NtB.

## 2. Materiale

- 2 dadi a sei facce;
- sistema per registrare il punteggio;
- sistema per registrare i Kaputt!;
- eventuali segnalini Punti Fortuna.

## 3. Numero da Battere — NtB

Il **Numero da Battere (NtB)** rappresenta la soglia corrente della partita.

Quando una regola richiede di superarlo, il risultato deve essere **strettamente maggiore**.

Un risultato uguale al NtB non lo supera.

Il valore iniziale definitivo del NtB è ancora da validare nella 3.0.

## 4. Sequenza del turno

1. **Lancio nascosto**  
   Il giocatore lancia entrambi i dadi senza vederli, tenendone uno coperto sotto ciascuna mano.

2. **Prima rivelazione**  
   Rivela un solo dado.

3. **Decisione**  
   Dichiara **ATTACCO** oppure **DIFESA**.

4. **Seconda rivelazione**  
   Rivela il secondo dado.

5. **Verifica Estremo**  
   Se i dadi sono **1 e 6**, in qualsiasi ordine, si verifica un **ESTREMO**.  
   Altrimenti si risolve normalmente l'azione scelta.

## 5. Attacco

**Risultato di Attacco = Dado A × Dado B**

Se:

**Risultato > NtB**

l'Attacco riesce.

Nelle modalità a punteggio:
- si ottengono punti pari al risultato;
- il risultato diventa il nuovo NtB.

Se:

**Risultato ≤ NtB**

l'Attacco fallisce:
- si subisce **1 Kaputt!**;
- non si ottengono punti;
- il NtB rimane invariato.

### Esempio

NtB = 12.  
Primo dado: 4.  
Scelta: Attacco.  
Secondo dado: 5.

4 × 5 = 20

20 > 12, quindi l'Attacco riesce: 20 punti e nuovo NtB = 20.

## 6. Difesa

**Risultato di Difesa = Dado A + Dado B**

Nelle modalità a punteggio si ottiene come punteggio **il valore del dado più alto**.

La somma completa diventa il nuovo NtB.

La Difesa non provoca un Kaputt! se il risultato non supera il precedente NtB.

### Esempio

NtB = 24.  
Primo dado: 4.  
Scelta: Difesa.  
Secondo dado: 3.

4 + 3 = 7

Si ottengono 4 punti e il nuovo NtB diventa 7.

## 7. Estremo

Un **Estremo** si verifica esclusivamente con:

- 1 + 6
- 6 + 1

Probabilità naturale: 2/36 = **5,56%**, circa 1 lancio ogni 18.

L'Estremo non annulla la decisione presa dal giocatore.

**Polarizza la scelta già dichiarata.**

## 8. Attacco Estremo

Se era stato dichiarato **Attacco**, prevale il valore massimo.

Il dado 1 viene trattato come 6:

1 × 6 → 6 × 6 = **36**

Quindi:

**ATTACCO ESTREMO = 36**

Se 36 > NtB:
- l'Attacco riesce;
- nelle modalità a punteggio si ottengono 36 punti;
- il nuovo NtB diventa 36.

Se 36 ≤ NtB si applicano le normali conseguenze di un Attacco fallito.

**Principio:** Attacco = escalation massima.

## 9. Difesa Estrema

Se era stata dichiarata **Difesa**, prevale il valore minimo.

Il dado 6 viene trattato come 1:

1 + 6 → 1 + 1 = **2**

Quindi:

**DIFESA ESTREMA = 2**

Nelle modalità a punteggio:
- si ottiene 1 punto;
- il nuovo NtB diventa 2;
- non si subisce Kaputt!.

**Principio:** Difesa = de-escalation massima.

## 10. Doppi

Nella 3.0 i Doppi non sono eventi speciali.

| Dadi | Attacco | Difesa |
|---|---:|---:|
| 1–1 | 1 | 2 |
| 2–2 | 4 | 4 |
| 3–3 | 9 | 6 |
| 4–4 | 16 | 8 |
| 5–5 | 25 | 10 |
| 6–6 | 36 | 12 |

### Simmetria intenzionale

La regola Estremo crea due vie per raggiungere ciascun limite:

**Difesa minima**
- 1–1 naturale;
- 1–6 / 6–1 tramite Estremo.

**Attacco massimo**
- 6–6 naturale;
- 1–6 / 6–1 tramite Estremo.

Sui 36 esiti ordinati:
- Difesa = 2 in 3/36 = **8,33%** dei casi;
- Attacco = 36 in 3/36 = **8,33%** dei casi.

Condizionando sul primo dado rivelato:

- se si vede **1** e si sceglie Difesa, si ottiene NtB 2 con secondo dado 1 oppure 6: **2/6 = 33,33%**;
- se si vede **6** e si sceglie Attacco, si ottiene 36 con secondo dado 1 oppure 6: **2/6 = 33,33%**.

Questa simmetria è deliberata e fa parte del core K3-E1.

## 11. Struttura strategica

### Attacco
Rischio → Ricompensa → Escalation

### Difesa
Sicurezza → Ricompensa ridotta → De-escalation

Il sistema tende a creare un ciclo:

NtB basso → Attacco appetibile → escalation → NtB alto → aumento del rischio → Difesa → de-escalation → nuovo ciclo.

Questa dinamica è una delle principali ipotesi da verificare con simulazione e playtest.

## 12. Informazione parziale

La scelta deve sempre avvenire dopo la rivelazione del primo dado e prima della rivelazione del secondo.

Il giocatore valuta:
- probabilità di successo;
- possibile ricompensa;
- rischio di Kaputt!;
- conseguenze del nuovo NtB;
- stato complessivo della partita.

## 13. Punti Fortuna — provvisorio

I Punti Fortuna restano nel modello di sviluppo, ma non sono ancora congelati.

Baseline precedente:
- massimo 3 PF;
- un PF può annullare un Kaputt! appena subito;
- i PF possono ridurre il NtB;
- ogni PF speso per la riduzione vale **−1d6 NtB**.

Quindi:
- 1 PF = −1d6
- 2 PF = −2d6
- 3 PF = −3d6

Riduzione media:
- 3,5
- 7
- 10,5

La fonte dei PF nella 3.0 deve essere ridisegnata.

## 14. Modalità — provvisorie

La baseline 2.7 comprende:
- Cooperativa
- Vs
- King of the Hill
- Battle Royale

Le condizioni precise non sono ancora congelate nella 3.0.

## 15. Regole congelate per K3-E1

1. 2d6 nascosti.
2. Si rivela un solo dado.
3. Scelta irrevocabile Attacco/Difesa.
4. Attacco = moltiplicazione.
5. Attacco fallito = Kaputt!.
6. Difesa = somma.
7. Punti Difesa = dado maggiore.
8. Il risultato dell'operazione determina il nuovo NtB secondo le normali regole.
9. Estremo solo con 1–6 / 6–1.
10. Attacco Estremo = 36.
11. Difesa Estrema = 2 e 1 punto.
12. Tutti i Doppi sono normali.
13. La simmetria 1→Difesa e 6→Attacco al 33,33% è intenzionale.

## 16. Questioni aperte

- NtB iniziale.
- Decision Density.
- Dominanza di 1→Difesa e 6→Attacco.
- Bilanciamento dell'Estremo.
- Economia dei Punti Fortuna.
- Durata delle partite.
- Scoring per modalità.
- Soglie Kaputt!.
- First-player advantage.
- Kingmaking e targeting.
- Runaway leader.
- Alpha-player problem in cooperativo.

## 17. Principio di sviluppo

Ogni nuova regola deve:
1. risolvere un problema osservato;
2. aumentare la qualità delle decisioni;
3. migliorare tensione, leggibilità o ritmo;
4. giustificare il proprio costo cognitivo.

**Massima profondità emergente con il minimo numero di regole.**
