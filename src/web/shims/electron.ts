/** Ersatz für „electron“ im Browser: kein Schlüsselbund, Ablage im Browser-Speicher. */

export const safeStorage = {
  isEncryptionAvailable: (): boolean => false,
  getSelectedStorageBackend: (): string => 'basic_text',
  encryptString: (): never => {
    throw new Error('Kein Schlüsselbund im Browser')
  },
  decryptString: (): string => '',
}

export const app = {
  getPath: (): string => '',
  getAppPath: (): string => '',
  isPackaged: true,
}
