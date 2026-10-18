import * as ExpoCrypto from "expo-crypto";
import { Platform } from "react-native";

/** Minimal native bridge for Supabase's PKCE SHA-256 and secure random bytes.
 * Do not replace a complete WebCrypto implementation or claim other algorithms.
 */
export function installNativeAuthCrypto(target: { crypto?: Crypto } = globalThis): void {
  if (Platform.OS === "web") return;
  const nativeCrypto = target.crypto ?? ({} as Crypto);
  if (!nativeCrypto.getRandomValues) {
    Object.defineProperty(nativeCrypto, "getRandomValues", {
      value: ExpoCrypto.getRandomValues, configurable: true,
    });
  }
  if (!nativeCrypto.subtle?.digest) {
    const subtle = nativeCrypto.subtle ?? ({} as SubtleCrypto);
    Object.defineProperty(subtle, "digest", {
      value: async (algorithm: AlgorithmIdentifier, data: BufferSource) => {
        const name = typeof algorithm === "string" ? algorithm : algorithm.name;
        if (name.toUpperCase() !== "SHA-256") throw new Error("Native auth crypto supports only SHA-256.");
        return ExpoCrypto.digest(ExpoCrypto.CryptoDigestAlgorithm.SHA256, data);
      }, configurable: true,
    });
    if (!nativeCrypto.subtle) Object.defineProperty(nativeCrypto, "subtle", { value: subtle, configurable: true });
  }
  if (!target.crypto) Object.defineProperty(target, "crypto", { value: nativeCrypto, configurable: true });
}
