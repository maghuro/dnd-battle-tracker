import { nanoid } from 'nanoid';
import { dismissErrors, updateErrors } from './ErrorManager';
import now from '../util/date';
import {
  createDmRecoveryKey,
  encryptDmRecovery,
} from './DmRecoveryManager';

let shareQueue = Promise.resolve();

function getSharedCreatures(creatures) {
  return creatures.map((creature) => ({
    ...creature,
    statBlock: undefined,
    armorClass: undefined,
    totalSpellSlots: undefined,
    usedSpellSlots: undefined,
    initiativeRoll: undefined,
    spells: undefined,
    selected: undefined,
  }));
}

function queueShare(state, mutation, input) {
  const run = async () => {
    let dmSnapshot;

    if (state.dmRecoveryKey) {
      try {
        dmSnapshot = await encryptDmRecovery(
          state,
          state.dmRecoveryKey,
          state.battleId,
        );
      } catch {
        dmSnapshot = undefined;
      }
    }

    await mutation({
      variables: {
        battleinput: {
          ...input.variables.battleinput,
          ...(dmSnapshot ? { dmSnapshot } : {}),
        },
      },
    });
  };

  shareQueue = shareQueue.then(run, run).catch(() => undefined);
}

export function waitForPendingShares() {
  return shareQueue;
}

export function share(state, createBattle, updateBattle) {
  if (!state.shareEnabled) {
    return state;
  }

  const battleId = state.battleId || nanoid(11);
  const timestamp = now();
  const dmRecoveryKey = state.dmRecoveryKey || createDmRecoveryKey();

  const sharedState = {
    ...state,
    battleId,
    dmRecoveryKey,
  };

  const input = {
    variables: {
      battleinput: {
        battleId,
        round: state.round,
        creatures: getSharedCreatures(state.creatures),
        activeCreature: state.activeCreature,
        expdate: Math.floor(timestamp / 1000.0) + 86400,
      },
    },
  };

  const { battleCreated } = state;

  if (battleCreated) {
    queueShare(sharedState, updateBattle, input);
    return sharedState;
  }

  queueShare(sharedState, createBattle, input);

  return {
    ...sharedState,
    battleCreated: true,
    sharedTimestamp: timestamp,
  };
}

export function handleShareError(state, createError, updateError) {
  if (!createError && !updateError) return dismissErrors(state);

  const error = state.loaded
    ? 'Error rejoining previously shared battle. Try resharing the battle.'
    : 'Error sharing battle with players. Try toggling share button.';
  const stateWithErrors = updateErrors(state, error);

  if (createError) return { ...stateWithErrors, battleCreated: false };

  if (state.loaded) {
    return {
      ...stateWithErrors,
      battleCreated: false,
      shareEnabled: false,
      battleId: undefined,
    };
  }

  return stateWithErrors;
}
