use std::io;
use std::process::{Child, Command, Stdio};

pub struct SshTunnel {
    child: Option<Child>,
    ssh_host: String,
    local_port: u16,
    remote_port: u16,
}

impl SshTunnel {
    pub fn start(
        ssh_host: String,
        local_port: u16,
        remote_port: u16,
    ) -> io::Result<Self> {
        let mut cmd = Command::new("ssh");
        cmd.arg("-L")
            .arg(format!("{}:localhost:{}", local_port, remote_port))
            .arg(&ssh_host)
            .arg("-N")
            .arg("-o").arg("ExitOnForwardFailure=yes")
            .stdout(Stdio::null())
            .stderr(Stdio::piped());

        let child = cmd.spawn()?;

        Ok(Self {
            child: Some(child),
            ssh_host,
            local_port,
            remote_port,
        })
    }

    pub fn pid(&self) -> Option<u32> {
        self.child.as_ref().map(|c| c.id())
    }

    pub fn is_running(&mut self) -> bool {
        if let Some(ref mut child) = self.child {
            match child.try_wait() {
                Ok(None) => true,
                _ => false,
            }
        } else {
            false
        }
    }

    pub fn stop(&mut self) -> io::Result<()> {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        Ok(())
    }
}

impl Drop for SshTunnel {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}
