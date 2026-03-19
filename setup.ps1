# Paratext Track Changes Extension - Quick Setup Script
# Run this in PowerShell from the project folder

Write-Host "=== Paratext Track Changes Extension Setup ===" -ForegroundColor Cyan
Write-Host ""

# Check if paranext-core exists
if (-not (Test-Path "../paranext-core")) {
    Write-Host "Step 1: Cloning paranext-core..." -ForegroundColor Yellow
    cd ..
    git clone https://github.com/paranext/paranext-core.git
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Failed to clone paranext-core" -ForegroundColor Red
        exit 1
    }
    
    Write-Host "Step 2: Installing paranext-core dependencies (this takes 5-10 minutes)..." -ForegroundColor Yellow
    cd paranext-core
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Failed to install paranext-core dependencies" -ForegroundColor Red
        exit 1
    }
    cd ..
    cd paratext-track-changes
} else {
    Write-Host "paranext-core already exists, skipping clone" -ForegroundColor Green
}

Write-Host ""
Write-Host "Step 3: Installing extension dependencies..." -ForegroundColor Yellow
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to install extension dependencies" -ForegroundColor Red
    Write-Host "Make sure paranext-core is in the parent directory" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Step 4: Building extension..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Build failed" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Step 5: Verifying build..." -ForegroundColor Yellow
if (Test-Path "dist\src\main.js") {
    $sizeKB = (Get-Item dist\src\main.js).length / 1KB
    Write-Host "Build successful! dist\src\main.js is $([math]::Round($sizeKB, 2)) KB" -ForegroundColor Green
    
    if ($sizeKB -lt 100) {
        Write-Host "WARNING: File size seems small. Build may not have completed correctly." -ForegroundColor Yellow
    }
} else {
    Write-Host "ERROR: dist\src\main.js was not created" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "=== Setup Complete! ===" -ForegroundColor Green
Write-Host ""
Write-Host "To load in Paratext, run ONE of these commands:" -ForegroundColor Cyan
Write-Host ""
Write-Host "Option 1 - Copy to Paratext extensions folder:" -ForegroundColor White
Write-Host '  $extDir = "$HOME\.paratext-10-studio\installed-extensions\paratext-track-changes"' -ForegroundColor Gray
Write-Host '  New-Item -ItemType Directory -Force -Path $extDir' -ForegroundColor Gray
Write-Host '  Copy-Item -Recurse -Force dist\* $extDir' -ForegroundColor Gray
Write-Host ""
Write-Host "Option 2 - Run Paratext with command line:" -ForegroundColor White
Write-Host '  $distPath = (Get-Item dist).FullName' -ForegroundColor Gray
Write-Host '  & "$HOME\AppData\Local\Programs\paratext-10-studio\Paratext 10 Studio.exe" --extensions $distPath' -ForegroundColor Gray
Write-Host ""
