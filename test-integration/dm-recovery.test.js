import { screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { graphql, HttpResponse } from 'msw';
import DmApp from './page-object-models/dmApp';
import msw from './mocks/server';
import defaultState from '../test/fixtures/battle';
import {
  createDmRecoveryKey,
  encryptDmRecovery,
} from '../src/state/DmRecoveryManager';

describe('DM recovery', () => {
  test('recovers the complete private DM state from another browser session', async () => {
    const battleId = 'recovery-battle-id';
    const key = createDmRecoveryKey();
    const state = {
      ...defaultState,
      battleId,
      battleCreated: true,
      shareEnabled: true,
      dmRecoveryKey: key,
    };
    const dmSnapshot = await encryptDmRecovery(state, key, battleId);

    msw.use(
      graphql.query('GET_DM_RECOVERY', ({ variables }) => {
        expect(variables.battleId).toBe(battleId);
        return HttpResponse.json({
          data: {
            getDndbattletracker: {
              battleId,
              dmSnapshot,
            },
          },
        });
      }),
    );

    new DmApp({ battleId, key });

    await waitFor(() => {
      const savedState = JSON.parse(window.localStorage.getItem('battle'));
      expect(savedState.battleId).toBe(battleId);
      expect(savedState.dmRecoveryKey).toBe(key);
      expect(savedState.shareEnabled).toBe(true);
      expect(savedState.battleCreated).toBe(true);
      expect(savedState.creatures[1].armorClass).toBe(15);
      expect(savedState.creatures[1].statBlock).toBe('https://www.dndbeyond.com/monsters/goblin');
      expect(savedState.creatures[1].initiativeRoll).toEqual({ result: 12 });
    });

    const recoveryLink = await screen.findByRole('link', { name: 'DM recovery link' });
    expect(recoveryLink).toBeVisible();
  });

  test('can leave online mode after recovering a battle', async () => {
    const battleId = 'recovery-battle-id';
    const key = createDmRecoveryKey();
    const dmSnapshot = await encryptDmRecovery({
      ...defaultState,
      battleId,
      battleCreated: true,
      shareEnabled: true,
      dmRecoveryKey: key,
    }, key, battleId);

    msw.use(
      graphql.query('GET_DM_RECOVERY', () => HttpResponse.json({
        data: {
          getDndbattletracker: {
            battleId,
            dmSnapshot,
          },
        },
      })),
    );

    const dmApp = new DmApp({ battleId, key });
    await screen.findByRole('link', { name: 'DM recovery link' });

    await dmApp.battleMenu.toggle();
    await dmApp.battleMenu.selectMenuItem('Unshare battle');

    await waitFor(() => {
      expect(screen.queryByRole('link', { name: 'DM recovery link' })).toBeNull();
    });
  });

  test('keeps the local battle and shows an error for an expired recovery link', async () => {
    window.localStorage.setItem('battle', JSON.stringify({
      ...defaultState,
      shareEnabled: false,
      battleId: undefined,
      battleCreated: false,
    }));

    msw.use(
      graphql.query('GET_DM_RECOVERY', () => HttpResponse.json({
        data: {
          getDndbattletracker: null,
        },
      })),
    );

    new DmApp({
      battleId: 'expired-battle',
      key: createDmRecoveryKey(),
    });

    const error = await screen.findByRole('alert');
    expect(error).toHaveTextContent('Could not recover the DM battle. The recovery link may be invalid or expired.');

    const savedState = JSON.parse(window.localStorage.getItem('battle'));
    expect(savedState.creatures).toEqual(defaultState.creatures);
    expect(savedState.battleId).toBeUndefined();
    expect(savedState.shareEnabled).toBe(false);
  });
});
