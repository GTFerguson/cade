use std::fs;
use std::process::{Child, Command, Stdio};
use std::io;
use std::path::PathBuf;

/// Manages the Python backend subprocess lifecycle
pub struct PythonProcess {
    child: Option<Child>,
    port: u16,
    log_path: Option<PathBuf>,
    #[cfg(target_os = "windows")]
    _job: Option<windows_job::Job>,
}

impl PythonProcess {
    /// Start the Python backend on the specified port
    pub fn start(port: u16) -> io::Result<Self> {
        let backend_exe = Self::get_backend_path()?;

        println!("Starting Python backend: {} on port {}", backend_exe.display(), port);

        let mut cmd = Command::new(backend_exe);
        cmd.arg("serve")
            .arg("--port")
            .arg(port.to_string())
            .arg("--host")
            .arg("0.0.0.0")
            .arg("--no-browser")
            .arg("--debug")
            .stdout(Stdio::null());

        // Write stderr to a log file so startup failures are diagnosable
        let log_path = Self::get_log_path();
        let stderr_target = match &log_path {
            Some(path) => {
                if let Some(parent) = path.parent() {
                    fs::create_dir_all(parent).ok();
                }
                match fs::File::create(path) {
                    Ok(file) => {
                        println!("Backend log: {}", path.display());
                        Stdio::from(file)
                    }
                    Err(e) => {
                        eprintln!("Failed to create log file {}: {}", path.display(), e);
                        Stdio::null()
                    }
                }
            }
            None => Stdio::null(),
        };
        cmd.stderr(stderr_target);

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let child = cmd.spawn()?;

        #[cfg(target_os = "windows")]
        let _job = windows_job::Job::new(&child);

        let proc = Self {
            child: Some(child),
            port,
            log_path,
            #[cfg(target_os = "windows")]
            _job,
        };

        Ok(proc)
    }

    /// Get the path for the backend log file
    fn get_log_path() -> Option<PathBuf> {
        dirs::data_local_dir()
            .or_else(dirs::home_dir)
            .map(|base| base.join("cade").join("backend.log"))
    }

    /// Get the log file path (for diagnostics)
    pub fn log_path(&self) -> Option<&PathBuf> {
        self.log_path.as_ref()
    }

    /// Get the backend process ID (for debugging)
    pub fn pid(&self) -> Option<u32> {
        self.child.as_ref().map(|c| c.id())
    }

    /// Get the port the backend is running on
    pub fn port(&self) -> u16 {
        self.port
    }

    /// Check if the backend process is still running
    pub fn is_running(&mut self) -> bool {
        if let Some(ref mut child) = self.child {
            match child.try_wait() {
                Ok(Some(_)) => false,  // Process has exited
                Ok(None) => true,       // Process is still running
                Err(_) => false,        // Error checking status
            }
        } else {
            false
        }
    }

    /// Stop the Python backend gracefully
    pub fn stop(&mut self) -> io::Result<()> {
        if let Some(mut child) = self.child.take() {
            println!("Stopping Python backend (PID: {})", child.id());

            // Try graceful termination first
            #[cfg(unix)]
            {
                use std::os::unix::process::CommandExt;
                // Send SIGTERM
                unsafe {
                    libc::kill(child.id() as i32, libc::SIGTERM);
                }

                // Wait up to 5 seconds for graceful shutdown
                use std::time::Duration;
                use std::thread;
                for _ in 0..50 {
                    match child.try_wait()? {
                        Some(_) => return Ok(()),
                        None => thread::sleep(Duration::from_millis(100)),
                    }
                }
            }

            // Force kill if graceful didn't work
            child.kill()?;
            child.wait()?;
        }
        Ok(())
    }

    /// Get platform-specific path to the backend executable
    fn get_backend_path() -> io::Result<PathBuf> {
        #[cfg(target_os = "windows")]
        let exe_name = "cade-backend.exe";

        #[cfg(not(target_os = "windows"))]
        let exe_name = "cade-backend";

        // In development, look in resources directory
        // In production (bundled), Tauri puts external binaries in a specific location
        let dev_path = PathBuf::from("resources").join(exe_name);

        if dev_path.exists() {
            return Ok(dev_path);
        }

        // In production, try to get from Tauri's resource directory
        #[cfg(target_os = "macos")]
        {
            // macOS: binaries are in Contents/Resources/
            if let Ok(exe_path) = std::env::current_exe() {
                let resources_path = exe_path
                    .parent()
                    .and_then(|p| p.parent())
                    .map(|p| p.join("Resources").join(exe_name));
                if let Some(path) = resources_path {
                    if path.exists() {
                        return Ok(path);
                    }
                }
            }
        }

        #[cfg(not(target_os = "macos"))]
        {
            // Windows/Linux: binaries are alongside the executable
            if let Ok(exe_path) = std::env::current_exe() {
                if let Some(parent) = exe_path.parent() {
                    let backend_path = parent.join(exe_name);
                    if backend_path.exists() {
                        return Ok(backend_path);
                    }
                }
            }
        }

        Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!("Backend executable '{}' not found", exe_name)
        ))
    }
}

