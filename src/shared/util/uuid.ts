import { v7 as uuidv7, validate as isUuid, version as uuidVersion } from 'uuid';

export function newId(): string {
  return uuidv7();
}

export function isUuidV7(value: string): boolean {
  return isUuid(value) && uuidVersion(value) === 7;
}
