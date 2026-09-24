import packageJson from '../../package.json';

const RECOVERY_VERSION = 'v1';
const RECOVERY_KEY_BYTES = 32;
const RECOVERY_IV_BYTES = 12;

function bytesToBase64Url(bytes) {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlToBytes(value) {
  const base64 = value
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const binary = atob(padded);

  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function versionsAreCompatible(recoveredVersion) {
  if (!recoveredVersion) return false;

  const currentMajorVersion = packageJson.version.split('.')[0];
  const recoveredMajorVersion = recoveredVersion.split('.')[0];

  return currentMajorVersion === recoveredMajorVersion;
}

function getSnapshotState(state) {
  const {
    ariaAnnouncements,
    errors,
    autoSaveError,
    loaded,
    battleCreated,
    battleId,
    shareEnabled,
    sharedTimestamp,
    dmRecoveryKey,
    focusedCreature,
    ...persistentState
  } = state;

  return {
    ...persistentState,
    creatures: persistentState.creatures.map((creature) => ({
      ...creature,
      selected: false,
    })),
  };
}

export function isDmRecoverySupported() {
  return Boolean(
    window.crypto
    && window.crypto.getRandomValues
    && window.crypto.subtle
    && typeof TextEncoder !== 'undefined'
    && typeof TextDecoder !== 'undefined',
  );
}

export function createDmRecoveryKey() {
  if (!isDmRecoverySupported()) return undefined;

  const keyBytes = new Uint8Array(RECOVERY_KEY_BYTES);
  window.crypto.getRandomValues(keyBytes);

  return bytesToBase64Url(keyBytes);
}

export async function encryptDmRecovery(state, key, battleId) {
  if (!isDmRecoverySupported()) throw new Error('DM recovery is not supported');

  const encoder = new TextEncoder();
  const iv = new Uint8Array(RECOVERY_IV_BYTES);
  window.crypto.getRandomValues(iv);

  const cryptoKey = await window.crypto.subtle.importKey(
    'raw',
    base64UrlToBytes(key),
    'AES-GCM',
    false,
    ['encrypt'],
  );

  const encrypted = await window.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: encoder.encode(battleId),
    },
    cryptoKey,
    encoder.encode(JSON.stringify(getSnapshotState(state))),
  );

  return [
    RECOVERY_VERSION,
    bytesToBase64Url(iv),
    bytesToBase64Url(new Uint8Array(encrypted)),
  ].join('.');
}

export async function decryptDmRecovery(snapshot, key, battleId) {
  if (!isDmRecoverySupported()) throw new Error('DM recovery is not supported');

  const [version, encodedIv, encodedPayload, ...extra] = snapshot.split('.');
  if (
    version !== RECOVERY_VERSION
    || !encodedIv
    || !encodedPayload
    || extra.length
  ) {
    throw new Error('Invalid DM recovery snapshot');
  }

  const encoder = new TextEncoder();
  const cryptoKey = await window.crypto.subtle.importKey(
    'raw',
    base64UrlToBytes(key),
    'AES-GCM',
    false,
    ['decrypt'],
  );

  const decrypted = await window.crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: base64UrlToBytes(encodedIv),
      additionalData: encoder.encode(battleId),
    },
    cryptoKey,
    base64UrlToBytes(encodedPayload),
  );

  const state = JSON.parse(new TextDecoder().decode(decrypted));
  if (!versionsAreCompatible(state.battleTrackerVersion)) {
    throw new Error('Incompatible DM recovery snapshot');
  }

  return state;
}

export function buildDmRecoveryUrl(battleId, key, href = window.location.href) {
  if (!battleId || !key) return undefined;

  const url = new URL(href);
  const recovery = new URLSearchParams();
  recovery.set('dm', battleId);
  recovery.set('key', key);

  url.searchParams.delete('battle');
  url.hash = recovery.toString();

  return url.toString();
}

export function getDmRecoveryFromLocation(location = window.location) {
  const recovery = new URLSearchParams(location.hash.replace(/^#/, ''));
  const battleId = recovery.get('dm');
  const key = recovery.get('key');

  if (!battleId || !key) return undefined;

  return { battleId, key };
}

export function restoreDmRecovery(defaultState, recoveredState, recovery, timestamp) {
  return {
    ...defaultState,
    ...recoveredState,
    focusedCreature: undefined,
    creatures: recoveredState.creatures.map((creature) => ({
      ...creature,
      selected: false,
    })),
    battleId: recovery.battleId,
    battleCreated: true,
    shareEnabled: true,
    sharedTimestamp: timestamp,
    dmRecoveryKey: recovery.key,
    errors: [],
    ariaAnnouncements: ['battle recovered'],
    loaded: true,
  };
}
