# Concepts Appendix — Embeddings, kNN, Exponential Decay

> The minimum math and search concepts needed to read
> [usage-carved-memory.en.md](./usage-carved-memory.en.md), explained with
> examples. Skip anything you already know. All numbers here are illustrative.

---

## 1. Embeddings

Turning a sentence into a numeric vector (a coordinate). The one property that
matters: **sentences with similar meanings get nearby coordinates.**

```
"the user likes americanos"        → (0.81, 0.12, …)
"the user enjoys drinking coffee"  → (0.79, 0.15, …)   ← close to the above
"the user took up hiking"          → (0.11, 0.88, …)   ← far from both
```

Real vectors have hundreds to thousands of dimensions, but a 2-D map is enough for
intuition: an embedding pins a sentence onto a "map of meaning," and related
statements cluster in the same neighborhood. In this system every node stores an
embedding alongside its content, and "finding similar memories" is always a
distance computation on this map.

## 2. Cosine similarity

A measure of how much two vectors point the same way — the cosine of the angle
between them.

- **1.0** — exactly the same direction (effectively the same meaning)
- **around 0.9** — a rephrasing of nearly the same statement
- **0.5–0.7** — related but distinct statements
- **near 0** — unrelated

Why angle instead of distance: to ignore vector length (which reflects sentence
length or emphasis) and compare **direction (meaning) only**.

One property to keep in mind — cosine similarity is **sensitive to surface meaning
and blind to polarity**. "Loves coffee" and "can no longer drink coffee" mean
opposite things, yet both are 'statements about coffee preference' and score high
similarity. This blind spot is exactly why the gate in the main document has a
gray zone (deferred judgment).

## 3. kNN (k-Nearest Neighbors)

"Find the **k closest items** to a given point" — that's all it is. In this system
it means "the k existing nodes whose embeddings have the highest cosine similarity
to a reference sentence."

```
New sentence: "the user drinks lattes often"      (with k = 3)

Existing node                      similarity
"likes americanos"                 0.88   ← 1st neighbor
"enjoys drinking coffee"           0.85   ← 2nd neighbor
"likes working from cafés"         0.64   ← 3rd neighbor
"took up hiking"                   0.12   (out)
```

The system uses kNN in two places:

- **The gate (writing)** — looks up a new candidate's nearest neighbors to judge
  duplication (the 1st neighbor's similarity) and to decide which neighbor
  hypotheses to lay (the k above the floor).
- **Retrieval seeds (reading)** — the query's k nearest nodes become the starting
  points of the ranking.

The **difference from a threshold cut** matters. "Return everything above 0.7"
(threshold) may match zero items or a hundred — starvation and flooding. "The k
closest" (kNN) always returns **exactly k**. This is why the main document
abandons thresholds for top-k plus ranking.

## 4. Exponential decay and half-life

A way of decreasing "by the same **ratio** every day." In the formula `e^(−λt)`,
λ is that ratio and t is elapsed time.

The easiest intuition is the half-life — the time it takes for a value to halve:

```
half-life = ln(2) / λ ≈ 0.693 / λ

λ = 0.01  →  half-life ≈ 69 days
λ = 0.02  →  half-life ≈ 35 days
λ = 0.05  →  half-life ≈ 14 days
λ = 0     →  no decay (unchanged forever)
```

In this system, t is not "time since birth" but **"time since last
reinforcement."** A bump resets the clock to zero, so decay is proportional not to
age but to **neglect**. Frequently used memories keep having their clocks reset
and never sink.

One side property (the basis of the main document's "no batch job needs to grind
down stored values"): exponential decay is **memoryless** — computing 90 days of
decay at once gives the same result as computing 30 days three times. So there is
no need to refresh stored values along the way; plugging the full elapsed time
into the formula at read time always yields the exact value.

## 5. Weighted sums

The simplest way to combine several signals into one ranking:

```
score = weight₁ × signal₁ + weight₂ × signal₂ + …
```

Each signal is a "reason to recall" in [0, 1], and each weight is the multiplier
for how much that reason counts. Setting a weight to 0 turns that reason off. The
main document's `score = α·similarity + β·edge_activation + γ·recency +
δ·node_strength` is exactly this structure.

## 6. Graph vocabulary

- **Node** — a point. Here, one memory.
- **Edge** — a line joining two points. Here, a relation between two memories.
- **Direction** — edges are stored directed (`A → B`), but retrieval in this
  system ignores direction and reads both ways (undirected read). Direction
  functions only as part of the dedup key at write time.
- **1-hop** — "one step over." Neighbors reachable through a single edge are
  1-hop; neighbors of neighbors are 2-hop. Retrieval in the main document expands
  only to 1-hop — it never walks the whole graph, only one step out from wherever
  the current query shines its light.
