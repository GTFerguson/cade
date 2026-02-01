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
}

export interface RemoteProfilesConfig {
  version: number;
  profiles: RemoteProfile[];
  defaultProfileId?: string;
}
