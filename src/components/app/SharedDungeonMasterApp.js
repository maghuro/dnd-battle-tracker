import React, { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import {
  CREATE_BATTLE,
  GET_DM_RECOVERY,
  UPDATE_BATTLE,
} from '../../graphql/operations';
import { share, handleShareError } from '../../state/SyncManager';
import {
  decryptDmRecovery,
  restoreDmRecovery,
} from '../../state/DmRecoveryManager';
import { updateErrors } from '../../state/ErrorManager';
import now from '../../util/date';
import DungeonMasterApp from './DungeonMasterApp';
import Loading from './Loading';

const recoveryErrorMessage = 'Could not recover the DM battle. The recovery link may be invalid or expired.';

export default function SharedDungeonMasterApp({
  state,
  setState,
  recovery,
}) {
  const [recoveryResolved, setRecoveryResolved] = useState(!recovery);
  const [createBattleMutation, { error: createError }] = useMutation(CREATE_BATTLE);
  const [updateBattleMutation, { error: updateError }] = useMutation(UPDATE_BATTLE);
  const {
    loading: recoveryLoading,
    data: recoveryData,
    error: recoveryError,
  } = useQuery(GET_DM_RECOVERY, {
    skip: !recovery || recoveryResolved,
    variables: recovery ? { battleId: recovery.battleId } : undefined,
    fetchPolicy: 'network-only',
  });

  const shareBattle = (shareState) => share(
    shareState,
    createBattleMutation,
    updateBattleMutation,
  );

  useEffect(() => {
    if (!recovery) {
      setState((prevState) => shareBattle(prevState));
    }
  }, []);

  useEffect(() => {
    setState((prevState) => handleShareError(prevState, createError, updateError));
  }, [createError, updateError]);

  useEffect(() => {
    if (!recovery || recoveryResolved || recoveryLoading) return undefined;

    let cancelled = false;
    const dmSnapshot = recoveryData?.getDndbattletracker?.dmSnapshot;

    if (recoveryError || !dmSnapshot) {
      setState((prevState) => updateErrors(prevState, recoveryErrorMessage));
      setRecoveryResolved(true);
      return undefined;
    }

    decryptDmRecovery(dmSnapshot, recovery.key, recovery.battleId)
      .then((recoveredState) => {
        if (cancelled) return;

        setState((prevState) => restoreDmRecovery(
          prevState,
          recoveredState,
          recovery,
          now(),
        ));
        setRecoveryResolved(true);
        window.history.replaceState(
          null,
          '',
          `${window.location.pathname}${window.location.search}`,
        );
      })
      .catch(() => {
        if (cancelled) return;
        setState((prevState) => updateErrors(prevState, recoveryErrorMessage));
        setRecoveryResolved(true);
      });

    return () => {
      cancelled = true;
    };
  }, [
    recovery,
    recoveryResolved,
    recoveryLoading,
    recoveryData,
    recoveryError,
  ]);

  if (recovery && !recoveryResolved) {
    return <Loading />;
  }

  return (
    <DungeonMasterApp
      state={state}
      setState={setState}
      shareBattle={shareBattle}
    />
  );
}
