import defaultState from '../../test/fixtures/battle';
import {
  buildDmRecoveryUrl,
  createDmRecoveryKey,
  decryptDmRecovery,
  encryptDmRecovery,
  getDmRecoveryFromLocation,
  restoreDmRecovery,
} from './DmRecoveryManager';

describe('DM recovery encryption', () => {
  it('round trips private battle state without transient or sharing metadata', async () => {
    const key = createDmRecoveryKey();
    const state = {
      ...defaultState,
      battleCreated: true,
      battleId: 'public-battle',
      sharedTimestamp: 123,
      dmRecoveryKey: key,
      focusedCreature: 2,
      errors: ['an error'],
      ariaAnnouncements: ['announcement'],
      creatures: defaultState.creatures.map((creature, index) => ({
        ...creature,
        selected: index === 1,
      })),
    };

    const encrypted = await encryptDmRecovery(state, key, state.battleId);
    const recovered = await decryptDmRecovery(encrypted, key, state.battleId);

    expect(encrypted).not.toContain('Goblin #1');
    expect(recovered.creatures[1].armorClass).toBe(15);
    expect(recovered.creatures[1].statBlock).toBe('https://www.dndbeyond.com/monsters/goblin');
    expect(recovered.creatures[1].selected).toBe(false);
    expect(recovered.battleId).toBeUndefined();
    expect(recovered.battleCreated).toBeUndefined();
    expect(recovered.shareEnabled).toBeUndefined();
    expect(recovered.sharedTimestamp).toBeUndefined();
    expect(recovered.dmRecoveryKey).toBeUndefined();
    expect(recovered.focusedCreature).toBeUndefined();
    expect(recovered.errors).toBeUndefined();
    expect(recovered.ariaAnnouncements).toBeUndefined();
  });

  it('cannot decrypt a snapshot with a different recovery key', async () => {
    const key = createDmRecoveryKey();
    const otherKey = createDmRecoveryKey();
    const encrypted = await encryptDmRecovery(defaultState, key, 'battle-1');

    await expect(
      decryptDmRecovery(encrypted, otherKey, 'battle-1'),
    ).rejects.toBeDefined();
  });

  it('binds the encrypted snapshot to the public battle id', async () => {
    const key = createDmRecoveryKey();
    const encrypted = await encryptDmRecovery(defaultState, key, 'battle-1');

    await expect(
      decryptDmRecovery(encrypted, key, 'battle-2'),
    ).rejects.toBeDefined();
  });

  it('rejects recovery snapshots from another major version', async () => {
    const key = createDmRecoveryKey();
    const incompatibleState = {
      ...defaultState,
      battleTrackerVersion: '999.0.0',
    };
    const encrypted = await encryptDmRecovery(incompatibleState, key, 'battle-1');

    await expect(
      decryptDmRecovery(encrypted, key, 'battle-1'),
    ).rejects.toThrow('Invalid or incompatible DM recovery snapshot');
  });
});

describe('DM recovery links', () => {
  it('keeps the recovery key in the URL fragment and removes player battle params', () => {
    const url = buildDmRecoveryUrl(
      'battle-1',
      'private-key',
      'https://example.com/?feature=true&battle=player-id#old',
    );

    expect(url).toBe('https://example.com/?feature=true#dm=battle-1&key=private-key');
  });

  it('reads a valid recovery link from a location hash', () => {
    const recovery = getDmRecoveryFromLocation({
      hash: '#dm=battle-1&key=private-key',
    });

    expect(recovery).toEqual({
      battleId: 'battle-1',
      key: 'private-key',
    });
  });

  it('ignores incomplete recovery links', () => {
    expect(getDmRecoveryFromLocation({ hash: '#dm=battle-1' })).toBeUndefined();
    expect(getDmRecoveryFromLocation({ hash: '#key=private-key' })).toBeUndefined();
  });
});

describe('restoreDmRecovery', () => {
  it('restores the private state into the active shared session', () => {
    const recoveredState = {
      ...defaultState,
      shareEnabled: undefined,
      battleId: undefined,
      battleCreated: undefined,
      sharedTimestamp: undefined,
      creatures: defaultState.creatures.map((creature) => ({
        ...creature,
        selected: true,
      })),
    };

    const restored = restoreDmRecovery(
      {
        ...defaultState,
        creatures: [],
        shareEnabled: false,
      },
      recoveredState,
      {
        battleId: 'battle-1',
        key: 'private-key',
      },
      123456,
    );

    expect(restored.battleId).toBe('battle-1');
    expect(restored.battleCreated).toBe(true);
    expect(restored.shareEnabled).toBe(true);
    expect(restored.sharedTimestamp).toBe(123456);
    expect(restored.dmRecoveryKey).toBe('private-key');
    expect(restored.errors).toEqual([]);
    expect(restored.ariaAnnouncements).toEqual(['battle recovered']);
    expect(restored.focusedCreature).toBeUndefined();
    expect(restored.creatures.every(({ selected }) => !selected)).toBe(true);
    expect(restored.creatures[1].armorClass).toBe(15);
  });
});
