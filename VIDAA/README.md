# JellyClient for VIDAA

This folder contains the VIDAA television client and the PC server used to run
it. The television plays the video; the PC hosts the page and connects it to
Jellyfin. See [VIDAA features](FEATURES.md) for playback controls, supported
formats, and current limitations.

## What you need

- A Windows PC and a VIDAA television on the same home network.
- A current Jellyfin server.
- [Node.js](https://nodejs.org/en/download) version 22 or newer. Choose an LTS
  Windows installer if you are unsure.
- [pnpm](https://pnpm.io/installation) version 11.

The television outputs the sound. Use its speakers or an audio system connected
to the television.

## Download and install

Download the repository ZIP from GitHub and extract it, or clone it with Git.
Open PowerShell in the extracted `JellyClient` folder.

Node.js includes `npm`. Install pnpm with:

```powershell
npm install --global pnpm@latest-11
```

Confirm that both commands work:

```powershell
node --version
pnpm --version
```

Install JellyClient's packages:

```powershell
pnpm install
```

These installation steps are only needed once.

## Start the VIDAA client

From the main `JellyClient` folder, run:

```powershell
pnpm vidaa:serve
```

This builds the VIDAA files and starts the server on port 80. Keep the
PowerShell window open while using the television app.

On the PC, open:

```text
http://localhost/connect
```

Enter the Jellyfin server address, then either enter a username and password or
use Quick Connect. The page then shows the address to open on the television,
for example:

```text
http://192.168.1.20/
```

Open that address in the VIDAA browser and bookmark it if the television allows
bookmarks. If Windows Firewall asks about Node.js, allow access on private
networks.

To stop the server, return to PowerShell and press `Ctrl+C`.

## Use a different port

Port 80 may already be used by another program. To use port 8090 instead:

```powershell
$env:VIDAA_PORT = '8090'
pnpm vidaa:serve
```

Then use these addresses:

```text
PC setup: http://localhost:8090/connect
TV app:   http://<PC-IP>:8090/
```

Replace `<PC-IP>` with the address shown on the connection page. Any available
port from 1 through 65535 can be used.

To return to port 80 in the current PowerShell window:

```powershell
Remove-Item Env:VIDAA_PORT
```

## Signal probe

The signal probe plays chosen files without connecting the library interface.
It can be useful when checking whether a television accepts SDR, HDR10, or
Dolby Vision files.

Start the VIDAA server, then open this page on the PC:

```text
http://localhost:<PORT>/setup
```

Add media files stored on the PC or direct media URLs. Open `/probe` on the
television to play them. Local probe settings and samples are ignored by Git.

## Later starts and updates

If the files have already been built, this starts them without rebuilding:

```powershell
pnpm vidaa:start
```

After downloading an updated version of JellyClient, run these commands again:

```powershell
pnpm install
pnpm vidaa:serve
```

## If the television page does not load

Check the following:

1. The PC and television are connected to the same router or local network.
2. The PowerShell window running `pnpm vidaa:serve` is still open.
3. The TV address uses the current PC IP address and the selected port.
4. Node.js is allowed through Windows Firewall on private networks.
5. Another program is not using the selected port. Try port 8090 if needed.
6. `http://localhost:<PORT>/connect` opens on the PC before testing the TV.

The server is meant for use on a trusted home network. Do not forward its port
through the router or expose it to the Internet.
