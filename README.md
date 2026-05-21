# Paratext Track Changes Extension

A Platform.Bible extension for tracking changes in Paratext 10 Studio.

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

1. **Navigate to this folder:**

   ```powershell
   cd "C:\Users\Dale\paratect-track-changes"
   ```

2. **Clone paranext-core (same parent folder):**

   ```powershell
   git clone https://github.com/paranext/paranext-core.git
   cd paranext-core
   npm install
   cd ..
   ```

3. **Install this extension's dependencies:**

   ```powershell
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

**Option 1: Copy to Paratext's extension directory**

```powershell
$extDir = "$HOME\.paratext-10-studio\installed-extensions\paratext-track-changes"
New-Item -ItemType Directory -Force -Path $extDir
Copy-Item -Recurse -Force dist\* $extDir
```

**Option 2: Run Paratext with command line argument**

```powershell
$distPath = (Get-Item dist).FullName
& "$HOME\AppData\Local\Programs\paratext-10-studio\Paratext 10 Studio.exe" --extensions $distPath
```

### Development Workflow

For active development (auto-rebuild on file changes):

```powershell
npm run watch
```

In another terminal, run Paratext with your extension.

## Folder Structure

```
paratext-track-changes/
├── src/
│   ├── main.ts                    # Main entry point
│   └── types/
│       └── paratext-track-changes.d.ts  # TypeScript types
├── dist/                          # Built extension (created by npm run build)
│   ├── src/
│   │   └── main.js               # Compiled bundle
│   ├── manifest.json
│   └── ...
├── assets/
│   ├── displayData.json
│   └── descriptions/
│       └── description-en.md
├── contributions/
│   ├── menus.json
│   ├── settings.json
│   └── ...
├── webpack/                       # Webpack configuration
├── package.json
├── manifest.json
└── README.md
```

## Troubleshooting

### Extension appears blank

- Make sure you ran `npm run build`
- Verify `dist/src/main.js` exists and is ~700KB
- Check you're loading from the `dist/` folder, not root

### "Cannot use import statement outside a module"

- The extension wasn't built. Run `npm run build`
- Or Paratext is loading from wrong folder

### npm install fails

- Make sure paranext-core is in the parent directory
- Check paths in package.json match your folder structure

### Build fails

```powershell
# Clear and rebuild
Remove-Item -Recurse -Force node_modules
Remove-Item package-lock.json
npm install
npm run build
```

## Next Steps

- Modify `src/main.ts` to add your track changes functionality
- Add WebViews by creating `.web-view.tsx` files
- Read the Platform.Bible documentation: https://github.com/paranext/paranext-extension-template/wiki

## License

MIT
