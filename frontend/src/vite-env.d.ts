/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CLEAR_SESSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
