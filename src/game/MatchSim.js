// Glue between the match engine and a single delivery simulation.
// Used by the in-game match controller, the menu "attract mode" and the Node tests.

import { DeliverySim } from './DeliverySim.js';
import { assignFielders } from './FieldPlacements.js';
import { chooseDelivery, chooseBowler, chooseField } from '../ai/BowlingAI.js';
import { BOWLING_TYPES } from './PlayerAttributes.js';

/** Make sure the engine has a bowler for the coming over (AI choice). */
export function ensureBowler(engine, rng) {
  if (!engine.needsBowler()) return engine.innings.currentBowler;
  const id = chooseBowler({ engine, eligible: engine.eligibleBowlers(), rng });
  engine.setBowler(id);
  return id;
}

export function fieldersFor(engine, bowlerId) {
  const team = engine.bowlingTeam;
  const keeper = engine.keeper(team.id);
  return { keeper, outfield: team.players.filter(p => p.id !== bowlerId && p.id !== keeper.id) };
}

export function autoFieldPreset(engine, bowler) {
  const inn = engine.innings;
  const st = inn.batters[inn.striker];
  return chooseField({
    bowler,
    situation: engine.situation(),
    strategy: engine.bowlingTeam.strategy?.fieldApproach || 'auto',
    newBatter: st && st.balls < 4,
  });
}

/**
 * Create the DeliverySim for the next ball.
 * opts: { rng, userTeamId, assistRunning, fieldPreset, cpuSpec }
 */
export function buildDeliverySim(engine, opts) {
  const { rng } = opts;
  const inn = engine.innings;
  const bowler = engine.player(inn.currentBowler);
  const striker = engine.player(inn.striker);
  const nonStriker = engine.player(inn.nonStriker);
  const { keeper, outfield } = fieldersFor(engine, bowler.id);
  const preset = opts.fieldPreset || autoFieldPreset(engine, bowler);
  const field = assignFielders(preset, outfield);
  const userBatting = !!opts.userTeamId && inn.battingTeam === opts.userTeamId;
  const userBowling = !!opts.userTeamId && inn.bowlingTeam === opts.userTeamId;
  const situation = engine.situation();
  const sim = new DeliverySim({
    striker, nonStriker, bowler, keeper, field,
    userBatting, userBowling,
    assistRunning: !!opts.assistRunning,
    difficulty: engine.config.difficulty,
    situation,
    freeHit: inn.freeHit,
    ballsFaced: inn.batters[inn.striker]?.balls || 0,
    fatigue: engine.fatigueOf(bowler.id),
    rng,
    unlockSpeeds: !!opts.unlockSpeeds,
  });
  sim.fieldPreset = preset;
  if (!userBowling) {
    const spec = chooseDelivery({
      bowler, batter: striker, situation, ballsFaced: inn.batters[inn.striker]?.balls || 0, rng,
      difficulty: engine.config.difficulty, isCpuVsUser: userBatting, lastSpecs: opts.lastSpecs || [],
      fatigue: engine.fatigueOf(bowler.id),
    });
    sim.setSpec(spec);
    sim.cpuSpec = spec;
  }
  return sim;
}

/** Bowl one AI-vs-AI ball instantly; returns the engine's record result. */
export function simulateBallHeadless(engine, rng, opts = {}) {
  ensureBowler(engine, rng);
  const sim = buildDeliverySim(engine, { rng, ...opts });
  const result = sim.fastForward();
  const rec = engine.recordBall(result);
  return { result, rec, sim };
}

/** Play a whole match with the AI on both sides (tests / quick sim). */
export function simulateMatchHeadless(engine, rng, { maxBalls = 2000 } = {}) {
  let n = 0;
  while (engine.phase !== 'complete' && n++ < maxBalls) {
    if (engine.phase === 'break') { engine.beginSecondInnings(); continue; }
    simulateBallHeadless(engine, rng);
  }
  return engine;
}

export function bowlerKind(p) { return BOWLING_TYPES[p.bowlingType]?.kind || 'pace'; }
