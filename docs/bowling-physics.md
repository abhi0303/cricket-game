# Bowling physics

The ball's flight in a delivery is a real simulated trajectory, not an animation between two points. Every value below lives in [`src/game/PhysicsConfig.js`](../src/game/PhysicsConfig.js); changing them doesn't require touching gameplay code.

## How a delivery works

All coordinates are in the delivery frame: the striker's stumps are at z = +10.06 m, the bowler's at z = -10.06 m, x > 0 is the off side and y is up. When the ends change, the scene rotates this frame, so the physics never changes.

**Stage A: release.** The ball leaves the hand at (0.32, 2.18, -8.5) for pace (release height 1.96 m for spin). Its release velocity has magnitude exactly the selected speed:

```
v0 = speed_kph / 3.6        (m/s)
```

The direction comes from a solver that makes the trajectory land on the chosen pitching point:

1. First it solves the drag-free problem. It finds the flight time `tb` for which the velocity that reaches the target, `v(tb) = (Δx − ½·ax·tb², Δy − ½·ay·tb², Δz) / tb`, has magnitude `v0`. A bisection picks the direct (non-lob) solution.
2. Then a shooting method corrects for drag. It integrates the real flight, measures the miss at the target plane and shifts the aim point by that miss, repeating until the error is under 4 mm (at most 6 iterations).

In flight the ball feels:

```
a = (ax_swing, −g − dip, 0) − k·|v|·v          g = 9.81 m/s², k = 0.0068 1/m
```

- `k = ½ ρ Cd A / m` for a 0.16 kg, 72 mm ball with Cd ≈ 0.45. A 150 km/h ball reaches the stumps at about 120–135 km/h.
- `ax_swing` is the swing acceleration (outswinger +x, inswinger −x) or the spinner's drift.
- `dip` is a spinner's flight.

**Stage B: pitch and bounce.** Collision with the pitch is found inside the integration step. The contact fraction is `f = (y₀ − r)/(y₀ − y₁)`, the contact is placed exactly at `y = r` and the rest of the step continues with the new velocity. The ball never sinks into the pitch, at any speed. The bounce impulse is:

```
vy' = −vy · e · (1 ± bounceVariation) · (1 + power·effortBounce)
vz' =  vz · retention
vx' =  vx · 0.9 + seam / turn kick
```

`e` (restitution) and `retention` come from the delivery length. Spinners multiply them by 0.86 and 0.92. Later bounces use `e = 0.45`, retention 0.8, then rolling friction.

**Stage C: approach to the batsman.** The trajectory is precomputed at a fixed 1/720 s step (frame-rate independent). Collisions are swept: the bat contact plane, the pads, the batter's body/helmet, the popping crease (wides) and the stumps are all found by interpolating where the path crosses that plane (`Path.timeAtZ`), never by checking where the ball happens to be on a rendered frame. A 150 km/h ball can't pass through anything between frames. The game advances the simulation clock with delta time and reads the ball position from the trajectory at that time. It never moves the ball per frame.

## Speeds and lengths

| Setting | Value |
|---|---|
| Speeds (km/h) | 150, 145, 140, 130, 125, 115, 100, 95, 85, 70 |
| Speed ranges by type | fast 125–150, fast-medium 115–145, medium 95–140, off-spin 70–100, leg-spin 70–95 |
| Per-bowler cap | natural pace (pace rating) + 6 km/h, minus up to 8 km/h when tired. `?debug=physics` unlocks all ten. |

| Length | Pitches (m before stumps) | Restitution | Retention | Height at batter, 140 km/h |
|---|---|---:|---:|---:|
| Yorker | 0–1 | 0.40 | 0.92 | ~0.1 m (toes) |
| Full Toss | no bounce; aimed 0.45–0.95 m high at the crease | — | — | 0.65 m |
| Full Length | 2–4 | 0.47 | 0.90 | ~0.2 m |
| Good Length | 6–8 | 0.53 | 0.88 | ~0.63 m (top of stumps) |
| Back of a Length | 8–10 | 0.55 | 0.87 | ~0.95 m (hip) |
| Short of a Length | 10–12 | 0.50 | 0.86 | ~1.2 m (waist/chest) |
| Short Ball | 12–14 | 0.41 | 0.86 | ~1.4 m (chest) |
| Bouncer | 12–14 | 0.445 | 0.85 | ~1.65 m (shoulder/head) |

