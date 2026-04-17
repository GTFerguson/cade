/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CLEAR_SESSION?: string;
  /** Google OAuth client ID. When set, enables Google Sign-In in the auth layer. */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
