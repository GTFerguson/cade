/**
 * Google Identity Services (GIS) wrapper for Google Sign-In.
 *
 * The GIS library is loaded via a script tag in index.html. This module
 * wraps its One Tap / button APIs and manages the short-lived id_token in
 * sessionStorage. id_tokens expire in ~1 hour, so there is no value in
 * persisting them across browser sessions.
 */

const ID_TOKEN_SESSION_KEY = "cade_google_id_token";

// Minimal type shim for the GIS globals. Only the subset we call is typed here.
interface GoogleAccountsId {
  initialize(config: {
    client_id: string;
    callback: (response: { credential: string }) => void;
    auto_select?: boolean;
  }): void;
  prompt(): void;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: GoogleAccountsId;
      };
    };
  }
}

/**
 * Wait for the GIS library to be available on the window object.
 * The script tag uses async/defer so it may not be ready immediately.
 */
function waitForGis(timeoutMs = 10_000): Promise<GoogleAccountsId> {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) {
      resolve(window.google.accounts.id);
      return;
    }

    const deadline = Date.now() + timeoutMs;
    const poll = () => {
      if (window.google?.accounts?.id) {
        resolve(window.google.accounts.id);
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error("Google Identity Services library did not load in time"));
        return;
      }
      setTimeout(poll, 50);
    };
    poll();
  });
}

/**
 * Initialise GIS and trigger sign-in.
 *
 * Tries One Tap first. If Google suppresses the overlay (e.g. user already
 * used it this session, dismissed it, or it was auto-closed), falls back to
 * rendering a proper Sign In with Google button inside `fallbackContainer`.
 */
export async function initGoogleAuth(
  clientId: string,
  callback: (idToken: string) => void,
  fallbackContainer?: HTMLElement | null,
): Promise<void> {
  const gis = await waitForGis();

  const wrapped = (response: { credential: string }) => {
    setStoredIdToken(response.credential);
    callback(response.credential);
  };

  gis.initialize({ client_id: clientId, callback: wrapped, auto_select: false });

  gis.prompt((notification: any) => {
    const suppressed =
      notification.isNotDisplayed?.() || notification.isSkippedMoment?.();
    if (suppressed && fallbackContainer) {
      fallbackContainer.innerHTML = "";
      window.google!.accounts.id.renderButton(fallbackContainer, {
        type: "standard",
        theme: "filled_black",
        size: "large",
        text: "signin_with",
        shape: "rectangular",
      });
    }
  });
}

/**
 * Return the id_token stored for the current browser session, or null if
 * the user has not signed in (or the session has been cleared).
 */
export function getStoredIdToken(): string | null {
  try {
    return sessionStorage.getItem(ID_TOKEN_SESSION_KEY);
  } catch {
    return null;
  }
}

/**
 * Persist the id_token for the duration of the browser session.
 */
export function setStoredIdToken(token: string): void {
  try {
    sessionStorage.setItem(ID_TOKEN_SESSION_KEY, token);
  } catch (e) {
    console.error("Failed to store Google id_token:", e);
  }
}

/**
 * Remove the stored id_token (e.g. on sign-out or auth failure).
 */
export function clearStoredIdToken(): void {
  try {
    sessionStorage.removeItem(ID_TOKEN_SESSION_KEY);
  } catch (e) {
    console.error("Failed to clear Google id_token:", e);
  }
}
