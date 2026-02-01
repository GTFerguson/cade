use std::collections::HashMap;
use std::sync::Mutex;

use crate::ssh_tunnel::SshTunnel;

type TunnelKey = (String, u16, u16);

pub struct TunnelRegistry {
    tunnels: Mutex<HashMap<TunnelKey, SshTunnel>>,
}

impl TunnelRegistry {
    pub fn new() -> Self {
        Self {
            tunnels: Mutex::new(HashMap::new()),
        }
    }

    pub fn start_or_reuse(
        &self,
        ssh_host: String,
        local_port: u16,
        remote_port: u16,
    ) -> Result<u32, String> {
        let key = (ssh_host.clone(), local_port, remote_port);
        let mut tunnels = self.tunnels.lock().map_err(|e| format!("Lock error: {}", e))?;

        if let Some(tunnel) = tunnels.get_mut(&key) {
            if tunnel.is_running() {
                return tunnel.pid().ok_or_else(|| "Failed to get tunnel PID".to_string());
            } else {
                tunnels.remove(&key);
            }
        }

        let tunnel = SshTunnel::start(ssh_host, local_port, remote_port)
            .map_err(|e| format!("Failed to start SSH tunnel: {}", e))?;

        let pid = tunnel.pid().ok_or_else(|| "Failed to get tunnel PID".to_string())?;

        tunnels.insert(key, tunnel);

        Ok(pid)
    }

    pub fn stop(&self, tunnel_pid: u32) -> Result<(), String> {
        let mut tunnels = self.tunnels.lock().map_err(|e| format!("Lock error: {}", e))?;

        let key_to_remove = tunnels
            .iter()
            .find(|(_, tunnel)| tunnel.pid() == Some(tunnel_pid))
            .map(|(key, _)| key.clone());

        if let Some(key) = key_to_remove {
            if let Some(mut tunnel) = tunnels.remove(&key) {
                tunnel.stop().map_err(|e| format!("Failed to stop tunnel: {}", e))?;
            }
        }

        Ok(())
    }

    pub fn stop_all(&self) {
        if let Ok(mut tunnels) = self.tunnels.lock() {
            for (_, mut tunnel) in tunnels.drain() {
                let _ = tunnel.stop();
            }
        }
    }
}

impl Drop for TunnelRegistry {
    fn drop(&mut self) {
        self.stop_all();
    }
}
