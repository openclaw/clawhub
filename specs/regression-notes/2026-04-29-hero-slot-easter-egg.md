# Hero Slot Easter Egg Regression Note

Date: 2026-04-29

The homepage hero easter egg was originally added in commit `91c7e44` by Val Alexander on 2026-04-18 as `feat: slot machine Easter egg on hero label triple-click`.

Follow-up behavior changes:

- `cb75011` by Val Alexander on 2026-04-18 tuned odds to 1/25 for any jackpot and 1/100 for the Hack jackpot.
- `fec5db7` by Val Alexander on 2026-04-18 added timer and interval cleanup on unmount.

The easter egg was removed from `src/routes/index.tsx` in commit `6c0163f` by Patrick Erichsen on 2026-04-28 as part of `feat: add skills plugins search typeahead`.

Expected behavior:

- Triple-click `BUILT BY THE COMMUNITY.` within 800ms to trigger the slot-machine headline.
- Reels stop at 1200ms, 1800ms, and 2400ms.
- Non-jackpot spins reroll accidental triples so jackpot odds stay controlled.
- Jackpot odds are 1/25 overall.
- Hack jackpot odds are 1/100 overall.
- Wins fire confetti; Hack wins use the aquatic Hack-specific effect.
- Wins display for 10s and cool down for 18s; losses display for 2.4s and cool down for 3s.
