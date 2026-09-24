import { nanoid } from 'nanoid';
import {
  share,
  handleShareError,
  handleRecoveryError,
  waitForPendingShares,
} from './SyncManager';
import { dismissErrors, updateErrors } from './ErrorManager';
import {
  createDmRecoveryKey,
  encryptDmRecovery,
} from './DmRecoveryManager';
import defaultState from '../../test/fixtures/battle';
import now from '../util/date';

jest.mock('nanoid');
jest.mock('../util/date');
jest.mock('./ErrorManager');
jest.mock('./DmRecoveryManager');

const createBattleMock = jest.fn();
const updateBattleMock = jest.fn();
const createRecoveryMock = jest.fn();
const updateRecoveryMock = jest.fn();

const timestamp = 1605815493000;
now.mockReturnValue(timestamp);

const expectedPublicInput = (battleId = defaultState.battleId) => ({
  variables: {
    battleinput: {
      battleId,
      round: defaultState.round,
      creatures: defaultState.creatures.map((creature) => ({
        ...creature,
        statBlock: undefined,
        armorClass: undefined,
        totalSpellSlots: undefined,
        usedSpellSlots: undefined,
        initiativeRoll: undefined,
        spells: undefined,
        selected: undefined,
      })),
      activeCreature: defaultState.activeCreature,
      expdate: 1605901893,
    },
  },
});

const expectedRecoveryInput = (
  recoveryId = 'dm-recovery-id',
  dmSnapshot = 'encrypted-snapshot',
) => ({
  variables: {
    battleinput: {
      battleId: recoveryId,
      round: 0,
      creatures: [],
      activeCreature: null,
      dmSnapshot,
      expdate: 1610999493,
    },
  },
});

beforeEach(async () => {
  await waitForPendingShares();
  createBattleMock.mockReset();
  updateBattleMock.mockReset();
  createRecoveryMock.mockReset();
  updateRecoveryMock.mockReset();
  nanoid.mockReset();
  updateErrors.mockReset();
  dismissErrors.mockReset();
  createDmRecoveryKey.mockReset();
  encryptDmRecovery.mockReset();

  nanoid.mockImplementation((size) => (
    size === 21 ? 'recovery-id' : 'new-player-id'
  ));
  createBattleMock.mockResolvedValue();
  updateBattleMock.mockResolvedValue();
  createRecoveryMock.mockResolvedValue();
  updateRecoveryMock.mockResolvedValue();
  createDmRecoveryKey.mockReturnValue('private-key');
  encryptDmRecovery.mockResolvedValue('encrypted-snapshot');
});

