import * as ExpoCrypto from "expo-crypto";
import { installNativeAuthCrypto } from "@/services/supabaseNativeCrypto";

jest.mock("react-native", () => ({ Platform: { OS: "android" } }));
jest.mock("expo-crypto", () => ({ CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  getRandomValues: jest.fn((bytes) => bytes), digest: jest.fn().mockResolvedValue(new ArrayBuffer(32)),
}));

test("bridges native random values and SHA-256 without advertising other digests", async () => {
  const target: { crypto?: Crypto } = {};
  installNativeAuthCrypto(target);
  const bytes = new Uint8Array([1, 2, 3]);
  target.crypto!.getRandomValues(bytes);
  expect(ExpoCrypto.getRandomValues).toHaveBeenCalledWith(bytes);
  await target.crypto!.subtle.digest("SHA-256", bytes);
  expect(ExpoCrypto.digest).toHaveBeenCalledWith("SHA-256", bytes);
  await expect(target.crypto!.subtle.digest("SHA-512", bytes)).rejects.toThrow("only SHA-256");
});
test("preserves an existing crypto implementation", () => {
  const random = jest.fn();
  const digest = jest.fn();
  const crypto = { getRandomValues: random, subtle: { digest } } as unknown as Crypto;
  const target = { crypto };
  installNativeAuthCrypto(target);
  expect(target.crypto).toBe(crypto);
  expect(target.crypto.getRandomValues).toBe(random);
  expect(target.crypto.subtle.digest).toBe(digest);
});