Shorter balls hit the pitch more steeply, so they climb higher even though their restitution isn't larger. The values are tuned to give realistic heights at the batter. The pitching point can be moved inside the range (stick up/down), and bowler accuracy adds natural variation around it.

## Travel time and reaction time

These are kept separate:

- **Total travel:** release → the striker's stumps (the end of the 22 yards).
- **Reaction after bounce:** pitching → entering the hitting zone (z ≥ 7.6 m, the furthest front-foot reach). For a yorker the ball pitches inside the hitting zone, so there is effectively no post-bounce reaction time.
- Also reported: release → pitch, pitch → stumps, bounce peak, height at the batter, and speed at release, pitch and stumps.

## Simulated vs. constant-speed baseline

The baseline is `20.12 m / v`. Simulated times differ from it because of the following:

- **Shorter distance:** release is 1.56 m in front of the bowler's stumps, so the ball travels 18.56 m, about 7.8% less.
- **Air drag:** the ball loses 10–20% of its speed before the stumps.
- **Bounce friction:** the ball keeps only 85–92% of its horizontal speed at pitching, so short balls lose more time than full ones.

Full balls and full tosses come out up to 0.011 s faster than the baseline, because the shorter distance outweighs drag. Short balls are slower, increasingly so at low speed: +0.08 s at 150 km/h and up to +0.21 s at 70 km/h. A 70 km/h ball pitched 12–14 m out slows enough to bounce a second time before the batter.

Regenerate this table with `npm run physics-report -- --md`. Conditions: medium-pace bowler with perfect accuracy, seam-up, no swing, pitching at the middle of each range, line 0.1 m.