impl Drop for PythonProcess {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

/// Windows Job Object that auto-kills child processes when the parent exits.
#[cfg(target_os = "windows")]
mod windows_job {
    use std::process::Child;
    use std::os::windows::io::AsRawHandle;

    type HANDLE = *mut std::ffi::c_void;
    type BOOL = i32;
    type DWORD = u32;
    type LPCWSTR = *const u16;

    const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: DWORD = 0x2000;
    const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION: DWORD = 9;

    #[repr(C)]
    #[derive(Default)]
    struct IO_COUNTERS {
        read_operation_count: u64,
        write_operation_count: u64,
        other_operation_count: u64,
        read_transfer_count: u64,
        write_transfer_count: u64,
        other_transfer_count: u64,
    }

    #[repr(C)]
    #[derive(Default)]
    struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
        per_process_user_time_limit: i64,
        per_job_user_time_limit: i64,
        limit_flags: DWORD,
        minimum_working_set_size: usize,
        maximum_working_set_size: usize,
        active_process_limit: DWORD,
        affinity: usize,
        priority_class: DWORD,
        scheduling_class: DWORD,
    }

    #[repr(C)]
    #[derive(Default)]
    struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION_STRUCT {
        basic_limit_information: JOBOBJECT_BASIC_LIMIT_INFORMATION,
        io_info: IO_COUNTERS,
        process_memory_limit: usize,
        job_memory_limit: usize,
        peak_process_memory_used: usize,
        peak_job_memory_used: usize,
    }

    extern "system" {
        fn CreateJobObjectW(security_attributes: *const std::ffi::c_void, name: LPCWSTR) -> HANDLE;
        fn SetInformationJobObject(
            job: HANDLE,
            class: DWORD,
            info: *const std::ffi::c_void,
            info_length: DWORD,
        ) -> BOOL;
        fn AssignProcessToJobObject(job: HANDLE, process: HANDLE) -> BOOL;
        fn CloseHandle(handle: HANDLE) -> BOOL;
    }

    /// RAII wrapper around a Windows Job Object handle.
    /// When dropped, the handle closes, and the OS kills all assigned processes.
    pub struct Job {
        handle: HANDLE,
    }

    impl Job {
        /// Create a job object and assign the child process to it.
        /// Returns None if any Win32 call fails (non-fatal — falls back to manual cleanup).
        pub fn new(child: &Child) -> Option<Self> {
            unsafe {
                let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                if handle.is_null() {
                    eprintln!("Failed to create job object");
                    return None;
                }

                let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION_STRUCT::default();
                info.basic_limit_information.limit_flags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

                let ok = SetInformationJobObject(
                    handle,
                    JOB_OBJECT_EXTENDED_LIMIT_INFORMATION,
                    &info as *const _ as *const std::ffi::c_void,
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION_STRUCT>() as DWORD,
                );
                if ok == 0 {
                    eprintln!("Failed to set job object limits");
                    CloseHandle(handle);
                    return None;
                }

                let process_handle = child.as_raw_handle() as HANDLE;
                let ok = AssignProcessToJobObject(handle, process_handle);
                if ok == 0 {
                    eprintln!("Failed to assign process to job object");
                    CloseHandle(handle);
                    return None;
                }

                println!("Backend assigned to job object (auto-cleanup on exit)");
                Some(Job { handle })
            }
        }
    }

    impl Drop for Job {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.handle);
            }
        }
    }

    // Job handle is just a kernel handle — safe to hold across threads
    unsafe impl Send for Job {}
    unsafe impl Sync for Job {}
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_backend_path() {
        // This test will fail in CI without the binary, but documents expected behavior
        let result = PythonProcess::get_backend_path();
        match result {
            Ok(path) => println!("Found backend at: {}", path.display()),
            Err(e) => println!("Backend not found (expected in test): {}", e),
        }
    }
}
