use tauri::command;
use std::fs;
use std::path::PathBuf;

#[command]
pub fn get_profiles_path() -> Result<String, String> {
    let home_dir = dirs::home_dir().ok_or("Could not find home directory")?;
    let path = home_dir.join(".cade").join("remote-profiles.json");
    Ok(path.to_string_lossy().to_string())
}

#[command]
pub fn load_remote_profiles() -> Result<String, String> {
    let home_dir = dirs::home_dir().ok_or("Could not find home directory")?;
    let path = home_dir.join(".cade").join("remote-profiles.json");

    if !path.exists() {
        return Ok(get_default_profiles());
    }

    fs::read_to_string(&path).map_err(|e| format!("Failed to read profiles: {}", e))
}

fn get_default_profiles() -> String {
    r#"{
  "version": 1,
  "profiles": [
    {
      "id": "clann-vm-default",
      "name": "clann-vm",
      "url": "http://localhost:3000",
      "connectionType": "ssh-tunnel",
      "sshHost": "clann-vm",
      "localPort": 3000,
      "remotePort": 3000,
      "defaultPath": "/home/gary/cade-test",
      "authToken": "9994173863a133f5377fe23f771630ab2310ac8d50200275cce2ee24de8af67f"
    }
  ]
}"#.to_string()
}

#[command]
pub fn save_remote_profiles(data: String) -> Result<(), String> {
    let home_dir = dirs::home_dir().ok_or("Could not find home directory")?;
    let cade_dir = home_dir.join(".cade");
    let path = cade_dir.join("remote-profiles.json");

    fs::create_dir_all(&cade_dir).map_err(|e| format!("Failed to create .cade dir: {}", e))?;
    fs::write(&path, data).map_err(|e| format!("Failed to write profiles: {}", e))?;

    Ok(())
}