| km/h | Delivery | Pitched (m) | Release→pitch | Pitch→stumps | Reaction after bounce | Total travel | Baseline | Δ | Height at batter | Height at stumps | Speed at stumps (km/h) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 150 | Yorker | 0.54 | 0.461 | 0.016 | 0 (pitches in zone) | 0.477 | 0.483 | -0.006 | 0.11 | 0.07 | 121.6 |
| 150 | Full Toss | — | — | — | — | 0.475 | 0.483 | -0.008 | 0.66 | 0.51 | 133.6 |
| 150 | Full Length | 3.03 | 0.395 | 0.091 | 0.017 | 0.486 | 0.483 | +0.003 | 0.21 | 0.28 | 118.7 |
| 150 | Good Length | 7.02 | 0.292 | 0.215 | 0.138 | 0.506 | 0.483 | +0.024 | 0.64 | 0.71 | 115.1 |
| 150 | Back of a Length | 9.01 | 0.241 | 0.279 | 0.201 | 0.521 | 0.483 | +0.038 | 0.97 | 1.04 | 112.9 |
| 150 | Short of a Length | 11.01 | 0.192 | 0.348 | 0.268 | 0.540 | 0.483 | +0.058 | 1.26 | 1.33 | 110.0 |
| 150 | Short Ball | 13.01 | 0.145 | 0.422 | 0.339 | 0.567 | 0.483 | +0.084 | 1.52 | 1.57 | 106.5 |
| 150 | Bouncer | 13.01 | 0.145 | 0.427 | 0.343 | 0.572 | 0.483 | +0.089 | 1.72 | 1.79 | 105.3 |
| 145 | Yorker | 0.54 | 0.477 | 0.016 | 0 (pitches in zone) | 0.494 | 0.500 | -0.006 | 0.11 | 0.08 | 117.6 |
| 145 | Full Toss | — | — | — | — | 0.492 | 0.500 | -0.008 | 0.65 | 0.51 | 129.2 |
| 145 | Full Length | 3.03 | 0.408 | 0.094 | 0.018 | 0.503 | 0.500 | +0.003 | 0.21 | 0.28 | 114.7 |
| 145 | Good Length | 7.02 | 0.302 | 0.222 | 0.143 | 0.524 | 0.500 | +0.024 | 0.64 | 0.70 | 111.3 |
| 145 | Back of a Length | 9.01 | 0.250 | 0.289 | 0.208 | 0.539 | 0.500 | +0.039 | 0.96 | 1.02 | 109.2 |
| 145 | Short of a Length | 11.01 | 0.199 | 0.360 | 0.277 | 0.559 | 0.500 | +0.059 | 1.24 | 1.30 | 106.3 |
| 145 | Short Ball | 13.01 | 0.150 | 0.436 | 0.351 | 0.586 | 0.500 | +0.086 | 1.47 | 1.52 | 102.9 |
| 145 | Bouncer | 13.01 | 0.150 | 0.441 | 0.355 | 0.591 | 0.500 | +0.092 | 1.67 | 1.73 | 101.8 |
| 140 | Yorker | 0.54 | 0.494 | 0.017 | 0 (pitches in zone) | 0.511 | 0.517 | -0.006 | 0.11 | 0.08 | 113.5 |
| 140 | Full Toss | — | — | — | — | 0.509 | 0.517 | -0.008 | 0.65 | 0.50 | 124.9 |
| 140 | Full Length | 3.03 | 0.423 | 0.098 | 0.018 | 0.521 | 0.517 | +0.003 | 0.22 | 0.28 | 110.8 |
| 140 | Good Length | 7.02 | 0.312 | 0.230 | 0.148 | 0.542 | 0.517 | +0.025 | 0.64 | 0.69 | 107.5 |
| 140 | Back of a Length | 9.01 | 0.258 | 0.299 | 0.216 | 0.558 | 0.517 | +0.040 | 0.95 | 1.01 | 105.4 |
| 140 | Short of a Length | 11.01 | 0.206 | 0.373 | 0.287 | 0.579 | 0.517 | +0.061 | 1.21 | 1.27 | 102.7 |
| 140 | Short Ball | 13.01 | 0.155 | 0.451 | 0.363 | 0.607 | 0.517 | +0.089 | 1.43 | 1.46 | 99.4 |
| 140 | Bouncer | 13.01 | 0.155 | 0.457 | 0.367 | 0.612 | 0.517 | +0.095 | 1.63 | 1.68 | 98.3 |
| 130 | Yorker | 0.54 | 0.532 | 0.018 | 0 (pitches in zone) | 0.550 | 0.557 | -0.007 | 0.12 | 0.08 | 105.5 |
| 130 | Full Toss | — | — | — | — | 0.548 | 0.557 | -0.009 | 0.65 | 0.49 | 116.2 |
| 130 | Full Length | 3.03 | 0.455 | 0.105 | 0.020 | 0.560 | 0.557 | +0.003 | 0.22 | 0.29 | 102.9 |
| 130 | Good Length | 7.02 | 0.336 | 0.248 | 0.159 | 0.584 | 0.557 | +0.026 | 0.63 | 0.68 | 99.8 |
| 130 | Back of a Length | 9.01 | 0.278 | 0.322 | 0.232 | 0.600 | 0.557 | +0.043 | 0.92 | 0.97 | 97.9 |
| 130 | Short of a Length | 11.01 | 0.222 | 0.401 | 0.309 | 0.622 | 0.557 | +0.065 | 1.15 | 1.19 | 95.3 |
| 130 | Short Ball | 13.01 | 0.167 | 0.486 | 0.390 | 0.653 | 0.557 | +0.095 | 1.32 | 1.33 | 92.4 |
| 130 | Bouncer | 13.01 | 0.167 | 0.491 | 0.395 | 0.658 | 0.557 | +0.101 | 1.52 | 1.54 | 91.3 |
| 125 | Yorker | 0.54 | 0.553 | 0.019 | 0 (pitches in zone) | 0.572 | 0.579 | -0.007 | 0.12 | 0.08 | 101.5 |
| 125 | Full Toss | — | — | — | — | 0.570 | 0.579 | -0.009 | 0.65 | 0.48 | 111.9 |
| 125 | Full Length | 3.03 | 0.473 | 0.109 | 0.020 | 0.582 | 0.579 | +0.003 | 0.23 | 0.29 | 99.0 |
| 125 | Good Length | 7.02 | 0.349 | 0.257 | 0.166 | 0.607 | 0.579 | +0.027 | 0.63 | 0.67 | 96.0 |
| 125 | Back of a Length | 9.02 | 0.289 | 0.335 | 0.241 | 0.624 | 0.579 | +0.044 | 0.91 | 0.95 | 94.2 |
| 125 | Short of a Length | 11.01 | 0.230 | 0.417 | 0.321 | 0.647 | 0.579 | +0.068 | 1.11 | 1.14 | 91.7 |
| 125 | Short Ball | 13.01 | 0.173 | 0.505 | 0.406 | 0.678 | 0.579 | +0.099 | 1.25 | 1.25 | 88.9 |
| 125 | Bouncer | 13.01 | 0.173 | 0.511 | 0.411 | 0.684 | 0.579 | +0.105 | 1.45 | 1.46 | 87.8 |
| 115 | Yorker | 0.54 | 0.601 | 0.021 | 0 (pitches in zone) | 0.621 | 0.630 | -0.008 | 0.13 | 0.08 | 93.5 |
| 115 | Full Toss | — | — | — | — | 0.620 | 0.630 | -0.010 | 0.64 | 0.46 | 103.3 |
| 115 | Full Length | 3.03 | 0.514 | 0.119 | 0.022 | 0.633 | 0.630 | +0.003 | 0.23 | 0.30 | 91.2 |
| 115 | Good Length | 7.02 | 0.379 | 0.279 | 0.180 | 0.659 | 0.630 | +0.029 | 0.61 | 0.65 | 88.4 |
| 115 | Back of a Length | 9.02 | 0.314 | 0.363 | 0.262 | 0.677 | 0.630 | +0.047 | 0.86 | 0.89 | 86.7 |
| 115 | Short of a Length | 11.01 | 0.250 | 0.452 | 0.348 | 0.702 | 0.630 | +0.072 | 1.02 | 1.03 | 84.5 |
| 115 | Short Ball | 13.01 | 0.188 | 0.548 | 0.441 | 0.736 | 0.630 | +0.106 | 1.09 | 1.07 | 81.9 |
| 115 | Bouncer | 13.01 | 0.188 | 0.555 | 0.446 | 0.743 | 0.630 | +0.113 | 1.29 | 1.27 | 80.9 |
| 100 | Yorker | 0.54 | 0.691 | 0.024 | 0 (pitches in zone) | 0.714 | 0.724 | -0.010 | 0.14 | 0.09 | 81.4 |
| 100 | Full Toss | — | — | — | — | 0.713 | 0.724 | -0.011 | 0.63 | 0.42 | 90.4 |
| 100 | Full Length | 3.03 | 0.590 | 0.137 | 0.026 | 0.727 | 0.724 | +0.002 | 0.25 | 0.32 | 79.3 |
| 100 | Good Length | 7.02 | 0.435 | 0.321 | 0.207 | 0.756 | 0.724 | +0.031 | 0.60 | 0.62 | 77.0 |
| 100 | Back of a Length | 9.02 | 0.360 | 0.417 | 0.300 | 0.776 | 0.724 | +0.052 | 0.79 | 0.79 | 75.6 |
| 100 | Short of a Length | 11.01 | 0.287 | 0.519 | 0.399 | 0.805 | 0.724 | +0.081 | 0.84 | 0.80 | 73.8 |
| 100 | Short Ball | 13.01 | 0.216 | 0.628 | 0.505 | 0.844 | 0.724 | +0.119 | 0.76 | 0.67 | 71.8 |
| 100 | Bouncer | 13.01 | 0.216 | 0.635 | 0.511 | 0.851 | 0.724 | +0.127 | 0.95 | 0.88 | 70.9 |
| 95 | Yorker | 0.54 | 0.727 | 0.025 | 0 (pitches in zone) | 0.752 | 0.762 | -0.010 | 0.15 | 0.09 | 77.3 |
| 95 | Full Toss | — | — | — | — | 0.751 | 0.762 | -0.012 | 0.63 | 0.40 | 86.1 |
| 95 | Full Length | 3.03 | 0.621 | 0.144 | 0.027 | 0.765 | 0.762 | +0.002 | 0.26 | 0.33 | 75.4 |
| 95 | Good Length | 7.02 | 0.457 | 0.337 | 0.217 | 0.795 | 0.762 | +0.032 | 0.59 | 0.60 | 73.2 |
| 95 | Back of a Length | 9.02 | 0.378 | 0.438 | 0.316 | 0.817 | 0.762 | +0.054 | 0.75 | 0.73 | 71.9 |
| 95 | Short of a Length | 11.01 | 0.301 | 0.545 | 0.420 | 0.847 | 0.762 | +0.084 | 0.76 | 0.70 | 70.3 |
| 95 | Short Ball | 13.01 | 0.227 | 0.660 | 0.531 | 0.887 | 0.762 | +0.125 | 0.62 | 0.50 | 68.5 |
| 95 | Bouncer | 13.01 | 0.227 | 0.668 | 0.537 | 0.895 | 0.762 | +0.132 | 0.81 | 0.70 | 67.6 |
| 85 | Yorker | 0.54 | 0.814 | 0.028 | 0 (pitches in zone) | 0.842 | 0.852 | -0.010 | 0.16 | 0.10 | 69.1 |
| 85 | Full Toss | — | — | — | — | 0.841 | 0.852 | -0.011 | 0.62 | 0.35 | 77.7 |
| 85 | Full Length | 3.03 | 0.694 | 0.161 | 0.030 | 0.855 | 0.852 | +0.002 | 0.28 | 0.35 | 67.5 |
| 85 | Good Length | 7.02 | 0.510 | 0.376 | 0.242 | 0.887 | 0.852 | +0.034 | 0.57 | 0.55 | 65.6 |
| 85 | Back of a Length | 9.02 | 0.422 | 0.489 | 0.352 | 0.910 | 0.852 | +0.058 | 0.66 | 0.61 | 64.6 |
| 85 | Short of a Length | 11.01 | 0.336 | 0.608 | 0.468 | 0.943 | 0.852 | +0.091 | 0.56 | 0.44 | 63.4 |
| 85 | Short Ball | 13.01 | 0.253 | 0.735 | 0.591 | 0.988 | 0.852 | +0.136 | 0.26 | 0.07 | 62.3 |
| 85 | Bouncer | 13.01 | 0.253 | 0.744 | 0.598 | 0.997 | 0.852 | +0.145 | 0.44 | 0.27 | 61.4 |
| 70 | Yorker | 0.54 | 0.996 | 0.035 | 0 (pitches in zone) | 1.031 | 1.035 | -0.004 | 0.20 | 0.12 | 56.7 |
| 70 | Full Toss | — | — | — | — | 1.032 | 1.035 | -0.003 | 0.59 | 0.22 | 65.4 |
| 70 | Full Length | 3.03 | 0.845 | 0.196 | 0.037 | 1.041 | 1.035 | +0.006 | 0.33 | 0.41 | 55.3 |
| 70 | Good Length | 7.02 | 0.618 | 0.456 | 0.294 | 1.074 | 1.035 | +0.039 | 0.51 | 0.44 | 54.4 |
| 70 | Back of a Length | 9.02 | 0.510 | 0.591 | 0.426 | 1.100 | 1.035 | +0.066 | 0.44 | 0.31 | 54.0 |
| 70 | Short of a Length | 11.01 | 0.405 | 0.747 | 0.565 | 1.152 | 1.035 | +0.117 | 0.07 | 0.11 | 41.8 |
| 70 | Short Ball | 13.01 | 0.305 | 0.944 | 0.727 | 1.249 | 1.035 | +0.214 | 0.12 | 0.04 | 40.8 |
| 70 | Bouncer | 13.01 | 0.305 | 0.943 | 0.724 | 1.248 | 1.035 | +0.213 | 0.16 | 0.13 | 40.1 |
