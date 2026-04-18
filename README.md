# Paratext Project Manager

A modern project management extension for Paratext 10 Studio, built on Platform.Bible.

## Setup Instructions

### Prerequisites

1. **Install Git:** https://git-scm.com/download/win
2. **Install Node.js:** https://nodejs.org/ (get the LTS version)

Verify installation:
```powershell
git --version
node --version
npm --version
```

### Installation Steps

1. **Create a workspace folder:**
   It is recommended to put the core and extensions next to each other.
   ```powershell
   mkdir C:\Users\Dale\paratext-dev
   cd C:\Users\Dale\paratext-dev
   ```

2. **Clone paranext-core:**
   ```powershell
   git clone https://github.com/paranext/paranext-core.git
   cd paranext-core
   npm install
   cd ..
   ```

3. **Clone and install this extension:**
   ```powershell
   git clone https://github.com/dalesmucker-cpu/Paratext-Project-Management.git
   cd Paratext-Project-Management
   npm install
   ```

4. **Build the extension:**
   ```powershell
   npm run build
   ```

5. **Verify the build:**
   ```powershell
   (Get-Item dist\src\main.js).length / 1KB
   ```
   Should show ~700 (meaning 700KB)

### Loading in Paratext

**Option 1: Copy to Paratext's extension directory (Recommended for users)**
```powershell
$extDir = "$HOME\.paratext-10-studio\installed-extensions\paratextProjectManager"
New-Item -ItemType Directory -Force -Path $extDir
Copy-Item -Recurse -Force dist\* $extDir
```

**Option 2: Run Paratext with command line argument (For developers)**
```powershell
npm run start
# Automatically loads the extension into a development instance of Paratext 10.
```

### Development Workflow

For active development (auto-rebuild on file changes and auto-launch Paratext):
```powershell
npm run start
```

## Folder Structure

```
Paratext-Project-Management/
├── src/
│   ├── main.ts                          # Main entry point
│   ├── task-board.web-view.tsx          # Task Board Component
│   ├── my-tasks.web-view.tsx            # My Tasks Component
│   ├── project-overview.web-view.tsx    # Details Component
│   └── types/
│       └── project-manager.d.ts         # TypeScript types
├── dist/                                # Built extension
├── assets/
│   └── displayData.json
├── contributions/
│   └── menus.json
├── webpack/                             # Webpack configuration
├── package.json
├── manifest.json
└── README.md
```

## Troubleshooting

### Extension appears blank or commands do not work
- Make sure you ran `npm run build`
- Verify `dist/src/main.js` exists
- Check you're loading from the `dist/` folder, not root

### "Cannot use import statement outside a module"
- The extension wasn't built. Run `npm run build`
- Or Paratext is loading from wrong folder

### npm install fails
- Make sure `paranext-core` is checked out in the *parent* directory alongside this extension folder.
- Ensure you have built/installed `paranext-core` (`npm install` inside it).

### Build fails
```powershell
# Clear and rebuild
Remove-Item -Recurse -Force node_modules
Remove-Item package-lock.json
npm install
npm run build
```

## License

MIT
