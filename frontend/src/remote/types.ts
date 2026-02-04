export interface SavedProject {
  id: string;
  name: string;
  path: string;
  lastUsed?: number;
}

export interface RemoteProfile {
  id: string;
  name: string;
  url: string;
  authToken?: string;
  defaultPath?: string;
  lastUsed?: number;
  connectionType: "direct" | "ssh-tunnel";
  sshHost?: string;
  localPort?: number;
  remotePort?: number;
  projects?: SavedProject[];
}

export interface RemoteProfilesConfig {
  version: number;
  profiles: RemoteProfile[];
  defaultProfileId?: string;
}
