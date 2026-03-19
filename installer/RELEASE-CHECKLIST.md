# Release Checklist

## Before Release
- [ ] `node scripts/bundle-agent.js` executed (agent bundle up to date)
- [ ] `Build-Installers.ps1` completed without errors
- [ ] Teacher-Setup.exe tested on clean PC
- [ ] Student-Setup.exe tested on clean PC
- [ ] Change default admin password in .env

## Teacher PC
1. Run `Teacher-Setup.exe`
2. Note the server URL displayed
3. Change admin password at first login

## Student PCs
1. Run `Student-Setup.exe` on each student PC
2. Enter teacher's server URL when prompted
3. Verify PC appears in dashboard
