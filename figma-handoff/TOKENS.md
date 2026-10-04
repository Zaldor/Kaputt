# KAPUTT! start-screen — Figma rebuild tokens

Screenshots (390×844, CSS px): `start-login-390x844.png`, `board-390x844.png`, `setup-dialog-390x844.png`.
Note: board + dialog shots were revealed via DOM toggle for pixel reference; start screen normally gates them behind email login.

## Palette
- Navy deep `#0B2051` · navy `#132C65` / `#173888` · header `#132C65`
- Arena yellow `#FFE467` (page bg) · button yellow `#FFE15D` · cream `#FFF3D3`
- Lavender `#BEB5FA` / `#C6BDFF` (opponent card) · accent orange `#FF9511` · error `#B3261E`
- Ink text `#102459` · muted `#3D4A7D` / `#5D5E76`

## Type
- Barlow (self-hosted 500–900). Logo tagline 22px/800 `#173888`. Start label 18px/700. Mode button title 17px/800, sub 13px/500 at 80% opacity.

## Start screen anatomy (top→bottom)
1. Logo `kaputt-logo.webp` — width min(70vw, 320px)
2. Tagline "Roll. Reveal. Rival."
3. Name/email card: input 52px tall, radius 14px, 2px `#173888` border, bg `#FFFDF5`; CONTINUE button navy gradient (`#1E4A9A→#173888`), radius 14px
4. Mode grid 2×2, gap 12px; cards radius 20px, 2px navy border, navy gradient, 32px white icon, padding 20px 12px
5. Text-button "Change name" 14px

## Game shell (max-width 460px, full viewport height, no page scroll)
Header navy rounded-bottom → lavender opponent card → NTB ellipse (`target-ring.webp`, 65cqw × 45cqw) → 3D dice stage → turn text → primary button → navy bottom player bar pinned to viewport bottom (+ safe-area).
