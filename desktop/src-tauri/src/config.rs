use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::PathBuf;

/// Remote backend configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteBackendConfig {
    pub enabled: bool,
    pub url: String,
    pub token: String,
}

impl Default for RemoteBackendConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            url: String::new(),
            token: String::new(),
        }
    }
}

/// Application configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub remote_backend: RemoteBackendConfig,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            remote_backend: RemoteBackendConfig::default(),
        }
    }
}

impl AppConfig {
    /// Load configuration from file, returning default if not found or invalid
    pub fn load() -> Self {
        match Self::load_from_file() {
            Ok(config) => config,
            Err(e) => {
                eprintln!("Failed to load config: {}, using defaults", e);
                Self::default()
            }
        }
    }

    /// Load configuration from file
    fn load_from_file() -> io::Result<Self> {
        let path = Self::get_config_path()?;

        if !path.exists() {
            return Ok(Self::default());
        }

        let contents = fs::read_to_string(&path)?;
        let config: AppConfig = serde_json::from_str(&contents)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;

        Ok(config)
    }

    /// Save configuration to file
    pub fn save(&self) -> io::Result<()> {
        let path = Self::get_config_path()?;

        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }

        let contents = serde_json::to_string_pretty(self)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;

        fs::write(&path, contents)?;
        Ok(())
    }

    /// Get the configuration file path
    fn get_config_path() -> io::Result<PathBuf> {
        let config_dir = dirs::config_dir()
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Config directory not found"))?;

        Ok(config_dir.join("cade").join("config.json"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = AppConfig::default();
        assert!(!config.remote_backend.enabled);
        assert!(config.remote_backend.url.is_empty());
        assert!(config.remote_backend.token.is_empty());
    }

    #[test]
    fn test_serialize_deserialize() {
        let config = AppConfig {
            remote_backend: RemoteBackendConfig {
                enabled: true,
                url: "http://example.com:3000".to_string(),
                token: "test-token".to_string(),
            },
        };

        let json = serde_json::to_string(&config).unwrap();
        let deserialized: AppConfig = serde_json::from_str(&json).unwrap();

        assert_eq!(config.remote_backend.enabled, deserialized.remote_backend.enabled);
        assert_eq!(config.remote_backend.url, deserialized.remote_backend.url);
        assert_eq!(config.remote_backend.token, deserialized.remote_backend.token);
    }
}
