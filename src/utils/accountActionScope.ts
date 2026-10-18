export class AccountActionCancelled extends Error {
  constructor() { super("This action's account or screen changed."); this.name = "AccountActionCancelled"; }
}
export interface AccountAction {
  isCurrent(): boolean;
  /** UI flags may be reset after token rotation, but never for another screen/account. */
  canUpdate(): boolean;
  assertCurrent(): void;
  run<T>(operation: () => Promise<T>): Promise<T>;
}
const passthrough: AccountAction = {
  isCurrent: () => true, canUpdate: () => true, assertCurrent: () => {}, run: operation => operation(),
};
export const beginUnscopedAction = () => passthrough;
/** No SDK, credentials, subscriptions or React state in an action ticket. */
export function createAccountActionScope(owner: string | null, read: () => { userId: string | null; revision: number }) {
  let mounted = false, generation = 0;
  return {
    activate() { mounted = true; generation++; },
    dispose() { mounted = false; generation++; },
    begin(): AccountAction {
      const epoch = generation, revision = read().revision;
      const canUpdate = () => mounted && epoch === generation && owner !== null && read().userId === owner;
      const isCurrent = () => canUpdate() && read().revision === revision;
      const assertCurrent = () => { if (!isCurrent()) throw new AccountActionCancelled(); };
      return { isCurrent, canUpdate, assertCurrent,
        async run<T>(operation: () => Promise<T>): Promise<T> {
          assertCurrent(); const result = await operation(); assertCurrent(); return result;
        },
      };
    },
  };
}