describe('share', () => {
  it('creates separate 24 hour player and 60 day recovery records', async () => {
    const newState = share(
      defaultState,
      createBattleMock,
      updateBattleMock,
      createRecoveryMock,
      updateRecoveryMock,
    );

    expect(newState).toEqual({
      ...defaultState,
      battleCreated: true,
      dmRecoveryId: 'dm-recovery-id',
      dmRecoveryKey: 'private-key',
      dmRecoveryCreated: true,
      sharedTimestamp: timestamp,
    });

    await waitForPendingShares();

    expect(createBattleMock).toHaveBeenCalledTimes(1);
    expect(createBattleMock).toHaveBeenCalledWith(expectedPublicInput());
    expect(createRecoveryMock).toHaveBeenCalledTimes(1);
    expect(createRecoveryMock).toHaveBeenCalledWith(expectedRecoveryInput());
    expect(updateBattleMock).not.toHaveBeenCalled();
    expect(updateRecoveryMock).not.toHaveBeenCalled();
    expect(encryptDmRecovery).toHaveBeenCalledWith(
      expect.objectContaining({
        battleId: defaultState.battleId,
        dmRecoveryId: 'dm-recovery-id',
        dmRecoveryKey: 'private-key',
      }),
      'private-key',
      'dm-recovery-id',
    );
  });

  it('updates existing player and recovery records independently', async () => {
    const state = {
      ...defaultState,
      battleCreated: true,
      dmRecoveryId: 'dm-existing-recovery',
      dmRecoveryKey: 'existing-private-key',
      dmRecoveryCreated: true,
    };

    const newState = share(
      state,
      createBattleMock,
      updateBattleMock,
      createRecoveryMock,
      updateRecoveryMock,
    );

    expect(newState).toEqual(state);

    await waitForPendingShares();

    expect(updateBattleMock).toHaveBeenCalledTimes(1);
    expect(updateBattleMock).toHaveBeenCalledWith(expectedPublicInput());
    expect(updateRecoveryMock).toHaveBeenCalledTimes(1);
    expect(updateRecoveryMock).toHaveBeenCalledWith(
      expectedRecoveryInput('dm-existing-recovery'),
    );
    expect(createBattleMock).not.toHaveBeenCalled();
    expect(createRecoveryMock).not.toHaveBeenCalled();
  });

  it('does nothing if share is disabled', async () => {
    const state = { ...defaultState, shareEnabled: false };
    const newState = share(
      state,
      createBattleMock,
      updateBattleMock,
      createRecoveryMock,
      updateRecoveryMock,
    );

    expect(newState).toEqual(state);
    await waitForPendingShares();

    expect(createBattleMock).not.toHaveBeenCalled();
    expect(updateBattleMock).not.toHaveBeenCalled();
    expect(createRecoveryMock).not.toHaveBeenCalled();
    expect(updateRecoveryMock).not.toHaveBeenCalled();
    expect(createDmRecoveryKey).not.toHaveBeenCalled();
  });

  it('creates a fresh player battle ID without changing the recovery ID', async () => {
    const state = {
      ...defaultState,
      battleId: undefined,
      dmRecoveryId: 'dm-existing-recovery',
      dmRecoveryKey: 'existing-private-key',
      dmRecoveryCreated: true,
    };

    const newState = share(
      state,
      createBattleMock,
      updateBattleMock,
      createRecoveryMock,
      updateRecoveryMock,
    );

    expect(newState.battleId).toBe('new-player-id');
    expect(newState.dmRecoveryId).toBe('dm-existing-recovery');
    expect(newState.battleCreated).toBe(true);
    expect(newState.sharedTimestamp).toBe(timestamp);

    await waitForPendingShares();

    expect(createBattleMock).toHaveBeenCalledWith(
      expectedPublicInput('new-player-id'),
    );
    expect(updateRecoveryMock).toHaveBeenCalledWith(
      expectedRecoveryInput('dm-existing-recovery'),
    );
  });

  it('keeps an existing DM recovery key and ID', async () => {
    const state = {
      ...defaultState,
      battleCreated: true,
      dmRecoveryId: 'dm-existing-recovery',
      dmRecoveryKey: 'existing-private-key',
      dmRecoveryCreated: true,
    };

    const newState = share(
      state,
      createBattleMock,
      updateBattleMock,
      createRecoveryMock,
      updateRecoveryMock,
    );
    await waitForPendingShares();

    expect(newState.dmRecoveryId).toBe('dm-existing-recovery');
    expect(newState.dmRecoveryKey).toBe('existing-private-key');
    expect(createDmRecoveryKey).not.toHaveBeenCalled();
    expect(encryptDmRecovery).toHaveBeenCalledWith(
      state,
      'existing-private-key',
      'dm-existing-recovery',
    );
  });

  it('keeps player sharing working if encrypting recovery fails', async () => {
    encryptDmRecovery.mockRejectedValue(new Error('crypto failed'));

    share(
      defaultState,
      createBattleMock,
      updateBattleMock,
      createRecoveryMock,
      updateRecoveryMock,
    );
    await waitForPendingShares();

    expect(createBattleMock).toHaveBeenCalledWith(expectedPublicInput());
    expect(createRecoveryMock).not.toHaveBeenCalled();
  });

  it('still saves recovery if creating the player session fails', async () => {
    createBattleMock.mockRejectedValue(new Error('player create failed'));

    share(
      defaultState,
      createBattleMock,
      updateBattleMock,
      createRecoveryMock,
      updateRecoveryMock,
    );
    await waitForPendingShares();

    expect(createBattleMock).toHaveBeenCalledTimes(1);
    expect(createRecoveryMock).toHaveBeenCalledWith(expectedRecoveryInput());
  });
});

