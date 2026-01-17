# Run dev mode with dummy Claude UI
Write-Host "Starting dev backend in DUMMY mode on port 3001..."
Write-Host "Starting Vite on port 5173..."
Write-Host "Access dev at http://localhost:5173"

Start-Process -NoNewWindow python -ArgumentList "-m", "backend.main", "--port", "3001", "--no-browser", "--dummy"
Set-Location frontend
$env:BACKEND_PORT = "3001"
npm run dev -- --port 5173
