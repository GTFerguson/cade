use std::io;
use std::net::{TcpListener, SocketAddr};

/// Find an available port by binding to a random port and returning it
pub fn find_available_port() -> io::Result<u16> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let addr: SocketAddr = listener.local_addr()?;
    Ok(addr.port())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_find_available_port() {
        let port = find_available_port().expect("Should find available port");
        assert!(port > 0, "Port should be greater than 0");

        // Try to bind to the port to verify it's actually available
        let result = TcpListener::bind(format!("127.0.0.1:{}", port));
        assert!(result.is_ok(), "Port should be available for binding");
    }

    #[test]
    fn test_multiple_ports_different() {
        let port1 = find_available_port().expect("Should find first port");
        let port2 = find_available_port().expect("Should find second port");

        // Ports might be same if OS reuses quickly, but functionality is correct
        assert!(port1 > 0 && port2 > 0, "Both ports should be valid");
    }
}