describe('handleShareError', () => {
  it('sets an error in state and sets battleCreated to false on create battle error', () => {
    const state = { ...defaultState, battleCreated: true };
    const error = 'Error sharing battle with players. Try toggling share button.';
    const stateWithErrors = { ...state, errors: [error] };
    updateErrors.mockReturnValue(stateWithErrors);

    const newState = handleShareError(state, new Error('createError'), undefined);

    const expectedState = { ...stateWithErrors, battleCreated: false };
    expect(newState).toEqual(expectedState);
    expect(updateErrors).toHaveBeenCalledWith(state, error);
  });

  it('sets an error in state on update battle error', () => {
    const state = { ...defaultState, battleCreated: true };
    const error = 'Error sharing battle with players. Try toggling share button.';
    const stateWithErrors = { ...state, errors: [error] };
    updateErrors.mockReturnValue(stateWithErrors);

    const newState = handleShareError(state, undefined, new Error('updateError'));

    expect(newState).toEqual(stateWithErrors);
    expect(updateErrors).toHaveBeenCalledWith(state, error);
  });

  it('sets battleCreated to false on create and update battle error', () => {
    const state = { ...defaultState, battleCreated: true };
    const error = 'Error sharing battle with players. Try toggling share button.';
    const stateWithErrors = { ...state, errors: [error] };
    updateErrors.mockReturnValue(stateWithErrors);

    const newState = handleShareError(
      state,
      new Error('createError'),
      new Error('updateError'),
    );

    expect(newState).toEqual({ ...stateWithErrors, battleCreated: false });
  });

  it('unshares the battle on update battle error for a loaded battle', () => {
    const state = { ...defaultState, battleCreated: true, loaded: true };
    const error = 'Error rejoining previously shared battle. Try resharing the battle.';
    const stateWithErrors = { ...state, errors: [error] };
    updateErrors.mockReturnValue(stateWithErrors);

    const newState = handleShareError(state, undefined, new Error('updateError'));

    expect(newState).toEqual({
      ...stateWithErrors,
      battleCreated: false,
      shareEnabled: false,
      battleId: undefined,
    });
  });

  it('clears errors in state if there are no errors', () => {
    const state = { ...defaultState, errors: ['some error'] };
    dismissErrors.mockReturnValue(defaultState);
    const newState = handleShareError(state, undefined, undefined);

    expect(newState).toEqual(defaultState);
    expect(updateErrors).not.toHaveBeenCalled();
    expect(dismissErrors).toHaveBeenCalledWith(state);
  });
});

describe('handleRecoveryError', () => {
  it('does not disable player sharing when recovery persistence fails', () => {
    const state = {
      ...defaultState,
      battleCreated: true,
      dmRecoveryCreated: true,
    };
    const error = 'DM recovery could not be saved. Player sharing is still active.';
    const stateWithErrors = { ...state, errors: [error] };
    updateErrors.mockReturnValue(stateWithErrors);

    const newState = handleRecoveryError(
      state,
      new Error('recovery create failed'),
      undefined,
    );

    expect(newState).toEqual({
      ...stateWithErrors,
      dmRecoveryCreated: false,
    });
    expect(newState.shareEnabled).toBe(true);
    expect(newState.battleCreated).toBe(true);
    expect(updateErrors).toHaveBeenCalledWith(state, error);
  });

  it('does nothing when recovery persistence has no error', () => {
    expect(handleRecoveryError(defaultState)).toEqual(defaultState);
  });
});
