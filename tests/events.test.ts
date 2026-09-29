import { describe, it, expect } from 'vitest';
import { evaluateEvents, type EventActions, type EventQueries } from '../src/forge/physics/events';
import type { ForgeEvent } from '../src/forge/core/types';
import { Rng } from '../src/forge/core/rng';

function makeEvent(partial: Partial<ForgeEvent['trigger']> & { type: ForgeEvent['trigger']['type'] }, action: Partial<ForgeEvent['action']> = {}): ForgeEvent {
  return {
    id: `e-${Math.random()}`, name: 't', enabled: true, fired: false,
    trigger: { type: partial.type, objectA: null, objectB: null, time: 0, threshold: 0, probability: 0, ...partial },
    action: { type: 'sound', targetId: null, vector: [0, 0, 0], scalar: 1, presetId: 'blip', ...action },
  };
}

function harness() {
  const calls: Array<[string, unknown[]]> = [];
  const actions = new Proxy({} as EventActions, {
    get: (_t, prop: string) => (...args: unknown[]) => {
      calls.push([prop, args]);
    },
  });
  const q: EventQueries = {
    simTime: 0, dt: 1 / 60,
    positionOf: () => null,
    speedOf: () => 0,
    pressureOf: () => 0,
    collisions: [],
    rng: new Rng(1),
  };
  return { calls, actions, q };
}

describe('evaluateEvents', () => {
  it('fires time triggers once', () => {
    const { calls, actions, q } = harness();
    const ev = makeEvent({ type: 'time', time: 1 });
    q.simTime = 0.5;
    expect(evaluateEvents([ev], q, actions)).toEqual([]);
    q.simTime = 1.5;
    expect(evaluateEvents([ev], q, actions)).toEqual([ev.id]);
    expect(calls[0][0]).toBe('sound');
    expect(evaluateEvents([ev], q, actions)).toEqual([]); // one-shot
  });

  it('matches collision pairs and impact thresholds', () => {
    const { actions, q } = harness();
    const ev = makeEvent({ type: 'collision', objectA: 'a', objectB: 'b' });
    q.collisions = [{ a: 'a', b: 'b', point: [0, 0, 0], impulse: 3, speed: 2 }];
    expect(evaluateEvents([ev], q, actions)).toEqual([ev.id]);

    const ev2 = makeEvent({ type: 'impact', objectA: 'a', threshold: 50 });
    q.collisions = [{ a: 'a', b: 'z', point: [0, 0, 0], impulse: 3, speed: 2 }];
    expect(evaluateEvents([ev2], q, actions)).toEqual([]);
    q.collisions = [{ a: 'a', b: 'z', point: [0, 0, 0], impulse: 80, speed: 9 }];
    expect(evaluateEvents([ev2], q, actions)).toEqual([ev2.id]);
  });

  it('evaluates velocity/height/pressure/distance triggers', () => {
    const { actions, q } = harness();
    q.speedOf = () => 7;
    q.pressureOf = () => 300000;
    q.positionOf = (id) => (id === 'a' ? [0, 5, 0] : id === 'b' ? [0, 5, 1] : null);
    const evs = [
      makeEvent({ type: 'velocity', objectA: 'a', threshold: 5 }),
      makeEvent({ type: 'height', objectA: 'a', threshold: 4 }),
      makeEvent({ type: 'pressure', objectA: 'a', threshold: 200000 }),
      makeEvent({ type: 'distance', objectA: 'a', objectB: 'b', threshold: 2 }),
      makeEvent({ type: 'velocity', objectA: 'a', threshold: 50 }),
    ];
    const fired = evaluateEvents(evs, q, actions);
    expect(fired).toHaveLength(4);
  });

  it('dispatches actions with targets', () => {
    const { calls, actions, q } = harness();
    q.simTime = 10;
    const ev = makeEvent(
      { type: 'time', time: 1 },
      { type: 'impulse', targetId: 'box', vector: [0, 10, 0] },
    );
    evaluateEvents([ev], q, actions);
    expect(calls).toEqual([['impulse', ['box', [0, 10, 0]]]]);
  });

  it('skips disabled events', () => {
    const { actions, q } = harness();
    q.simTime = 99;
    const ev = makeEvent({ type: 'time', time: 1 });
    ev.enabled = false;
    expect(evaluateEvents([ev], q, actions)).toEqual([]);
  });
});
