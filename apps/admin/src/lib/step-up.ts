// The step-up code typed inside a confirmation (docs/06 §5.3 ConfirmDialog step-up slot, ADM-AUTH-08): the code is
// checked first, then the action runs. A wrong code reads the same as in the step-up dialog.
import { api, RequestError, stepUpActive } from "../api.ts";

export const WRONG_CODE =
  "That code didn't work. It may be the one you signed in with, which can't be used again. Wait for the next code and enter it.";

/** With a code: confirm it (POST /auth/step-up), then run the action. Without one (a step-up is active): just run it. */
export async function withCode<T>(code: string | undefined, run: () => Promise<T>): Promise<T> {
  // A code already accepted (an earlier try of this action failed after it) keeps the step-up open: don't spend it twice.
  if (code && !stepUpActive()) {
    try {
      await api.stepUp(code);
    } catch (e) {
      if (e instanceof RequestError && e.code === "invalid_code")
        throw new RequestError(400, "invalid_code", WRONG_CODE, e.requestId);
      throw e;
    }
  }
  return run();
}
